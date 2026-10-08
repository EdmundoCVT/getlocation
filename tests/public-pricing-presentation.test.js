const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const root = path.join(__dirname, "..");
const PRICING = fs.readFileSync(path.join(root, "js", "pricing.js"), "utf8");
const DATA = fs.readFileSync(path.join(root, "js", "data.js"), "utf8");
const APP = fs.readFileSync(path.join(root, "js", "app.js"), "utf8");
const { calculerPrixTotal } = require("../js/data.js");

function price(overrides = {}) {
  return calculerPrixTotal({
    vehiculeId: "opel-corsa", dateDebut: "2026-08-10", heureDebut: "10:00", dateFin: "2026-08-15", heureFin: "10:00",
    ...overrides
  });
}

function vehicleWindow(search) {
  const dom = new JSDOM('<!doctype html><body><h1 class="section-title"></h1><div id="filter-bar"></div><div id="vehicle-grid"></div></body>', {
    url: "https://getlocation.fr/vehicules.html", runScripts: "outside-only"
  });
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.eval(PRICING + "\n" + DATA + "\n" + APP);
  if (search) dom.window.localStorage.setItem("gl_recherche", JSON.stringify(search));
  dom.window.initVehiculesPage();
  return dom.window;
}

test("présentation centrale : durée, prix moyen, remise et TVA suivent exactement le moteur", () => {
  const p = price();
  assert.equal(p.jours, 5);
  assert.equal(p.sousTotalBrut, 325);
  assert.equal(p.sousTotal, 308.75);
  assert.equal(p.presentationPrix.prixMoyenJour, 61.75);
  assert.equal(p.presentationPrix.locationHT, 257.29);
  assert.equal(p.presentationPrix.locationTVA, 51.46);
  assert.equal(p.presentationPrix.locationHT + p.presentationPrix.locationTVA, p.sousTotal);
  assert.equal(p.presentationPrix.total, p.total, "la TVA est seulement une décomposition, jamais un supplément");
  assert.equal(p.presentationPrix.lignes.find((line) => line.id === "location").taxRate, 20);
  assert.equal(p.presentationPrix.lignes.find((line) => line.id === "remise-duree").montant, -16.25);
});

test("la TVA concerne uniquement la location, jamais livraison, options ou protection", () => {
  const p = price({ options: ["livraison-adresse", "siege-enfant"], deliveryDistanceKm: 10, protection: "confort" });
  assert.equal(p.presentationPrix.locationTTC, 308.75);
  assert.equal(p.presentationPrix.locationTVA, 51.46);
  assert.equal(p.presentationPrix.lignes.find((line) => line.id === "option-livraison-adresse").taxRate, 0);
  assert.equal(p.presentationPrix.lignes.find((line) => line.id === "option-siege-enfant").taxRate, 0);
  assert.equal(p.presentationPrix.lignes.find((line) => line.id === "protection").taxRate, 0);
  assert.equal(p.total, 308.75 + 30 + 20 + 60, "aucune TVA ne doit être ajoutée une seconde fois");
});

test("cartes : aucun tarif sans recherche, puis prix moyen et modal cohérents après les dates", () => {
  const withoutDates = vehicleWindow();
  assert.match(withoutDates.document.querySelector(".vehicle-card").textContent, /Sélectionnez vos dates pour voir le tarif/);
  assert.equal(withoutDates.document.querySelector("[data-price-details]"), null);

  const search = { dateDebut: "2026-08-10", heureDebut: "10:00", dateFin: "2026-08-15", heureFin: "10:00", lieuPrise: "Livraison à l'adresse de votre choix", lieuRetour: "Livraison à l'adresse de votre choix" };
  const withDates = vehicleWindow(search);
  const card = withDates.document.querySelector(".vehicle-card");
  assert.match(card.textContent, /61,75\s?€\s*\/\s*jour/);
  assert.match(card.textContent, /308,75\s?€\s*total/);
  assert.match(card.textContent, /65\s?€\s*\/\s*jour/);
  card.querySelector("[data-price-details]").click();
  const dialog = withDates.document.getElementById("price-details-dialog");
  assert.ok(dialog.open);
  assert.match(dialog.textContent, /TVA 20 % incluse dans la location/);
  assert.match(dialog.textContent, /51,46\s?€/);
  assert.match(dialog.textContent, /308,75\s?€/);
});

test("récapitulatif et modal partagent exactement le même total final", () => {
  const dom = new JSDOM('<!doctype html><body><div id="summary"></div></body>', { url: "https://getlocation.fr/reservation.html", runScripts: "outside-only" });
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.eval(PRICING + "\n" + DATA + "\n" + APP);
  const p = dom.window.calculerPrixTotal({ vehiculeId: "opel-corsa", dateDebut: "2026-08-10", heureDebut: "10:00", dateFin: "2026-08-15", heureFin: "10:00", options: ["siege-enfant"], protection: "confort" });
  const summary = dom.window.document.getElementById("summary");
  dom.window.appendBreakdownRows(summary, p);
  assert.match(summary.querySelector(".price-highlights").textContent, /388,75\s?€\s*total/);
  summary.querySelector(".price-details-trigger").click();
  assert.match(dom.window.document.getElementById("price-details-dialog").textContent, /388,75\s?€/);
});
