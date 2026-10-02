const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateQuote } = require("../js/pricing.js");

function quote(vehicleId, dateDebut, dateFin, extra = {}) { return calculateQuote({ vehicleId, dateDebut, dateFin, ...extra }); }

test("1 — Corsa normale : 3 jours et 600 km", () => { const q = quote("opel-corsa", "2026-10-05", "2026-10-08"); assert.equal(q.rentalAfterDiscount, 147); assert.equal(q.includedKm, 600); });
test("2 — Corsa MIPCOM : très forte", () => { const q = quote("opel-corsa", "2026-10-12", "2026-10-15"); assert.equal(q.rentalAfterDiscount, 195); assert.equal(q.includedKm, 600); });
test("3 — Corsa multi-périodes : normal + MIPCOM", () => { const q = quote("opel-corsa", "2026-10-09", "2026-10-14"); assert.deepEqual(q.dailyRates.map((d) => d.rate), [49, 49, 65, 65, 65]); assert.equal(q.rentalSubtotal, 293); assert.equal(q.discountAmount, 14.65); assert.equal(q.rentalAfterDiscount, 278.35); assert.equal(q.includedKm, 900); });
test("4 — Peugeot 2008 : remise 7 jours", () => { const q = quote("peugeot-2008-hybrid", "2026-10-02", "2026-10-09"); assert.equal(q.rentalSubtotal, 413); assert.equal(q.rentalAfterDiscount, 371.7); assert.equal(q.includedKm, 1100); });
test("5 — Peugeot 3008 : 14 jours très forte", () => { const q = quote("peugeot-3008", "2027-07-01", "2027-07-15"); assert.equal(q.rentalSubtotal, 1386); assert.equal(q.rentalAfterDiscount, 1178.1); assert.equal(q.includedKm, 2000); });
test("6 — Toyota Proace : 30 jours très forte", () => { const q = quote("toyota-proace-city", "2027-07-01", "2027-07-31"); assert.equal(q.rentalSubtotal, 3270); assert.equal(q.rentalAfterDiscount, 2616); assert.equal(q.includedKm, 3000); });
test("7 — Corsa : forfait km et livraison", () => { const q = quote("opel-corsa", "2026-10-05", "2026-10-08", { extraMileagePackageId: "km-200", deliveryDistanceKm: 15 }); assert.equal(q.rentalAfterDiscount, 147); assert.equal(q.extraMileagePackage.amount, 60); assert.equal(q.delivery.amount, 35); assert.equal(q.total, 242); assert.equal(q.includedKm + q.extraMileagePackage.km, 800); });
