// tests/contrat-remarques-particulieres.test.js
//
// Section "Remarques particulières" de contrat.html (demandée le
// 01/09/2026) : champ texte libre saisi côté AGENCE (initOwnerView),
// imprimé tel quel (retours à la ligne conservés, aucune interprétation
// HTML) dans le contrat officiel — absent du PDF/de l'affichage tant
// qu'aucun texte n'est saisi.
//
// Même approche que tests/contrat-apercu-fill.test.js : exécute le vrai
// code de contrat.html via jsdom (pas une copie à la main), en vérifiant
// le mécanisme réellement utilisé par genererPDF() — construirePayload()
// -> remplirTexteArticles() -> texteConditionsLocation()/
// sectionsConditionsLocation() — sans dépendre de jsPDF (chargé depuis un
// CDN, indisponible dans cet environnement de test).

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
  let i = start;
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

test("remarque vide (champ absent) : construirePayload().remarques est une chaîne vide, section absente du texte", () => {
  const win = buildWindow();
  const payload = win.construirePayload(makeReservationData(), null, null);
  assert.equal(payload.remarques, "");
  win.remplirTexteArticles(payload);
  const texte = win.texteConditionsLocation();
  assert.doesNotMatch(texte, /Remarques particulières/);
  assert.equal(win.document.getElementById("remarquesTitre").style.display, "none");
  assert.equal(win.document.getElementById("remarquesClause").style.display, "none");
});

test("remarque vide (espaces/retours à la ligne uniquement) : traitée comme vide après trim()", () => {
  const win = buildWindow();
  const payload = win.construirePayload(makeReservationData({ remarques: "   \n\n  " }), null, null);
  assert.equal(payload.remarques, "");
  win.remplirTexteArticles(payload);
  assert.equal(win.document.getElementById("remarquesClause").style.display, "none");
});

test("remarque sur plusieurs lignes : conservée telle quelle (retours à la ligne intacts), section affichée", () => {
  const win = buildWindow();
  const texteRemarques = "Véhicule livré avec le plein.\nLe client accepte un retour avant 8h00.\nLe siège enfant est prêté gratuitement.";
  const payload = win.construirePayload(makeReservationData({ remarques: texteRemarques }), null, null);
  assert.equal(payload.remarques, texteRemarques);

  win.remplirTexteArticles(payload);
  assert.equal(win.document.getElementById("remarquesTitre").style.display, "");
  assert.equal(win.document.getElementById("remarquesClause").style.display, "");
  // textContent (jamais innerHTML) : la valeur brute, y compris les \n, est
  // reprise telle quelle par le DOM.
  assert.equal(win.document.getElementById("remarquesClause").textContent, texteRemarques);

  const texte = win.texteConditionsLocation();
  assert.match(texte, /Remarques particulières/);
  assert.ok(texte.includes(texteRemarques), "le texte multi-lignes doit apparaître intact dans texteConditionsLocation()");

  const sections = win.sectionsConditionsLocation();
  const sectionRemarques = sections.find((s) => s.titre === "Remarques particulières");
  assert.ok(sectionRemarques, "la section Remarques particulières doit exister dans sectionsConditionsLocation() (utilisée par genererPDF)");
  // Array.from() : tableau du realm jsdom, non réf.-égal à un littéral du
  // realm Node malgré un contenu identique (voir même remarque dans
  // tests/contrat-tarif-manuel-kilometrage.test.js) — re-matérialisé avant
  // comparaison.
  assert.deepEqual(Array.from(sectionRemarques.paragraphes), [texteRemarques]);
});

test("remarque longue : tronquée à 1500 caractères (garde-fou anti-abus, même si le formulaire limite déjà via maxlength)", () => {
  const win = buildWindow();
  const texteLong = "A".repeat(2000);
  const payload = win.construirePayload(makeReservationData({ remarques: texteLong }), null, null);
  assert.equal(payload.remarques.length, 1500);
  assert.equal(payload.remarques, "A".repeat(1500));
});

test("remarque contenant du HTML/JS : jamais interprété, affiché comme texte brut (protection XSS)", () => {
  const win = buildWindow();
  const tentative = "<script>alert(1)</script><img src=x onerror=alert(2)>";
  const payload = win.construirePayload(makeReservationData({ remarques: tentative }), null, null);
  assert.equal(payload.remarques, tentative);

  win.remplirTexteArticles(payload);
  const clause = win.document.getElementById("remarquesClause");
  // textContent restitue la chaîne telle quelle ; aucun <script> ni <img> ne
  // doit avoir été inséré comme élément DOM réel.
  assert.equal(clause.textContent, tentative);
  assert.equal(clause.querySelector("script"), null);
  assert.equal(clause.querySelector("img"), null);
});

test("remplirTexteArticles() appelée plusieurs fois : une remarque effacée après un premier aperçu ne reste pas affichée au second", () => {
  const win = buildWindow();
  const avecRemarque = win.construirePayload(makeReservationData({ remarques: "Tarif exceptionnel accordé." }), null, null);
  win.remplirTexteArticles(avecRemarque);
  assert.equal(win.document.getElementById("remarquesClause").style.display, "");

  const sansRemarque = win.construirePayload(makeReservationData({ remarques: "" }), null, null);
  win.remplirTexteArticles(sansRemarque);
  assert.equal(win.document.getElementById("remarquesTitre").style.display, "none");
  assert.equal(win.document.getElementById("remarquesClause").style.display, "none");
  assert.doesNotMatch(win.texteConditionsLocation(), /Remarques particulières|Tarif exceptionnel/);
});

test("le motif de tarif spécial (notes internes) et les remarques particulières restent deux champs distincts", () => {
  const win = buildWindow();
  const payload = win.construirePayload(makeReservationData({
    notes: "Info interne agence, jamais imprimée",
    remarques: "Info visible client, imprimée"
  }), null, null);
  assert.equal(payload.notes, "Info interne agence, jamais imprimée");
  assert.equal(payload.remarques, "Info visible client, imprimée");
  win.remplirTexteArticles(payload);
  const texte = win.texteConditionsLocation();
  assert.match(texte, /Info visible client, imprimée/);
  assert.doesNotMatch(texte, /Info interne agence/, "les notes internes ne doivent jamais apparaître dans le contrat imprimé");
});
