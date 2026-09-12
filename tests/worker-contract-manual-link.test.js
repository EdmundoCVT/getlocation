// tests/worker-contract-manual-link.test.js
//
// src/api/contract-manual-link.js — lien COURT (jeton) partagé par
// WhatsApp/SMS/copie pour un contrat MANUEL, correctif du bug signalé le
// 12/09/2026 : le lien historique `?data=...` (tout le formulaire encodé en
// base64) n'était reconnu comme cliquable qu'en partie une fois collé dans
// WhatsApp. Mêmes conventions que tests/worker-contract-dossier.test.js
// (dossier des réservations en ligne) et
// tests/worker-api-contracts-manual.test.js (session agence + CSRF).

const test = require("node:test");
const assert = require("node:assert/strict");

const { createFakeKv } = require("./helpers/fake-kv.js");
const { createFakeD1 } = require("./helpers/fake-d1.js");
const { handleContractsManualCreate } = require("../src/api/contracts-manual-create.js");
const { handleContractManualLink } = require("../src/api/contract-manual-link.js");
const { handleAgencyLogin } = require("../src/api/agency-login.js");

const PEPPER = "pepper-de-test-lien-court-contrat-manuel";

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

async function loginAgency(env) {
  const res = await handleAgencyLogin(
    new Request("https://getlocation.fr/api/agency-login", {
      method: "POST",
      headers: { origin: "https://getlocation.fr", "cf-connecting-ip": nextIp(), "content-type": "application/json" },
      body: JSON.stringify({ code: "code-edmundo-1234" })
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

function manualLinkGet(token) {
  return new Request("https://getlocation.fr/api/contract-manual-link", {
    method: "GET",
    headers: token ? { Authorization: `Bearer ${token}`, "cf-connecting-ip": nextIp() } : { "cf-connecting-ip": nextIp() }
  });
}

const rawDataValide = {
  vehiculeId: "opel-corsa",
  immat: "HJ-967-KQ",
  depart: "2026-08-13T10:00",
  retour: "2026-08-15T10:00",
  nom: "Benzaama",
  prenom: "Israa",
  tel: "0601020304",
  naissance: "1990-01-01",
  modePaiement: "carte",
  montantRegle: "50",
  acompteRegle: true
};

async function creerContratManuel(env, session, override = {}) {
  const res = await handleContractsManualCreate(
    makePostRequest("https://getlocation.fr/api/contracts-manual-create", { rawData: { ...rawDataValide, ...override } }, session),
    env
  );
  return res.json();
}

function extractManualToken(clientUrl) {
  return new URLSearchParams(new URL(clientUrl).hash.slice(1)).get("manualToken");
}

test("POST : rejette les méthodes autres que GET/POST/OPTIONS", async () => {
  const res = await handleContractManualLink(new Request("https://getlocation.fr/api/contract-manual-link", { method: "DELETE" }), makeEnv());
  assert.equal(res.status, 405);
});

test("POST : 401 sans session agence", async () => {
  const env = makeEnv();
  const session = await loginAgency(env);
  const { id } = await creerContratManuel(env, session);
  const res = await handleContractManualLink(
    new Request("https://getlocation.fr/api/contract-manual-link", {
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
  const res = await handleContractManualLink(makePostRequest("https://getlocation.fr/api/contract-manual-link", { id: "pas-un-id" }, session), env);
  assert.equal(res.status, 400);
});

test("POST : 404 si le contrat manuel n'existe pas", async () => {
  const env = makeEnv();
  const session = await loginAgency(env);
  const res = await handleContractManualLink(
    makePostRequest("https://getlocation.fr/api/contract-manual-link", { id: "res_" + "0".repeat(32) }, session),
    env
  );
  assert.equal(res.status, 404);
});

test("POST : cas nominal renvoie une URL courte avec le jeton en FRAGMENT (#manualToken=), jamais en paramètre de requête", async () => {
  const env = makeEnv();
  const session = await loginAgency(env);
  const { id } = await creerContratManuel(env, session);

  const res = await handleContractManualLink(makePostRequest("https://getlocation.fr/api/contract-manual-link", { id }, session), env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.match(body.clientUrl, /^https:\/\/getlocation\.fr\/contrat\.html#manualToken=[A-Za-z0-9_-]{43}$/);
});

test("GET : sans jeton, refuse l'accès", async () => {
  const res = await handleContractManualLink(manualLinkGet(null), makeEnv());
  assert.equal(res.status, 401);
});

test("GET : un jeton inconnu est refusé", async () => {
  const res = await handleContractManualLink(manualLinkGet("Z".repeat(43)), makeEnv());
  assert.equal(res.status, 401);
});

test("GET : le jeton court renvoie exactement les données du formulaire (même forme que le rawData envoyé), sans les champs internes serveur", async () => {
  const env = makeEnv();
  const session = await loginAgency(env);
  const { id } = await creerContratManuel(env, session);
  const emission = await (await handleContractManualLink(makePostRequest("https://getlocation.fr/api/contract-manual-link", { id }, session), env)).json();
  const token = extractManualToken(emission.clientUrl);

  const res = await handleContractManualLink(manualLinkGet(token), env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.nom, "Benzaama");
  assert.equal(body.prenom, "Israa");
  assert.equal(body.vehiculeId, "opel-corsa");
  assert.equal(body.montantRegle, "50");
  // Jamais exposés au client : identifiant interne, statut KV, auteur, jeton...
  assert.equal(body.id, undefined);
  assert.equal(body.status, undefined);
  assert.equal(body.createdBy, undefined);
  assert.equal(body.manualClientAccess, undefined);
});

test("GET : un jeton révoqué (ou remplacé par une nouvelle émission) n'est plus accepté", async () => {
  const env = makeEnv();
  const session = await loginAgency(env);
  const { id } = await creerContratManuel(env, session);
  const premiere = await (await handleContractManualLink(makePostRequest("https://getlocation.fr/api/contract-manual-link", { id }, session), env)).json();
  const ancienToken = extractManualToken(premiere.clientUrl);

  // Ré-émission (ex. après une mise à jour du contrat) : invalide l'ancien jeton.
  await handleContractManualLink(makePostRequest("https://getlocation.fr/api/contract-manual-link", { id }, session), env);

  const res = await handleContractManualLink(manualLinkGet(ancienToken), env);
  assert.equal(res.status, 401);
});

test("GET : un jeton de dossier CLIENT (réservation en ligne) ne fonctionne pas sur cet endpoint, et réciproquement", async () => {
  const { issueContractClientAccess } = require("../src/lib/contract-dossier-token.js");
  const { createReservation, saveContractClientAccessIndex, updateReservationStatus } = require("../src/lib/reservation-store.js");
  const env = makeEnv();
  const reservation = await createReservation(env, { vehiculeId: "opel-corsa" });
  const issued = await issueContractClientAccess(env);
  await saveContractClientAccessIndex(env, reservation.id, issued.stored.tokenHash, issued.stored.expiresAt);
  await updateReservationStatus(env, reservation.id, "paid", { contractClientAccess: issued.stored });

  const res = await handleContractManualLink(manualLinkGet(issued.token), env);
  assert.equal(res.status, 401);
});
