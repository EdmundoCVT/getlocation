// tests/pricing-ui.test.js
//
// Couvre l'interface des nouvelles options supplémentaires et du code promo
// sur reservation.html : la liste d'options est générée depuis le catalogue
// partagé (OPTIONS, js/data.js), cocher/décocher une option et appliquer un
// code promo recalculent immédiatement le total affiché — exactement comme
// pour la barre de dates persistante (voir tests/date-bar.test.js).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const DATA_SRC = fs.readFileSync(path.join(__dirname, "..", "js", "data.js"), "utf8");
const APP_SRC = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8");
// Les `const` de haut niveau (OPTIONS, VEHICULES...) évaluées via
// window.eval() restent dans la portée lexicale globale de jsdom mais ne
// deviennent PAS des propriétés de `window` (contrairement aux fonctions
// déclarées avec `function`, qui elles sont bien exposées sur `window` en
// eval non strict). Pour vérifier le catalogue depuis le test, on le
// récupère donc via require() (export CommonJS), pas via `window.OPTIONS`.
const { OPTIONS, getCodePromo } = require("../js/data.js");

function reservationPageHtml() {
  return `
    <div id="reservation-summary"></div>
    <input type="checkbox" id="assurance">
    <h3>Options supplémentaires</h3>
    <div id="options-list"></div>
    <input type="text" id="promo-input">
    <button type="button" id="promo-apply">Appliquer</button>
    <div id="promo-message"></div>
    <form id="driver-form">
      <input name="nom" id="nom"><input name="prenom" id="prenom"><input name="email" id="email">
      <input name="telephone" id="telephone"><input name="permis" id="permis"><input name="age" id="age">
      <button type="submit">Continuer</button>
    </form>
  `;
}

function newWindow(bodyHtml) {
  const dom = new JSDOM(`<!DOCTYPE html><body>${bodyHtml}</body>`, { url: "https://getlocation.fr/reservation.html", runScripts: "outside-only" });
  dom.window.eval(DATA_SRC + "\n" + APP_SRC);
  return dom.window;
}

function baseReservation(overrides = {}) {
  return {
    vehiculeId: "opel-corsa", // 60 €/jour
    dateDebut: "2026-08-10", heureDebut: "10:00",
    dateFin: "2026-08-12", heureFin: "10:00", // 2 jours, pas de remise durée
    jours: 2, assurance: false,
    _savedAt: Date.now(),
    ...overrides
  };
}

test("initReservationPage : la liste d'options est générée depuis le catalogue OPTIONS", () => {
  const window = newWindow(reservationPageHtml());
  window.localStorage.setItem("gl_reservation", JSON.stringify(baseReservation()));
  window.initReservationPage();

  const items = window.document.querySelectorAll("#options-list .option-item");
  assert.equal(items.length, OPTIONS.length);
  OPTIONS.forEach((opt) => {
    assert.ok(window.document.getElementById(`option-${opt.id}`), `checkbox manquante pour ${opt.id}`);
  });
});

test("initReservationPage : cocher une option recalcule le total et le persiste", () => {
  const window = newWindow(reservationPageHtml());
  window.localStorage.setItem("gl_reservation", JSON.stringify(baseReservation()));
  window.initReservationPage();

  // 2 jours x 60 € = 120 € avant option.
  assert.match(window.document.getElementById("reservation-summary").textContent, /120/);

  const siegeAuto = window.getOptionParId("siege-auto"); // type "jour", 5 €/jour
  const checkbox = window.document.getElementById("option-siege-auto");
  checkbox.checked = true;
  checkbox.dispatchEvent(new window.Event("change", { bubbles: true }));

  const totalAttendu = 120 + siegeAuto.prix * 2;
  assert.match(window.document.getElementById("reservation-summary").textContent, new RegExp(String(totalAttendu)));

  const persisted = JSON.parse(window.localStorage.getItem("gl_reservation"));
  assert.deepEqual(persisted.options, ["siege-auto"]);

  // Décocher revient au total initial.
  checkbox.checked = false;
  checkbox.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.match(window.document.getElementById("reservation-summary").textContent, /120/);
  const persistedApres = JSON.parse(window.localStorage.getItem("gl_reservation"));
  assert.deepEqual(persistedApres.options, []);
});

test("initReservationPage : applique un code promo valide et affiche un message de succès", () => {
  const window = newWindow(reservationPageHtml());
  window.localStorage.setItem("gl_reservation", JSON.stringify(baseReservation()));
  window.initReservationPage();

  window.document.getElementById("promo-input").value = "bienvenue10"; // insensible à la casse
  window.document.getElementById("promo-apply").dispatchEvent(new window.Event("click", { bubbles: true }));

  const promo = getCodePromo("BIENVENUE10");
  const totalAttendu = Math.round((120 - 120 * promo.pourcentage / 100) * 100) / 100;
  assert.match(window.document.getElementById("reservation-summary").textContent, new RegExp(String(totalAttendu)));
  assert.match(window.document.getElementById("promo-message").textContent, /appliqué/);

  // La saisie brute est conservée telle quelle en local (la normalisation —
  // casse/espaces — n'a lieu que dans le calcul via getCodePromo()).
  const persisted = JSON.parse(window.localStorage.getItem("gl_reservation"));
  assert.equal(persisted.codePromo, "bienvenue10");
});

test("initReservationPage : un code promo invalide affiche une erreur et ne change pas le total", () => {
  const window = newWindow(reservationPageHtml());
  window.localStorage.setItem("gl_reservation", JSON.stringify(baseReservation()));
  window.initReservationPage();

  window.document.getElementById("promo-input").value = "CODE-BIDON";
  window.document.getElementById("promo-apply").dispatchEvent(new window.Event("click", { bubbles: true }));

  assert.match(window.document.getElementById("reservation-summary").textContent, /120/);
  assert.match(window.document.getElementById("promo-message").textContent, /invalide/);
});

test("initReservationPage : affiche la remise durée dans le résumé à partir de 7 jours", () => {
  const window = newWindow(reservationPageHtml());
  window.localStorage.setItem("gl_reservation", JSON.stringify(baseReservation({
    dateDebut: "2026-08-01", dateFin: "2026-08-08", jours: 7
  })));
  window.initReservationPage();

  assert.match(window.document.getElementById("reservation-summary").textContent, /Remise durée/);
});
