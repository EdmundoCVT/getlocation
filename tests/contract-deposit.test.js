const test = require("node:test");
const assert = require("node:assert/strict");
const { getVehiculeParId } = require("../js/data.js");
const { storedContractDeposit, resolveContractDeposit } = require("../src/lib/contract-deposit.js");

test("Peugeot 2008 : le catalogue est la source du nouveau dépôt à 750 €", () => {
  const vehicle = getVehiculeParId("peugeot-2008-hybrid");
  assert.equal(vehicle.caution, 750);
  assert.equal(resolveContractDeposit({ vehiculeId: vehicle.id }, vehicle), 750);
});

test("un montant contractuel historique reste figé malgré le catalogue", () => {
  const vehicle = getVehiculeParId("peugeot-2008-hybrid");
  assert.equal(resolveContractDeposit({ vehiculeId: vehicle.id, depotGarantie: 650 }, vehicle), 650);
  assert.equal(resolveContractDeposit({ vehiculeId: vehicle.id, cautionContractuelle: 650 }, vehicle), 650);
  assert.equal(storedContractDeposit({ cautionContractuelle: 0, depotGarantie: 650 }), 0, "zéro est une valeur explicite, pas un fallback");
  assert.equal(resolveContractDeposit({ vehiculeId: "vehicule-inconnu" }), null);
});
