const test = require("node:test");
const assert = require("node:assert/strict");

const { makeAgencyEnv } = require("./helpers/agency-session.js");
const { handleDepositCheckout } = require("../src/api/deposit-checkout.js");
const { createClient } = require("../src/lib/clients.js");
const { createRental } = require("../src/lib/rentals.js");
const { createMollieAuthorizationRecord } = require("../src/lib/deposits.js");

test("lien de dépôt sans secret : ne révèle pas DEPOSIT_LINK_PEPPER", async () => {
  const response = await handleDepositCheckout(
    new Request("https://getlocation.fr/api/deposit-checkout?token=" + "a".repeat(32)),
    makeAgencyEnv()
  );
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.match(body.error, /temporairement indisponible/);
  assert.doesNotMatch(body.error, /PEPPER|secret/i);
});

test("lien de dépôt valide : expose uniquement le contexte utile et le montant figé", async () => {
  const env = makeAgencyEnv({
    DEPOSIT_LINK_PEPPER: "secret-de-test-depot",
    MOLLIE_API_KEY: "test_mollie_key"
  });
  const client = await createClient(env, { firstName: "Jean", lastName: "Dupont" }, "Edmundo");
  const rental = await createRental(env, client.id, {
    vehiculeId: "peugeot-2008-hybrid",
    immatriculation: "AA-123-AA",
    dateDebut: "2026-11-10", heureDebut: "10:00",
    dateFin: "2026-11-13", heureFin: "10:00",
    lieuPrise: "Livraison", lieuRetour: "Livraison",
    priceTotal: 300
  }, "Edmundo");
  const token = "t".repeat(43);
  await createMollieAuthorizationRecord(env, {
    rentalId: rental.id,
    amount: 650,
    operator: "Edmundo",
    customerToken: token,
    payment: { id: "tr_deposit_test", status: "open", captureBefore: "2026-11-20T10:00:00Z" }
  });

  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    assert.match(String(url), /api\.mollie\.com\/v2\/payments\/tr_deposit_test$/);
    return new Response(JSON.stringify({
      id: "tr_deposit_test",
      status: "open",
      captureBefore: "2026-11-20T10:00:00Z",
      _links: { checkout: { href: "https://www.mollie.com/checkout/test" } }
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const response = await handleDepositCheckout(
      new Request(`https://getlocation.fr/api/deposit-checkout?token=${token}`),
      env
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.amountCents, 65000, "le montant vient de la demande enregistrée, pas du catalogue courant");
    assert.equal(body.vehicle.name, "Peugeot 2008 Hybrid");
    assert.deepEqual(body.rental, { startDate: "2026-11-10", endDate: "2026-11-13" });
    assert.equal(body.mode, "preauthorization");
    assert.equal(body.checkoutUrl, "https://www.mollie.com/checkout/test");
    assert.equal(body.client, undefined, "aucune donnée personnelle n'est exposée par ce lien public");
  } finally {
    global.fetch = originalFetch;
  }
});
