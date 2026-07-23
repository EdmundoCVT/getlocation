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
     <input type="checkbox" id="assurance">
     <form id="driver-form">
       <input name="nom" id="nom"><input name="prenom" id="prenom"><input name="email" id="email">
       <input name="telephone" id="telephone"><input name="permis" id="permis"><input name="age" id="age">
       <button type="submit">Continuer</button>
     </form>
     ${dateBarHtml()}`,
    "https://getlocation.fr/reservation.html"
  );
  window.localStorage.setItem("gl_reservation", JSON.stringify({
    vehiculeId: "opel-corsa", // 60 €/jour
    dateDebut: "2026-08-10", heureDebut: "10:00",
    dateFin: "2026-08-12", heureFin: "10:00",
    jours: 2, assurance: false,
    _savedAt: Date.now()
  }));

  window.initReservationPage();

  // Résumé initial : 2 jours x 60 € = 120 €.
  assert.match(window.document.getElementById("reservation-summary").textContent, /120/);
  assert.match(window.document.getElementById("date-bar-text").textContent, /2 jours/);

  // Le client rajoute un jour (10 -> 13 août au lieu de 10 -> 12) : 3 jours x 60 € = 180 €.
  applyNewDates(window, { dateDebut: "2026-08-10", heureDebut: "10:00", dateFin: "2026-08-13", heureFin: "10:00" });

  assert.match(window.document.getElementById("reservation-summary").textContent, /180/);
  assert.match(window.document.getElementById("date-bar-text").textContent, /3 jours/);

  // La nouvelle durée est bien persistée (survit à un rafraîchissement de page).
  const persisted = JSON.parse(window.localStorage.getItem("gl_reservation"));
  assert.equal(persisted.dateFin, "2026-08-13");
  assert.equal(persisted.jours, 3);
});

test("initReservationPage : la barre de dates refuse une date de retour avant le départ", () => {
  const window = newWindow(
    `<div id="reservation-summary"></div>
     <input type="checkbox" id="assurance">
     <form id="driver-form">
       <input name="nom" id="nom"><input name="prenom" id="prenom"><input name="email" id="email">
       <input name="telephone" id="telephone"><input name="permis" id="permis"><input name="age" id="age">
       <button type="submit">Continuer</button>
     </form>
     ${dateBarHtml()}`,
    "https://getlocation.fr/reservation.html"
  );
  window.localStorage.setItem("gl_reservation", JSON.stringify({
    vehiculeId: "opel-corsa",
    dateDebut: "2026-08-10", heureDebut: "10:00",
    dateFin: "2026-08-12", heureFin: "10:00",
    jours: 2, assurance: false,
    _savedAt: Date.now()
  }));

  window.initReservationPage();
  applyNewDates(window, { dateDebut: "2026-08-10", heureDebut: "10:00", dateFin: "2026-08-09", heureFin: "10:00" });

  assert.notEqual(window.document.getElementById("date-bar-error").textContent, "");
  // Le total ne doit pas avoir changé (toujours 2 jours x 60 € = 120 €).
  assert.match(window.document.getElementById("reservation-summary").textContent, /120/);
  const persisted = JSON.parse(window.localStorage.getItem("gl_reservation"));
  assert.equal(persisted.dateFin, "2026-08-12");
});

test("initPaiementPage : la barre de dates recalcule le total à régler sans revenir en arrière", () => {
  const window = newWindow(
    `<div class="info-banner" id="info-banner"></div>
     <div id="payment-summary"></div>
     <form id="payment-form">
       <input id="card-name">
       <div id="stripe-card-element"></div>
       <div id="stripe-card-errors"></div>
       <div id="err-card-name"></div>
       <input type="checkbox" id="cgl-accept">
       <div id="err-cgl-accept"></div>
       <button id="pay-button">Payer</button>
     </form>
     ${dateBarHtml()}`,
    "https://getlocation.fr/paiement.html"
  );
  window.localStorage.setItem("gl_reservation", JSON.stringify({
    vehiculeId: "peugeot-3008", // 80 €/jour
    dateDebut: "2026-08-10", heureDebut: "10:00",
    dateFin: "2026-08-12", heureFin: "10:00",
    jours: 2, assurance: false,
    conducteur: { nom: "Dupont", prenom: "Jean", email: "jean@example.com", telephone: "0601020304", permis: "123456", age: 30 },
    _savedAt: Date.now()
  }));

  // Pas de Stripe chargé dans ce test (comme en environnement de dev sans
  // clé configurée) : initPaiementPage bascule sur le repli téléphone/
  // WhatsApp, mais la barre de dates doit déjà être initialisée à ce
  // moment-là (voir l'ordre des opérations dans initPaiementPage).
  window.initPaiementPage();

  assert.match(window.document.getElementById("payment-summary").textContent, /160/); // 2 x 80 €

  applyNewDates(window, { dateDebut: "2026-08-10", heureDebut: "10:00", dateFin: "2026-08-14", heureFin: "10:00" });

  assert.match(window.document.getElementById("payment-summary").textContent, /320/); // 4 x 80 €
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
