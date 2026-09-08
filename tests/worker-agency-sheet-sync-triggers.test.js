// tests/worker-agency-sheet-sync-triggers.test.js
//
// Vérifie que les endpoints agence du Lot 2 déclenchent bien une tentative
// de synchronisation (Lot 3) sur leurs actions listées comme déclencheurs
// (voir CLAUDE.md) — et surtout qu'une panne Google NE BLOQUE JAMAIS la
// réponse ni n'annule l'écriture D1 déjà faite (best-effort réel, pas
// seulement documenté).

const test = require("node:test");
const assert = require("node:assert/strict");

const { makeAgencyEnv, loginAgency, agencyRequest } = require("./helpers/agency-session.js");
const { makeServiceAccountFixture } = require("./helpers/google-service-account-fixture.js");
const { handleAgencyClients } = require("../src/api/agency-clients.js");
const { handleAgencyRentals } = require("../src/api/agency-rentals.js");
const { handleAgencyPayments } = require("../src/api/agency-payments.js");
const { handleAgencyDeposits } = require("../src/api/agency-deposits.js");

function makeEnv() {
  const { keyJson } = makeServiceAccountFixture();
  return { ...makeAgencyEnv(), GOOGLE_SERVICE_ACCOUNT_KEY: keyJson, GOOGLE_SHEETS_SPREADSHEET_ID: "test-spreadsheet-id" };
}

function withGoogleAlwaysFailing(fn) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("oauth2.googleapis.com")) {
      return new Response(JSON.stringify({ access_token: "jeton-de-test", expires_in: 3600 }), { status: 200 });
    }
    throw new Error("Google Sheets indisponible (panne simulée)");
  };
  return Promise.resolve(fn()).finally(() => { globalThis.fetch = original; });
}

async function creerClientEtLocation(env, session) {
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

test("une panne Google Sheets ne fait jamais échouer la création d'une location (D1 reste la source fiable)", async () => {
  const env = makeEnv();
  const session = await loginAgency(env);

  const rental = await withGoogleAlwaysFailing(() => creerClientEtLocation(env, session));

  assert.ok(rental.id, "la location est bien créée en D1 malgré la panne Google");
  const outboxRow = [...env.AGENCY_DB._raw.sheet_sync_outbox.values()].find((r) => r.rental_id === rental.id);
  assert.equal(outboxRow.status, "error", "la tentative échouée reste tracée pour relance");
});

test("l'ajout d'un paiement et une action caution déclenchent aussi une tentative de synchronisation", async () => {
  const env = makeEnv();
  const session = await loginAgency(env);
  const rental = await withGoogleAlwaysFailing(() => creerClientEtLocation(env, session));

  await withGoogleAlwaysFailing(() =>
    handleAgencyPayments(
      agencyRequest("https://getlocation.fr/api/agency-payments", { method: "POST", session, body: { action: "add", rentalId: rental.id, data: { amount: 50, method: "carte" } } }),
      env
    )
  );
  await withGoogleAlwaysFailing(() =>
    handleAgencyDeposits(
      agencyRequest("https://getlocation.fr/api/agency-deposits", { method: "POST", session, body: { action: "create", rentalId: rental.id, data: { amount: 500, method: "carte" } } }),
      env
    )
  );

  const outboxRow = [...env.AGENCY_DB._raw.sheet_sync_outbox.values()].find((r) => r.rental_id === rental.id);
  assert.ok(outboxRow.attempt_count >= 3, "création + paiement + caution ont chacun tenté une synchronisation");

  const events = env.AGENCY_DB._raw.auditLog.filter((e) => e.event_type === "sheet_sync_failed" && e.entity_id === rental.id);
  assert.ok(events.length >= 3);
});
