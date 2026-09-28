const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const document = new JSDOM(html).window.document;

test("le hero contient directement le moteur de recherche sur la homepage", () => {
  const hero = document.querySelector(".hero");
  const form = document.getElementById("search-form");

  assert.ok(hero && form);
  assert.ok(hero.contains(form));
});

test("la promesse met le service de livraison au centre", () => {
  assert.match(document.querySelector(".hero-eyebrow").textContent, /La location de voiture simplifiée/);
  assert.match(document.querySelector(".hero-text").textContent, /Commandez votre véhicule, on vous l'apporte\./);
  assert.equal(document.querySelector(".hero-badges"), null);
  assert.equal(document.querySelector(".hero-cta"), null);
  assert.equal(
    document.querySelector("#search-form button[type='submit']").textContent.trim(),
    "Voir les véhicules disponibles"
  );
});

test("l'accueil demande uniquement les dates avant l'accès aux véhicules", () => {
  assert.equal(document.querySelector("#lieu-prise"), null);
  assert.equal(document.querySelector("#adresse-prise"), null);
  assert.equal(document.querySelector("#adresse-retour"), null);
  assert.equal(document.querySelector(".search-card-heading"), null);
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
  assert.equal(document.querySelectorAll("#search-form button[type='submit']").length, 1);
  assert.equal(document.querySelector("#search-form .btn-primary").textContent.trim(), "Voir les véhicules disponibles");
  assert.doesNotMatch(document.body.textContent, /Réserver maintenant|Voir la flotte|>Découvrir</);
});

test("les blocs de réassurance répétitifs sont regroupés en une seule rangée", () => {
  assert.doesNotMatch(document.body.textContent, /Pourquoi nous faire confiance|Pourquoi GETLOCATION/);
  const items = document.querySelectorAll(".homepage-reassurance-list li");
  assert.equal(items.length, 4);
  assert.match(items[0].textContent, /Livraison sur la Côte d'Azur/);
});

test("les détails tarifaires ne sont pas affichés avant la recherche", () => {
  assert.equal(document.querySelector(".booking-inclusions"), null);
  const searchSection = document.querySelector("#search-form").textContent;
  assert.doesNotMatch(searchSection, /Assurance incluse|km \/ jour|Livraison : \d+ €|Caution dès/);
});

test("le sélecteur utilise les deux silhouettes fournies sans SVG ni emoji", () => {
  const toggle = document.getElementById("vehicle-type-toggle");
  assert.equal(toggle.querySelectorAll(".vt-option").length, 2);
  assert.equal(toggle.querySelectorAll(".vt-icon svg").length, 0);
  assert.ok(toggle.querySelector(".vt-icon-car"));
  assert.ok(toggle.querySelector(".vt-icon-utility"));
  assert.doesNotMatch(toggle.textContent, /🚗|🚐/);
});

test("la homepage présente le service sans répliquer le catalogue", () => {
  assert.equal(document.querySelector(".homepage-vehicle-grid"), null);
  assert.doesNotMatch(document.body.textContent, /La flotte|Une flotte pour chaque trajet/);
  assert.ok(document.querySelector('.main-nav a[href="vehicules.html"]'));
});

test("la FAQ utilise des accordéons natifs accessibles", () => {
  const items = [...document.querySelectorAll(".faq-item")];
  // FAQ opérationnelle enrichie sans réintroduire une liste de flotte figée.
  assert.equal(items.length, 8);
  assert.equal(
    items.some((item) => /Quels véhicules proposez-vous/.test(item.textContent)),
    false,
    "cette question a été retirée de la FAQ"
  );
  assert.ok(items.every(item => item.tagName === "DETAILS" && item.querySelector(":scope > summary")));
  assert.ok(items.every(item => !item.open), "toutes les réponses doivent être fermées par défaut");
});

test("les actions de conversion sont balisées sans traceur externe", () => {
  assert.ok(document.querySelector('[data-conversion="recherche_disponibilites"]'));
  assert.ok(document.querySelector('[data-conversion="mobile_disponibilites"]'));
  assert.equal(document.querySelector('[data-conversion="appel"]'), null);
  assert.equal(document.querySelector('[data-conversion="whatsapp"]'), null);
});
