const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..");

test("chaque aperçu de véhicule de l'accueil mène vers sa fiche ciblée", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const document = new JSDOM(html).window.document;
  const cards = [...document.querySelectorAll(".vehicle-card[data-vehicle-link]")];

  const apercus = ["opel-corsa", "peugeot-2008-hybrid", "toyota-proace-city"];
  assert.equal(cards.length, apercus.length);
  for (const id of apercus) {
    const href = `vehicules.html?vehicule=${id}`;
    const card = cards.find((item) => item.dataset.vehicleLink === href);
    assert.ok(card, `la carte ${id} doit ouvrir ${href}`);
    assert.equal(card.getAttribute("role"), "link");
    assert.equal(card.getAttribute("tabindex"), "0");
    assert.equal(card.querySelector("a.btn").getAttribute("href"), href);
  }
});

test("la page véhicules filtre le catalogue avec un paramètre validé", () => {
  const source = fs.readFileSync(path.join(ROOT, "js", "app.js"), "utf8");
  assert.match(source, /new URLSearchParams\(window\.location\.search\)\.get\("vehicule"\)/);
  assert.match(source, /vehiculeCibleId \? getVehiculeParId\(vehiculeCibleId\) : null/);
  assert.match(source, /vehiculeCible\s*\? \[vehiculeCible\]/);
});
