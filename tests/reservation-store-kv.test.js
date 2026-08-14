// tests/reservation-store-kv.test.js
//
// lib/server/reservation-store-kv.js est l'équivalent Cloudflare KV de
// lib/server/reservation-store.js (Netlify Blobs) — voir plan de migration
// Cloudflare, B.3. Mêmes cas de test que tests/reservation-store.test.js
// (même interface publique), mais contre un mock KV (tests/helpers/mock-kv.js)
// plutôt qu'un vrai namespace Cloudflare KV.

const test = require("node:test");
const assert = require("node:assert/strict");

const { createReservationStore } = require("../lib/server/reservation-store-kv.js");
const { createMockKv } = require("./helpers/mock-kv.js");

test("createReservationStore : refuse de continuer sans binding KV (échec bruyant)", () => {
  assert.throws(() => createReservationStore(undefined), /Binding KV manquant/);
  assert.throws(() => createReservationStore(null), /Binding KV manquant/);
});

test("generateReservationId : format non devinable", () => {
  const { generateReservationId } = createReservationStore(createMockKv());
  const id = generateReservationId();
  assert.match(id, /^res_[a-f0-9]{32}$/);
  const id2 = generateReservationId();
  assert.notEqual(id, id2);
});

test("createReservation : statut initial pending_payment, id non écrasable", async () => {
  const { createReservation } = createReservationStore(createMockKv());
  const record = await createReservation({
    vehiculeId: "peugeot-3008",
    dateDebut: "2026-08-01",
    id: "tentative-injection",
    status: "paid"
  });
  assert.equal(record.status, "pending_payment");
  assert.notEqual(record.id, "tentative-injection");
  assert.match(record.id, /^res_[a-f0-9]{32}$/);
  assert.ok(record.createdAt);
  assert.ok(record.expiresAt);
});

test("getReservation : introuvable renvoie null, id invalide renvoie null", async () => {
  const { getReservation } = createReservationStore(createMockKv());
  assert.equal(await getReservation("res_inexistant"), null);
  assert.equal(await getReservation(""), null);
  assert.equal(await getReservation(undefined), null);
});

test("updateReservationStatus : transition + fusion de champs, createdAt/id protégés", async () => {
  const { createReservation, updateReservationStatus, getReservation } = createReservationStore(createMockKv());
  const record = await createReservation({ vehiculeId: "opel-corsa" });
  const updated = await updateReservationStatus(record.id, "paid", {
    paymentId: "tr_test_123",
    id: "autre-id",
    createdAt: "falsifie"
  });
  assert.equal(updated.status, "paid");
  assert.equal(updated.id, record.id);
  assert.equal(updated.createdAt, record.createdAt);
  assert.equal(updated.paymentId, "tr_test_123");

  const reread = await getReservation(record.id);
  assert.equal(reread.status, "paid");
});

test("updateReservationStatus : réservation inexistante renvoie null (pas de crash)", async () => {
  const { updateReservationStatus } = createReservationStore(createMockKv());
  const result = await updateReservationStatus("res_inexistant", "paid", {});
  assert.equal(result, null);
});

test("findReservationByPaymentId : retrouve la bonne réservation", async () => {
  const { createReservation, updateReservationStatus, findReservationByPaymentId } = createReservationStore(createMockKv());
  const record = await createReservation({ vehiculeId: "toyota-proace-city" });
  await updateReservationStatus(record.id, "pending_payment", {
    paymentId: "tr_unique_456"
  });
  const found = await findReservationByPaymentId("tr_unique_456");
  assert.ok(found);
  assert.equal(found.id, record.id);

  assert.equal(await findReservationByPaymentId("tr_absent"), null);
  assert.equal(await findReservationByPaymentId(""), null);
});

test("hasOverlappingReservation : détecte un chevauchement sur le même véhicule", async () => {
  const store = createReservationStore(createMockKv());
  const vehiculeId = `veh-overlap-${store.generateReservationId()}`;
  const record = await store.createReservation({
    vehiculeId,
    periodeDebut: "2026-09-01T10:00:00.000Z",
    periodeFin: "2026-09-04T10:00:00.000Z"
  });

  assert.equal(
    await store.hasOverlappingReservation(vehiculeId, "2026-09-03T10:00:00.000Z", "2026-09-05T10:00:00.000Z"),
    true
  );
  assert.equal(
    await store.hasOverlappingReservation(vehiculeId, "2026-09-02T00:00:00.000Z", "2026-09-03T00:00:00.000Z"),
    true
  );
  assert.equal(
    await store.hasOverlappingReservation(vehiculeId, "2026-09-04T10:00:00.000Z", "2026-09-06T10:00:00.000Z"),
    false
  );
  assert.equal(
    await store.hasOverlappingReservation(vehiculeId, "2026-09-01T10:00:00.000Z", "2026-09-04T10:00:00.000Z", record.id),
    false
  );
});

test("hasOverlappingReservation : une réservation annulée ne bloque pas", async () => {
  const store = createReservationStore(createMockKv());
  const vehiculeId = `veh-cancel-${store.generateReservationId()}`;
  const record = await store.createReservation({
    vehiculeId,
    periodeDebut: "2026-10-01T10:00:00.000Z",
    periodeFin: "2026-10-04T10:00:00.000Z"
  });
  await store.updateReservationStatus(record.id, "cancelled");

  assert.equal(
    await store.hasOverlappingReservation(vehiculeId, "2026-10-02T10:00:00.000Z", "2026-10-03T10:00:00.000Z"),
    false
  );
});

test("hasOverlappingReservation : période invalide refusée par prudence", async () => {
  const store = createReservationStore(createMockKv());
  const vehiculeId = `veh-invalide-${store.generateReservationId()}`;
  assert.equal(await store.hasOverlappingReservation(vehiculeId, "pas-une-date", "2026-10-03T10:00:00.000Z"), true);
  assert.equal(
    await store.hasOverlappingReservation(vehiculeId, "2026-10-03T10:00:00.000Z", "2026-10-01T10:00:00.000Z"),
    true
  );
});

test("deux réservations créées séparément restent isolées", async () => {
  const { createReservation, getReservation } = createReservationStore(createMockKv());
  const a = await createReservation({ vehiculeId: "opel-corsa" });
  const b = await createReservation({ vehiculeId: "peugeot-3008" });
  assert.notEqual(a.id, b.id);
  const rereadA = await getReservation(a.id);
  const rereadB = await getReservation(b.id);
  assert.equal(rereadA.vehiculeId, "opel-corsa");
  assert.equal(rereadB.vehiculeId, "peugeot-3008");
});
