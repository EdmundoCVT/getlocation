// tests/date-bar.test.js
//
// Couvre la barre de dates persistante (véhicules.html, reservation.html,
// paiement.html) : permet au client de modifier ses dates de location sans
// revenir en arrière dans le tunnel — le prix affiché sur la page courante
// doit se recalculer immédiatement (demande client explicite).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const DATA_SRC = fs.readFileSync(path.join(__dirname, "..", "js", "data.js"), "utf8");
const APP_SRC = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8");

function dateBarHtml() {
  return `
    <div class="date-bar" id="date-bar">
      <div class="date-bar-summary">
        <span id="date-bar-text"></span>
        <button type="button" id="date-bar-toggle">Modifier les dates</button>
      </div>
      <div class="date-bar-form" id="date-bar-form">
        <input type="date" id="bar-date-debut">
        <select id="bar-heure-debut"></select>
        <input type="date" id="bar-date-fin">
        <select id="bar-heure-fin"></select>
        <button type="button" id="date-bar-apply">Mettre à jour le prix</button>
        <div id="date-bar-error"></div>
      </div>
    </div>
  `;
}

function newWindow(bodyHtml, url) {
  const dom = new JSDOM(`<!DOCTYPE html><body>${bodyHtml}</body>`, { url, runScripts: "outside-only" });
  dom.window.eval(DATA_SRC + "\n" + APP_SRC);
  return dom.window;
}

function applyNewDates(window, { dateDebut, heureDebut, dateFin, heureFin }) {
  window.document.getElementById("bar-date-debut").value = dateDebut;
  window.document.getElementById("bar-heure-debut").value = heureDebut;
  window.document.getElementById("bar-date-fin").value = dateFin;
  window.document.getElementById("bar-heure-fin").value = heureFin;
  window.document.getElementById("date-bar-apply").dispatchEvent(new window.Event("click", { bubbles: true }));
}

test("initReservationPage : la barre de dates affiche les dates courantes et recalcule le total quand on les change", () => {
  const window = newWindow(
    `<div id="reservation-summary"></div>
     <form id="driver-form">
       <input name="nom" id="nom"><input name="prenom" id="prenom"><input name="email" id="email">
       <input name="telephone" id="telephone"><input name="naissance" id="naissance">
       <button type="submit">Continuer</button>
     </form>
     ${dateBarHtml()}`,
    "https://getlocation.fr/reservation.html"
  );
  window.localStorage.setItem("gl_reservation", JSON.stringify({
    vehiculeId: "opel-corsa", // 49 €/jour
    dateDebut: "2026-08-10", heureDebut: "10:00",
    dateFin: "2026-08-12", heureFin: "10:00",
    jours: 2,
    _savedAt: Date.now()
  }));

  window.initReservationPage();

  // Résumé initial : 2 jours x 49 € = 98 €.
  assert.match(window.document.getElementById("reservation-summary").textContent, /98/);
  assert.match(window.document.getElementById("date-bar-text").textContent, /2 jours/);

  // Le client rajoute un jour (10 -> 13 août au lieu de 10 -> 12) : 3 jours x 49 € = 147 €.
  applyNewDates(window, { dateDebut: "2026-08-10", heureDebut: "10:00", dateFin: "2026-08-13", heureFin: "10:00" });

  assert.match(window.document.getElementById("reservation-summary").textContent, /147/);
  assert.match(window.document.getElementById("date-bar-text").textContent, /3 jours/);

  // La nouvelle durée est bien persistée (survit à un rafraîchissement de page).
  const persisted = JSON.parse(window.localStorage.getItem("gl_reservation"));
  assert.equal(persisted.dateFin, "2026-08-13");
  assert.equal(persisted.jours, 3);
});

test("initReservationPage : la barre de dates refuse une date de retour avant le départ", () => {
  const window = newWindow(
    `<div id="reservation-summary"></div>
     <form id="driver-form">
       <input name="nom" id="nom"><input name="prenom" id="prenom"><input name="email" id="email">
       <input name="telephone" id="telephone"><input name="naissance" id="naissance">
       <button type="submit">Continuer</button>
     </form>
     ${dateBarHtml()}`,
    "https://getlocation.fr/reservation.html"
  );
  window.localStorage.setItem("gl_reservation", JSON.stringify({
    vehiculeId: "opel-corsa",
    dateDebut: "2026-08-10", heureDebut: "10:00",
    dateFin: "2026-08-12", heureFin: "10:00",
    jours: 2,
    _savedAt: Date.now()
  }));

  window.initReservationPage();
  applyNewDates(window, { dateDebut: "2026-08-10", heureDebut: "10:00", dateFin: "2026-08-09", heureFin: "10:00" });

  assert.notEqual(window.document.getElementById("date-bar-error").textContent, "");
  // Le total ne doit pas avoir changé (toujours 2 jours x 49 € = 98 €).
  assert.match(window.document.getElementById("reservation-summary").textContent, /98/);
  const persisted = JSON.parse(window.localStorage.getItem("gl_reservation"));
  assert.equal(persisted.dateFin, "2026-08-12");
});

test("initPaiementPage : la barre de dates recalcule le total à régler sans revenir en arrière", () => {
  const window = newWindow(
    `<div class="info-banner" id="info-banner"></div>
     <div id="payment-summary"></div>
     <form id="payment-form">
       <input type="checkbox" id="cgl-accept">
       <div id="err-cgl-accept"></div>
       <button id="pay-button">Payer</button>
       <div id="payment-errors"></div>
     </form>
     ${dateBarHtml()}`,
    "https://getlocation.fr/paiement.html"
  );
  window.localStorage.setItem("gl_reservation", JSON.stringify({
    vehiculeId: "peugeot-3008", // 69 €/jour
    dateDebut: "2026-08-10", heureDebut: "10:00",
    dateFin: "2026-08-12", heureFin: "10:00",
    jours: 2,
    conducteur: { nom: "Dupont", prenom: "Jean", email: "jean@example.com", telephone: "0601020304", naissance: "1995-06-15" },
    _savedAt: Date.now()
  }));

  // Avec Mollie, la disponibilité du paiement n'est connue qu'au moment de
  // la soumission (pas de clé publique côté client à vérifier au
  // chargement, contrairement à l'ancien flux Stripe) : la barre de dates
  // doit donc déjà être initialisée dès initPaiementPage(), sans attendre
  // une tentative de paiement.
  window.initPaiementPage();

  assert.match(window.document.getElementById("payment-summary").textContent, /138/); // 2 x 69 €

  applyNewDates(window, { dateDebut: "2026-08-10", heureDebut: "10:00", dateFin: "2026-08-14", heureFin: "10:00" });

  assert.match(window.document.getElementById("payment-summary").textContent, /276/); // 4 x 69 €
  const persisted = JSON.parse(window.localStorage.getItem("gl_reservation"));
  assert.equal(persisted.jours, 4);
});

test("initVehiculesPage : la barre de dates recalcule le nombre de jours et les totaux de la grille", () => {
  const window = newWindow(
    `<p id="search-summary"></p>
     <div class="filter-bar" id="filter-bar"></div>
     <div class="vehicle-grid" id="vehicle-grid"></div>
     ${dateBarHtml()}`,
    "https://getlocation.fr/vehicules.html"
  );
  window.localStorage.setItem("gl_recherche", JSON.stringify({
    lieuPrise: "Agence Grasse", lieuRetour: "Agence Grasse",
    adressePrise: "", adresseRetour: "",
    dateDebut: "2026-08-10", heureDebut: "10:00",
    dateFin: "2026-08-12", heureFin: "10:00"
  }));

  window.initVehiculesPage();
  assert.match(window.document.getElementById("search-summary").textContent, /2 jours/);
  assert.match(window.document.getElementById("vehicle-grid").textContent, /2 jours/);

  applyNewDates(window, { dateDebut: "2026-08-10", heureDebut: "10:00", dateFin: "2026-08-15", heureFin: "10:00" });

  assert.match(window.document.getElementById("search-summary").textContent, /5 jours/);
  assert.match(window.document.getElementById("vehicle-grid").textContent, /5 jours/);
  const persisted = JSON.parse(window.localStorage.getItem("gl_recherche"));
  assert.equal(persisted.dateFin, "2026-08-15");
});
