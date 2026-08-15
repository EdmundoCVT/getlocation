// tests/contrat-apercu-fill.test.js
//
// Garde-fou pour le bug constaté le 15/08/2026 : le bouton "Télécharger
// l'aperçu" de la vue AGENCE (contrat.html, initOwnerView) produisait un PDF
// dont les articles ("Conditions de location") affichaient des "…" non
// remplis (véhicule, dates, caution, km inclus jamais injectés), alors que
// le tableau récapitulatif au-dessus était correct. Cause : le remplissage
// des <span data-fill="..."> dans #contractText n'existait que dans la vue
// CLIENT (initClientView), jamais appelé côté agence avant lecture du texte
// par texteConditionsLocation() (utilisée pour construire le PDF).
//
// Corrigé en extrayant ce remplissage dans remplirTexteArticles(payload),
// appelée par genererPDF() lui-même juste avant de lire le texte — donc
// systématiquement, quelle que soit la vue d'où le PDF est généré.
//
// Ce test n'exécute PAS genererPDF() (dépend de jsPDF chargé depuis un CDN,
// indisponible dans cet environnement de test) : il vérifie directement le
// mécanisme qui a causé et qui corrige le bug — remplirTexteArticles() suivi
// de texteConditionsLocation() — en extrayant le vrai code de contrat.html
// (pas une copie à la main), comme tests/send-contract-email.test.js le
// fait déjà pour encodeData/decodeData.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const dataJsSource = fs.readFileSync(path.join(__dirname, "..", "js", "data.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "..", "contrat.html"), "utf8");

// Extrait le bloc de fonctions du script inline de contrat.html, entre la
// balise <script> (juste après js/data.js) et le début de l'auto-init en bas
// de fichier (`var params = new URLSearchParams...`) qui a besoin d'un vrai
// `window.location`/DOM complet qu'on ne fournit pas ici.
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

// Extrait le bloc <div class="contract-text" id="contractText">...</div>
// (comptage de profondeur sur les <div>, pas une regex non-gourmande qui
// s'arrêterait au premier </div> imbriqué).
function extractContractTextDiv() {
  const startMarker = '<div class="contract-text" id="contractText">';
  const start = html.indexOf(startMarker);
  assert.ok(start !== -1, 'Bloc #contractText introuvable dans contrat.html');
  let depth = 0;
  let i = start;
  const divOpen = /<div\b[^>]*>/g;
  const re = /<div\b[^>]*>|<\/div>/g;
  re.lastIndex = start;
  let match;
  while ((match = re.exec(html))) {
    if (match[0].startsWith("</")) depth--;
    else depth++;
    if (depth === 0) {
      return html.slice(start, match.index + match[0].length);
    }
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

test("reproduction du bug : sans remplirTexteArticles(), les articles gardent leurs \"…\" non remplis", () => {
  const win = buildWindow();
  const payload = win.construirePayload(makeReservationData(), null, null);
  const texte = win.texteConditionsLocation();
  assert.match(texte, /loue au locataire désigné ci-dessus le véhicule …, immatriculé …/,
    "ce test doit constater le bug initial (placeholders non remplis) avant correction — si ça échoue, la structure du HTML a changé");
});

test("remplirTexteArticles() + texteConditionsLocation() : les articles reflètent les vraies valeurs de la réservation, plus aucun \"…\" résiduel", () => {
  const win = buildWindow();
  const payload = win.construirePayload(makeReservationData(), null, null);
  win.remplirTexteArticles(payload);
  const texte = win.texteConditionsLocation();

  assert.match(texte, /le véhicule Peugeot 3008, immatriculé AB-123-CD/);
  assert.match(texte, /Lieu : Agence Grasse\./);
  assert.match(texte, /Montant total de la location : \d+([.,]\d+)?\s?€\./);
  assert.match(texte, /Une caution de \d+([.,]\d+)?\s?€ est prélevée avant remise des clés, réglée par carte bancaire\./);
  assert.match(texte, /soit \d[\d\s]* km au total pour la durée du contrat/);

  // Plus aucun span data-fill non substitué (hors ceux volontairement
  // absents du texte, ex. le second conducteur non applicable ici).
  assert.doesNotMatch(texte, /véhicule …,/, "le véhicule doit être substitué");
  assert.doesNotMatch(texte, /immatriculé …/, "l'immatriculation doit être substituée");
  assert.doesNotMatch(texte, /Lieu : …\./, "le lieu doit être substitué");
  assert.doesNotMatch(texte, /location : …\./, "le montant total doit être substitué");
  assert.doesNotMatch(texte, /caution de … est/, "la caution doit être substituée");
  assert.doesNotMatch(texte, /soit … km/, "le kilométrage inclus doit être substitué");
});

test("second conducteur : la clause correspondante est révélée et remplie quand l'option est sélectionnée", () => {
  const win = buildWindow();
  const data = makeReservationData({ secondConducteur: true, prenom2: "Marie", nom2: "Dupont", permis2: "123456789" });
  const payload = win.construirePayload(data, null, null);
  win.remplirTexteArticles(payload);
  const texte = win.texteConditionsLocation();

  assert.match(texte, /Un second conducteur, Marie Dupont \(permis n° 123456789\), est autorisé/);
  const clause = win.document.getElementById("secondConducteurClause");
  assert.notEqual(clause.style.display, "none");
});
