// tests/reservation-store.test.js
//
// Ces tests s'exécutent sans Netlify Blobs disponible (environnement de
// test classique) : ils valident donc aussi le repli mémoire documenté dans
// lib/reservation-store.js. En production, le même module bascule
// automatiquement sur Netlify Blobs sans changement de code.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createReservation,
  getReservation,
  updateReservationStatus,
  findReservationByPaymentIntent,
  hasOverlappingReservation,
  generateReservationId
} = require("../netlify/functions/lib/reservation-store.js");

test("generateReservationId : format non devinable", () => {
  const id = generateReservationId();
  assert.match(id, /^res_[a-f0-9]{32}$/);
  const id2 = generateReservationId();
  assert.notEqual(id, id2);
});

test("createReservation : statut initial pending_payment, id non écrasable", async () => {
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
  assert.equal(await getReservation("res_inexistant"), null);
  assert.equal(await getReservation(""), null);
  assert.equal(await getReservation(undefined), null);
});

test("updateReservationStatus : transition + fusion de champs, createdAt/id protégés", async () => {
  const record = await createReservation({ vehiculeId: "opel-corsa" });
  const updated = await updateReservationStatus(record.id, "paid", {
    paymentIntentId: "pi_test_123",
    id: "autre-id",
    createdAt: "falsifie"
  });
  assert.equal(updated.status, "paid");
  assert.equal(updated.id, record.id);
  assert.equal(updated.createdAt, record.createdAt);
  assert.equal(updated.paymentIntentId, "pi_test_123");

  const reread = await getReservation(record.id);
  assert.equal(reread.status, "paid");
});

test("updateReservationStatus : réservation inexistante renvoie null (pas de crash)", async () => {
  const result = await updateReservationStatus("res_inexistant", "paid", {});
  assert.equal(result, null);
});

test("findReservationByPaymentIntent : retrouve la bonne réservation", async () => {
  const record = await createReservation({ vehiculeId: "toyota-proace-city" });
  await updateReservationStatus(record.id, "pending_payment", {
    paymentIntentId: "pi_unique_456"
  });
  const found = await findReservationByPaymentIntent("pi_unique_456");
  assert.ok(found);
  assert.equal(found.id, record.id);

  assert.equal(await findReservationByPaymentIntent("pi_absent"), null);
  assert.equal(await findReservationByPaymentIntent(""), null);
});

test("hasOverlappingReservation : détecte un chevauchement sur le même véhicule", async () => {
  const vehiculeId = `veh-overlap-${generateReservationId()}`;
  const record = await createReservation({
    vehiculeId,
    periodeDebut: "2026-09-01T10:00:00.000Z",
    periodeFin: "2026-09-04T10:00:00.000Z"
  });

  // Chevauchement partiel
  assert.equal(
    await hasOverlappingReservation(vehiculeId, "2026-09-03T10:00:00.000Z", "2026-09-05T10:00:00.000Z"),
    true
  );
  // Contenu totalement inclus
  assert.equal(
    await hasOverlappingReservation(vehiculeId, "2026-09-02T00:00:00.000Z", "2026-09-03T00:00:00.000Z"),
    true
  );
  // Pas de chevauchement (après)
  assert.equal(
    await hasOverlappingReservation(vehiculeId, "2026-09-04T10:00:00.000Z", "2026-09-06T10:00:00.000Z"),
    false
  );
  // Exclusion explicite de la réservation elle-même
  assert.equal(
    await hasOverlappingReservation(vehiculeId, "2026-09-01T10:00:00.000Z", "2026-09-04T10:00:00.000Z", record.id),
    false
  );
});

test("hasOverlappingReservation : une réservation annulée ne bloque pas", async () => {
  const vehiculeId = `veh-cancel-${generateReservationId()}`;
  const record = await createReservation({
    vehiculeId,
    periodeDebut: "2026-10-01T10:00:00.000Z",
    periodeFin: "2026-10-04T10:00:00.000Z"
  });
  await updateReservationStatus(record.id, "cancelled");

  assert.equal(
    await hasOverlappingReservation(vehiculeId, "2026-10-02T10:00:00.000Z", "2026-10-03T10:00:00.000Z"),
    false
  );
});

test("hasOverlappingReservation : période invalide refusée par prudence", async () => {
  const vehiculeId = `veh-invalide-${generateReservationId()}`;
  assert.equal(await hasOverlappingReservation(vehiculeId, "pas-une-date", "2026-10-03T10:00:00.000Z"), true);
  assert.equal(
    await hasOverlappingReservation(vehiculeId, "2026-10-03T10:00:00.000Z", "2026-10-01T10:00:00.000Z"),
    true
  );
});

test("deux réservations créées séparément restent isolées", async () => {
  const a = await createReservation({ vehiculeId: "opel-corsa" });
  const b = await createReservation({ vehiculeId: "peugeot-3008" });
  assert.notEqual(a.id, b.id);
  const rereadA = await getReservation(a.id);
  const rereadB = await getReservation(b.id);
  assert.equal(rereadA.vehiculeId, "opel-corsa");
  assert.equal(rereadB.vehiculeId, "peugeot-3008");
});
