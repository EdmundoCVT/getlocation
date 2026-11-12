const test = require("node:test");
const assert = require("node:assert/strict");

const { DELIVERY, deliveryCost, calculateQuote } = require("../js/pricing.js");
const { DELIVERY_REFERENCE_LOCATIONS, VILLES_LIVRAISON, getDeliveryReferenceLocation, calculerPrixTotal } = require("../js/data.js");

test("deliveryCost applique 20 € jusqu'à 5 km puis 1 € par km supplémentaire", () => {
  assert.deepEqual(DELIVERY, { baseFee: 20, includedKm: 5, perExtraKm: 1 });
  for (const [distance, amount] of [[0, 20], [1, 20], [4.9, 20], [5, 20], [6, 21], [10, 25], [18, 33], [20, 35], [28, 43], [33, 48], [34, 49]]) {
    assert.equal(deliveryCost(distance), amount, `${distance} km`);
  }
});

test("deliveryCost refuse les valeurs invalides et arrondit un km supplémentaire commencé au supérieur", () => {
  assert.equal(deliveryCost(-1), 0);
  assert.equal(deliveryCost(null), 0);
  assert.equal(deliveryCost(undefined), 0);
  assert.equal(deliveryCost("distance inconnue"), 0);
  assert.equal(deliveryCost(5.1), 21);
  assert.equal(deliveryCost(6.01), 22);
});

test("les destinations de référence forment l'unique liste connue et portent leur distance commerciale", () => {
  const expected = {
    "Saint-Laurent-du-Var": 0,
    "Gare SNCF de Saint-Laurent-du-Var": 1,
    "Aéroport Nice Côte d’Azur": 5,
    "Gare SNCF Nice Saint-Augustin": 5,
    "Cagnes-sur-Mer": 5,
    "Gare SNCF Cagnes-sur-Mer": 6,
    "Villeneuve-Loubet": 8,
    Nice: 10,
    "Gare SNCF Nice-Ville": 10,
    Biot: 13,
    Antibes: 18,
    "Gare SNCF d'Antibes": 18,
    "Juan-les-Pins": 21,
    Mougins: 24,
    "Le Cannet": 26,
    Cannes: 28,
    "Gare SNCF de Cannes": 28,
    "Cannes-la-Bocca": 32,
    "Gare SNCF de Cannes-la-Bocca": 32,
    Monaco: 32,
    Grasse: 33,
    "Gare SNCF de Grasse": 34
  };
  assert.equal(DELIVERY_REFERENCE_LOCATIONS.length, 22);
  assert.deepEqual(VILLES_LIVRAISON, DELIVERY_REFERENCE_LOCATIONS.map((location) => location.label));
  for (const [label, distanceKm] of Object.entries(expected)) {
    assert.equal(getDeliveryReferenceLocation(label).distanceKm, distanceKm, label);
    assert.equal(deliveryCost(distanceKm), 20 + Math.max(0, distanceKm - 5), label);
  }
});

test("les destinations commerciales principales produisent le montant attendu", () => {
  for (const [label, distanceKm, amount] of [
    ["Aéroport Nice Côte d’Azur", 5, 20],
    ["Nice", 10, 25],
    ["Antibes", 18, 33],
    ["Cannes", 28, 43],
    ["Monaco", 32, 47],
    ["Grasse", 33, 48]
  ]) {
    const reference = getDeliveryReferenceLocation(label);
    assert.equal(reference.distanceKm, distanceKm);
    assert.equal(deliveryCost(reference.distanceKm), amount);
  }
});

test("calculateQuote et calculerPrixTotal utilisent le même moteur de livraison", () => {
  for (const [label, amount] of [["Nice", 25], ["Antibes", 33], ["Cannes", 43], ["Grasse", 48]]) {
    const distance = getDeliveryReferenceLocation(label).distanceKm;
    const quote = calculateQuote({ vehicleId: "opel-corsa", dateDebut: "2027-01-04", dateFin: "2027-01-05", deliveryDistanceKm: distance });
    const total = calculerPrixTotal({ vehiculeId: "opel-corsa", dateDebut: "2027-01-04", dateFin: "2027-01-05", options: ["livraison-adresse"], deliveryDistanceKm: distance });
    assert.equal(quote.delivery.amount, amount, label);
    assert.equal(total.livraison.amount, amount, label);
  }
});
