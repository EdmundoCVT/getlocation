// tests/worker-agency-rentals.test.js
//
// src/api/agency-rentals.js — session requise, CSRF/origine sur les
// écritures, client vérifié avant création, génération de contrat.

const test = require("node:test");
const assert = require("node:assert/strict");

const { makeAgencyEnv, loginAgency, agencyRequest } = require("./helpers/agency-session.js");
const { handleAgencyClients } = require("../src/api/agency-clients.js");
const { handleAgencyRentals } = require("../src/api/agency-rentals.js");

const dataValide = {
  vehiculeId: "opel-corsa",
  dateDebut: "2026-09-10",
  heureDebut: "10:00",
  dateFin: "2026-09-12",
  heureFin: "10:00"
};

async function creerClient(env, session) {
  const res = await handleAgencyClients(
    agencyRequest("https://getlocation.fr/api/agency-clients", { method: "POST", session, body: { action: "create", data: { firstName: "Jean", lastName: "Dupont" } } }),
    env
  );
  return (await res.json()).client;
}

test("GET : 401 sans session agence", async () => {
  const res = await handleAgencyRentals(agencyRequest("https://getlocation.fr/api/agency-rentals?id=rnt_x"), makeAgencyEnv());
  assert.equal(res.status, 401);
});

test("POST create : 403 sans origine autorisée", async () => {
  const env = makeAgencyEnv();
  const session = await loginAgency(env);
  const client = await creerClient(env, session);
  const req = new Request("https://getlocation.fr/api/agency-rentals", {
    method: "POST",
    headers: { origin: "https://evil.example", "content-type": "application/json", cookie: `agency_session=${session.cookie}`, "x-agency-csrf": session.csrfToken },
    body: JSON.stringify({ action: "create", clientId: client.id, data: dataValide })
  });
  const res = await handleAgencyRentals(req, env);
  assert.equal(res.status, 403);
});

test("POST create : 404 si le client n'existe pas", async () => {
  const env = makeAgencyEnv();
  const session = await loginAgency(env);
  const res = await handleAgencyRentals(
    agencyRequest("https://getlocation.fr/api/agency-rentals", { method: "POST", session, body: { action: "create", clientId: "clt_inconnu", data: dataValide } }),
    env
  );
  assert.equal(res.status, 404);
});

test("cas nominal : création, lecture par id, par client, mise à jour, génération du contrat", async () => {
  const env = makeAgencyEnv();
  const session = await loginAgency(env);
  const client = await creerClient(env, session);

  const createRes = await handleAgencyRentals(
    agencyRequest("https://getlocation.fr/api/agency-rentals", { method: "POST", session, body: { action: "create", clientId: client.id, data: dataValide } }),
    env
  );
  assert.equal(createRes.status, 200);
  const { rental } = await createRes.json();
  assert.equal(rental.createdBy, "Edmundo");
  assert.equal(rental.contractNumero, null);

  const byId = await (await handleAgencyRentals(agencyRequest(`https://getlocation.fr/api/agency-rentals?id=${rental.id}`, { session }), env)).json();
  assert.equal(byId.rental.id, rental.id);

  const byClient = await (await handleAgencyRentals(agencyRequest(`https://getlocation.fr/api/agency-rentals?clientId=${client.id}`, { session }), env)).json();
  assert.equal(byClient.rentals.length, 1);

  const updateRes = await handleAgencyRentals(
    agencyRequest("https://getlocation.fr/api/agency-rentals", { method: "POST", session, body: { action: "update", id: rental.id, data: { ...dataValide, kmDepart: 42000 } } }),
    env
  );
  const { rental: updated } = await updateRes.json();
  assert.equal(updated.kmDepart, 42000);

  const contractRes = await handleAgencyRentals(
    agencyRequest("https://getlocation.fr/api/agency-rentals", { method: "POST", session, body: { action: "generate-contract", id: rental.id } }),
    env
  );
  const { rental: withContract } = await contractRes.json();
  assert.match(withContract.contractNumero, /^GL-\d{8}-\d{4}$/);
  assert.equal(withContract.status, "contrat_genere");

  assert.equal(env.AGENCY_DB._raw.auditLog.some((e) => e.event_type === "contract_generated"), true);
});
