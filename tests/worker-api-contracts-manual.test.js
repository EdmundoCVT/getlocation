// tests/worker-api-contracts-manual.test.js
//
// Tests de src/api/contracts-manual-create.js, contracts-manual-update.js
// et contracts-history.js. Depuis le Lot 1 (voir CLAUDE.md), ces 3
// endpoints exigent une session agence valide (Edmundo/Antonio) — chaque
// requête d'écriture/lecture ci-dessous passe donc par loginAgency() pour
// obtenir un cookie de session + un jeton CSRF avant d'appeler l'endpoint.

const test = require("node:test");
const assert = require("node:assert/strict");

const { createFakeKv } = require("./helpers/fake-kv.js");
const { createFakeD1 } = require("./helpers/fake-d1.js");
const { handleContractsManualCreate } = require("../src/api/contracts-manual-create.js");
const { handleContractsManualUpdate } = require("../src/api/contracts-manual-update.js");
const { handleContractsHistory } = require("../src/api/contracts-history.js");
const { handleAgencyLogin } = require("../src/api/agency-login.js");

function makeEnv() {
  return {
    RESERVATIONS_KV: createFakeKv(),
    RATE_LIMITS_KV: createFakeKv(),
    AGENCY_DB: createFakeD1(),
    AGENCY_AUTH_PEPPER: "pepper-de-test-agence",
    AGENCY_CODE_EDMUNDO: "code-edmundo-1234",
    AGENCY_CODE_ANTONIO: "code-antonio-5678"
  };
}

let ipCounter = 0;
function nextIp() {
  ipCounter += 1;
  return `198.51.100.${ipCounter}`;
}

// Connecte "Edmundo" sur cet env et renvoie { cookie, csrfToken } à réutiliser
// dans les requêtes suivantes (même principe que le navigateur : cookie de
// session + en-tête X-Agency-Csrf sur les écritures).
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
function makeGetRequest(url, session) {
  const headers = { origin: "https://getlocation.fr", "cf-connecting-ip": nextIp() };
  if (session) headers.cookie = `agency_session=${session.cookie}`;
  return new Request(url, { method: "GET", headers });
}

const rawDataValide = {
  vehiculeId: "opel-corsa",
  immat: "HJ-967-KQ",
  depart: "2026-08-13T10:00",
  retour: "2026-08-15T10:00",
  nom: "Benzaama",
  prenom: "Israa"
};

function creerContrat(env, session, override = {}) {
  return handleContractsManualCreate(
    makePostRequest("https://getlocation.fr/api/contracts-manual-create", { rawData: { ...rawDataValide, ...override } }, session),
    env
  );
}

test("handleContractsManualCreate : rejette les méthodes autres que POST/OPTIONS", async () => {
  const res = await handleContractsManualCreate(new Request("https://getlocation.fr/api/contracts-manual-create", { method: "GET" }), makeEnv());
  assert.equal(res.status, 405);
});

test("handleContractsManualCreate : 401 sans session agence (Lot 1)", async () => {
  const res = await creerContrat(makeEnv(), null);
  assert.equal(res.status, 401);
});

test("handleContractsManualCreate : 403 si le jeton CSRF est absent, même avec une session valide", async () => {
  const env = makeEnv();
  const session = await loginAgency(env);
  const res = await handleContractsManualCreate(
    new Request("https://getlocation.fr/api/contracts-manual-create", {
      method: "POST",
      headers: { origin: "https://getlocation.fr", "content-type": "application/json", cookie: `agency_session=${session.cookie}` },
      body: JSON.stringify({ rawData: rawDataValide })
    }),
    env
  );
  assert.equal(res.status, 403);
});

test("handleContractsManualCreate : rejette des champs requis manquants", async () => {
  const env = makeEnv();
  const session = await loginAgency(env);
  const res = await handleContractsManualCreate(
    makePostRequest("https://getlocation.fr/api/contracts-manual-create", { rawData: { vehiculeId: "opel-corsa" } }, session),
    env
  );
  assert.equal(res.status, 400);
});

test("handleContractsManualCreate : cas nominal renvoie un id et un numéro, et enregistre createdBy depuis la session", async () => {
  const env = makeEnv();
  const session = await loginAgency(env);
  const res = await creerContrat(env, session);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.match(json.id, /^res_[a-f0-9]{32}$/);
  assert.match(json.numero, /^GL-\d{8}-\d{4}$/);

  const liste = (await (await handleContractsHistory(makeGetRequest("https://getlocation.fr/api/contracts-history", session), env)).json()).contracts;
  assert.equal(liste[0].rawData.createdBy, "Edmundo");
});

test("handleContractsManualCreate : createdBy vient TOUJOURS de la session, jamais d'un champ du payload", async () => {
  const env = makeEnv();
  const session = await loginAgency(env);
  const res = await creerContrat(env, session, { createdBy: "Quelqu'un d'autre" });
  const json = await res.json();
  const liste = (await (await handleContractsHistory(makeGetRequest("https://getlocation.fr/api/contracts-history", session), env)).json()).contracts;
  const entry = liste.find((c) => c.id === json.id);
  assert.equal(entry.rawData.createdBy, "Edmundo");
});

test("handleContractsManualUpdate : rejette les méthodes autres que POST/OPTIONS", async () => {
  const res = await handleContractsManualUpdate(new Request("https://getlocation.fr/api/contracts-manual-update", { method: "GET" }), makeEnv());
  assert.equal(res.status, 405);
});

test("handleContractsManualUpdate : 401 sans session agence", async () => {
  const res = await handleContractsManualUpdate(
    makePostRequest("https://getlocation.fr/api/contracts-manual-update", { id: "res_" + "0".repeat(32), rawData: rawDataValide }, null),
    makeEnv()
  );
  assert.equal(res.status, 401);
});

test("handleContractsManualUpdate : rejette un id mal formé", async () => {
  const env = makeEnv();
  const session = await loginAgency(env);
  const res = await handleContractsManualUpdate(
    makePostRequest("https://getlocation.fr/api/contracts-manual-update", { id: "pas-un-id", rawData: rawDataValide }, session),
    env
  );
  assert.equal(res.status, 400);
});

test("handleContractsManualUpdate : renvoie 404 si le contrat n'existe pas", async () => {
  const env = makeEnv();
  const session = await loginAgency(env);
  const res = await handleContractsManualUpdate(
    makePostRequest("https://getlocation.fr/api/contracts-manual-update", { id: "res_" + "0".repeat(32), rawData: rawDataValide }, session),
    env
  );
  assert.equal(res.status, 404);
});

test("handleContractsManualUpdate : met à jour en place (même numéro), aucun doublon, updatedBy depuis la session", async () => {
  const env = makeEnv();
  const session = await loginAgency(env);
  const creation = await creerContrat(env, session, { kmDepart: "42150" });
  const { id, numero } = await creation.json();

  const res = await handleContractsManualUpdate(
    makePostRequest(
      "https://getlocation.fr/api/contracts-manual-update",
      { id, rawData: { ...rawDataValide, kmDepart: "42150", kmRetour: "42736" } },
      session
    ),
    env
  );
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.numero, numero);

  const liste = await (await handleContractsHistory(makeGetRequest("https://getlocation.fr/api/contracts-history", session), env)).json();
  assert.equal(liste.contracts.length, 1, "aucun contrat supplémentaire créé");
  assert.equal(liste.contracts[0].rawData.kmRetour, "42736");
  assert.equal(liste.contracts[0].rawData.createdBy, "Edmundo");
  assert.equal(liste.contracts[0].rawData.updatedBy, "Edmundo");
});

test("handleContractsHistory : rejette les méthodes autres que GET/OPTIONS", async () => {
  const res = await handleContractsHistory(new Request("https://getlocation.fr/api/contracts-history", { method: "POST" }), makeEnv());
  assert.equal(res.status, 405);
});

test("handleContractsHistory : 401 sans session agence", async () => {
  const res = await handleContractsHistory(makeGetRequest("https://getlocation.fr/api/contracts-history", null), makeEnv());
  assert.equal(res.status, 401);
});

test("handleContractsHistory : liste vide si aucun contrat", async () => {
  const env = makeEnv();
  const session = await loginAgency(env);
  const res = await handleContractsHistory(makeGetRequest("https://getlocation.fr/api/contracts-history", session), env);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.deepEqual(json.contracts, []);
});

test("handleContractsHistory : renvoie les contrats manuels créés, du plus récent au plus ancien", async () => {
  const env = makeEnv();
  const session = await loginAgency(env);
  await creerContrat(env, session, { nom: "Premier" });
  await creerContrat(env, session, { nom: "Second" });

  const res = await handleContractsHistory(makeGetRequest("https://getlocation.fr/api/contracts-history", session), env);
  const json = await res.json();
  assert.equal(json.contracts.length, 2);
  assert.equal(json.contracts[0].rawData.nom, "Second");
  assert.equal(json.contracts[1].rawData.nom, "Premier");
});
