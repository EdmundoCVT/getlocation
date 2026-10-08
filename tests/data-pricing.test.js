const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { dureeEnHeures, joursFacturablesPourPeriode, calculerPrixTotal, getVehiculeParId } = require("../js/data.js");
const { calculateQuote } = require("../js/pricing.js");

const base = { vehiculeId: "peugeot-2008-hybrid", dateDebut: "2026-10-08", heureDebut: "14:00", dateFin: "2026-10-09", heureFin: "14:00" };

test("1 — exactement 24 heures : une journée facturée", () => {
  assert.equal(joursFacturablesPourPeriode(base.dateDebut, base.heureDebut, base.dateFin, base.heureFin), 1);
  assert.equal(calculerPrixTotal(base).jours, 1);
});
test("2 — 24 heures et une minute : deux journées facturées", () => {
  const quote = calculerPrixTotal({ ...base, heureFin: "14:01" });
  assert.equal(quote.jours, 2); assert.equal(quote.kmInclus, 400);
});
test("3 — exactement 72 heures : trois journées facturées", () => {
  assert.equal(calculerPrixTotal({ ...base, dateFin: "2026-10-11", heureFin: "14:00" }).jours, 3);
});
test("4 — 72 heures et une minute : quatre journées facturées", () => {
  assert.equal(calculerPrixTotal({ ...base, dateFin: "2026-10-11", heureFin: "14:01" }).jours, 4);
});
test("5 — cas réel Peugeot 2008 : 78 h, 4 jours, 274 € et 800 km", () => {
  const quote = calculerPrixTotal({ ...base, dateFin: "2026-10-11", heureFin: "20:00" });
  assert.equal(dureeEnHeures(base.dateDebut, base.heureDebut, "2026-10-11", "20:00"), 78);
  assert.equal(quote.jours, 4); assert.deepEqual(quote.tarifsJournaliers.map((day) => day.rate), [65, 65, 65, 79]);
  assert.equal(quote.sousTotalBrut, 274); assert.equal(quote.kmInclus, 800); assert.equal(quote.reductionDuree, null);
});
test("6 — la dernière tranche entamée utilise le niveau événementiel de sa date locale", () => {
  const quote = calculateQuote({ vehicleId: "peugeot-2008-hybrid", dateDebut: "2026-10-10", heureDebut: "14:00", dateFin: "2026-10-11", heureFin: "14:01" });
  assert.deepEqual(quote.dailyRates.map((day) => [day.date, day.rate]), [["2026-10-10", 65], ["2026-10-11", 79]]);
});
test("7 — une journée entamée déclenche le palier de remise correspondant", () => {
  const quote = calculerPrixTotal({ ...base, dateFin: "2026-10-12", heureFin: "14:01" });
  assert.equal(quote.jours, 5); assert.equal(quote.reductionDuree.taux, 0.05);
});
test("8 — protections et options journalières suivent les jours facturés, protection plafonnée à 7 jours", () => {
  const quote = calculerPrixTotal({ ...base, dateFin: "2026-10-15", heureFin: "14:01", protection: "confort", options: ["siege-enfant"] });
  assert.equal(quote.jours, 8); assert.equal(quote.protection.montant, 42); assert.equal(quote.protection.joursFactures, 7);
  assert.equal(quote.optionsSelectionnees.find((option) => option.id === "siege-enfant").montant, 80);
});
test("9 — Europe/Paris : changements d'heure et minuit utilisent les instants réels", () => {
  assert.equal(joursFacturablesPourPeriode("2026-03-28", "14:00", "2026-03-29", "14:00"), 1);
  assert.equal(joursFacturablesPourPeriode("2026-10-24", "14:00", "2026-10-26", "14:00"), 3);
  assert.equal(joursFacturablesPourPeriode("2026-10-08", "23:30", "2026-10-09", "00:30"), 1);
  assert.equal(calculerPrixTotal({ ...base, dateFin: base.dateDebut, heureFin: base.heureDebut }), null);
});
test("10 — le calcul fiable ignore tout montant fourni par le navigateur et le récapitulatif ne double pas Protection", () => {
  const expected = calculerPrixTotal({ ...base, dateFin: "2026-10-11", heureFin: "20:00" });
  const forged = calculerPrixTotal({ ...base, dateFin: "2026-10-11", heureFin: "20:00", total: 0, amount: 0, price: 0 });
  assert.equal(forged.totalCentimes, expected.totalCentimes); assert.equal(getVehiculeParId(base.vehiculeId).id, base.vehiculeId);
  assert.doesNotMatch(fs.readFileSync(require.resolve("../js/app.js"), "utf8"), /Protection \{nom\}/);
});
