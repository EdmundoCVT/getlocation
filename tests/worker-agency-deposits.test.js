// tests/worker-agency-deposits.test.js
//
// src/api/agency-deposits.js — caution distincte des paiements, cycle
// demande -> réception -> restitution/retenue.

const test = require("node:test");
const assert = require("node:assert/strict");

const { makeAgencyEnv, loginAgency, agencyRequest } = require("./helpers/agency-session.js");
const { handleAgencyClients } = require("../src/api/agency-clients.js");
const { handleAgencyRentals } = require("../src/api/agency-rentals.js");
const { handleAgencyDeposits } = require("../src/api/agency-deposits.js");

async function creerLocation(env, session) {
  const clientRes = await handleAgencyClients(
    agencyRequest("https://getlocation.fr/api/agency-clients", { method: "POST", session, body: { action: "create", data: { firstName: "Jean", lastName: "Dupont" } } }),
    env
  );
  const { client } = await clientRes.json();
  const rentalRes = await handleAgencyRentals(
    agencyRequest("https://getlocation.fr/api/agency-rentals", {
      method: "POST",
      session,
      body: { action: "create", clientId: client.id, data: { vehiculeId: "opel-corsa", dateDebut: "2026-09-10", heureDebut: "10:00", dateFin: "2026-09-12", heureFin: "10:00" } }
    }),
    env
  );
  return (await rentalRes.json()).rental;
}

test("GET : 401 sans session agence", async () => {
  const res = await handleAgencyDeposits(agencyRequest("https://getlocation.fr/api/agency-deposits?rentalId=rnt_x"), makeAgencyEnv());
  assert.equal(res.status, 401);
});

test("cycle complet : demande -> réception -> restitution intégrale", async () => {
  const env = makeAgencyEnv();
  const session = await loginAgency(env);
  const rental = await creerLocation(env, session);

  const createRes = await handleAgencyDeposits(
    agencyRequest("https://getlocation.fr/api/agency-deposits", { method: "POST", session, body: { action: "create", rentalId: rental.id, data: { amount: 500, method: "carte" } } }),
    env
  );
  assert.equal(createRes.status, 200);
  const { deposit } = await createRes.json();
  assert.equal(deposit.status, "attendue");

  const receiveRes = await handleAgencyDeposits(
    agencyRequest("https://getlocation.fr/api/agency-deposits", { method: "POST", session, body: { action: "receive", id: deposit.id } }),
    env
  );
  assert.equal((await receiveRes.json()).deposit.status, "recue");

  const returnRes = await handleAgencyDeposits(
    agencyRequest("https://getlocation.fr/api/agency-deposits", { method: "POST", session, body: { action: "return", id: deposit.id, data: { returnedAmount: 500, retainedAmount: 0 } } }),
    env
  );
  const { deposit: returned } = await returnRes.json();
  assert.equal(returned.status, "restituee");

  const getRes = await handleAgencyDeposits(agencyRequest(`https://getlocation.fr/api/agency-deposits?rentalId=${rental.id}`, { session }), env);
  assert.equal((await getRes.json()).deposit.status, "restituee");

  const auditTypes = env.AGENCY_DB._raw.auditLog.map((e) => e.event_type);
  assert.ok(auditTypes.includes("deposit_requested"));
  assert.ok(auditTypes.includes("deposit_received"));
  assert.ok(auditTypes.includes("deposit_returned"));
});

test("retenue partielle sans motif : rejetée (400)", async () => {
  const env = makeAgencyEnv();
  const session = await loginAgency(env);
  const rental = await creerLocation(env, session);
  const createRes = await handleAgencyDeposits(
    agencyRequest("https://getlocation.fr/api/agency-deposits", { method: "POST", session, body: { action: "create", rentalId: rental.id, data: { amount: 500, method: "carte" } } }),
    env
  );
  const { deposit } = await createRes.json();
  await handleAgencyDeposits(agencyRequest("https://getlocation.fr/api/agency-deposits", { method: "POST", session, body: { action: "receive", id: deposit.id } }), env);

  const res = await handleAgencyDeposits(
    agencyRequest("https://getlocation.fr/api/agency-deposits", { method: "POST", session, body: { action: "return", id: deposit.id, data: { returnedAmount: 400, retainedAmount: 100 } } }),
    env
  );
  assert.equal(res.status, 400);
});

test("une seconde caution pour la même location est refusée (400)", async () => {
  const env = makeAgencyEnv();
  const session = await loginAgency(env);
  const rental = await creerLocation(env, session);
  await handleAgencyDeposits(
    agencyRequest("https://getlocation.fr/api/agency-deposits", { method: "POST", session, body: { action: "create", rentalId: rental.id, data: { amount: 500, method: "carte" } } }),
    env
  );
  const res = await handleAgencyDeposits(
    agencyRequest("https://getlocation.fr/api/agency-deposits", { method: "POST", session, body: { action: "create", rentalId: rental.id, data: { amount: 500, method: "carte" } } }),
    env
  );
  assert.equal(res.status, 400);
});
