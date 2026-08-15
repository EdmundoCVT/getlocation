// tests/worker-reservation-status.test.js
//
// Équivalent de tests/reservation-status.test.js pour
// src/api/reservation-status.js (Cloudflare Worker, Phase B — voir
// DEPLOIEMENT.md).

const test = require("node:test");
const assert = require("node:assert/strict");

const { createFakeKv } = require("./helpers/fake-kv.js");
const { handleReservationStatus } = require("../src/api/reservation-status.js");
const { createReservation, updateReservationStatus } = require("../src/lib/reservation-store.js");

function makeEnv() {
  return { RESERVATIONS_KV: createFakeKv(), RATE_LIMITS_KV: createFakeKv() };
}

let ipCounter = 0;
function makeRequest(query = {}, headers = {}) {
  ipCounter += 1;
  const url = new URL("https://getlocation.fr/api/reservation-status");
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return new Request(url, {
    method: "GET",
    headers: { origin: "https://getlocation.fr", "cf-connecting-ip": `198.51.100.${200 + ipCounter}`, ...headers }
  });
}

test("rejette les méthodes autres que GET/OPTIONS", async () => {
  const res = await handleReservationStatus(new Request("https://getlocation.fr/api/reservation-status", { method: "POST" }), makeEnv());
  assert.equal(res.status, 405);
});

test("rejette un id absent ou mal formé", async () => {
  const env = makeEnv();
  const missing = await handleReservationStatus(makeRequest({}), env);
  assert.equal(missing.status, 400);

  const malformed = await handleReservationStatus(makeRequest({ id: "not-a-real-id" }), env);
  assert.equal(malformed.status, 400);
});

test("renvoie 404 pour une réservation inexistante", async () => {
  const res = await handleReservationStatus(makeRequest({ id: `res_${"0".repeat(32)}` }), makeEnv());
  assert.equal(res.status, 404);
});

test("renvoie une vue publique sûre (sans naissance/téléphone) pour une réservation existante", async () => {
  const env = makeEnv();
  const reservation = await createReservation(env, {
    vehiculeId: "peugeot-3008",
    dateDebut: "2026-08-01",
    heureDebut: "10:00",
    dateFin: "2026-08-04",
    heureFin: "10:00",
    assurance: true,
    jours: 3,
    total: 264,
    conducteur: {
      nom: "Dupont",
      prenom: "Jean",
      email: "jean@example.com",
      telephone: "0601020304",
      naissance: "1996-03-14"
    }
  });
  await updateReservationStatus(env, reservation.id, "paid", { paidAt: new Date().toISOString() });

  const res = await handleReservationStatus(makeRequest({ id: reservation.id }), env);
  assert.equal(res.status, 200);
  const json = await res.json();

  assert.equal(json.id, reservation.id);
  assert.equal(json.status, "paid");
  assert.equal(json.vehicule.id, "peugeot-3008");
  assert.equal(json.total, 264);
  assert.equal(json.conducteur.prenom, "Jean");
  assert.equal(json.conducteur.email, "jean@example.com");

  // Champs sensibles jamais exposés par cet endpoint public.
  assert.equal(json.conducteur.telephone, undefined);
  assert.equal(json.conducteur.naissance, undefined);
  assert.equal(JSON.stringify(json).includes("1996-03-14"), false);
});

test("en-tête Cache-Control: no-store présent (donnée sensible/dynamique)", async () => {
  const env = makeEnv();
  const reservation = await createReservation(env, { vehiculeId: "opel-corsa" });
  const res = await handleReservationStatus(makeRequest({ id: reservation.id }), env);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
});
