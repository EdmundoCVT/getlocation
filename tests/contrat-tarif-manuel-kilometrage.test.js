// tests/contrat-tarif-manuel-kilometrage.test.js
//
// Tests des ajouts "Tarif spécial" (remise/majoration manuelle sur le
// contrat, motif interne jamais imprimé) et "Kilométrage" (relevés
// départ/retour, calcul du dépassement) sur la vue AGENCE manuelle de
// contrat.html — mission demandée le 20/08/2026. Exécute le vrai code de
// contrat.html via jsdom, comme tests/contrat-apercu-fill.test.js.

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

// #contractText doit exister dans le DOM : construirePayload() ->
// remplirTexteArticles() n'est pas appelé ici (on teste construirePayload
// directement, pas genererPDF), mais texteConditionsLocation()/
// sectionsConditionsLocation() sont appelées ailleurs dans le script au
// chargement ; un DOM minimal suffit.
function buildWindow() {
  const dom = new JSDOM(`<!DOCTYPE html><body><div id="contractText"></div></body>`, {
    url: "https://getlocation.fr/contrat.html",
    runScripts: "outside-only"
  });
  dom.window.eval(dataJsSource);
  dom.window.eval(extractScriptBody());
  return dom.window;
}

const donneesBase = {
  vehiculeId: "opel-corsa",
  immat: "HJ-967-KQ",
  depart: "2026-08-13T10:00",
  retour: "2026-08-15T10:00", // 2 jours facturables
  nom: "Benzaama",
  prenom: "Israa",
  naissance: "1995-04-12",
  adresse: "12 rue des Oliviers",
  codePostal: "06130",
  ville: "Grasse",
  tel: "0601020304",
  email: "israa@example.com",
  permis: "061234567890"
};

test("appliquerTarifManuel : inactif par défaut, total = tarif calculé", () => {
  const win = buildWindow();
  const prix = win.calculerPrixContrat(donneesBase);
  const tarif = win.appliquerTarifManuel(prix, donneesBase);
  assert.equal(tarif.tarifManuelActif, false);
  assert.equal(tarif.total, prix.total);
  assert.equal(tarif.tarifCalcule, prix.total);
});

test("appliquerTarifManuel : actif avec montant vide ou non numérique => reste inactif", () => {
  const win = buildWindow();
  const prix = win.calculerPrixContrat(donneesBase);
  const vide = win.appliquerTarifManuel(prix, { ...donneesBase, tarifManuel: true, montantFinalConvenu: "" });
  assert.equal(vide.tarifManuelActif, false);
  const invalide = win.appliquerTarifManuel(prix, { ...donneesBase, tarifManuel: true, montantFinalConvenu: "pas-un-nombre" });
  assert.equal(invalide.tarifManuelActif, false);
});

test("appliquerTarifManuel : remise (montant < tarif calculé)", () => {
  const win = buildWindow();
  const prix = win.calculerPrixContrat(donneesBase);
  const tarif = win.appliquerTarifManuel(prix, { ...donneesBase, tarifManuel: true, montantFinalConvenu: String(prix.total - 60) });
  assert.equal(tarif.tarifManuelActif, true);
  assert.equal(tarif.total, prix.total - 60);
  assert.equal(tarif.tarifCalcule, prix.total);
});

test("appliquerTarifManuel : majoration (montant > tarif calculé) autorisée", () => {
  const win = buildWindow();
  const prix = win.calculerPrixContrat(donneesBase);
  const tarif = win.appliquerTarifManuel(prix, { ...donneesBase, tarifManuel: true, montantFinalConvenu: String(prix.total + 40) });
  assert.equal(tarif.tarifManuelActif, true);
  assert.equal(tarif.total, prix.total + 40);
});

test("construirePayload : sans tarif manuel, comportement inchangé (une seule ligne Total)", () => {
  const win = buildWindow();
  const payload = win.construirePayload(donneesBase, null, null);
  const derniere = payload.detailFinancier[payload.detailFinancier.length - 1];
  assert.equal(derniere[0], "Total");
  assert.equal(payload.kilometrageManuel, null);
});

test("construirePayload : tarif manuel remise => Location / Remise commerciale / TOTAL, motif jamais dans le payload", () => {
  const win = buildWindow();
  const prixSeul = win.calculerPrixContrat(donneesBase);
  const donnees = {
    ...donneesBase,
    tarifManuel: true,
    montantFinalConvenu: String(prixSeul.total - 60),
    tarifMotif: "Client fidèle, geste commercial"
  };
  const payload = win.construirePayload(donnees, null, null);
  // Array.from() : payload.detailFinancier est un tableau du "realm" jsdom
  // — deepEqual le compare comme non-réf.-égal à un littéral construit dans
  // le realm Node malgré un contenu identique ; Array.from() re-matérialise
  // le tableau dans le realm courant avant comparaison.
  const labels = Array.from(payload.detailFinancier).map((l) => l[0]);
  assert.deepEqual(labels.slice(-3), ["Location", "Remise commerciale", "TOTAL"]);
  assert.equal(payload.detailFinancier[payload.detailFinancier.length - 1][1], win.formatEUR(prixSeul.total - 60));
  assert.equal("tarifMotif" in payload, false, "le motif interne ne doit jamais apparaître dans le payload PDF");
  assert.equal(JSON.stringify(payload).includes("geste commercial"), false);
});

test("construirePayload : tarif manuel majoration => libellé 'Ajustement tarif'", () => {
  const win = buildWindow();
  const prixSeul = win.calculerPrixContrat(donneesBase);
  const donnees = { ...donneesBase, tarifManuel: true, montantFinalConvenu: String(prixSeul.total + 40) };
  const payload = win.construirePayload(donnees, null, null);
  const labels = payload.detailFinancier.map((l) => l[0]);
  assert.ok(labels.includes("Ajustement tarif"));
  assert.ok(!labels.includes("Remise commerciale"));
});

test("construirePayload : kilométrage absent => kilometrageManuel null", () => {
  const win = buildWindow();
  const payload = win.construirePayload(donneesBase, null, null);
  assert.equal(payload.kilometrageManuel, null);
});

test("construirePayload : km départ seul (retour à compléter plus tard) => resultat null, pas d'erreur", () => {
  const win = buildWindow();
  const payload = win.construirePayload({ ...donneesBase, kmDepart: "42150" }, null, null);
  assert.ok(payload.kilometrageManuel);
  assert.equal(payload.kilometrageManuel.kmDepart, "42150");
  assert.equal(payload.kilometrageManuel.kmRetour, "");
  assert.equal(payload.kilometrageManuel.resultat, null);
});

test("construirePayload : km départ+retour cohérents => calcul via calculerKilometrage (pas de tarif recodé)", () => {
  const win = buildWindow();
  const payload = win.construirePayload({ ...donneesBase, kmDepart: "42150", kmRetour: "42990" }, null, null);
  const r = payload.kilometrageManuel.resultat;
  assert.equal(r.valid, true);
  assert.equal(r.kmParcourus, 840);
  assert.equal(r.kmInclus, win.getKmInclusParJour() * 2); // 2 jours facturables
  assert.equal(r.kmDepasses, 840 - win.getKmInclusParJour() * 2);
  assert.ok(r.kmDepasses > 0);
  // Aucun forfait km sélectionné dans donneesBase => tarif "sans forfait" (0,65 €/km).
  assert.equal(r.supplement, Math.round(r.kmDepasses * win.getSupplementKmCentimes(false)) / 100);
});

test("construirePayload : km retour < départ => resultat.valid=false avec message, aucun crash", () => {
  const win = buildWindow();
  const payload = win.construirePayload({ ...donneesBase, kmDepart: "42150", kmRetour: "40000" }, null, null);
  assert.equal(payload.kilometrageManuel.resultat.valid, false);
  assert.ok(payload.kilometrageManuel.resultat.error);
});

test("kilometrageManuel utilise le tarif canonique de js/data.js, pas une valeur recodée en dur", () => {
  const win = buildWindow();
  assert.equal(win.getKmInclusParJour(), 200);
  // Double tarif de dépassement : 0,25 €/km avec un forfait km acheté,
  // 0,65 €/km sans (tarif de base).
  assert.equal(win.getSupplementKmCentimes(true), 25);
  assert.equal(win.getSupplementKmCentimes(false), 65);
});
