import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd());
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("la page véhicules ne répète pas la recherche et conserve une seule modification des dates", () => {
  const html = read("vehicules.html");
  assert.doesNotMatch(html, /search-summary/);
  assert.doesNotMatch(html, /Modifier ma recherche/);
  assert.match(html, /Modifier les dates/);
});

test("les cartes véhicules utilisent le vocabulaire compact et sans description marketing", () => {
  const app = read("js/app.js");
  assert.doesNotMatch(app, /<p class="hint-text">\$\{v\.description\}/);
  assert.ok(app.includes('t("Choisir ce véhicule")'));
  assert.ok(app.includes('class="vehicle-total"'));
  assert.ok(app.includes('t(`${v.places} places`)'));
  assert.ok(app.includes('t("Tarif sur demande")'));
  assert.ok(app.includes('class="vehicle-details"'));
});

test("le responsive réduit la densité de la sélection véhicules sur mobile", () => {
  const css = read("css/style.css");
  assert.ok(css.includes(".vehicle-selection { padding-top: 18px; }"));
  assert.ok(css.includes(".vehicle-selection .vehicle-media { height: 210px; }"));
  assert.ok(css.includes(".vehicle-selection .vt-option"));
});
