const test = require("node:test");
const assert = require("node:assert/strict");
const { createFakeKv } = require("./helpers/fake-kv.js");
const { createReservation, updateReservationStatus, getReservation } = require("../src/lib/reservation-store.js");
const { shouldSendReturnReminder, runReturnReminders } = require("../src/lib/return-reminders.js");
const { buildReturnReminderEmailContent } = require("../src/lib/send-return-reminder-email.js");

const NOW = Date.parse("2026-08-15T09:00:00.000Z");

async function paidReservation(env, startMs, returnMs) {
  const start = new Date(startMs);
  const end = new Date(returnMs);
  const reservation = await createReservation(env, {
    vehiculeId: "opel-corsa",
    periodeDebut: start.toISOString(), periodeFin: end.toISOString(),
    dateDebut: start.toISOString().slice(0, 10), heureDebut: "10:00",
    dateFin: end.toISOString().slice(0, 10), heureFin: "10:00",
    lieuRetour: "Agence Grasse", conducteur: { email: "client@example.test" }
  });
  return updateReservationStatus(env, reservation.id, "paid");
}

test("envoie un seul rappel pendant la location et moins de 48 heures avant le retour", async () => {
  const env = { RESERVATIONS_KV: createFakeKv() };
  const reservation = await paidReservation(env, NOW - 86400000, NOW + 30 * 60 * 60 * 1000);
  const calls = [];
  const result = await runReturnReminders(env, NOW, async (_env, record) => { calls.push(record.id); return true; });
  assert.deepEqual(result, { scanned: 1, sent: 1 });
  assert.deepEqual(calls, [reservation.id]);
  const updated = await getReservation(env, reservation.id);
  assert.equal(updated.returnReminderSentAt, new Date(NOW).toISOString());
  assert.equal(shouldSendReturnReminder(updated, NOW), false);
});

test("ignore une location pas encore commencée, déjà terminée ou non payée", () => {
  const base = { status: "paid", conducteur: { email: "client@example.test" } };
  assert.equal(shouldSendReturnReminder({ ...base, periodeDebut: new Date(NOW + 1).toISOString(), periodeFin: new Date(NOW + 30 * 3600000).toISOString() }, NOW), false);
  assert.equal(shouldSendReturnReminder({ ...base, periodeDebut: new Date(NOW - 86400000).toISOString(), periodeFin: new Date(NOW - 1).toISOString() }, NOW), false);
  assert.equal(shouldSendReturnReminder({ ...base, status: "pending_payment", periodeDebut: new Date(NOW - 86400000).toISOString(), periodeFin: new Date(NOW + 3600000).toISOString() }, NOW), false);
});

test("n'enregistre pas le rappel si l'e-mail échoue", async () => {
  const env = { RESERVATIONS_KV: createFakeKv() };
  const reservation = await paidReservation(env, NOW - 86400000, NOW + 3600000);
  assert.equal((await runReturnReminders(env, NOW, async () => false)).sent, 0);
  assert.equal((await getReservation(env, reservation.id)).returnReminderSentAt, undefined);
});

test("l'e-mail contient le retour, la checklist et un WhatsApp prérempli", () => {
  const content = buildReturnReminderEmailContent({
    id: "res_test", vehiculeId: "opel-corsa", dateFin: "2026-08-17", heureFin: "10:00",
    lieuRetour: "<Agence>", adresseRetour: "Grasse"
  });
  assert.match(content.text, /Opel Corsa Business 1\.2T/);
  assert.match(content.text, /niveau de carburant prévu au contrat/);
  assert.match(content.text, /tout dommage ou incident/);
  assert.doesNotMatch(content.html, /<Agence>/);
  assert.match(content.html, /&lt;Agence&gt;/);
  assert.match(content.html, /wa\.me\/33667485430/);
});
