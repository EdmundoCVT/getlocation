const test = require("node:test");
const assert = require("node:assert/strict");
const { validateReservationInput } = require("../src/lib/validate-reservation-input.js");
const { CGL_VERSION, LIEU_LIVRAISON } = require("../js/data.js");

function payload(overrides = {}) {
  return {
    vehiculeId: "opel-corsa", dateDebut: "2099-10-10", heureDebut: "10:00", dateFin: "2099-10-10", heureFin: "20:00",
    lieuPrise: LIEU_LIVRAISON, lieuRetour: LIEU_LIVRAISON, adressePrise: "Nice", adresseRetour: "Nice",
    conducteur: { nom: "Dupont", prenom: "Jean", email: "jean@example.com", telephone: "0601020304", naissance: "1990-01-01" },
    cglAccepted: true, cglVersion: CGL_VERSION, deliveryDistanceKm: 0, ...overrides
  };
}

test("validation Worker : accepte les créneaux positifs le même jour et refuse les retours égaux ou antérieurs", () => {
  assert.equal(validateReservationInput(payload()).valid, true);
  assert.equal(validateReservationInput(payload({ heureFin: "10:30" })).valid, true);
  assert.equal(validateReservationInput(payload({ heureFin: "10:00" })).valid, false);
  assert.equal(validateReservationInput(payload({ heureDebut: "20:00", heureFin: "10:00" })).valid, false);
  assert.equal(validateReservationInput(payload({ dateFin: "2099-10-11", heureFin: "10:00" })).valid, true);
});
