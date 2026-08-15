// tests/worker-rate-limiter.test.js
//
// Équivalent de tests/rate-limiter.test.js pour src/lib/rate-limiter.js
// (Cloudflare KV, Phase B — voir DEPLOIEMENT.md).

const test = require("node:test");
const assert = require("node:assert/strict");

const { createFakeKv } = require("./helpers/fake-kv.js");
const { checkRateLimit } = require("../src/lib/rate-limiter.js");

function makeEnv() {
  return { RATE_LIMITS_KV: createFakeKv() };
}

test("checkRateLimit : autorise jusqu'à la limite puis bloque", async () => {
  const env = makeEnv();
  const key = `test-key-${Date.now()}-${Math.random()}`;
  const opts = { windowMs: 60000, maxRequests: 3 };

  const r1 = await checkRateLimit(env, key, opts);
  const r2 = await checkRateLimit(env, key, opts);
  const r3 = await checkRateLimit(env, key, opts);
  const r4 = await checkRateLimit(env, key, opts);

  assert.equal(r1.allowed, true);
  assert.equal(r2.allowed, true);
  assert.equal(r3.allowed, true);
  assert.equal(r4.allowed, false);
  assert.ok(r4.retryAfterSeconds > 0);
});

test("checkRateLimit : des clés différentes ont des compteurs indépendants", async () => {
  const env = makeEnv();
  const opts = { windowMs: 60000, maxRequests: 1 };
  const keyA = `test-a-${Date.now()}-${Math.random()}`;
  const keyB = `test-b-${Date.now()}-${Math.random()}`;

  const a1 = await checkRateLimit(env, keyA, opts);
  const b1 = await checkRateLimit(env, keyB, opts);

  assert.equal(a1.allowed, true);
  assert.equal(b1.allowed, true);
});

test("checkRateLimit : n'échoue jamais sur la contrainte KV expirationTtl >= 60s, même pour une fenêtre courte", async () => {
  const env = makeEnv();
  // windowMs très court (1s) : ttlSeconds calculé doit quand même rester
  // >= 60 (voir MIN_KV_TTL_SECONDS dans rate-limiter.js), sans quoi la
  // fausse KV (qui reproduit la contrainte réelle) lèverait une exception.
  await assert.doesNotReject(checkRateLimit(env, `short-window-${Date.now()}`, { windowMs: 1000, maxRequests: 5 }));
});
