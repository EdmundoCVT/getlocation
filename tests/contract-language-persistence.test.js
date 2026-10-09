const test = require("node:test");
const assert = require("node:assert/strict");
const { contractLanguage } = require("../src/lib/reservation-store.js");

test("langue contrat : anglais explicite conservé, anciens dossiers français par défaut", () => {
  assert.equal(contractLanguage({ contractLanguage: "en" }), "en");
  assert.equal(contractLanguage({ langueClient: "en" }), "en");
  assert.equal(contractLanguage({ langue: "en" }), "en");
  assert.equal(contractLanguage({}), "fr");
});
