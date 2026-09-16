// tests/contrat-deposit-amount.test.js
//
// contrat.html#construirePayload() : le dépôt de garantie affiché sur le
// PDF/l'aperçu doit être celui FIGÉ pour la location (`data.depositAmount`,
// voir lireDonneesFormulaire()/remplirFormulaire() dans contrat.html),
// jamais recalculé depuis le tarif ACTUEL du véhicule — sinon rouvrir ou
// dupliquer un contrat déjà généré afficherait un montant différent de
// celui réellement convenu si VEHICULES[].caution a changé depuis (voir
// CLAUDE.md, révision du 16/09/2026 des dépôts de garantie).
//
// Même technique que tests/contrat-apercu-fill.test.js : exécute le VRAI
// code de contrat.html (pas une copie à la main) dans un bac à sable JSDOM.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { getVehiculeParId } = require("../js/data.js");

const dataJsSource = fs.readFileSync(path.join(__dirname, "..", "js", "data.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "..", "contrat.html"), "utf8");

function extractScriptBody() {
  const afterDataJs = html.indexOf("js/data.js");
  const openTag = html.indexOf("<script>", afterDataJs);
  assert.ok(openTag !== -1, "Balise <script> introuvable après js/data.js dans contrat.html");
  const bodyStart = openTag + "<script>".length;
  const initMarker = "var params = new URLSearchParams";
  const bodyEnd = html.indexOf(initMarker, bodyStart);
  assert.ok(bodyEnd !== -1, "Marqueur d'auto-init introuvable (structure de contrat.html changée ?)");
  return html.slice(bodyStart, bodyEnd);
}

function buildWindow() {
  const dom = new JSDOM("<!DOCTYPE html><body></body>", {
    url: "https://getlocation.fr/contrat.html",
    runScripts: "outside-only"
  });
  dom.window.eval(dataJsSource);
  dom.window.eval(extractScriptBody());
  return dom.window;
}

function makeReservationData(overrides = {}) {
  return {
    vehiculeId: "peugeot-3008", // caution actuelle : 900 € (js/data.js)
    immat: "AB-123-CD",
    lieu: "Agence Grasse",
    depart: "2027-02-09T10:00",
    retour: "2027-02-10T10:00",
    modeCaution: "carte",
    prenom: "Edmond",
    nom: "Tavares",
    naissance: "1986-12-19",
    adresse: "", codePostal: "", ville: "",
    tel: "+33667485430",
    email: "edmundo06@gmail.com",
    permis: "",
    secondConducteur: false,
    prenom2: "", nom2: "", permis2: "",
    livraison: false,
    livraisonRue: "", livraisonCP: "", livraisonVille: "",
    ...overrides
  };
}

test("construirePayload : sans depositAmount figé, reprend le tarif ACTUEL du véhicule (nouveau contrat)", () => {
  const win = buildWindow();
  const payload = win.construirePayload(makeReservationData(), null, null);
  assert.equal(payload.caution, win.formatEUR(getVehiculeParId("peugeot-3008").caution));
});

test("construirePayload : avec depositAmount figé, IGNORE le tarif actuel du véhicule (contrat rouvert/dupliqué)", () => {
  const win = buildWindow();
  // Simule un contrat généré quand la Peugeot 3008 coûtait encore 600 € de
  // caution (avant la révision du 16/09/2026) : rouvrir ce contrat ne doit
  // jamais afficher 900 € (tarif courant) à la place.
  const data = makeReservationData({ depositAmount: 600 });
  const payload = win.construirePayload(data, null, null);
  assert.equal(payload.caution, win.formatEUR(600));
  assert.notEqual(payload.caution, win.formatEUR(getVehiculeParId("peugeot-3008").caution));
});

test("construirePayload : chaque véhicule utilise son propre tarif actuel quand aucun montant n'est figé", () => {
  const win = buildWindow();
  const cas = [
    ["opel-corsa", 650],
    ["peugeot-2008-hybrid", 750],
    ["peugeot-3008", 900],
    ["toyota-proace-city", 1000]
  ];
  for (const [vehiculeId, attendu] of cas) {
    const payload = win.construirePayload(makeReservationData({ vehiculeId }), null, null);
    assert.equal(payload.caution, win.formatEUR(attendu), vehiculeId);
  }
});
