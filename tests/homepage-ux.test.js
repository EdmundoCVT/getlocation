const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { VEHICULES, getOptionParId, getKmInclusParJour, getSupplementKmCentimes } = require("../js/data.js");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const document = new JSDOM(html).window.document;

test("le hero précède le moteur de recherche sur la homepage", () => {
  const hero = document.querySelector(".hero");
  const form = document.getElementById("search-form");

  assert.ok(hero && form);
  assert.equal(hero.compareDocumentPosition(form) & 4, 4);
});

test("la promesse et le CTA mettent en avant la livraison et les disponibilités", () => {
  assert.match(document.querySelector(".hero-text").textContent, /livr/i);
  assert.match(document.querySelector(".hero-text").textContent, /Côte d'Azur/i);
  assert.equal(
    document.querySelector("#search-form button[type='submit']").textContent.trim(),
    "Voir les véhicules disponibles"
  );
});

test("le hero ne présente pas de note en étoiles non sourcée", () => {
  assert.equal(document.querySelector(".hero-stars"), null);
  assert.doesNotMatch(document.querySelector(".hero").textContent, /★★★★★/);
});

test("la homepage ne présente pas de section d'avis tant qu'ils ne sont pas disponibles", () => {
  assert.doesNotMatch(document.body.textContent, /Avis clients/);
  assert.equal(document.querySelector(".testimonials"), null);
});

test("les CTA principaux utilisent des libellés cohérents", () => {
  const availabilityCtas = [...document.querySelectorAll("a, button")]
    .filter((element) => element.textContent.trim() === "Voir les véhicules disponibles");
  assert.equal(availabilityCtas.length, 3);
  assert.doesNotMatch(document.body.textContent, /Réserver maintenant|Voir la flotte|>Découvrir</);
});

test("les blocs de réassurance répétitifs sont regroupés", () => {
  assert.doesNotMatch(document.body.textContent, /Pourquoi nous faire confiance|Pourquoi GETLOCATION/);
  assert.match(document.body.textContent, /Tarifs transparents/);
  assert.match(document.body.textContent, /sans frais cachés/);
});

test("les informations tarifaires essentielles reflètent le catalogue", () => {
  const inclusions = document.querySelector(".booking-inclusions").textContent;
  const livraison = getOptionParId("livraison-adresse");
  assert.match(inclusions, new RegExp(`${getKmInclusParJour()} km / jour`));
  assert.match(inclusions, new RegExp(`${(getSupplementKmCentimes() / 100).toFixed(2).replace(".", ",")} € / km`));
  assert.match(inclusions, new RegExp(`Livraison : ${livraison.prix} €`));
  assert.match(inclusions, new RegExp(`Caution dès ${Math.min(...VEHICULES.map(v => v.caution))} €`));
});

test("chaque véhicule de la homepage affiche sa caution exacte", () => {
  for (const vehicule of VEHICULES) {
    const card = document.querySelector(`[data-vehicle-link="vehicules.html?vehicule=${vehicule.id}"]`);
    assert.match(card.textContent, new RegExp(`Caution ${vehicule.caution} €`));
  }
});

test("la FAQ utilise des accordéons natifs accessibles", () => {
  const items = [...document.querySelectorAll(".faq-item")];
  assert.equal(items.length, 5);
  assert.ok(items.every(item => item.tagName === "DETAILS" && item.querySelector(":scope > summary")));
});

test("les actions de conversion sont balisées sans traceur externe", () => {
  assert.ok(document.querySelector('[data-conversion="recherche_disponibilites"]'));
  assert.ok(document.querySelector('[data-conversion="mobile_disponibilites"]'));
  assert.ok(document.querySelector('[data-conversion="appel"]'));
  assert.ok(document.querySelector('[data-conversion="whatsapp"]'));
});
