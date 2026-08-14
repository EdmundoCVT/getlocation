// tests/reservation-status.test.js
const test = require("node:test");
const assert = require("node:assert/strict");

const { handler } = require("../netlify/functions/reservation-status.js");
const { createReservation, updateReservationStatus } = require("../lib/server/reservation-store.js");

let ipCounter = 0;
function makeEvent(query = {}, headers = {}) {
  ipCounter += 1;
  return {
    httpMethod: "GET",
    headers: { origin: "https://getlocation.fr", "x-nf-client-connection-ip": `198.51.100.${200 + ipCounter}`, ...headers },
    queryStringParameters: query
  };
}

test("rejette les méthodes autres que GET/OPTIONS", async () => {
  const res = await handler({ httpMethod: "POST", headers: {} });
  assert.equal(res.statusCode, 405);
});

test("rejette un id absent ou mal formé", async () => {
  const missing = await handler(makeEvent({}));
  assert.equal(missing.statusCode, 400);

  const malformed = await handler(makeEvent({ id: "not-a-real-id" }));
  assert.equal(malformed.statusCode, 400);
});

test("renvoie 404 pour une réservation inexistante", async () => {
  const res = await handler(makeEvent({ id: `res_${"0".repeat(32)}` }));
  assert.equal(res.statusCode, 404);
});

test("renvoie une vue publique sûre (sans naissance/téléphone) pour une réservation existante", async () => {
  const reservation = await createReservation({
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
  await updateReservationStatus(reservation.id, "paid", { paidAt: new Date().toISOString() });

  const res = await handler(makeEvent({ id: reservation.id }));
  assert.equal(res.statusCode, 200);
  const json = JSON.parse(res.body);

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
  const reservation = await createReservation({ vehiculeId: "opel-corsa" });
  const res = await handler(makeEvent({ id: reservation.id }));
  assert.equal(res.headers["Cache-Control"], "no-store");
});
