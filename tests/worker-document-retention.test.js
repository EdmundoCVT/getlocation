// tests/worker-document-retention.test.js
//
// Purge RGPD des documents d'identité 30 jours après la restitution — voir
// src/lib/document-retention.js. Aucun vrai appel R2 ici : deleteDocument
// est injecté (fonction stub), comme le prévoit runDocumentRetentionPurge.

const test = require("node:test");
const assert = require("node:assert/strict");

const { createFakeKv } = require("./helpers/fake-kv.js");
const {
  createReservation,
  updateReservationStatus,
  getReservation
} = require("../src/lib/reservation-store.js");
const {
  shouldPurgeDocuments,
  purgeReservationDocuments,
  runDocumentRetentionPurge
} = require("../src/lib/document-retention.js");

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function env() {
  return { RESERVATIONS_KV: createFakeKv() };
}

async function makeSubmittedReservation(e, overrides = {}) {
  const record = await createReservation(e, {
    vehiculeId: "opel-corsa",
    dateDebut: "2026-01-01",
    heureDebut: "10:00",
    periodeFin: "2026-01-04T10:00:00.000Z",
    conducteur: { prenom: "Camille", nom: "Martin", email: "camille@example.com", naissance: "1990-01-01" },
    total: 250,
    paymentId: "tr_test_123",
    ...overrides
  });
  return updateReservationStatus(e, record.id, "paid", {
    paidAt: "2026-01-01T09:00:00.000Z",
    documentsStatus: "submitted",
    documentsSubmittedAt: "2026-01-01T09:30:00.000Z",
    documentsData: { postalAddress: "12 rue Test, Grasse", permitNumber: "AB12345", permitDate: "2015-01-01" },
    documentFiles: [
      { key: "reservations/x/permis-recto/aaa", type: "permis-recto", contentType: "image/jpeg", size: 100 },
      { key: "reservations/x/permis-verso/bbb", type: "permis-verso", contentType: "image/jpeg", size: 100 },
      { key: "reservations/x/identite/ccc", type: "identite", contentType: "image/jpeg", size: 100 }
    ],
    documentAccess: { tokenHash: "a".repeat(64), createdAt: "2026-01-01T09:00:00.000Z", expiresAt: "2026-01-05T09:00:00.000Z", revokedAt: null },
    agencyDocumentAccess: { tokenHash: "b".repeat(64), createdAt: "2026-01-01T09:30:00.000Z", expiresAt: "2026-01-08T09:30:00.000Z", revokedAt: null }
  });
}

test("shouldPurgeDocuments : refuse tant que 30 jours ne sont pas écoulés depuis periodeFin", () => {
  const returnMs = new Date("2026-01-04T10:00:00.000Z").getTime();
  const reservation = { status: "paid", documentsStatus: "submitted", periodeFin: "2026-01-04T10:00:00.000Z" };
  assert.equal(shouldPurgeDocuments(reservation, returnMs + THIRTY_DAYS_MS - 1000), false);
  assert.equal(shouldPurgeDocuments(reservation, returnMs + THIRTY_DAYS_MS), true);
});

test("shouldPurgeDocuments : refuse si pas payée, pas soumise, ou déjà purgée", () => {
  const now = new Date("2026-03-01T00:00:00.000Z").getTime();
  const base = { status: "paid", documentsStatus: "submitted", periodeFin: "2026-01-04T10:00:00.000Z" };
  assert.equal(shouldPurgeDocuments({ ...base, status: "pending_payment" }, now), false);
  assert.equal(shouldPurgeDocuments({ ...base, documentsStatus: "pending" }, now), false);
  assert.equal(shouldPurgeDocuments({ ...base, documentsPurgedAt: "2026-02-10T00:00:00.000Z" }, now), false);
  assert.equal(shouldPurgeDocuments(base, now), true);
});

test("purgeReservationDocuments : succès — supprime R2, nettoie les données documentaires, préserve les données comptables/contractuelles", async () => {
  const e = env();
  const reservation = await makeSubmittedReservation(e);
  const deleted = [];
  const ok = await purgeReservationDocuments(e, reservation, Date.now(), async (_env, key) => {
    deleted.push(key);
  });

  assert.equal(ok, true);
  assert.equal(deleted.length, 3);

  const updated = await getReservation(e, reservation.id);
  assert.deepEqual(updated.documentFiles, []);
  assert.equal(updated.documentsData, null);
  assert.equal(updated.documentAccess, null);
  assert.equal(updated.agencyDocumentAccess, null);
  assert.ok(updated.documentsPurgedAt);
  // Marqueur non sensible uniquement, jamais de token ni de nom de fichier.
  assert.equal(typeof updated.documentsPurgedAt, "string");

  // Jamais touché : statut de paiement, montant, référence de paiement,
  // identité du conducteur principal — nécessaires à la comptabilité et à
  // la preuve contractuelle.
  assert.equal(updated.status, "paid");
  assert.equal(updated.total, 250);
  assert.equal(updated.paymentId, "tr_test_123");
  assert.equal(updated.paidAt, "2026-01-01T09:00:00.000Z");
  assert.deepEqual(updated.conducteur, reservation.conducteur);
});

test("purgeReservationDocuments : échec partiel — ne marque pas la purge terminée, ne retente que les fichiers en échec", async () => {
  const e = env();
  const reservation = await makeSubmittedReservation(e);
  const attempted = [];
  const ok = await purgeReservationDocuments(e, reservation, Date.now(), async (_env, key) => {
    attempted.push(key);
    if (key.includes("permis-verso")) throw new Error("échec R2 simulé");
  });

  assert.equal(ok, false);
  assert.equal(attempted.length, 3);

  const updated = await getReservation(e, reservation.id);
  assert.equal(updated.documentFiles.length, 1);
  assert.match(updated.documentFiles[0].key, /permis-verso/);
  assert.equal(updated.documentsPurgedAt, undefined);
  // Les données non-fichiers restent en place tant que la purge n'est pas
  // complètement terminée (rien ne doit disparaître avant d'être sûr que
  // les fichiers ont bien été supprimés).
  assert.ok(updated.documentsData);
  assert.ok(updated.documentAccess);
});

test("purgeReservationDocuments : une nouvelle tentative ne retente que les fichiers déjà en échec (idempotence)", async () => {
  const e = env();
  const reservation = await makeSubmittedReservation(e);
  await purgeReservationDocuments(e, reservation, Date.now(), async (_env, key) => {
    if (key.includes("permis-verso")) throw new Error("échec R2 simulé");
  });

  const afterFirstAttempt = await getReservation(e, reservation.id);
  const attemptedSecondTime = [];
  const ok = await purgeReservationDocuments(e, afterFirstAttempt, Date.now(), async (_env, key) => {
    attemptedSecondTime.push(key);
  });

  assert.equal(ok, true);
  assert.deepEqual(attemptedSecondTime, afterFirstAttempt.documentFiles.map((f) => f.key));
  const finalRecord = await getReservation(e, reservation.id);
  assert.deepEqual(finalRecord.documentFiles, []);
  assert.ok(finalRecord.documentsPurgedAt);
});

test("purgeReservationDocuments : une réservation déjà purgée n'est plus jamais retraitée", async () => {
  const e = env();
  const reservation = await makeSubmittedReservation(e);
  await purgeReservationDocuments(e, reservation, Date.now(), async () => {});
  const purged = await getReservation(e, reservation.id);

  assert.equal(shouldPurgeDocuments(purged, Date.now() + 1000 * THIRTY_DAYS_MS), false);
});

test("runDocumentRetentionPurge : ne purge que les réservations éligibles, comptabilise correctement", async () => {
  const e = env();
  const eligible = await makeSubmittedReservation(e, { vehiculeId: "opel-corsa" });
  const notYetDue = await createReservation(e, { vehiculeId: "peugeot-3008", periodeFin: new Date(Date.now() + 1000).toISOString() });
  await updateReservationStatus(e, notYetDue.id, "paid", { documentsStatus: "submitted", documentFiles: [{ key: "k", type: "identite" }] });
  const neverSubmitted = await createReservation(e, { vehiculeId: "toyota-proace-city", periodeFin: "2020-01-01T00:00:00.000Z" });
  await updateReservationStatus(e, neverSubmitted.id, "paid", { documentsStatus: "pending" });

  const nowMs = new Date(eligible.periodeFin).getTime() + THIRTY_DAYS_MS + 1000;
  const result = await runDocumentRetentionPurge(e, nowMs, async (env2, reservation, nowMs2) =>
    purgeReservationDocuments(env2, reservation, nowMs2, async () => {})
  );

  assert.equal(result.scanned, 3);
  assert.equal(result.purged, 1);
  assert.equal(result.failed, 0);

  const updatedEligible = await getReservation(e, eligible.id);
  assert.ok(updatedEligible.documentsPurgedAt);
  const updatedOther = await getReservation(e, notYetDue.id);
  assert.equal(updatedOther.documentsPurgedAt, undefined);
});
