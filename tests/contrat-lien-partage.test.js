// tests/contrat-lien-partage.test.js
//
// Garde-fou pour le bug constaté le 18/08/2026 : le lien "?data=..."
// (bouton "Copier"/WhatsApp de la vue AGENCE, contrat.html) était encodé en
// base64 standard, dont l'alphabet contient "+", "/" et un "=" de
// padding. Deux conséquences réelles :
//  1. WhatsApp ne reconnaissait pas le texte collé comme un lien cliquable
//     (le "=" terminal en particulier casse la détection de lien de
//     plusieurs messageries).
//  2. Plus grave : côté lecture, contrat.html lit le paramètre via
//     `new URLSearchParams(window.location.search).get('data')`, qui décode
//     "+" en espace (norme application/x-www-form-urlencoded) — un lien
//     dont le base64 contenait un "+" se retrouvait donc silencieusement
//     corrompu avant même atob(), pour certaines réservations seulement
//     (selon le contenu, donc un bug intermittent, difficile à repérer).
//
// Corrigé en passant en base64url (RFC 4648 §5 : "-"/"_", pas de padding),
// qui ne contient aucun des trois caractères problématiques. decodeData()
// reste rétro-compatible avec un ancien lien déjà envoyé au format base64
// standard (voir aussi encodeContractData() dans src/lib/send-contract-email.js,
// qui doit produire le même format côté serveur).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const dataJsSource = fs.readFileSync(path.join(__dirname, "..", "js", "data.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "..", "contrat.html"), "utf8");

function extractScriptBody() {
  const afterDataJs = html.indexOf("js/data.js");
  const openTag = html.indexOf("<script>", afterDataJs);
  const bodyStart = openTag + "<script>".length;
  const initMarker = "var params = new URLSearchParams";
  const bodyEnd = html.indexOf(initMarker, bodyStart);
  return html.slice(bodyStart, bodyEnd);
}

function buildWindow() {
  const dom = new JSDOM(`<!DOCTYPE html><body></body>`, {
    url: "https://getlocation.fr/contrat.html",
    runScripts: "outside-only"
  });
  dom.window.eval(dataJsSource);
  dom.window.eval(extractScriptBody());
  return dom.window;
}

test("encodeData() ne produit jamais de \"+\", \"/\" ni \"=\" (base64url, pas base64 standard)", () => {
  const win = buildWindow();
  // Objet choisi pour forcer un "+" en base64 standard (vérifié par essais
  // successifs) : sert de garde-fou contre une régression silencieuse,
  // dépendante du contenu, comme celle qui a causé le bug.
  const echantillons = [
    { nom: "Dupont", prenom: "Jean", notes: "" },
    { nom: "Müller-Bénard", prenom: "Éloïse à la côte", tel: "+33 6 12 34 56 78" },
    { a: 1, b: 2, c: 3, d: 4, e: 5, f: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" }
  ];
  for (const obj of echantillons) {
    const encoded = win.encodeData(obj);
    assert.doesNotMatch(encoded, /[+/=]/, `encodeData() a produit un caractère interdit pour ${JSON.stringify(obj)}`);
  }
});

test("encodeData() suivi de decodeData() restitue exactement l'objet d'origine (round-trip)", () => {
  const win = buildWindow();
  const original = { vehiculeId: "opel-corsa", prenom: "Riahd", tel: "+33612345678", livraison: false, montant: 118 };
  const url = "https://getlocation.fr/contrat?data=" + win.encodeData(original);
  const parsed = new URL(url);
  // Simule exactement la lecture faite par contrat.html : URLSearchParams
  // décode "+" en espace — c'est justement ce que base64url doit éviter.
  const lu = new win.URLSearchParams(parsed.search).get("data");
  // JSON.parse/stringify neutralise l'écart de "realm" jsdom/Node (objets
  // structurellement identiques mais prototypes différents, sinon rejetés
  // par deepStrictEqual) — pas un contournement du test, juste la même
  // convention que le reste de la suite pour comparer une valeur produite
  // dans la fenêtre jsdom.
  assert.deepEqual(JSON.parse(JSON.stringify(win.decodeData(lu))), original);
});

test("decodeData() reste compatible avec un ancien lien déjà envoyé au format base64 standard", () => {
  const win = buildWindow();
  const original = { nom: "Ancien lien", prenom: "Test" };
  const ancienFormat = Buffer.from(JSON.stringify(original), "utf8").toString("base64"); // avec "+"/"/"/"=" éventuels
  assert.deepEqual(JSON.parse(JSON.stringify(win.decodeData(ancienFormat))), original);
});

test("encodeContractData() côté serveur (src/lib/send-contract-email.js) produit le même format base64url que encodeData()", () => {
  const win = buildWindow();
  const { encodeContractData } = require("../src/lib/send-contract-email.js");
  const data = { vehiculeId: "peugeot-3008", prenom: "Marie", nom: "Curie", livraison: true };
  const encodedByServer = encodeContractData(data);
  assert.doesNotMatch(encodedByServer, /[+/=]/, "encodeContractData() doit aussi produire du base64url");
  assert.deepEqual(JSON.parse(JSON.stringify(win.decodeData(encodedByServer))), data);
});
