// tests/worker-mollie-deposit-webhook.test.js
//
// src/api/mollie-deposit-webhook.js — webhook dédié à l'empreinte bancaire
// (caution), distinct de /api/mollie-webhook (paiement de location). Ne
// fait jamais confiance au corps du webhook : revérifie toujours le statut
// réel via l'API Mollie simulée (fetch faux, comme les autres tests Mollie
// de ce dépôt — aucun accès réseau réel disponible ici).

const test = require("node:test");
const assert = require("node:assert/strict");

const { makeAgencyEnv, loginAgency, agencyRequest } = require("./helpers/agency-session.js");
const { handleAgencyClients } = require("../src/api/agency-clients.js");
const { handleAgencyRentals } = require("../src/api/agency-rentals.js");
const { handleAgencyDepositAuthorizations } = require("../src/api/agency-deposit-authorizations.js");
const { handleMollieDepositWebhook } = require("../src/api/mollie-deposit-webhook.js");

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

function webhookRequest(paymentId) {
  return new Request("https://getlocation.fr/api/mollie-deposit-webhook", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `id=${encodeURIComponent(paymentId)}`
  });
}

async function creerEmpreinteLienCree(env, session) {
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
  const rental = (await rentalRes.json()).rental;

  const createRes = await withQueuedFetch(
    [{ status: 201, body: { id: "tr_webhook1", status: "open", mode: "test", _links: { checkout: { href: "https://x" } } } }],
    () =>
      handleAgencyDepositAuthorizations(
        agencyRequest("https://getlocation.fr/api/agency-deposit-authorizations", { method: "POST", session, body: { action: "create", rentalId: rental.id } }),
        env
      )
  );
  return (await createRes.json()).authorization;
}

test("méthode GET refusée (405)", async () => {
  const env = makeAgencyEnv();
  const res = await handleMollieDepositWebhook(new Request("https://getlocation.fr/api/mollie-deposit-webhook"), env);
  assert.equal(res.status, 405);
});

test("MOLLIE_DEPOSIT_API_KEY manquante -> 500, sans planter", async () => {
  const env = makeAgencyEnv();
  const res = await handleMollieDepositWebhook(webhookRequest("tr_x"), env);
  assert.equal(res.status, 500);
});

test("id manquant dans le corps -> 400", async () => {
  const env = makeAgencyEnv({ MOLLIE_DEPOSIT_API_KEY: "test_dummy_key" });
  const res = await handleMollieDepositWebhook(new Request("https://getlocation.fr/api/mollie-deposit-webhook", { method: "POST", body: "" }), env);
  assert.equal(res.status, 400);
});

test("id inconnu de notre base -> 200 reçu, sans effet ni erreur révélée", async () => {
  const env = makeAgencyEnv({ MOLLIE_DEPOSIT_API_KEY: "test_dummy_key" });
  const res = await withQueuedFetch(
    [{ status: 200, body: { id: "tr_jamais_vu", status: "authorized", mode: "test" } }],
    () => handleMollieDepositWebhook(webhookRequest("tr_jamais_vu"), env)
  );
  assert.equal(res.status, 200);
});

test("id inconnu de Mollie (404) -> 200 reçu quand même (pas de retentatives inutiles)", async () => {
  const env = makeAgencyEnv({ MOLLIE_DEPOSIT_API_KEY: "test_dummy_key" });
  const res = await withQueuedFetch(
    [{ status: 404, body: { status: 404, detail: "No payment exists with token tr_inexistant" } }],
    () => handleMollieDepositWebhook(webhookRequest("tr_inexistant"), env)
  );
  assert.equal(res.status, 200);
});

test("statut authorized : revérifié auprès de Mollie, jamais fait confiance au corps du webhook, journalisé", async () => {
  const env = makeAgencyEnv({ MOLLIE_DEPOSIT_API_KEY: "test_dummy_key" });
  const session = await loginAgency(env);
  const created = await creerEmpreinteLienCree(env, session);
  assert.equal(created.status, "lien_cree");

  const res = await withQueuedFetch(
    [{ status: 200, body: { id: "tr_webhook1", status: "authorized", mode: "test" } }],
    () => handleMollieDepositWebhook(webhookRequest("tr_webhook1"), env)
  );
  assert.equal(res.status, 200);

  const getRes = await handleAgencyDepositAuthorizations(
    agencyRequest(`https://getlocation.fr/api/agency-deposit-authorizations?rentalId=${created.rentalId}`, { session }),
    env
  );
  const { active } = await getRes.json();
  assert.equal(active.status, "autorisee");
  assert.ok(active.authorizedAt);

  const auditEvents = env.AGENCY_DB._raw.auditLog.filter((e) => e.event_type === "deposit_authorization_status_changed");
  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0].actor, "mollie");
  assert.deepEqual(JSON.parse(auditEvents[0].metadata), { from: "lien_cree", to: "autorisee" });
});

test("un second appel webhook avec le même statut ne journalise pas de nouveau changement", async () => {
  const env = makeAgencyEnv({ MOLLIE_DEPOSIT_API_KEY: "test_dummy_key" });
  const session = await loginAgency(env);
  const created = await creerEmpreinteLienCree(env, session);

  await withQueuedFetch(
    [{ status: 200, body: { id: "tr_webhook1", status: "authorized", mode: "test" } }],
    () => handleMollieDepositWebhook(webhookRequest("tr_webhook1"), env)
  );
  await withQueuedFetch(
    [{ status: 200, body: { id: "tr_webhook1", status: "authorized", mode: "test" } }],
    () => handleMollieDepositWebhook(webhookRequest("tr_webhook1"), env)
  );

  const auditEvents = env.AGENCY_DB._raw.auditLog.filter((e) => e.event_type === "deposit_authorization_status_changed");
  assert.equal(auditEvents.length, 1);
});
