const test = require("node:test");
const assert = require("node:assert/strict");
const { createFakeKv } = require("./helpers/fake-kv.js");
const { createReservation, updateReservationStatus, getReservation } = require("../src/lib/reservation-store.js");
const { shouldSendPickupReminder, runPickupReminders } = require("../src/lib/pickup-reminders.js");
const { buildPickupReminderEmailContent } = require("../src/lib/send-pickup-reminder-email.js");

const NOW = Date.parse("2026-08-15T09:00:00.000Z");

async function paidReservation(env, startMs, extra = {}) {
  const start = new Date(startMs);
  const reservation = await createReservation(env, {
    vehiculeId: "opel-corsa",
    periodeDebut: start.toISOString(),
    periodeFin: new Date(startMs + 86400000).toISOString(),
    dateDebut: start.toISOString().slice(0, 10),
    heureDebut: "10:00",
    lieuPrise: "Agence Grasse",
    conducteur: { email: "client@example.test" }
  });
  return updateReservationStatus(env, reservation.id, "paid", extra);
}

test("envoie un seul rappel entre 24 et 48 heures avant la prise en charge", async () => {
  const env = { RESERVATIONS_KV: createFakeKv() };
  const reservation = await paidReservation(env, NOW + 30 * 60 * 60 * 1000);
  const calls = [];
  const result = await runPickupReminders(env, NOW, async (_env, record) => { calls.push(record.id); return true; });
  assert.deepEqual(result, { scanned: 1, sent: 1 });
  assert.deepEqual(calls, [reservation.id]);
  const updated = await getReservation(env, reservation.id);
  assert.equal(updated.pickupReminderSentAt, new Date(NOW).toISOString());
  assert.equal(shouldSendPickupReminder(updated, NOW), false);
});

test("ignore les réservations trop éloignées, déjà commencées ou non payées", () => {
  const base = { status: "paid", conducteur: { email: "client@example.test" } };
  assert.equal(shouldSendPickupReminder({ ...base, periodeDebut: new Date(NOW + 49 * 60 * 60 * 1000).toISOString() }, NOW), false);
  assert.equal(shouldSendPickupReminder({ ...base, periodeDebut: new Date(NOW - 1).toISOString() }, NOW), false);
  assert.equal(shouldSendPickupReminder({ ...base, status: "pending_payment", periodeDebut: new Date(NOW + 30 * 60 * 60 * 1000).toISOString() }, NOW), false);
});

test("n'enregistre pas le rappel si l'e-mail échoue", async () => {
  const env = { RESERVATIONS_KV: createFakeKv() };
  const reservation = await paidReservation(env, NOW + 30 * 60 * 60 * 1000);
  const result = await runPickupReminders(env, NOW, async () => false);
  assert.equal(result.sent, 0);
  assert.equal((await getReservation(env, reservation.id)).pickupReminderSentAt, undefined);
});

test("l'e-mail récapitule les informations utiles et échappe les valeurs HTML", () => {
  const content = buildPickupReminderEmailContent({
    id: "res_test", vehiculeId: "opel-corsa", dateDebut: "2026-08-16", heureDebut: "10:00",
    lieuPrise: "<Agence>", adressePrise: "Grasse", documentsStatus: "submitted"
  });
  assert.match(content.text, /Opel Corsa Business 1\.2T/);
  assert.match(content.text, /500/);
  assert.match(content.text, /documents reçus/);
  assert.doesNotMatch(content.html, /<Agence>/);
  assert.match(content.html, /&lt;Agence&gt;/);
  assert.match(content.html, /wa\.me\/33667485430/);
});
