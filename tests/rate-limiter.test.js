// tests/rate-limiter.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { checkRateLimit } = require("../netlify/functions/lib/rate-limiter.js");

test("checkRateLimit : autorise jusqu'à la limite puis bloque", async () => {
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
  const opts = { windowMs: 60000, maxRequests: 1 };
  const keyA = `test-a-${Date.now()}-${Math.random()}`;
  const keyB = `test-b-${Date.now()}-${Math.random()}`;

  const a1 = await checkRateLimit(keyA, opts);
  const b1 = await checkRateLimit(keyB, opts);

  assert.equal(a1.allowed, true);
  assert.equal(b1.allowed, true);
});
