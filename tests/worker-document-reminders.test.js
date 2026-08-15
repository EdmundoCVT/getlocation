const test = require("node:test");
const assert = require("node:assert/strict");
const { createFakeKv } = require("./helpers/fake-kv.js");
const { createReservation, updateReservationStatus, getReservation } = require("../src/lib/reservation-store.js");
const { shouldRemind, runDocumentReminders } = require("../src/lib/document-reminders.js");

const NOW = Date.parse("2026-08-15T09:00:00.000Z");

function env() {
  return { RESERVATIONS_KV: createFakeKv(), DOCUMENT_TOKEN_PEPPER: "reminder-pepper", RESEND_API_KEY: "test" };
}

async function paidReservation(e, extra = {}) {
  const reservation = await createReservation(e, {
    vehiculeId: "opel-corsa",
    periodeDebut: new Date(NOW + 5 * 86400000).toISOString(),
    periodeFin: new Date(NOW + 6 * 86400000).toISOString(),
    conducteur: { email: "client@example.test" }
  });
  return updateReservationStatus(e, reservation.id, "paid", {
    paidAt: new Date(NOW - 25 * 60 * 60 * 1000).toISOString(),
    documentsStatus: "pending",
    ...extra
  });
}

test("relance une première fois après 24 heures et enregistre l'envoi", async () => {
  const e = env();
  const reservation = await paidReservation(e);
  const calls = [];
  const result = await runDocumentReminders(e, NOW, async (_env, _reservation, token, number) => { calls.push({ token, number }); return true; });
  assert.deepEqual(result, { scanned: 1, sent: 1 });
  assert.equal(calls[0].number, 1);
  assert.match(calls[0].token, /^[A-Za-z0-9_-]{43}$/);
  const updated = await getReservation(e, reservation.id);
  assert.equal(updated.documentsReminder.count, 1);
  assert.equal(e.RESERVATIONS_KV._raw.has(`doc_${updated.documentAccess.tokenHash}`), true);
});

test("ne relance jamais un dossier déjà soumis", async () => {
  const e = env();
  await paidReservation(e, { documentsStatus: "submitted" });
  const result = await runDocumentReminders(e, NOW, async () => { throw new Error("ne doit pas être appelé"); });
  assert.equal(result.sent, 0);
});

test("attend 48 heures entre les relances et s'arrête après deux", async () => {
  const base = { status: "paid", documentsStatus: "pending", conducteur: { email: "client@example.test" }, periodeDebut: new Date(NOW + 86400000).toISOString(), paidAt: new Date(NOW - 10 * 86400000).toISOString() };
  assert.equal(shouldRemind({ ...base, documentsReminder: { count: 1, lastSentAt: new Date(NOW - 47 * 60 * 60 * 1000).toISOString() } }, NOW), false);
  assert.equal(shouldRemind({ ...base, documentsReminder: { count: 1, lastSentAt: new Date(NOW - 49 * 60 * 60 * 1000).toISOString() } }, NOW), true);
  assert.equal(shouldRemind({ ...base, documentsReminder: { count: 2, lastSentAt: new Date(NOW - 10 * 86400000).toISOString() } }, NOW), false);
});

test("n'enregistre pas une relance si l'e-mail échoue", async () => {
  const e = env();
  const reservation = await paidReservation(e);
  const result = await runDocumentReminders(e, NOW, async () => false);
  assert.equal(result.sent, 0);
  const updated = await getReservation(e, reservation.id);
  assert.equal(updated.documentsReminder, undefined);
});
