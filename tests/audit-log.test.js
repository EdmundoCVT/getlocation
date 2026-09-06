// tests/audit-log.test.js
//
// src/lib/audit-log.js — journal d'audit minimal, jamais de donnée
// personnelle au-delà de ce qui est passé explicitement, ne lève jamais si
// AGENCY_DB est absent (best effort, comme les autres journaux du site).

const test = require("node:test");
const assert = require("node:assert/strict");

const { createFakeD1 } = require("./helpers/fake-d1.js");
const { recordAuditEvent } = require("../src/lib/audit-log.js");

test("recordAuditEvent : enregistre l'acteur, l'événement, l'entité et les métadonnées", async () => {
  const env = { AGENCY_DB: createFakeD1() };
  await recordAuditEvent(env, {
    actor: "Edmundo",
    eventType: "payment_recorded",
    entityType: "payment",
    entityId: "pay_123",
    metadata: { amountCents: 5000 }
  });
  const rows = env.AGENCY_DB._raw.auditLog;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].actor, "Edmundo");
  assert.equal(rows[0].event_type, "payment_recorded");
  assert.equal(rows[0].entity_type, "payment");
  assert.equal(rows[0].entity_id, "pay_123");
  assert.deepEqual(JSON.parse(rows[0].metadata), { amountCents: 5000 });
  assert.ok(rows[0].created_at);
});

test("recordAuditEvent : actor null accepté (ex. échec de connexion, identité jamais révélée)", async () => {
  const env = { AGENCY_DB: createFakeD1() };
  await recordAuditEvent(env, { actor: null, eventType: "login_failed" });
  assert.equal(env.AGENCY_DB._raw.auditLog[0].actor, null);
  assert.equal(env.AGENCY_DB._raw.auditLog[0].metadata, null);
});

test("recordAuditEvent : ne lève jamais sans AGENCY_DB (best effort)", async () => {
  await assert.doesNotReject(recordAuditEvent({}, { eventType: "client_created" }));
});

test("recordAuditEvent : ne fait rien sans eventType", async () => {
  const env = { AGENCY_DB: createFakeD1() };
  await recordAuditEvent(env, { actor: "Edmundo" });
  assert.equal(env.AGENCY_DB._raw.auditLog.length, 0);
});
