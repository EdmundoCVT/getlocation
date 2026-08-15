// tests/validate-promo.test.js
//
// src/api/validate-promo.js — permet au client de confirmer le code de test
// interne (TEST_DISCOUNT_CODE) dès sa saisie, sans attendre la page Mollie
// (voir js/app.js, verifierCodeDeTest). Les codes publics (CODES_PROMO,
// js/data.js) ne passent jamais par ce endpoint : déjà validés côté client.

const test = require("node:test");
const assert = require("node:assert/strict");

const { createFakeKv } = require("./helpers/fake-kv.js");
const { handleValidatePromo } = require("../src/api/validate-promo.js");

function makeEnv(overrides = {}) {
  return { RATE_LIMITS_KV: createFakeKv(), TEST_DISCOUNT_CODE: "SECRET-INTERNE-1234", ...overrides };
}

let ipCounter = 0;
function makeRequest(body, { method = "POST", headers = {} } = {}) {
  ipCounter += 1;
  const init = { method, headers: { origin: "https://getlocation.fr", "cf-connecting-ip": `198.51.100.${100 + ipCounter}`, ...headers } };
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    init.body = JSON.stringify(body);
  }
  return new Request("https://getlocation.fr/api/validate-promo", init);
}

test("rejette les méthodes autres que POST/OPTIONS", async () => {
  const res = await handleValidatePromo(makeRequest(null, { method: "GET" }), makeEnv());
  assert.equal(res.status, 405);
});

test("répond valid:false pour un code qui ne correspond pas", async () => {
  const res = await handleValidatePromo(makeRequest({ code: "AUTRE-CODE" }), makeEnv());
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.deepEqual(json, { valid: false });
});

test("répond valid:true (+ montant réduit) pour le bon code", async () => {
  const res = await handleValidatePromo(makeRequest({ code: "secret-interne-1234" }), makeEnv());
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.deepEqual(json, { valid: true, totalFacture: 0.1 });
});

test("répond valid:false si TEST_DISCOUNT_CODE n'est pas configuré", async () => {
  const res = await handleValidatePromo(makeRequest({ code: "PEU-IMPORTE" }), makeEnv({ TEST_DISCOUNT_CODE: undefined }));
  const json = await res.json();
  assert.deepEqual(json, { valid: false });
});

test("ne révèle jamais la valeur du secret, même dans une erreur", async () => {
  const res = await handleValidatePromo(makeRequest({ code: "AUTRE" }), makeEnv());
  const text = await res.text();
  assert.equal(text.includes("SECRET-INTERNE-1234"), false);
});

test("corps de requête invalide (JSON malformé) : 400", async () => {
  const env = makeEnv();
  ipCounter += 1;
  const req = new Request("https://getlocation.fr/api/validate-promo", {
    method: "POST",
    headers: { origin: "https://getlocation.fr", "cf-connecting-ip": `198.51.100.${100 + ipCounter}` },
    body: "{ceci n'est pas du json"
  });
  const res = await handleValidatePromo(req, env);
  assert.equal(res.status, 400);
});

test("rate limiting : au-delà de la limite, 429", async () => {
  const env = makeEnv();
  const ip = "203.0.113.77";
  let last;
  for (let i = 0; i < 11; i++) {
    last = await handleValidatePromo(
      new Request("https://getlocation.fr/api/validate-promo", {
        method: "POST",
        headers: { origin: "https://getlocation.fr", "cf-connecting-ip": ip },
        body: JSON.stringify({ code: "peu-importe" })
      }),
      env
    );
  }
  assert.equal(last.status, 429);
});

test("en-tête Cache-Control: no-store présent (réponse jamais mise en cache)", async () => {
  const res = await handleValidatePromo(makeRequest({ code: "X" }), makeEnv());
  assert.equal(res.headers.get("Cache-Control"), "no-store");
});
