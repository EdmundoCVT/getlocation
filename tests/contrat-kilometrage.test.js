// tests/contrat-kilometrage.test.js
//
// Tests de calculEtatKilometrique() et des champs km_* de construirePayload()
// dans contrat.html — exécute le vrai code du fichier (technique identique à
// tests/contrat-apercu-fill.test.js), pas une réimplémentation à la main.

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
  assert.ok(openTag !== -1, "Balise <script> introuvable après js/data.js dans contrat.html");
  const bodyStart = openTag + "<script>".length;
  const initMarker = "var params = new URLSearchParams";
  const bodyEnd = html.indexOf(initMarker, bodyStart);
  assert.ok(bodyEnd !== -1, "Marqueur d'auto-init introuvable (structure de contrat.html changée ?)");
  return html.slice(bodyStart, bodyEnd);
}

function extractContractTextDiv() {
  const startMarker = '<div class="contract-text" id="contractText">';
  const start = html.indexOf(startMarker);
  assert.ok(start !== -1, 'Bloc #contractText introuvable dans contrat.html');
  let depth = 0;
  const re = /<div\b[^>]*>|<\/div>/g;
  re.lastIndex = start;
  let match;
  while ((match = re.exec(html))) {
    if (match[0].startsWith("</")) depth--;
    else depth++;
    if (depth === 0) return html.slice(start, match.index + match[0].length);
  }
  throw new Error("Bloc #contractText non refermé (parsing)");
}

function buildWindow() {
  const dom = new JSDOM(`<!DOCTYPE html><body>${extractContractTextDiv()}</body>`, {
    url: "https://getlocation.fr/contrat.html",
    runScripts: "outside-only"
  });
  dom.window.eval(dataJsSource);
  dom.window.eval(extractScriptBody());
  return dom.window;
}

function makeReservationData(overrides = {}) {
  return {
    vehiculeId: "peugeot-3008",
    immat: "AB-123-CD",
    lieu: "Agence Grasse",
    depart: "2027-02-09T10:00",
    retour: "2027-02-10T10:00", // 1 jour facturable => 200 km inclus
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
    notes: "",
    kmDepart: "",
    kmRetour: "",
    ...overrides
  };
}

test("calculEtatKilometrique : ni départ ni retour renseignés => rien de calculable", () => {
  const win = buildWindow();
  const etat = win.calculEtatKilometrique("", "", 200);
  assert.equal(etat.kmDepart, null);
  assert.equal(etat.kmRetour, null);
  assert.equal(etat.kmParcourus, null);
  assert.equal(etat.coherent, true);
});

test("calculEtatKilometrique : seul le départ est renseigné => pas de distance, pas d'incohérence", () => {
  const win = buildWindow();
  const etat = win.calculEtatKilometrique("42150", "", 200);
  assert.equal(etat.kmDepart, 42150);
  assert.equal(etat.kmRetour, null);
  assert.equal(etat.kmParcourus, null);
  assert.equal(etat.coherent, true);
});

test("calculEtatKilometrique : distance parcourue correcte, sans dépassement du forfait", () => {
  const win = buildWindow();
  const etat = win.calculEtatKilometrique("42150", "42300", 200);
  assert.equal(etat.kmParcourus, 150);
  assert.equal(etat.kmSupplementaire, null);
  assert.equal(etat.montantSupplementaire, null);
  assert.equal(etat.coherent, true);
});

test("calculEtatKilometrique : dépassement du forfait inclus calculé et chiffré au tarif existant (0,25 €/km)", () => {
  const win = buildWindow();
  const etat = win.calculEtatKilometrique("42150", "42736", 200); // 586 km, 200 inclus => 386 de plus
  assert.equal(etat.kmParcourus, 586);
  assert.equal(etat.kmSupplementaire, 386);
  // TARIF_KM_SUPPLEMENTAIRE est un `const` de script — non accessible via
  // `win.` (les const de haut niveau n'attachent pas à window, contrairement
  // aux déclarations `function`) : on vérifie le résultat produit plutôt que
  // la constante elle-même (déjà couvert par le test data-fill ci-dessous).
  assert.equal(Math.round(etat.montantSupplementaire * 100) / 100, 96.5);
});

test("calculEtatKilometrique : retour inférieur au départ => incohérent, aucune distance calculée", () => {
  const win = buildWindow();
  const etat = win.calculEtatKilometrique("42736", "42150", 200);
  assert.equal(etat.coherent, false);
  assert.equal(etat.kmParcourus, null);
});

test("calculEtatKilometrique : valeur négative ignorée comme si le champ était vide", () => {
  const win = buildWindow();
  const etat = win.calculEtatKilometrique("-10", "100", 200);
  assert.equal(etat.kmDepart, null);
  assert.equal(etat.kmParcourus, null);
});

// toLocaleString('fr-FR') utilise une espace insécable fine (U+202F) comme
// séparateur de milliers, pas une espace normale : on construit les valeurs
// attendues avec la même fonction plutôt que des littéraux "42 150 km" qui
// échoueraient silencieusement (diff visuellement identique).
function km(n) {
  return n.toLocaleString("fr-FR") + " km";
}

test("la clause légale (Article 4) ne code plus le tarif en dur, elle référence la constante via data-fill", () => {
  assert.doesNotMatch(html, /facturé <strong>0,25 € \/ km<\/strong>/, "la clause légale ne doit plus contenir de tarif codé en dur");
  assert.match(html, /data-fill="tarifKmSupp"/, "la clause légale doit référencer le tarif via data-fill");
});

test("construirePayload : sans kilométrage renseigné, aucune section kilométrique (rétrocompatible)", () => {
  const win = buildWindow();
  const payload = win.construirePayload(makeReservationData(), null, null);
  assert.equal(payload.km_depart, "");
  assert.equal(payload.km_retour, "");
  assert.equal(payload.km_parcourus, "");
});

test("construirePayload : départ seul => retour affiché « À compléter à la restitution »", () => {
  const win = buildWindow();
  const payload = win.construirePayload(makeReservationData({ kmDepart: "42150" }), null, null);
  assert.equal(payload.km_depart, km(42150));
  assert.equal(payload.km_retour, "À compléter à la restitution");
  assert.equal(payload.km_parcourus, "");
});

test("construirePayload : départ + retour => distance et statut « aucun supplément » si sous le forfait", () => {
  const win = buildWindow();
  // 1 jour facturable (depart->retour = 24h) => 200 km inclus.
  const payload = win.construirePayload(makeReservationData({ kmDepart: "42150", kmRetour: "42300" }), null, null);
  assert.equal(payload.km_retour, km(42300));
  assert.equal(payload.km_parcourus, km(150));
  assert.equal(payload.km_supplementaire_statut, "aucun");
  assert.equal(payload.km_supplementaire, "");
});

test("construirePayload : dépassement du forfait => montant supplémentaire chiffré, tarif exposé", () => {
  const win = buildWindow();
  const payload = win.construirePayload(makeReservationData({ kmDepart: "42150", kmRetour: "42736" }), null, null);
  assert.equal(payload.km_parcourus, km(586));
  assert.equal(payload.km_supplementaire_statut, "depasse");
  assert.equal(payload.km_supplementaire, km(386));
  assert.match(payload.km_tarif_supplementaire, /0,25\s?€/);
  assert.match(payload.km_montant_supplementaire, /96,50\s?€/); // 386 * 0.25
});

test("construirePayload : retour incohérent (< départ) => aucune distance ni supplément calculés, pas de plantage", () => {
  const win = buildWindow();
  const payload = win.construirePayload(makeReservationData({ kmDepart: "42736", kmRetour: "42150" }), null, null);
  assert.equal(payload.km_parcourus, "");
  assert.equal(payload.km_supplementaire_statut, "");
});
