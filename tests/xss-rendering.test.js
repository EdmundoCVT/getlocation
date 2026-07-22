// tests/xss-rendering.test.js
//
// Vérifie, dans un vrai environnement DOM (jsdom), que les données pouvant
// contenir une saisie utilisateur (nom/prénom du conducteur, adresse de
// livraison libre) ne sont JAMAIS interprétées comme du HTML lors du rendu
// des pages reservation.html, paiement.html et confirmation.html. Ces trois
// fonctions ont été réécrites en P0-7 pour utiliser exclusivement
// createElement/textContent (jamais innerHTML) sur les valeurs utilisateur.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const DATA_SRC = fs.readFileSync(path.join(__dirname, "..", "js", "data.js"), "utf8");
const APP_SRC = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8");

const XSS_PRENOM = "<img src=x onerror=alert(1)>";
const XSS_NOM = "<script>alert(2)</script>";
const XSS_ADRESSE = "<svg onload=alert(3)>Rue du Test";

function newWindow() {
  const dom = new JSDOM("<!DOCTYPE html><body></body>", { url: "https://getlocation.fr/", runScripts: "outside-only" });
  dom.window.eval(DATA_SRC + "\n" + APP_SRC);
  return dom.window;
}

function assertNoScriptInjection(container, rawValues) {
  const html = container.innerHTML;
  const text = container.textContent;
  for (const raw of rawValues) {
    // Le HTML généré ne doit contenir aucune balise réelle (non échappée)
    // issue de la valeur utilisateur : on vérifie l'absence du caractère
    // "<" suivi du tag, pas une simple sous-chaîne (qui peut légitimement
    // apparaître dans du texte échappé, ex. "onerror=alert" en tant que
    // texte brut à l'intérieur d'un nœud texte — ce n'est pas un risque).
    assert.equal(html.includes(raw), false, `La valeur brute "${raw}" ne doit jamais apparaître telle quelle (non échappée) dans le HTML généré`);
    assert.equal(text.includes(raw), true, `La valeur "${raw}" doit être présente en tant que texte (preuve qu'elle a été traitée comme donnée, pas comme balisage)`);
  }
  // Aucun élément réel du DOM (balise <script>, ou attribut onerror/onload
  // porteur du payload injecté) ne doit avoir été créé à partir des valeurs
  // utilisateur. Le véhicule (vignetteVehicule) utilise légitimement un
  // onerror="this.remove()" sur sa propre <img> interne : on ne flag donc
  // que les attributs contenant explicitement le payload "alert(", jamais
  // n'importe quel onerror.
  assert.equal(container.querySelectorAll("script").length, 0);
  container.querySelectorAll("[onerror], [onload]").forEach((el) => {
    const attrValue = (el.getAttribute("onerror") || "") + (el.getAttribute("onload") || "");
    assert.equal(attrValue.includes("alert("), false, `Un élément porte un attribut onerror/onload issu d'une injection : ${el.outerHTML}`);
  });
}

test("renderConfirmationDetails (confirmation.html) échappe les données conducteur", () => {
  const window = newWindow();
  const container = window.document.createElement("div");
  window.renderConfirmationDetails(container, {
    id: "res_" + "a".repeat(32),
    vehicule: { id: "opel-corsa" },
    dateDebut: "2026-08-01", heureDebut: "10:00",
    dateFin: "2026-08-03", heureFin: "10:00",
    lieuPrise: "Agence Grasse", lieuRetour: "Agence Grasse",
    jours: 2, total: 120,
    conducteur: { prenom: XSS_PRENOM, nom: XSS_NOM, email: "test@example.com" }
  });
  assertNoScriptInjection(container, [XSS_PRENOM, XSS_NOM]);
});

test("buildPaymentSummary (paiement.html) échappe les données conducteur", () => {
  const window = newWindow();
  const container = window.document.createElement("div");
  const vehicule = window.getVehiculeParId("opel-corsa");
  const data = {
    dateDebut: "2026-08-01", heureDebut: "10:00",
    dateFin: "2026-08-03", heureFin: "10:00",
    jours: 2,
    conducteur: { prenom: XSS_PRENOM, nom: XSS_NOM, email: "test@example.com" }
  };
  window.buildPaymentSummary(container, vehicule, data, 120, 0, 120);
  assertNoScriptInjection(container, [XSS_PRENOM, XSS_NOM]);
});

test("initReservationPage (reservation.html) échappe une adresse de livraison saisie par l'utilisateur", () => {
  const window = newWindow();
  window.document.body.innerHTML = `
    <div id="reservation-summary"></div>
    <input type="checkbox" id="assurance">
    <form id="driver-form">
      <input name="nom"><input name="prenom"><input name="email">
      <input name="telephone"><input name="permis"><input name="age">
    </form>
  `;
  window.localStorage.setItem("gl_reservation", JSON.stringify({
    vehiculeId: "opel-corsa",
    dateDebut: "2026-08-10", heureDebut: "10:00",
    dateFin: "2026-08-12", heureFin: "10:00",
    lieuPrise: "Livraison à l'adresse de votre choix",
    adressePrise: XSS_ADRESSE,
    lieuRetour: "Agence Grasse", adresseRetour: "",
    jours: 2, assurance: false,
    _savedAt: Date.now()
  }));

  window.initReservationPage();
  const container = window.document.getElementById("reservation-summary");
  assertNoScriptInjection(container, [XSS_ADRESSE]);
});
