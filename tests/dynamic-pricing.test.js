const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateQuote, levelForDate } = require("../js/pricing.js");
const { calculerPrixTotal } = require("../js/data.js");

function quote(vehicleId, dateDebut, dateFin, extra = {}) { return calculateQuote({ vehicleId, dateDebut, dateFin, ...extra }); }

test("1 — Corsa normale : 3 jours et 600 km", () => { const q = quote("opel-corsa", "2026-10-05", "2026-10-08"); assert.equal(q.rentalAfterDiscount, 165); assert.equal(q.includedKm, 600); });
test("2 — Corsa MIPCOM : très forte", () => { const q = quote("opel-corsa", "2026-10-12", "2026-10-15"); assert.equal(q.rentalAfterDiscount, 195); assert.equal(q.includedKm, 600); });
test("3 — Corsa multi-périodes : normal + MIPCOM", () => { const q = quote("opel-corsa", "2026-10-09", "2026-10-14"); assert.deepEqual(q.dailyRates.map((d) => d.rate), [55, 55, 65, 65, 65]); assert.equal(q.rentalSubtotal, 305); assert.equal(q.discountAmount, 15.25); assert.equal(q.rentalAfterDiscount, 289.75); assert.equal(q.includedKm, 1000); });
test("4 — Peugeot 2008 : remise 7 jours", () => { const q = quote("peugeot-2008-hybrid", "2026-10-02", "2026-10-09"); assert.equal(q.rentalSubtotal, 455); assert.equal(q.rentalAfterDiscount, 409.5); assert.equal(q.includedKm, 1400); });
test("5 — Festival de Cannes : niveau exceptionnelle", () => { const q = quote("peugeot-3008", "2027-05-12", "2027-05-15"); assert.equal(q.rentalAfterDiscount, 357); assert.equal(q.includedKm, 600); });
test("6 — Nouvel An : prioritaire sur les fêtes", () => { const q = quote("opel-corsa", "2026-12-30", "2027-01-02"); assert.equal(q.rentalAfterDiscount, 237); assert.equal(q.includedKm, 600); });
test("7 — Grand Prix de Monaco : niveau exceptionnelle", () => { const q = quote("toyota-proace-city", "2027-06-04", "2027-06-07"); assert.equal(q.rentalAfterDiscount, 387); assert.equal(q.includedKm, 600); });
test("8 — Proace 30 jours : remise et kilométrage", () => { const q = quote("toyota-proace-city", "2027-07-01", "2027-07-31"); assert.equal(q.rentalSubtotal, 3270); assert.equal(q.rentalAfterDiscount, 2616); assert.equal(q.includedKm, 6000); });
test("9 — forfait km et livraison", () => {
  const q = quote("opel-corsa", "2026-10-05", "2026-10-08", { extraMileagePackageId: "km-200", deliveryDistanceKm: 15 });
  assert.equal(q.rentalAfterDiscount, 165); assert.equal(q.extraMileagePackage.amount, 60); assert.equal(q.delivery.amount, 35); assert.equal(q.total, 260); assert.equal(q.includedKm + q.extraMileagePackage.km, 800);
  const price = calculerPrixTotal({ vehiculeId: "opel-corsa", dateDebut: "2026-10-05", dateFin: "2026-10-08", options: ["km-200", "livraison-adresse"], deliveryDistanceKm: 15 });
  assert.equal(price.total, 260);
  assert.deepEqual(price.pricingSnapshot.dates, { debut: "2026-10-05", fin: "2026-10-08" });
  assert.equal(price.pricingSnapshot.kilometresInclus, 800);
});
test("10 — une période inférieure ne baisse jamais la saison", () => {
  const result = levelForDate("2027-07-15", [{ name: "Événement de test", start: "2027-07-15", end: "2027-07-15", level: "high" }]);
  assert.deepEqual(result, { level: "veryHigh", event: null });
});
