// tests/worker-contract-agency-link.test.js
//
// src/api/contract-agency-link.js — réémet le lien AGENCE (#agencyToken=)
// d'une réservation payée, pour ne plus dépendre de retrouver l'e-mail
// envoyé une seule fois au moment du paiement (même besoin que
// contract-manual-link.js pour les contrats manuels, voir
// tests/worker-contract-manual-link.test.js dont ce fichier reprend les
// conventions : session agence + CSRF, réémission qui invalide l'ancien
// jeton).

const test = require("node:test");
const assert = require("node:assert/strict");

const { createFakeKv } = require("./helpers/fake-kv.js");
const { createFakeD1 } = require("./helpers/fake-d1.js");
const { createReservation, updateReservationStatus } = require("../src/lib/reservation-store.js");
const { handleContractAgencyLink } = require("../src/api/contract-agency-link.js");
const { handleContractDossierAgency } = require("../src/api/contract-dossier-agency.js");
const { handleAgencyLogin } = require("../src/api/agency-login.js");

const PEPPER = "pepper-de-test-lien-agence";

function makeEnv() {
  return {
    RESERVATIONS_KV: createFakeKv(),
    RATE_LIMITS_KV: createFakeKv(),
    AGENCY_DB: createFakeD1(),
    AGENCY_AUTH_PEPPER: "pepper-de-test-agence",
    AGENCY_CODE_EDMUNDO: "code-edmundo-1234",
    AGENCY_CODE_ANTONIO: "code-antonio-5678",
    DOCUMENT_TOKEN_PEPPER: PEPPER
  };
}

let ipCounter = 0;
function nextIp() {
  ipCounter += 1;
  return `198.51.100.${ipCounter % 250}`;
}

async function loginAgency(env, code) {
  const res = await handleAgencyLogin(
    new Request("https://getlocation.fr/api/agency-login", {
      method: "POST",
      headers: { origin: "https://getlocation.fr", "cf-connecting-ip": nextIp(), "content-type": "application/json" },
      body: JSON.stringify({ code: code || "code-edmundo-1234" })
    }),
    env
  );
  const json = await res.json();
  const cookie = /agency_session=([^;]+)/.exec(res.headers.get("set-cookie"))[1];
  return { cookie, csrfToken: json.csrfToken };
}

function makePostRequest(url, body, session) {
  const headers = { origin: "https://getlocation.fr", "cf-connecting-ip": nextIp(), "content-type": "application/json" };
  if (session) {
    headers.cookie = `agency_session=${session.cookie}`;
    headers["x-agency-csrf"] = session.csrfToken;
  }
  return new Request(url, { method: "POST", headers, body: JSON.stringify(body) });
}

function agencyGet(token) {
  return new Request("https://getlocation.fr/api/contract-dossier-agency", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, "cf-connecting-ip": nextIp() }
  });
}

async function creerReservationPayee(env, overrides = {}) {
  const reservation = await createReservation(env, {
    vehiculeId: "opel-corsa",
    dateDebut: "2026-09-01",
    heureDebut: "10:00",
    dateFin: "2026-09-04",
    heureFin: "10:00",
    periodeDebut: "2026-09-01T10:00:00.000Z",
    periodeFin: "2026-09-04T10:00:00.000Z",
    total: 177,
    options: [],
    conducteur: { nom: "David", prenom: "Claire", email: "claire@example.com", telephone: "0601020304", naissance: "1986-12-19" },
    ...overrides
  });
  await updateReservationStatus(env, reservation.id, "paid", { paidAt: new Date().toISOString() });
  return reservation.id;
}

function extractAgencyToken(agencyUrl) {
  return new URLSearchParams(new URL(agencyUrl).hash.slice(1)).get("agencyToken");
}

test("POST : rejette les méthodes autres que POST/OPTIONS", async () => {
  const res = await handleContractAgencyLink(new Request("https://getlocation.fr/api/contract-agency-link", { method: "GET" }), makeEnv());
  assert.equal(res.status, 405);
});

test("POST : 401 sans session agence", async () => {
  const env = makeEnv();
  const id = await creerReservationPayee(env);
  const res = await handleContractAgencyLink(
    new Request("https://getlocation.fr/api/contract-agency-link", {
      method: "POST",
      headers: { origin: "https://getlocation.fr", "content-type": "application/json", "cf-connecting-ip": nextIp() },
      body: JSON.stringify({ id })
    }),
    env
  );
  assert.equal(res.status, 401);
});

test("POST : rejette un id mal formé", async () => {
  const env = makeEnv();
  const session = await loginAgency(env);
  const res = await handleContractAgencyLink(makePostRequest("https://getlocation.fr/api/contract-agency-link", { id: "pas-un-id" }, session), env);
  assert.equal(res.status, 400);
});

test("POST : 404 si la réservation n'existe pas", async () => {
  const env = makeEnv();
  const session = await loginAgency(env);
  const res = await handleContractAgencyLink(
    makePostRequest("https://getlocation.fr/api/contract-agency-link", { id: "res_" + "0".repeat(32) }, session),
    env
  );
  assert.equal(res.status, 404);
});

test("POST : 404 si la réservation n'est pas payée (jamais de dossier agence pour une réservation en attente)", async () => {
  const env = makeEnv();
  const session = await loginAgency(env);
  const reservation = await createReservation(env, { vehiculeId: "opel-corsa" }); // reste "pending_payment"
  const res = await handleContractAgencyLink(makePostRequest("https://getlocation.fr/api/contract-agency-link", { id: reservation.id }, session), env);
  assert.equal(res.status, 404);
});

test("POST : Antonio (comme Edmundo) peut réémettre le lien — les deux opérateurs ont accès", async () => {
  const env = makeEnv();
  const session = await loginAgency(env, "code-antonio-5678");
  const id = await creerReservationPayee(env);
  const res = await handleContractAgencyLink(makePostRequest("https://getlocation.fr/api/contract-agency-link", { id }, session), env);
  assert.equal(res.status, 200);
});

test("POST : cas nominal renvoie une URL avec le jeton en FRAGMENT (#agencyToken=), jamais en paramètre de requête, qui ouvre bien le dossier", async () => {
  const env = makeEnv();
  const session = await loginAgency(env);
  const id = await creerReservationPayee(env);

  const res = await handleContractAgencyLink(makePostRequest("https://getlocation.fr/api/contract-agency-link", { id }, session), env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.match(body.agencyUrl, /^https:\/\/getlocation\.fr\/contrat\.html#agencyToken=[A-Za-z0-9_-]{43}$/);
  assert.equal(body.agencyUrl.includes("?agencyToken="), false);

  const token = extractAgencyToken(body.agencyUrl);
  const dossier = await handleContractDossierAgency(agencyGet(token), env);
  assert.equal(dossier.status, 200);
  const dossierBody = await dossier.json();
  assert.equal(dossierBody.reservation.conducteur.nom, "David");
  assert.equal(dossierBody.reservation.conducteur.prenom, "Claire");
});

test("POST : réémettre invalide l'ancien jeton (plus jamais reconstructible depuis l'historique, donc une réémission systématique)", async () => {
  const env = makeEnv();
  const session = await loginAgency(env);
  const id = await creerReservationPayee(env);

  const premiere = await (await handleContractAgencyLink(makePostRequest("https://getlocation.fr/api/contract-agency-link", { id }, session), env)).json();
  const ancienToken = extractAgencyToken(premiere.agencyUrl);

  await handleContractAgencyLink(makePostRequest("https://getlocation.fr/api/contract-agency-link", { id }, session), env);

  const res = await handleContractDossierAgency(agencyGet(ancienToken), env);
  assert.equal(res.status, 401);
});
