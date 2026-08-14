// tests/rate-limiter-kv.test.js
//
// lib/server/rate-limiter-kv.js est l'équivalent Cloudflare KV de
// lib/server/rate-limiter.js (Netlify Blobs) — voir plan de migration
// Cloudflare, B.3. Même test que tests/rate-limiter.test.js, mais contre
// un mock KV (tests/helpers/mock-kv.js).

const test = require("node:test");
const assert = require("node:assert/strict");

const { createRateLimiter } = require("../lib/server/rate-limiter-kv.js");
const { createMockKv } = require("./helpers/mock-kv.js");

test("createRateLimiter : refuse de continuer sans binding KV (échec bruyant)", () => {
  assert.throws(() => createRateLimiter(undefined), /Binding KV manquant/);
  assert.throws(() => createRateLimiter(null), /Binding KV manquant/);
});

test("checkRateLimit : autorise jusqu'à la limite puis bloque", async () => {
  const { checkRateLimit } = createRateLimiter(createMockKv());
  const key = `test-key-${Date.now()}-${Math.random()}`;
  const opts = { windowMs: 60000, maxRequests: 3 };

  const r1 = await checkRateLimit(key, opts);
  const r2 = await checkRateLimit(key, opts);
  const r3 = await checkRateLimit(key, opts);
  const r4 = await checkRateLimit(key, opts);

  assert.equal(r1.allowed, true);
  assert.equal(r2.allowed, true);
  assert.equal(r3.allowed, true);
  assert.equal(r4.allowed, false);
  assert.ok(r4.retryAfterSeconds > 0);
});

test("checkRateLimit : des clés différentes ont des compteurs indépendants", async () => {
  const { checkRateLimit } = createRateLimiter(createMockKv());
  const opts = { windowMs: 60000, maxRequests: 1 };

  const a1 = await checkRateLimit("clef-a", opts);
  const b1 = await checkRateLimit("clef-b", opts);
  const a2 = await checkRateLimit("clef-a", opts);

  assert.equal(a1.allowed, true);
  assert.equal(b1.allowed, true);
  assert.equal(a2.allowed, false);
});
