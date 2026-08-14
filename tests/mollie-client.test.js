// tests/mollie-client.test.js
//
// lib/server/mollie-client.js remplace le SDK @mollie/api-client par des
// appels REST directs (voir plan de migration Cloudflare, B.2) — code neuf,
// jamais exercé par un vrai réseau Mollie dans cet environnement de test
// (comme l'ancien SDK ne l'était pas non plus). Ces tests vérifient la
// construction exacte de la requête (URL, headers, body) et la gestion
// d'erreur, via un mock de fetch global — pas d'appel réseau réel.

const test = require("node:test");
const assert = require("node:assert/strict");
const { molliePaymentsCreate, molliePaymentsGet } = require("../lib/server/mollie-client.js");

function mockFetchOnce(status, jsonBody) {
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => jsonBody
    };
  };
  return calls;
}

test("molliePaymentsCreate : envoie Authorization, Content-Type et le body JSON attendu", async () => {
  const calls = mockFetchOnce(201, { id: "tr_test123", status: "open", _links: { checkout: { href: "https://mollie.test/checkout" } } });

  const body = { amount: { currency: "EUR", value: "49.00" }, description: "test" };
  const result = await molliePaymentsCreate("test_apikey", body);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.mollie.com/v2/payments");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers.Authorization, "Bearer test_apikey");
  assert.equal(calls[0].options.headers["Content-Type"], "application/json");
  assert.equal(calls[0].options.headers["Idempotency-Key"], undefined);
  assert.deepEqual(JSON.parse(calls[0].options.body), body);
  assert.equal(result.id, "tr_test123");
  assert.equal(result._links.checkout.href, "https://mollie.test/checkout");
});

test("molliePaymentsCreate : passe idempotencyKey en header Idempotency-Key (jamais dans le body)", async () => {
  const calls = mockFetchOnce(201, { id: "tr_test123" });

  await molliePaymentsCreate("test_apikey", { amount: { currency: "EUR", value: "49.00" } }, "idem-key-abc");

  assert.equal(calls[0].options.headers["Idempotency-Key"], "idem-key-abc");
  const sentBody = JSON.parse(calls[0].options.body);
  assert.equal(sentBody.idempotencyKey, undefined, "idempotencyKey ne doit jamais apparaître dans le corps JSON");
});

test("molliePaymentsCreate : rejette avec un message exploitable si Mollie répond une erreur", async () => {
  mockFetchOnce(422, { title: "Unprocessable Entity", detail: "La devise fournie n'est pas valide." });

  await assert.rejects(
    () => molliePaymentsCreate("test_apikey", { amount: { currency: "XXX", value: "1.00" } }),
    (err) => {
      assert.equal(err.status, 422);
      assert.match(err.message, /pas valide/);
      return true;
    }
  );
});

test("molliePaymentsGet : appelle le bon endpoint avec Authorization, sans body", async () => {
  const calls = mockFetchOnce(200, { id: "tr_abc", status: "paid" });

  const result = await molliePaymentsGet("test_apikey", "tr_abc");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.mollie.com/v2/payments/tr_abc");
  assert.equal(calls[0].options.headers.Authorization, "Bearer test_apikey");
  assert.equal(calls[0].options.method, undefined, "GET par défaut, pas de method explicite nécessaire");
  assert.equal(result.status, "paid");
});

test("molliePaymentsGet : encode l'id de paiement dans l'URL", async () => {
  const calls = mockFetchOnce(200, { id: "tr abc/def" });

  await molliePaymentsGet("test_apikey", "tr abc/def");

  assert.equal(calls[0].url, "https://api.mollie.com/v2/payments/tr%20abc%2Fdef");
});

test("molliePaymentsGet : rejette avec status 404 exploitable (paiement inconnu)", async () => {
  mockFetchOnce(404, { title: "Not Found", detail: "No payment exists with token tr_unknown." });

  await assert.rejects(
    () => molliePaymentsGet("test_apikey", "tr_unknown"),
    (err) => {
      assert.equal(err.status, 404);
      return true;
    }
  );
});
