const test = require("node:test");
const assert = require("node:assert/strict");
const { createFakeKv } = require("./helpers/fake-kv.js");
const { createReservation, updateReservationStatus } = require("../src/lib/reservation-store.js");
const { franceDate, eventsForDate, runAgencyDailySummary } = require("../src/lib/agency-daily-summary.js");
const { buildAgencyDailySummaryContent } = require("../src/lib/send-agency-daily-summary-email.js");

const NOW = Date.parse("2026-08-15T06:00:00.000Z");

async function reservation(env, extra = {}) {
  const created = await createReservation(env, {
    vehiculeId: "opel-corsa", dateDebut: "2026-08-15", heureDebut: "10:00",
    dateFin: "2026-08-16", heureFin: "11:00", lieuPrise: "Agence Grasse",
    conducteur: { prenom: "Jean", nom: "Test", email: "client@example.test", telephone: "0612345678" },
    ...extra
  });
  return updateReservationStatus(env, created.id, "paid", { documentsStatus: "submitted" });
}

test("calcule la date du planning dans le fuseau français", () => {
  assert.equal(franceDate(Date.parse("2026-08-14T22:30:00.000Z")), "2026-08-15");
});

test("sélectionne et trie uniquement les départs et retours payés du jour", async () => {
  const env = { RESERVATIONS_KV: createFakeKv() };
  const pickup = await reservation(env);
  const returning = await reservation(env, { dateDebut: "2026-08-14", heureDebut: "09:00", dateFin: "2026-08-15", heureFin: "08:00" });
  const events = eventsForDate([pickup, returning, { status: "cancelled", dateDebut: "2026-08-15" }], "2026-08-15");
  assert.deepEqual(events.map((event) => event.type), ["return", "pickup"]);
});

test("envoie le planning une seule fois et mémorise la date", async () => {
  const env = { RESERVATIONS_KV: createFakeKv() };
  await reservation(env);
  const calls = [];
  const sender = async (_env, date, events) => { calls.push({ date, count: events.length }); return true; };
  assert.equal((await runAgencyDailySummary(env, NOW, sender)).sent, true);
  assert.equal((await runAgencyDailySummary(env, NOW, sender)).alreadySent, true);
  assert.deepEqual(calls, [{ date: "2026-08-15", count: 1 }]);
});

test("n'enregistre rien s'il n'y a aucun mouvement ou si l'e-mail échoue", async () => {
  const empty = { RESERVATIONS_KV: createFakeKv() };
  assert.equal((await runAgencyDailySummary(empty, NOW, async () => true)).sent, false);
  const env = { RESERVATIONS_KV: createFakeKv() };
  await reservation(env);
  assert.equal((await runAgencyDailySummary(env, NOW, async () => false)).sent, false);
  assert.equal(await env.RESERVATIONS_KV.get("agency_summary_2026-08-15"), null);
});

test("l'e-mail contient les informations opérationnelles et échappe le HTML", async () => {
  const env = { RESERVATIONS_KV: createFakeKv() };
  const item = await reservation(env, { lieuPrise: "<Agence>" });
  const content = buildAgencyDailySummaryContent("2026-08-15", [{ type: "pickup", reservation: item }]);
  assert.match(content.text, /Jean Test/);
  assert.match(content.text, /documents reçus/);
  assert.match(content.text, /0612345678/);
  assert.match(content.html, /wa\.me\/33612345678/);
  assert.doesNotMatch(content.html, /<Agence>/);
  assert.match(content.html, /&lt;Agence&gt;/);
});
