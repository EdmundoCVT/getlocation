// tests/worker-reservation-store.test.js
//
// Équivalent de tests/reservation-store.test.js pour src/lib/reservation-store.js
// (Cloudflare KV, Phase B — voir DEPLOIEMENT.md). Utilise une fausse
// implémentation KV en mémoire (tests/helpers/fake-kv.js) au lieu du repli
// mémoire caché de l'ancienne version Netlify Blobs.

const test = require("node:test");
const assert = require("node:assert/strict");

const { createFakeKv } = require("./helpers/fake-kv.js");
const {
  createReservation,
  getReservation,
  updateReservationStatus,
  findReservationByPaymentId,
  hasOverlappingReservation,
  generateReservationId,
  reservationTtlSeconds,
  PAID_RETENTION_AFTER_RETURN_MS
} = require("../src/lib/reservation-store.js");

function makeEnv() {
  return { RESERVATIONS_KV: createFakeKv() };
}

test("generateReservationId : format non devinable", () => {
  const id = generateReservationId();
  assert.match(id, /^res_[a-f0-9]{32}$/);
  const id2 = generateReservationId();
  assert.notEqual(id, id2);
});

test("index documentaire : retrouve la réservation par empreinte sans stocker le jeton brut", async () => {
  const env = makeEnv();
  const record = await createReservation(env, { vehiculeId: "opel-corsa" });
  const hash = "a".repeat(64);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const { saveDocumentAccessIndex, findReservationByDocumentTokenHash } = require("../src/lib/reservation-store.js");
  assert.equal(await saveDocumentAccessIndex(env, record.id, hash, expiresAt), true);
  assert.equal((await findReservationByDocumentTokenHash(env, hash)).id, record.id);
  assert.equal(await env.RESERVATIONS_KV.get(`doc_${hash}`), record.id);
  assert.equal(await findReservationByDocumentTokenHash(env, "invalide"), null);
});

test("createReservation : statut initial pending_payment, id non écrasable", async () => {
  const env = makeEnv();
  const record = await createReservation(env, {
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
  const env = makeEnv();
  assert.equal(await getReservation(env, "res_inexistant"), null);
  assert.equal(await getReservation(env, ""), null);
  assert.equal(await getReservation(env, undefined), null);
});

test("updateReservationStatus : transition + fusion de champs, createdAt/id protégés", async () => {
  const env = makeEnv();
  const record = await createReservation(env, { vehiculeId: "opel-corsa" });
  const updated = await updateReservationStatus(env, record.id, "paid", {
    paymentId: "tr_test_123",
    id: "autre-id",
    createdAt: "falsifie"
  });
  assert.equal(updated.status, "paid");
  assert.equal(updated.id, record.id);
  assert.equal(updated.createdAt, record.createdAt);
  assert.equal(updated.paymentId, "tr_test_123");

  const reread = await getReservation(env, record.id);
  assert.equal(reread.status, "paid");
});

test("updateReservationStatus : réservation inexistante renvoie null (pas de crash)", async () => {
  const env = makeEnv();
  const result = await updateReservationStatus(env, "res_inexistant", "paid", {});
  assert.equal(result, null);
});

test("findReservationByPaymentId : retrouve la bonne réservation", async () => {
  const env = makeEnv();
  const record = await createReservation(env, { vehiculeId: "toyota-proace-city" });
  await updateReservationStatus(env, record.id, "pending_payment", { paymentId: "tr_unique_456" });
  const found = await findReservationByPaymentId(env, "tr_unique_456");
  assert.ok(found);
  assert.equal(found.id, record.id);

  assert.equal(await findReservationByPaymentId(env, "tr_absent"), null);
  assert.equal(await findReservationByPaymentId(env, ""), null);
});

test("hasOverlappingReservation : détecte un chevauchement sur le même véhicule", async () => {
  const env = makeEnv();
  const vehiculeId = `veh-overlap-${generateReservationId()}`;
  const record = await createReservation(env, {
    vehiculeId,
    periodeDebut: "2026-09-01T10:00:00.000Z",
    periodeFin: "2026-09-04T10:00:00.000Z"
  });

  assert.equal(
    await hasOverlappingReservation(env, vehiculeId, "2026-09-03T10:00:00.000Z", "2026-09-05T10:00:00.000Z"),
    true
  );
  assert.equal(
    await hasOverlappingReservation(env, vehiculeId, "2026-09-02T00:00:00.000Z", "2026-09-03T00:00:00.000Z"),
    true
  );
  assert.equal(
    await hasOverlappingReservation(env, vehiculeId, "2026-09-04T10:00:00.000Z", "2026-09-06T10:00:00.000Z"),
    false
  );
  assert.equal(
    await hasOverlappingReservation(env, vehiculeId, "2026-09-01T10:00:00.000Z", "2026-09-04T10:00:00.000Z", record.id),
    false
  );
});

test("hasOverlappingReservation : une réservation annulée ne bloque pas", async () => {
  const env = makeEnv();
  const vehiculeId = `veh-cancel-${generateReservationId()}`;
  const record = await createReservation(env, {
    vehiculeId,
    periodeDebut: "2026-10-01T10:00:00.000Z",
    periodeFin: "2026-10-04T10:00:00.000Z"
  });
  await updateReservationStatus(env, record.id, "cancelled");

  assert.equal(
    await hasOverlappingReservation(env, vehiculeId, "2026-10-02T10:00:00.000Z", "2026-10-03T10:00:00.000Z"),
    false
  );
});

test("hasOverlappingReservation : période invalide refusée par prudence", async () => {
  const env = makeEnv();
  const vehiculeId = `veh-invalide-${generateReservationId()}`;
  assert.equal(await hasOverlappingReservation(env, vehiculeId, "pas-une-date", "2026-10-03T10:00:00.000Z"), true);
  assert.equal(
    await hasOverlappingReservation(env, vehiculeId, "2026-10-03T10:00:00.000Z", "2026-10-01T10:00:00.000Z"),
    true
  );
});

test("deux réservations créées séparément restent isolées", async () => {
  const env = makeEnv();
  const a = await createReservation(env, { vehiculeId: "opel-corsa" });
  const b = await createReservation(env, { vehiculeId: "peugeot-3008" });
  assert.notEqual(a.id, b.id);
  const rereadA = await getReservation(env, a.id);
  const rereadB = await getReservation(env, b.id);
  assert.equal(rereadA.vehiculeId, "opel-corsa");
  assert.equal(rereadB.vehiculeId, "peugeot-3008");
});

test("expirationTtl respecte la contrainte minimale de Cloudflare KV (>= 60s)", async () => {
  const env = makeEnv();
  // Vérifie indirectement que reservation-store.js ne demande jamais un TTL
  // trop court (la fausse KV lève une exception dans ce cas, voir
  // tests/helpers/fake-kv.js) — createReservation/updateReservationStatus ne
  // doivent donc jamais rejeter pour cette raison.
  const record = await createReservation(env, { vehiculeId: "opel-corsa" });
  await assert.doesNotReject(updateReservationStatus(env, record.id, "paid", { paymentId: "tr_ttl_check" }));
});

test("une réservation payée future reste en KV jusqu'après son retour", () => {
  const inNinetyDays = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
  const ttl = reservationTtlSeconds({ status: "paid", periodeFin: inNinetyDays });
  assert.ok(ttl > 90 * 24 * 60 * 60);
  assert.equal(reservationTtlSeconds({ status: "pending_payment", periodeFin: inNinetyDays }), 7 * 24 * 60 * 60);
});

test("reservationTtlSeconds : marge technique au-delà des 30 jours de purge documentaire, pour que la purge puisse s'exécuter (et réessayer) avant que la fiche ne disparaisse de KV", () => {
  // Retour très récent : la fenêtre de rétention (30 jours) domine
  // largement le TTL plancher de 7 jours, on peut donc mesurer précisément
  // la marge technique ajoutée par-dessus.
  const justReturned = new Date(Date.now() - 1000).toISOString();
  const ttlMs = reservationTtlSeconds({ status: "paid", periodeFin: justReturned }) * 1000;
  // La purge se déclenche exactement à J+30 (PAID_RETENTION_AFTER_RETURN_MS) ;
  // le TTL KV doit dépasser ce seuil d'une marge technique positive, pour
  // que la purge (et ses éventuelles nouvelles tentatives) puisse
  // s'exécuter avant que l'enregistrement ne disparaisse.
  assert.ok(ttlMs > PAID_RETENTION_AFTER_RETURN_MS, "le TTL KV doit dépasser la fenêtre de purge de 30 jours");
  assert.ok(ttlMs - PAID_RETENTION_AFTER_RETURN_MS >= 1 * 24 * 60 * 60 * 1000, "au moins un jour de marge technique");
});
