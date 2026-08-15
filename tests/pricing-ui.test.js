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
    <h3>Options supplémentaires</h3>
    <div id="options-list"></div>
    <input type="text" id="promo-input">
    <button type="button" id="promo-apply">Appliquer</button>
    <div id="promo-message"></div>
    <form id="driver-form">
      <input name="nom" id="nom"><input name="prenom" id="prenom"><input name="email" id="email">
      <input name="telephone" id="telephone"><input name="naissance" id="naissance">
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
    vehiculeId: "opel-corsa", // 59 €/jour
    dateDebut: "2026-08-10", heureDebut: "10:00",
    dateFin: "2026-08-12", heureFin: "10:00", // 2 jours, pas de remise durée
    jours: 2,
    _savedAt: Date.now(),
    ...overrides
  };
}

test("initReservationPage : la liste d'options est générée depuis le catalogue OPTIONS", () => {
  const window = newWindow(reservationPageHtml());
  window.localStorage.setItem("gl_reservation", JSON.stringify(baseReservation()));
  window.initReservationPage();

  const items = window.document.querySelectorAll("#options-list .option-item");
  const optionsFacultatives = OPTIONS.filter((opt) => opt.id !== "livraison-adresse");
  assert.equal(items.length, optionsFacultatives.length);
  optionsFacultatives.forEach((opt) => {
    assert.ok(window.document.getElementById(`option-${opt.id}`), `checkbox manquante pour ${opt.id}`);
  });
  assert.equal(window.document.getElementById("option-livraison-adresse"), null, "la livraison obligatoire ne doit pas être décochable");
});

test("initReservationPage : la livraison est ajoutée et facturée sans case à cocher", () => {
  const window = newWindow(reservationPageHtml());
  window.localStorage.setItem("gl_reservation", JSON.stringify(baseReservation({
    lieuPrise: "Livraison à l'adresse de votre choix",
    lieuRetour: "Livraison à l'adresse de votre choix",
    adressePrise: "Nice",
    adresseRetour: "Nice",
    options: []
  })));
  window.initReservationPage();

  const persisted = JSON.parse(window.localStorage.getItem("gl_reservation"));
  assert.ok(persisted.options.includes("livraison-adresse"));
  assert.match(window.document.getElementById("reservation-summary").textContent, /138/); // 118 € + 20 € livraison
});

test("initReservationPage : cocher une option recalcule le total et le persiste", () => {
  const window = newWindow(reservationPageHtml());
  window.localStorage.setItem("gl_reservation", JSON.stringify(baseReservation()));
  window.initReservationPage();

  // 2 jours x 59 € = 118 € avant option.
  assert.match(window.document.getElementById("reservation-summary").textContent, /118/);

  const siegeAuto = window.getOptionParId("siege-auto"); // type "jour", 5 €/jour
  const checkbox = window.document.getElementById("option-siege-auto");
  checkbox.checked = true;
  checkbox.dispatchEvent(new window.Event("change", { bubbles: true }));

  const totalAttendu = 118 + siegeAuto.prix * 2;
  assert.match(window.document.getElementById("reservation-summary").textContent, new RegExp(String(totalAttendu)));

  const persisted = JSON.parse(window.localStorage.getItem("gl_reservation"));
  assert.deepEqual(persisted.options, ["siege-auto"]);

  // Décocher revient au total initial.
  checkbox.checked = false;
  checkbox.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.match(window.document.getElementById("reservation-summary").textContent, /118/);
  const persistedApres = JSON.parse(window.localStorage.getItem("gl_reservation"));
  assert.deepEqual(persistedApres.options, []);
});

test("initReservationPage : applique un code promo valide et affiche un message de succès", () => {
  const window = newWindow(reservationPageHtml());
  window.localStorage.setItem("gl_reservation", JSON.stringify(baseReservation()));
  window.initReservationPage();

  window.document.getElementById("promo-input").value = "getloc10"; // insensible à la casse
  window.document.getElementById("promo-apply").dispatchEvent(new window.Event("click", { bubbles: true }));

  const promo = getCodePromo("GETLOC10");
  const totalAttendu = Math.round(118 - 118 * promo.pourcentage / 100); // formatEUR arrondit à l'euro
  assert.match(window.document.getElementById("reservation-summary").textContent, new RegExp(String(totalAttendu)));
  assert.match(window.document.getElementById("promo-message").textContent, /appliqué/);

  // La saisie brute est conservée telle quelle en local (la normalisation —
  // casse/espaces — n'a lieu que dans le calcul via getCodePromo()).
  const persisted = JSON.parse(window.localStorage.getItem("gl_reservation"));
  assert.equal(persisted.codePromo, "getloc10");
});

test("initReservationPage : un code promo invalide affiche une erreur et ne change pas le total", () => {
  const window = newWindow(reservationPageHtml());
  window.localStorage.setItem("gl_reservation", JSON.stringify(baseReservation()));
  window.initReservationPage();

  window.document.getElementById("promo-input").value = "CODE-BIDON";
  window.document.getElementById("promo-apply").dispatchEvent(new window.Event("click", { bubbles: true }));

  // Pas de window.fetch dans ce jsdom (comme un très vieux navigateur) :
  // verifierCodeDeTest() bascule alors immédiatement, sans appel réseau, sur
  // "invalide" — voir js/app.js. Couvre donc à la fois ce repli et le cas
  // d'un code réellement inconnu.
  assert.match(window.document.getElementById("reservation-summary").textContent, /118/);
  assert.match(window.document.getElementById("promo-message").textContent, /invalide/);
});

test("initReservationPage : un code absent du catalogue public déclenche une vérification serveur (/api/validate-promo)", () => {
  const window = newWindow(reservationPageHtml());
  window.localStorage.setItem("gl_reservation", JSON.stringify(baseReservation()));

  const appels = [];
  window.fetch = (url, options) => {
    appels.push({ url, body: JSON.parse(options.body) });
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ valid: false }) });
  };

  window.initReservationPage();
  window.document.getElementById("promo-input").value = "TEST1";
  window.document.getElementById("promo-apply").dispatchEvent(new window.Event("click", { bubbles: true }));

  assert.equal(appels.length, 1);
  assert.equal(appels[0].url, "/api/validate-promo");
  assert.deepEqual(appels[0].body, { code: "TEST1" });
});

test("initReservationPage : un code de test interne confirmé par le serveur affiche un message de succès dédié", async () => {
  const window = newWindow(reservationPageHtml());
  window.localStorage.setItem("gl_reservation", JSON.stringify(baseReservation()));
  window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ valid: true, totalFacture: 0.1 }) });

  window.initReservationPage();
  window.document.getElementById("promo-input").value = "TEST1";
  window.document.getElementById("promo-apply").dispatchEvent(new window.Event("click", { bubbles: true }));

  // Le message affiche "Vérification du code…" pendant que la promesse
  // fetch()/json() n'est pas encore résolue (avant même le premier .then()).
  assert.match(window.document.getElementById("promo-message").textContent, /Vérification/);

  // Laisse la chaîne de promesses (fetch -> json -> then) se dérouler.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.match(window.document.getElementById("promo-message").textContent, /reconnu.*test interne/);
  // Le total affiché reste volontairement le tarif normal (indicatif) : seul
  // le serveur applique réellement la réduction, au moment du paiement.
  assert.match(window.document.getElementById("reservation-summary").textContent, /118/);

  const persisted = JSON.parse(window.localStorage.getItem("gl_reservation"));
  assert.equal(persisted.codePromo, "TEST1");
});

test("initReservationPage : un code déjà enregistré (retour sur la page) est revérifié auprès du serveur", async () => {
  const window = newWindow(reservationPageHtml());
  window.localStorage.setItem("gl_reservation", JSON.stringify(baseReservation({ codePromo: "TEST1" })));
  window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ valid: true, totalFacture: 0.1 }) });

  window.initReservationPage();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.match(window.document.getElementById("promo-message").textContent, /reconnu.*test interne/);
});

test("initReservationPage : affiche la remise durée dans le résumé à partir de 5 jours", () => {
  const window = newWindow(reservationPageHtml());
  window.localStorage.setItem("gl_reservation", JSON.stringify(baseReservation({
    dateDebut: "2026-08-01", dateFin: "2026-08-06", jours: 5
  })));
  window.initReservationPage();

  assert.match(window.document.getElementById("reservation-summary").textContent, /Remise durée/);
});
