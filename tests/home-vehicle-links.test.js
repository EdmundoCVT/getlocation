const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..");

test("l'accueil ne duplique pas le catalogue et conserve son accès dans le menu", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const document = new JSDOM(html).window.document;
  assert.equal(document.querySelectorAll(".vehicle-card[data-vehicle-link]").length, 0);
  assert.ok(document.querySelector('.main-nav a[href="vehicules.html"]'));
});

test("la page véhicules filtre le catalogue avec un paramètre validé", () => {
  const source = fs.readFileSync(path.join(ROOT, "js", "app.js"), "utf8");
  assert.match(source, /new URLSearchParams\(window\.location\.search\)\.get\("vehicule"\)/);
  assert.match(source, /vehiculeCibleId \? getVehiculeParId\(vehiculeCibleId\) : null/);
  assert.match(source, /vehiculeCible\s*\? \[vehiculeCible\]/);
});
