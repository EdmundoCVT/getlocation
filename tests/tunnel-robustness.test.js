// tests/tunnel-robustness.test.js
//
// Couvre les améliorations de robustesse du tunnel de réservation (P1-4) :
// pré-remplissage du formulaire conducteur après un retour arrière,
// aria-invalid + focus sur la première erreur de validation.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const DATA_SRC = fs.readFileSync(path.join(__dirname, "..", "js", "data.js"), "utf8");
const APP_SRC = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8");

function driverFormHtml() {
  return `<!DOCTYPE html><body>
    <div id="reservation-summary"></div>
    <input type="checkbox" id="assurance">
    <form id="driver-form">
      <input name="nom" id="nom" aria-describedby="err-nom" aria-invalid="false"><div id="err-nom"></div>
      <input name="prenom" id="prenom" aria-describedby="err-prenom" aria-invalid="false"><div id="err-prenom"></div>
      <input name="email" id="email" aria-describedby="err-email" aria-invalid="false"><div id="err-email"></div>
      <input name="telephone" id="telephone" aria-describedby="err-telephone" aria-invalid="false"><div id="err-telephone"></div>
      <input name="permis" id="permis" aria-describedby="err-permis" aria-invalid="false"><div id="err-permis"></div>
      <input name="age" id="age" aria-describedby="err-age" aria-invalid="false"><div id="err-age"></div>
      <button type="submit">Continuer</button>
    </form>
  </body>`;
}

function newWindow(html) {
  const dom = new JSDOM(html, { url: "https://getlocation.fr/reservation.html", runScripts: "outside-only" });
  dom.window.eval(DATA_SRC + "\n" + APP_SRC);
  return dom.window;
}

test("initReservationPage : pré-remplit le formulaire si le conducteur avait déjà été saisi (retour arrière)", () => {
  const window = newWindow(driverFormHtml());
  window.localStorage.setItem("gl_reservation", JSON.stringify({
    vehiculeId: "opel-corsa",
    dateDebut: "2026-08-10", heureDebut: "10:00",
    dateFin: "2026-08-12", heureFin: "10:00",
    jours: 2, assurance: false,
    conducteur: { nom: "Dupont", prenom: "Jean", email: "jean@example.com", telephone: "0601020304", permis: "123456", age: 30 },
    _savedAt: Date.now()
  }));

  window.initReservationPage();

  assert.equal(window.document.getElementById("nom").value, "Dupont");
  assert.equal(window.document.getElementById("prenom").value, "Jean");
  assert.equal(window.document.getElementById("email").value, "jean@example.com");
  assert.equal(window.document.getElementById("telephone").value, "0601020304");
  assert.equal(window.document.getElementById("permis").value, "123456");
  assert.equal(window.document.getElementById("age").value, "30");
});

test("initReservationPage : ne pré-remplit rien pour une première visite (pas de conducteur enregistré)", () => {
  const window = newWindow(driverFormHtml());
  window.localStorage.setItem("gl_reservation", JSON.stringify({
    vehiculeId: "opel-corsa",
    dateDebut: "2026-08-10", heureDebut: "10:00",
    dateFin: "2026-08-12", heureFin: "10:00",
    jours: 2, assurance: false,
    _savedAt: Date.now()
  }));

  window.initReservationPage();
  assert.equal(window.document.getElementById("nom").value, "");
});

test("validateDriverForm : marque aria-invalid et place le focus sur le premier champ en erreur", () => {
  const window = newWindow(driverFormHtml());
  const form = window.document.getElementById("driver-form");
  window.document.getElementById("nom").value = "";
  window.document.getElementById("prenom").value = "";
  window.document.getElementById("email").value = "pas-un-email";
  window.document.getElementById("telephone").value = "0601020304";
  window.document.getElementById("permis").value = "123456";
  window.document.getElementById("age").value = "30";

  const valid = window.validateDriverForm(form);

  assert.equal(valid, false);
  assert.equal(window.document.getElementById("nom").getAttribute("aria-invalid"), "true");
  assert.equal(window.document.getElementById("email").getAttribute("aria-invalid"), "true");
  assert.equal(window.document.getElementById("telephone").getAttribute("aria-invalid"), "false");
  // Le focus doit être sur le premier champ en erreur dans l'ordre du formulaire (nom).
  assert.equal(window.document.activeElement, window.document.getElementById("nom"));
});

test("validateDriverForm : accepte un formulaire valide et efface les messages d'erreur", () => {
  const window = newWindow(driverFormHtml());
  const form = window.document.getElementById("driver-form");
  window.document.getElementById("nom").value = "Dupont";
  window.document.getElementById("prenom").value = "Jean";
  window.document.getElementById("email").value = "jean@example.com";
  window.document.getElementById("telephone").value = "0601020304";
  window.document.getElementById("permis").value = "123456";
  window.document.getElementById("age").value = "30";

  const valid = window.validateDriverForm(form);
  assert.equal(valid, true);
  assert.equal(window.document.getElementById("nom").getAttribute("aria-invalid"), "false");
  assert.equal(window.document.getElementById("err-nom").textContent, "");
});
