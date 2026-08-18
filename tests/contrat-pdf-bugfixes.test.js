// tests/contrat-pdf-bugfixes.test.js
//
// Garde-fou pour les deux bugs signalés sur le PDF du contrat (contrat.html) :
//  1. "2 /000 km" au lieu de "2 000 km" — jsPDF (police standard helvetica,
//     encodage WinAnsi) n'affiche pas correctement l'espace fine insécable
//     (U+202F, séparateur de milliers de toLocaleString('fr-FR')) ni l'espace
//     insécable (U+00A0, utilisé avant "€" par Intl.NumberFormat). Corrigé en
//     remplaçant ces deux caractères par une espace normale juste avant
//     l'écriture dans le PDF (voir nettoyerTextePdf(), appliquée à
//     doc.text()/doc.splitTextToSize() dans genererPDF()).
//  2. "0 €/km" au lieu de "0,25 €/km" — formatEUR() a maximumFractionDigits:0
//     et arrondissait 0,25 à 0. Corrigé avec formatEURPrecis() (2 décimales),
//     utilisée spécifiquement pour le tarif kilométrique supplémentaire.
//
// Vérifie aussi la règle P0 "jamais de calcul de prix dupliqué" : le contrat
// doit désormais recalculer via calculerPrixTotal() de js/data.js (incluant
// la réduction durée à partir de 5 jours), plus le contrôle de plausibilité
// qui bloque la génération d'un PDF si une valeur formatée contient "NaN".

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

function buildWindow() {
  const dom = new JSDOM(`<!DOCTYPE html><body></body>`, {
    url: "https://getlocation.fr/contrat.html",
    runScripts: "outside-only"
  });
  dom.window.eval(dataJsSource);
  dom.window.eval(extractScriptBody());
  return dom.window;
}

test("nettoyerTextePdf() remplace l'espace fine insécable (U+202F) et l'espace insécable (U+00A0) par une espace normale", () => {
  const win = buildWindow();
  const avecEspacesSpeciales = "2 000 km" + " et " + "0,25 €";
  const nettoye = win.nettoyerTextePdf(avecEspacesSpeciales);
  assert.equal(nettoye, "2 000 km et 0,25 €");
  assert.doesNotMatch(nettoye, /[  ]/);
});

test("nettoyerTextePdf() laisse le texte normal inchangé", () => {
  const win = buildWindow();
  assert.equal(win.nettoyerTextePdf("Peugeot 3008, immatriculé AB-123-CD"), "Peugeot 3008, immatriculé AB-123-CD");
});

test("formatEURPrecis(0.25) affiche 0,25 € — pas 0 € comme formatEUR (bug '0 €/km' corrigé)", () => {
  const win = buildWindow();
  assert.match(win.formatEURPrecis(0.25), /0,25\s?€/);
  // Le bug originel : formatEUR (0 décimale) arrondit 0,25 à 0.
  assert.match(win.formatEUR(0.25), /^0\s?€$/);
});

test("calculerPrixContrat() applique la réduction durée (5 jours ou plus) — jamais un calcul local qui l'oublierait", () => {
  const win = buildWindow();
  const data = {
    vehiculeId: "opel-corsa",
    depart: "2027-03-01T10:00",
    retour: "2027-03-06T10:00", // 5 jours
    secondConducteur: false,
    livraison: false
  };
  const prix = win.calculerPrixContrat(data);
  assert.ok(prix, "calculerPrixContrat ne doit pas renvoyer null pour des dates valides");
  assert.equal(prix.jours, 5);
  assert.ok(prix.reductionDuree, "la réduction durée (5 jours ou plus) doit être appliquée");
  assert.equal(prix.total, prix.sousTotalBrut - prix.reductionDuree.montant);
  // Vérifie que le total reflète bien js/data.js (source unique), pas une
  // reproduction locale qui aurait pu diverger.
  const attendu = win.calculerPrixTotal({
    vehiculeId: "opel-corsa", dateDebut: "2027-03-01", heureDebut: "10:00",
    dateFin: "2027-03-06", heureFin: "10:00", options: [], codePromo: ""
  });
  assert.equal(prix.total, attendu.total);
});

test("calculerPrixContrat() renvoie null pour des dates incohérentes (retour avant départ), sans planter", () => {
  const win = buildWindow();
  const prix = win.calculerPrixContrat({
    vehiculeId: "opel-corsa",
    depart: "2027-03-06T10:00",
    retour: "2027-03-01T10:00",
    secondConducteur: false,
    livraison: false
  });
  assert.equal(prix, null);
});

test("champsPdfSuspects() détecte une valeur 'NaN €' formatée et bloque la génération avant jsPDF", () => {
  const win = buildWindow();
  const suspects = Array.from(win.champsPdfSuspects({ total: "NaN €", caution: "500 €", kmInclus: "600 km", duree: "3 jours" }));
  assert.deepEqual(suspects, ["total"]);
  const aucunSuspect = Array.from(win.champsPdfSuspects({ total: "590 €", caution: "500 €", kmInclus: "600 km", duree: "3 jours" }));
  assert.deepEqual(aucunSuspect, []);
});

test("construirePayload() : total 'NaN €' si les dates du formulaire sont incohérentes (contrôle de plausibilité, pas un plantage silencieux)", () => {
  const win = buildWindow();
  const payload = win.construirePayload({
    vehiculeId: "opel-corsa", immat: "HJ-967-KQ", lieu: "Agence Grasse",
    depart: "2027-03-06T10:00", retour: "2027-03-01T10:00",
    modeCaution: "carte", prenom: "Jean", nom: "Dupont", naissance: "1990-01-01",
    adresse: "", codePostal: "", ville: "", tel: "", email: "", permis: "",
    secondConducteur: false, prenom2: "", nom2: "", permis2: "",
    livraison: false, livraisonRue: "", livraisonCP: "", livraisonVille: ""
  }, null, null);
  assert.match(payload.total, /NaN/);
  const suspects = Array.from(win.champsPdfSuspects(payload));
  assert.ok(suspects.includes("total"), "le contrôle de plausibilité doit détecter le total incorrect");
});

test("lignesDetailFinancier() construit le détail (sous-total, réduction durée, options, total) à partir de calculerPrixTotal()", () => {
  const win = buildWindow();
  const prix = win.calculerPrixTotal({
    vehiculeId: "opel-corsa", dateDebut: "2027-03-01", heureDebut: "10:00",
    dateFin: "2027-03-06", heureFin: "10:00", options: ["livraison-adresse"], codePromo: ""
  });
  const lignes = win.lignesDetailFinancier(prix);
  const labels = lignes.map((l) => l[0]);
  assert.ok(labels.some((l) => l.startsWith("Location (5 jours")));
  assert.ok(labels.some((l) => l.startsWith("Réduction durée")));
  assert.ok(labels.includes("Livraison du véhicule"));
  assert.equal(labels[labels.length - 1], "Total");
});
