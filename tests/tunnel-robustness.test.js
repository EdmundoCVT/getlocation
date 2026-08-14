// tests/tunnel-robustness.test.js
//
// Couvre les améliorations de robustesse du tunnel de réservation (P1-4) :
// pré-remplissage du formulaire conducteur après un retour arrière,
// aria-invalid + focus sur la première erreur de validation.
//
// Depuis la réorganisation du tunnel (les coordonnées ne sont demandées
// qu'à la toute dernière étape, une fois les options choisies et le prix
// final visible — demande client), le pré-remplissage du formulaire
// conducteur a lieu sur paiement.html (initPaiementPage), plus sur
// reservation.html.

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
    <form id="driver-form">
      <input name="nom" id="nom" aria-describedby="err-nom" aria-invalid="false"><div id="err-nom"></div>
      <input name="prenom" id="prenom" aria-describedby="err-prenom" aria-invalid="false"><div id="err-prenom"></div>
      <input name="email" id="email" aria-describedby="err-email" aria-invalid="false"><div id="err-email"></div>
      <input name="telephone" id="telephone" aria-describedby="err-telephone" aria-invalid="false"><div id="err-telephone"></div>
      <input name="naissance" id="naissance" aria-describedby="err-naissance" aria-invalid="false"><div id="err-naissance"></div>
      <button type="submit">Continuer</button>
    </form>
  </body>`;
}

// paiement.html : les mêmes champs conducteur vivent désormais dans
// #payment-form, aux côtés de la case CGL (le paiement carte lui-même se
// fait sur une page hébergée par Mollie, pas dans ce formulaire).
function paiementFormHtml() {
  return `<!DOCTYPE html><body>
    <div class="info-banner" id="info-banner"></div>
    <div id="payment-summary"></div>
    <form id="payment-form">
      <input name="nom" id="nom" aria-describedby="err-nom" aria-invalid="false"><div id="err-nom"></div>
      <input name="prenom" id="prenom" aria-describedby="err-prenom" aria-invalid="false"><div id="err-prenom"></div>
      <input name="email" id="email" aria-describedby="err-email" aria-invalid="false"><div id="err-email"></div>
      <input name="telephone" id="telephone" aria-describedby="err-telephone" aria-invalid="false"><div id="err-telephone"></div>
      <input name="naissance" id="naissance" aria-describedby="err-naissance" aria-invalid="false"><div id="err-naissance"></div>
      <input type="checkbox" id="cgl-accept">
      <div id="err-cgl-accept"></div>
      <button id="pay-button"><span class="btn-label">Payer</span></button>
      <div id="payment-errors"></div>
    </form>
  </body>`;
}

function newWindow(html, url = "https://getlocation.fr/reservation.html") {
  const dom = new JSDOM(html, { url, runScripts: "outside-only" });
  dom.window.eval(DATA_SRC + "\n" + APP_SRC);
  return dom.window;
}

test("initPaiementPage : pré-remplit le formulaire si le conducteur avait déjà été saisi (retour arrière)", () => {
  const window = newWindow(paiementFormHtml(), "https://getlocation.fr/paiement.html");
  window.localStorage.setItem("gl_reservation", JSON.stringify({
    vehiculeId: "opel-corsa",
    dateDebut: "2026-08-10", heureDebut: "10:00",
    dateFin: "2026-08-12", heureFin: "10:00",
    jours: 2,
    conducteur: { nom: "Dupont", prenom: "Jean", email: "jean@example.com", telephone: "0601020304", naissance: "15/06/1995" },
    _savedAt: Date.now()
  }));

  window.initPaiementPage();

  assert.equal(window.document.getElementById("nom").value, "Dupont");
  assert.equal(window.document.getElementById("prenom").value, "Jean");
  assert.equal(window.document.getElementById("email").value, "jean@example.com");
  assert.equal(window.document.getElementById("telephone").value, "0601020304");
  assert.equal(window.document.getElementById("naissance").value, "15/06/1995");
});

test("initPaiementPage : ne pré-remplit rien pour une première visite (pas de conducteur enregistré)", () => {
  const window = newWindow(paiementFormHtml(), "https://getlocation.fr/paiement.html");
  window.localStorage.setItem("gl_reservation", JSON.stringify({
    vehiculeId: "opel-corsa",
    dateDebut: "2026-08-10", heureDebut: "10:00",
    dateFin: "2026-08-12", heureFin: "10:00",
    jours: 2,
    _savedAt: Date.now()
  }));

  window.initPaiementPage();
  assert.equal(window.document.getElementById("nom").value, "");
});

test("initReservationPage : n'exige plus de coordonnées conducteur (options avant paiement)", () => {
  const window = newWindow(`<!DOCTYPE html><body>
    <div id="reservation-summary"></div>
    <div id="options-list"></div>
    <input type="text" id="promo-input">
    <button type="button" id="promo-apply"></button>
    <div id="promo-message"></div>
    <button type="button" id="continue-to-payment"></button>
  </body>`);
  window.localStorage.setItem("gl_reservation", JSON.stringify({
    vehiculeId: "opel-corsa",
    dateDebut: "2026-08-10", heureDebut: "10:00",
    dateFin: "2026-08-12", heureFin: "10:00",
    jours: 2,
    _savedAt: Date.now()
  }));

  // Ne doit pas planter en l'absence de tout formulaire conducteur sur
  // cette page (il a été déplacé vers paiement.html).
  assert.doesNotThrow(() => window.initReservationPage());
  assert.match(window.document.getElementById("reservation-summary").textContent, /118/);
});

test("validateDriverForm : marque aria-invalid et place le focus sur le premier champ en erreur", () => {
  const window = newWindow(driverFormHtml());
  const form = window.document.getElementById("driver-form");
  window.document.getElementById("nom").value = "";
  window.document.getElementById("prenom").value = "";
  window.document.getElementById("email").value = "pas-un-email";
  window.document.getElementById("telephone").value = "0601020304";
  window.document.getElementById("naissance").value = "15/06/1995";

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
  window.document.getElementById("naissance").value = "15/06/1995";

  const valid = window.validateDriverForm(form);
  assert.equal(valid, true);
  assert.equal(window.document.getElementById("nom").getAttribute("aria-invalid"), "false");
  assert.equal(window.document.getElementById("err-nom").textContent, "");
});

test("naissanceFrVersISO : convertit JJ/MM/AAAA en YYYY-MM-DD, rejette un format ou une date inexistante", () => {
  const window = newWindow(driverFormHtml());
  assert.equal(window.naissanceFrVersISO("15/06/1995"), "1995-06-15");
  assert.equal(window.naissanceFrVersISO("01/01/2000"), "2000-01-01");
  // Format ISO ou incomplet : rejeté (seul JJ/MM/AAAA est accepté).
  assert.equal(window.naissanceFrVersISO("1995-06-15"), null);
  assert.equal(window.naissanceFrVersISO("15/6/1995"), null);
  // Date qui n'existe pas : new Date() la « roulerait » silencieusement sur
  // mars sans cette vérification explicite des composants.
  assert.equal(window.naissanceFrVersISO("31/02/2000"), null);
  assert.equal(window.naissanceFrVersISO(""), null);
  assert.equal(window.naissanceFrVersISO(undefined), null);
});

test("initPaiementPage : insère automatiquement les \"/\" pendant la saisie de la date de naissance", () => {
  const window = newWindow(paiementFormHtml(), "https://getlocation.fr/paiement.html");
  window.localStorage.setItem("gl_reservation", JSON.stringify({
    vehiculeId: "opel-corsa",
    dateDebut: "2026-08-10", heureDebut: "10:00",
    dateFin: "2026-08-12", heureFin: "10:00",
    jours: 2,
    _savedAt: Date.now()
  }));
  window.initPaiementPage();

  const input = window.document.getElementById("naissance");
  function taper(valeurBrute) {
    input.value = valeurBrute;
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  }

  taper("1");
  assert.equal(input.value, "1");
  taper("15");
  assert.equal(input.value, "15");
  taper("156");
  assert.equal(input.value, "15/6");
  taper("15061995");
  assert.equal(input.value, "15/06/1995");
  // Les caractères non numériques déjà insérés (ex. l'utilisateur tape lui-
  // même un "/") ne doivent pas produire de doublon ou de format cassé.
  taper("15/06/1995");
  assert.equal(input.value, "15/06/1995");
});
