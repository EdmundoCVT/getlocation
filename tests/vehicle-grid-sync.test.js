// tests/vehicle-grid-sync.test.js
//
// Vérifie que les grilles véhicules recopiées en dur dans index.html et les
// pages locales (location-voiture-*.html) restent synchronisées avec
// js/data.js (voir scripts/check-vehicle-grid-sync.js pour le détail du
// risque et de la méthode). vehicules.html n'est pas concerné : sa grille
// est générée en JS directement depuis VEHICULES.

const test = require("node:test");
const assert = require("node:assert/strict");
const { findDivergences } = require("../scripts/check-vehicle-grid-sync.js");

test("les grilles véhicules en dur (accueil + pages locales) sont synchronisées avec js/data.js", () => {
  const errors = findDivergences();
  assert.deepEqual(errors, [], "Divergences détectées entre js/data.js et les grilles en dur :\n" + errors.join("\n"));
});
