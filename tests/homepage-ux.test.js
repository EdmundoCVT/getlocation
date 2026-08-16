const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

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
