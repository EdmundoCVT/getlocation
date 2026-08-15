const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { VEHICULES } = require("../js/data.js");

const ROOT = path.join(__dirname, "..");

test("chaque véhicule de la flotte d'accueil mène vers sa fiche ciblée", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const document = new JSDOM(html).window.document;
  const cards = [...document.querySelectorAll(".vehicle-card[data-vehicle-link]")];

  assert.equal(cards.length, VEHICULES.length);
  for (const vehicule of VEHICULES) {
    const href = `vehicules.html?vehicule=${vehicule.id}`;
    const card = cards.find((item) => item.dataset.vehicleLink === href);
    assert.ok(card, `la carte ${vehicule.id} doit ouvrir ${href}`);
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
