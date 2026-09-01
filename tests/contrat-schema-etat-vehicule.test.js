// tests/contrat-schema-etat-vehicule.test.js
//
// Schéma interactif d'état des lieux (dommages départ/retour) de
// contrat.html, demandé le 01/09/2026 : l'agence clique sur un schéma
// générique du véhicule (voiture ou utilitaire, selon VEHICULES[].
// vehicleFamily dans js/data.js) pour placer des marques de dommage
// (rayure/bosse/éclat), séparément au départ et au retour, jamais
// écrasées l'une par l'autre — voir creerGestionEtat()/
// normaliserEtatVehicule()/construirePayload() dans contrat.html.
//
// Comme tests/contrat-apercu-fill.test.js : exécute le vrai code de
// contrat.html via jsdom (pas une copie à la main). N'exécute pas
// genererPDF() (dépend de jsPDF, chargé depuis un CDN indisponible ici) :
// vérifie directement normaliserEtatVehicule()/construirePayload() (le
// garde-fou anti-abus/anti-donnée-corrompue) et l'intégrité des schémas
// géométriques (DMG_SHAPES/DMG_VIEWS) que dessinerSchemaPdf() consomme.

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
  retour: "2026-08-15T10:00",
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

test("DMG_SHAPES : chaque vue de DMG_VIEWS a une géométrie définie pour 'car' ET 'utility', mêmes dimensions", () => {
  const win = buildWindow();
  win.DMG_VIEWS.forEach((vue) => {
    const carSpec = win.DMG_SHAPES.car[vue.shape];
    const utilitySpec = win.DMG_SHAPES.utility[vue.shape];
    assert.ok(carSpec, `DMG_SHAPES.car.${vue.shape} manquant`);
    assert.ok(utilitySpec, `DMG_SHAPES.utility.${vue.shape} manquant`);
    assert.equal(carSpec.w, utilitySpec.w, `largeur différente entre car/utility pour ${vue.shape} (les marques en % ne correspondraient plus au bon endroit selon le véhicule)`);
    assert.equal(carSpec.h, utilitySpec.h, `hauteur différente entre car/utility pour ${vue.shape}`);
    assert.ok(carSpec.shapes.length > 0);
  });
  assert.equal(win.DMG_VIEWS.length, 5, "5 vues attendues (dessus, côté gauche, côté droit, avant, arrière)");
});

// Array.from() : les tableaux produits par le code exécuté en jsdom
// appartiennent à ce "realm" et ne sont jamais réf.-égaux à un littéral du
// realm Node malgré un contenu identique (deepEqual le voit comme une
// différence de structure) — voir la même remarque dans
// tests/contrat-tarif-manuel-kilometrage.test.js. Re-matérialisé avant
// comparaison à chaque fois que la valeur peut contenir un tel tableau.
function normalise(etat) {
  return { marks: Array.from(etat.marks).map((m) => ({ ...m })), observations: etat.observations };
}

test("normaliserEtatVehicule() : état vide/absent => marks:[], observations:''", () => {
  const win = buildWindow();
  assert.deepEqual(normalise(win.normaliserEtatVehicule(undefined)), { marks: [], observations: "" });
  assert.deepEqual(normalise(win.normaliserEtatVehicule(null)), { marks: [], observations: "" });
  assert.deepEqual(normalise(win.normaliserEtatVehicule({})), { marks: [], observations: "" });
});

test("normaliserEtatVehicule() : conserve les marques valides telles quelles", () => {
  const win = buildWindow();
  const etat = win.normaliserEtatVehicule({
    marks: [
      { id: "m1", view: "left", x: 42.3, y: 63.7, type: "rayure" },
      { id: "m2", view: "top", x: 10, y: 20, type: "bosse" },
      { id: "m3", view: "front", x: 50, y: 50, type: "eclat" }
    ],
    observations: "Rayure légère porte arrière droite."
  });
  assert.equal(etat.marks.length, 3);
  assert.deepEqual(normalise(etat).marks, [
    { id: "m1", view: "left", x: 42.3, y: 63.7, type: "rayure" },
    { id: "m2", view: "top", x: 10, y: 20, type: "bosse" },
    { id: "m3", view: "front", x: 50, y: 50, type: "eclat" }
  ]);
  assert.equal(etat.observations, "Rayure légère porte arrière droite.");
});

test("normaliserEtatVehicule() : vue/type inconnus repliés sur des valeurs sûres, x/y bornés 0-100 (lien ?data= trafiqué)", () => {
  const win = buildWindow();
  const etat = win.normaliserEtatVehicule({
    marks: [
      { id: "m1", view: "toit-panoramique", x: 500, y: -50, type: "rayure" },
      { id: "m2", view: "left", x: 10, y: 10, type: "<script>alert(1)</script>" }
    ]
  });
  assert.equal(etat.marks[0].view, "top", "vue inconnue repliée sur 'top'");
  assert.equal(etat.marks[0].x, 100, "x borné à 100 max");
  assert.equal(etat.marks[0].y, 0, "y borné à 0 min");
  assert.equal(etat.marks[1].type, "rayure", "type inconnu replié sur 'rayure'");
});

test("normaliserEtatVehicule() : troncature anti-abus (200 marques max, 1000 caractères d'observations max)", () => {
  const win = buildWindow();
  const beaucoupDeMarques = Array.from({ length: 500 }, (_, i) => ({ id: "m" + i, view: "top", x: 1, y: 1, type: "rayure" }));
  const etat = win.normaliserEtatVehicule({ marks: beaucoupDeMarques, observations: "A".repeat(2000) });
  assert.equal(etat.marks.length, 200);
  assert.equal(etat.observations.length, 1000);
});

test("normaliserEtatVehicule() : jamais d'interprétation HTML dans les observations (juste une troncature de texte brut)", () => {
  const win = buildWindow();
  const evil = "<img src=x onerror=alert(1)>";
  const etat = win.normaliserEtatVehicule({ observations: evil });
  assert.equal(etat.observations, evil, "le texte brut est conservé tel quel (l'échappement se fait à l'affichage, jamais ici)");
});

test("construirePayload() : état départ et état retour restent indépendants, jamais l'un n'écrase l'autre", () => {
  const win = buildWindow();
  const data = {
    ...donneesBase,
    etatDepart: { marks: [{ id: "d1", view: "left", x: 20, y: 30, type: "rayure" }], observations: "État au départ : RAS." },
    etatRetour: { marks: [{ id: "r1", view: "front", x: 60, y: 40, type: "bosse" }, { id: "r2", view: "front", x: 61, y: 41, type: "eclat" }], observations: "Nouvel impact avant constaté au retour." }
  };
  const payload = win.construirePayload(data, null, null);

  assert.equal(payload.etatDepart.marks.length, 1);
  assert.equal(payload.etatDepart.marks[0].id, "d1");
  assert.equal(payload.etatDepart.observations, "État au départ : RAS.");

  assert.equal(payload.etatRetour.marks.length, 2);
  assert.equal(payload.etatRetour.marks[0].id, "r1");
  assert.equal(payload.etatRetour.observations, "Nouvel impact avant constaté au retour.");

  // Le départ ne doit contenir aucune trace du retour, et réciproquement.
  assert.ok(!payload.etatDepart.marks.some((m) => m.id === "r1"));
  assert.ok(!payload.etatRetour.marks.some((m) => m.id === "d1"));
});

test("construirePayload() : état retour absent (véhicule pas encore restitué) => structure vide, pas d'erreur", () => {
  const win = buildWindow();
  const data = { ...donneesBase, etatDepart: { marks: [{ id: "d1", view: "top", x: 5, y: 5, type: "rayure" }], observations: "" } };
  const payload = win.construirePayload(data, null, null);
  assert.equal(payload.etatDepart.marks.length, 1);
  assert.deepEqual(normalise(payload.etatRetour), { marks: [], observations: "" });
});

test("construirePayload() : plusieurs marques sur la même vue sont toutes conservées", () => {
  const win = buildWindow();
  const marks = [
    { id: "a", view: "left", x: 10, y: 10, type: "rayure" },
    { id: "b", view: "left", x: 20, y: 20, type: "bosse" },
    { id: "c", view: "left", x: 30, y: 30, type: "eclat" }
  ];
  const payload = win.construirePayload({ ...donneesBase, etatDepart: { marks, observations: "" } }, null, null);
  assert.equal(payload.etatDepart.marks.length, 3);
  assert.deepEqual(Array.from(payload.etatDepart.marks).map((m) => m.type), ["rayure", "bosse", "eclat"]);
});

test("construirePayload() : vehicleFamily reflète le véhicule choisi (schéma voiture vs utilitaire)", () => {
  const win = buildWindow();
  const payloadVoiture = win.construirePayload({ ...donneesBase, vehiculeId: "opel-corsa" }, null, null);
  assert.equal(payloadVoiture.vehicleFamily, "car");
  const payloadUtilitaire = win.construirePayload({ ...donneesBase, vehiculeId: "toyota-proace-city" }, null, null);
  assert.equal(payloadUtilitaire.vehicleFamily, "utility");
});
