// tests/worker-agency-deposit-authorizations.test.js
//
// src/api/agency-deposit-authorizations.js — empreinte bancaire Mollie
// (caution), endpoint agence protégé par session. Simule fetch() comme
// tests/deposit-authorizations.test.js (aucun accès réseau Mollie réel
// disponible dans cet environnement, voir DEPLOIEMENT.md).

const test = require("node:test");
const assert = require("node:assert/strict");

const { makeAgencyEnv, loginAgency, agencyRequest } = require("./helpers/agency-session.js");
const { handleAgencyClients } = require("../src/api/agency-clients.js");
const { handleAgencyRentals } = require("../src/api/agency-rentals.js");
const { handleAgencyDepositAuthorizations } = require("../src/api/agency-deposit-authorizations.js");

function withQueuedFetch(responses, fn) {
  const original = globalThis.fetch;
  let i = 0;
  globalThis.fetch = async () => {
    const r = responses[i++];
    if (!r) throw new Error("withQueuedFetch: plus de réponse simulée disponible");
    return new Response(JSON.stringify(r.body), { status: r.status || 200 });
  };
  return Promise.resolve(fn()).finally(() => {
    globalThis.fetch = original;
  });
}

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
  const res = await handleAgencyDepositAuthorizations(agencyRequest("https://getlocation.fr/api/agency-deposit-authorizations?rentalId=rnt_x"), makeAgencyEnv());
  assert.equal(res.status, 401);
});

test("create : 200, ligne active renvoyée, mode test signalé", async () => {
  const env = makeAgencyEnv({ MOLLIE_DEPOSIT_API_KEY: "test_dummy_key" });
  const session = await loginAgency(env);
  const rental = await creerLocation(env, session);

  const createRes = await withQueuedFetch(
    [{ status: 201, body: { id: "tr_e2e1", status: "open", mode: "test", _links: { checkout: { href: "https://www.mollie.com/checkout/tr_e2e1" } } } }],
    () =>
      handleAgencyDepositAuthorizations(
        agencyRequest("https://getlocation.fr/api/agency-deposit-authorizations", { method: "POST", session, body: { action: "create", rentalId: rental.id } }),
        env
      )
  );
  assert.equal(createRes.status, 200);
  const { authorization } = await createRes.json();
  assert.equal(authorization.status, "lien_cree");
  assert.equal(authorization.authorizedAmountCents, 65000); // opel-corsa : VEHICULES[].caution = 650 €
  assert.equal(authorization.checkoutUrl, "https://www.mollie.com/checkout/tr_e2e1");

  const getRes = await handleAgencyDepositAuthorizations(
    agencyRequest(`https://getlocation.fr/api/agency-deposit-authorizations?rentalId=${rental.id}`, { session }),
    env
  );
  const getBody = await getRes.json();
  assert.equal(getBody.active.id, authorization.id);
  assert.equal(getBody.mollieTestMode, true);

  const auditTypes = env.AGENCY_DB._raw.auditLog.map((e) => e.event_type);
  assert.ok(auditTypes.includes("deposit_authorization_created"));
});

test("create : erreur Mollie renvoyée avec le détail (502), jamais masquée", async () => {
  const env = makeAgencyEnv({ MOLLIE_DEPOSIT_API_KEY: "test_dummy_key" });
  const session = await loginAgency(env);
  const rental = await creerLocation(env, session);

  const res = await withQueuedFetch(
    [{ status: 422, body: { status: 422, detail: "This payment method does not support manual capture" } }],
    () =>
      handleAgencyDepositAuthorizations(
        agencyRequest("https://getlocation.fr/api/agency-deposit-authorizations", { method: "POST", session, body: { action: "create", rentalId: rental.id } }),
        env
      )
  );
  assert.equal(res.status, 502);
  const body = await res.json();
  assert.equal(body.mollie.statusCode, 422);
  assert.match(body.mollie.detail, /manual capture/);
});

test("cycle complet : create -> autorisation (webhook simulé) -> capture partielle -> release refusé -> GET historique", async () => {
  const env = makeAgencyEnv({ MOLLIE_DEPOSIT_API_KEY: "test_dummy_key" });
  const session = await loginAgency(env);
  const rental = await creerLocation(env, session);

  const createRes = await withQueuedFetch(
    [{ status: 201, body: { id: "tr_e2e2", status: "open", mode: "test", _links: { checkout: { href: "https://x" } } } }],
    () =>
      handleAgencyDepositAuthorizations(
        agencyRequest("https://getlocation.fr/api/agency-deposit-authorizations", { method: "POST", session, body: { action: "create", rentalId: rental.id } }),
        env
      )
  );
  const { authorization: created } = await createRes.json();

  // Simule la revérification serveur qui suivrait un vrai webhook Mollie
  // (voir tests/worker-mollie-deposit-webhook.test.js pour le test du
  // endpoint webhook lui-même) en passant directement par "refresh".
  const refreshRes = await withQueuedFetch(
    [{ status: 200, body: { id: "tr_e2e2", status: "authorized", mode: "test" } }],
    () =>
      handleAgencyDepositAuthorizations(
        agencyRequest("https://getlocation.fr/api/agency-deposit-authorizations", { method: "POST", session, body: { action: "refresh", id: created.id } }),
        env
      )
  );
  assert.equal((await refreshRes.json()).authorization.status, "autorisee");

  const captureRes = await withQueuedFetch(
    [
      { status: 200, body: { id: "tr_e2e2", status: "authorized", mode: "test" } },
      { status: 201, body: { id: "cpt_e2e", status: "pending" } },
      { status: 200, body: { id: "tr_e2e2", status: "paid", mode: "test", amountCaptured: { currency: "EUR", value: "180.00" } } }
    ],
    () =>
      handleAgencyDepositAuthorizations(
        agencyRequest("https://getlocation.fr/api/agency-deposit-authorizations", { method: "POST", session, body: { action: "capture", id: created.id, amount: 180 } }),
        env
      )
  );
  assert.equal(captureRes.status, 200);
  const { authorization: captured } = await captureRes.json();
  assert.equal(captured.status, "capturee_partielle");
  assert.equal(captured.capturedAmountCents, 18000);

  const releaseRes = await handleAgencyDepositAuthorizations(
    agencyRequest("https://getlocation.fr/api/agency-deposit-authorizations", { method: "POST", session, body: { action: "release", id: created.id } }),
    env
  );
  assert.equal(releaseRes.status, 400);

  const getRes = await handleAgencyDepositAuthorizations(
    agencyRequest(`https://getlocation.fr/api/agency-deposit-authorizations?rentalId=${rental.id}`, { session }),
    env
  );
  const getBody = await getRes.json();
  assert.equal(getBody.history.length, 1);
  assert.equal(getBody.active, null);
  assert.equal(getBody.history[0].status, "capturee_partielle");

  const auditTypes = env.AGENCY_DB._raw.auditLog.map((e) => e.event_type);
  assert.ok(auditTypes.includes("deposit_authorization_capture_requested"));
});

test("une seconde empreinte active pour la même location est refusée (400)", async () => {
  const env = makeAgencyEnv({ MOLLIE_DEPOSIT_API_KEY: "test_dummy_key" });
  const session = await loginAgency(env);
  const rental = await creerLocation(env, session);

  await withQueuedFetch(
    [{ status: 201, body: { id: "tr_e2e3", status: "open", mode: "test", _links: { checkout: { href: "https://x" } } } }],
    () =>
      handleAgencyDepositAuthorizations(
        agencyRequest("https://getlocation.fr/api/agency-deposit-authorizations", { method: "POST", session, body: { action: "create", rentalId: rental.id } }),
        env
      )
  );

  const res = await handleAgencyDepositAuthorizations(
    agencyRequest("https://getlocation.fr/api/agency-deposit-authorizations", { method: "POST", session, body: { action: "create", rentalId: rental.id } }),
    env
  );
  assert.equal(res.status, 400);
});
