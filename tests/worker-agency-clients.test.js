// tests/worker-agency-clients.test.js
//
// src/api/agency-clients.js — session requise, CSRF/origine sur les
// écritures, created_by/updated_by depuis la session.

const test = require("node:test");
const assert = require("node:assert/strict");

const { makeAgencyEnv, loginAgency, agencyRequest } = require("./helpers/agency-session.js");

test("GET : 401 sans session agence", async () => {
  const { handleAgencyClients } = require("../src/api/agency-clients.js");
  const res = await handleAgencyClients(agencyRequest("https://getlocation.fr/api/agency-clients?id=clt_x"), makeAgencyEnv());
  assert.equal(res.status, 401);
});

test("POST create : 403 sans jeton CSRF, même avec une session valide", async () => {
  const { handleAgencyClients } = require("../src/api/agency-clients.js");
  const env = makeAgencyEnv();
  const session = await loginAgency(env);
  const req = new Request("https://getlocation.fr/api/agency-clients", {
    method: "POST",
    headers: { origin: "https://getlocation.fr", "content-type": "application/json", cookie: `agency_session=${session.cookie}` },
    body: JSON.stringify({ action: "create", data: { firstName: "Jean", lastName: "Dupont" } })
  });
  const res = await handleAgencyClients(req, env);
  assert.equal(res.status, 403);
});

test("POST create puis GET par id : cas nominal, createdBy depuis la session", async () => {
  const { handleAgencyClients } = require("../src/api/agency-clients.js");
  const env = makeAgencyEnv();
  const session = await loginAgency(env);

  const createRes = await handleAgencyClients(
    agencyRequest("https://getlocation.fr/api/agency-clients", { method: "POST", session, body: { action: "create", data: { firstName: "Jean", lastName: "Dupont", createdBy: "Quelqu'un d'autre" } } }),
    env
  );
  assert.equal(createRes.status, 200);
  const { client } = await createRes.json();
  assert.equal(client.createdBy, "Edmundo", "createdBy vient de la session, jamais du payload");

  const getRes = await handleAgencyClients(agencyRequest(`https://getlocation.fr/api/agency-clients?id=${client.id}`, { session }), env);
  const { client: fetched } = await getRes.json();
  assert.equal(fetched.id, client.id);
});

test("GET recherche : par téléphone, par email, secours par nom", async () => {
  const { handleAgencyClients } = require("../src/api/agency-clients.js");
  const env = makeAgencyEnv();
  const session = await loginAgency(env);
  await handleAgencyClients(
    agencyRequest("https://getlocation.fr/api/agency-clients", { method: "POST", session, body: { action: "create", data: { firstName: "Jean", lastName: "Dupont", phone: "0601020304" } } }),
    env
  );

  const parTel = await (await handleAgencyClients(agencyRequest("https://getlocation.fr/api/agency-clients?phone=0601020304", { session }), env)).json();
  assert.equal(parTel.clients.length, 1);

  const parNom = await (await handleAgencyClients(agencyRequest("https://getlocation.fr/api/agency-clients?lastName=Dupont", { session }), env)).json();
  assert.equal(parNom.clients.length, 1);
});

test("POST update : 404 si le client est introuvable", async () => {
  const { handleAgencyClients } = require("../src/api/agency-clients.js");
  const env = makeAgencyEnv();
  const session = await loginAgency(env);
  const res = await handleAgencyClients(
    agencyRequest("https://getlocation.fr/api/agency-clients", { method: "POST", session, body: { action: "update", id: "clt_inconnu", data: { firstName: "A", lastName: "B" } } }),
    env
  );
  assert.equal(res.status, 404);
});
