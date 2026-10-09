const test = require("node:test");
const assert = require("node:assert/strict");

const { makeAgencyEnv } = require("./helpers/agency-session.js");
const { handleDepositCheckout } = require("../src/api/deposit-checkout.js");

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
