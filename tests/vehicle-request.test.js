const test = require("node:test");
const assert = require("node:assert/strict");
const { createFakeKv } = require("./helpers/fake-kv.js");
const { handleVehicleRequest } = require("../src/api/vehicle-request.js");

const valid = {
  vehicleId: "sans-permis-request", name: "Alex Martin", email: "alex@example.com",
  phone: "+33 6 12 34 56 78", dateDebut: "2026-10-02", heureDebut: "10:00",
  dateFin: "2026-10-05", heureFin: "10:00", adressePrise: "Nice"
};
const request = (data, origin = "https://getlocation.fr") => new Request("https://getlocation.fr/api/vehicle-request", {
  method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(data)
});

test("sans permis : demande enregistrée et notifiée sans paiement", async () => {
  const previousFetch = global.fetch;
  const emails = [];
  global.fetch = async (_url, options) => {
    emails.push(JSON.parse(options.body));
    return new Response('{"id":"mail-test"}', { status: 200 });
  };
  const env = { RATE_LIMITS_KV: createFakeKv(), RESERVATIONS_KV: createFakeKv(),
    RESEND_API_KEY: "test", AGENCY_EMAIL: "agency@example.com" };
  try {
    const result = await handleVehicleRequest(request(valid), env);
    assert.equal(result.status, 201);
    const { id, status } = await result.json();
    assert.equal(status, "pending");
    const saved = JSON.parse(await env.RESERVATIONS_KV.get(`vehicle-request:${id}`));
    assert.equal(saved.vehicleId, valid.vehicleId);
    assert.equal(saved.email, valid.email);
    assert.equal(emails.length, 1);
    assert.equal(emails[0].to[0], "agency@example.com");
    assert.match(emails[0].text, /Disponibilité à confirmer avant paiement/);
  } finally { global.fetch = previousFetch; }
});

test("demande : refuse une origine tierce et un identifiant de réservation instantanée", async () => {
  const env = { RATE_LIMITS_KV: createFakeKv(), RESERVATIONS_KV: createFakeKv() };
  assert.equal((await handleVehicleRequest(request(valid, "https://other.example"), env)).status, 403);
  assert.equal((await handleVehicleRequest(request({ ...valid, vehicleId: "peugeot-3008" }), env)).status, 400);
  assert.equal((await env.RESERVATIONS_KV.list({ prefix: "vehicle-request:" })).keys.length, 0);
});
