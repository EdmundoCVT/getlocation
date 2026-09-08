// tests/sheet-sync-outbox.test.js
//
// src/lib/sheet-sync-outbox.js — au plus une entrée "pending" par location,
// résultat journalisé (audit_log + outbox), une panne Google n'empêche
// jamais le traitement des autres locations lors d'une relance groupée.

const test = require("node:test");
const assert = require("node:assert/strict");

const { createFakeD1 } = require("./helpers/fake-d1.js");
const { makeServiceAccountFixture } = require("./helpers/google-service-account-fixture.js");
const { createFakeGoogleSheets, withFakeGoogleSheets } = require("./helpers/google-sheets-fake.js");
const { createClient } = require("../src/lib/clients.js");
const { createRental } = require("../src/lib/rentals.js");
const { EXPECTED_HEADERS } = require("../src/lib/sheet-sync.js");
const { enqueueSync, attemptSync, retryPendingSheetSyncs } = require("../src/lib/sheet-sync-outbox.js");

function makeEnv() {
  const { keyJson } = makeServiceAccountFixture();
  return {
    AGENCY_DB: createFakeD1(),
    GOOGLE_SERVICE_ACCOUNT_KEY: keyJson,
    GOOGLE_SHEETS_SPREADSHEET_ID: "test-spreadsheet-id"
  };
}

async function creerLocation(env) {
  const client = await createClient(env, { firstName: "Jean", lastName: "Dupont" }, "Edmundo");
  return createRental(env, client.id, { vehiculeId: "opel-corsa", dateDebut: "2026-09-10", heureDebut: "10:00", dateFin: "2026-09-12", heureFin: "10:00" }, "Edmundo");
}

test("enqueueSync : crée une entrée pending, réutilise la même pour des appels rapprochés", async () => {
  const env = makeEnv();
  const id1 = await enqueueSync(env, "rnt_x");
  const id2 = await enqueueSync(env, "rnt_x");
  assert.equal(id1, id2, "pas de doublon d'entrée pending pour la même location");
  assert.equal(env.AGENCY_DB._raw.sheet_sync_outbox.size, 1);
});

test("attemptSync : succès -> status=synced, audit_log sheet_sync_succeeded", async () => {
  const env = makeEnv();
  const rental = await creerLocation(env);
  const fake = createFakeGoogleSheets({ headers: EXPECTED_HEADERS });

  const result = await withFakeGoogleSheets(fake, () => attemptSync(env, rental.id, "Edmundo"));
  assert.equal(result.ok, true);

  const outboxRow = [...env.AGENCY_DB._raw.sheet_sync_outbox.values()][0];
  assert.equal(outboxRow.status, "synced");
  assert.equal(outboxRow.attempt_count, 1);
  assert.ok(outboxRow.synced_at);

  const events = env.AGENCY_DB._raw.auditLog.map((e) => e.event_type);
  assert.ok(events.includes("sheet_sync_succeeded"));
});

test("attemptSync : échec -> status=error, last_error rempli, audit_log sheet_sync_failed, jamais d'exception", async () => {
  const env = makeEnv();
  const rental = await creerLocation(env);

  const result = await (async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: "Feuille introuvable" } }), { status: 404 });
    try {
      return await attemptSync(env, rental.id, "Edmundo");
    } finally {
      globalThis.fetch = original;
    }
  })();

  assert.equal(result.ok, false);
  const outboxRow = [...env.AGENCY_DB._raw.sheet_sync_outbox.values()][0];
  assert.equal(outboxRow.status, "error");
  assert.ok(outboxRow.last_error);

  const events = env.AGENCY_DB._raw.auditLog.map((e) => e.event_type);
  assert.ok(events.includes("sheet_sync_failed"));
});

test("retryPendingSheetSyncs : reprend les entrées pending ET error, une panne n'empêche pas les suivantes", async () => {
  const env = makeEnv();
  const rentalOk = await creerLocation(env);
  const rentalKo = await creerLocation(env);
  await enqueueSync(env, rentalOk.id);
  await enqueueSync(env, rentalKo.id);
  // Force la seconde entrée en "error" pour vérifier qu'elle est bien reprise aussi.
  const rows = [...env.AGENCY_DB._raw.sheet_sync_outbox.values()];
  rows.find((r) => r.rental_id === rentalKo.id).status = "error";

  const fake = createFakeGoogleSheets({ headers: EXPECTED_HEADERS });
  let call = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("oauth2.googleapis.com")) return fake.fakeFetch(url, init);
    call += 1;
    if (call === 2) throw new Error("panne réseau simulée");
    return fake.fakeFetch(url, init);
  };
  try {
    await retryPendingSheetSyncs(env);
  } finally {
    globalThis.fetch = original;
  }

  const statuses = [...env.AGENCY_DB._raw.sheet_sync_outbox.values()].map((r) => r.status).sort();
  assert.deepEqual(statuses, ["error", "synced"], "l'une réussit, l'autre échoue, mais les deux ont été traitées");
});

test("attemptSync : sans AGENCY_DB, renvoie un échec propre sans lever", async () => {
  await assert.doesNotReject(attemptSync({}, "rnt_x", null));
});
