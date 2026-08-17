// tests/worker-api-contracts-manual.test.js
//
// Tests de src/api/contracts-manual-create.js, contracts-manual-update.js
// et contracts-history.js. Même style que tests/worker-api-validate-promo
// / tests/worker-reservation-status.test.js.

const test = require("node:test");
const assert = require("node:assert/strict");

const { createFakeKv } = require("./helpers/fake-kv.js");
const { handleContractsManualCreate } = require("../src/api/contracts-manual-create.js");
const { handleContractsManualUpdate } = require("../src/api/contracts-manual-update.js");
const { handleContractsHistory } = require("../src/api/contracts-history.js");

function makeEnv() {
  return { RESERVATIONS_KV: createFakeKv(), RATE_LIMITS_KV: createFakeKv() };
}

let ipCounter = 0;
function makePostRequest(url, body) {
  ipCounter += 1;
  return new Request(url, {
    method: "POST",
    headers: { origin: "https://getlocation.fr", "cf-connecting-ip": `198.51.100.${ipCounter}`, "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}
function makeGetRequest(url) {
  ipCounter += 1;
  return new Request(url, {
    method: "GET",
    headers: { origin: "https://getlocation.fr", "cf-connecting-ip": `198.51.100.${ipCounter}` }
  });
}

const rawDataValide = {
  vehiculeId: "opel-corsa",
  immat: "HJ-967-KQ",
  depart: "2026-08-13T10:00",
  retour: "2026-08-15T10:00",
  nom: "Benzaama",
  prenom: "Israa"
};

function creerContrat(env, override = {}) {
  return handleContractsManualCreate(
    makePostRequest("https://getlocation.fr/api/contracts-manual-create", { rawData: { ...rawDataValide, ...override } }),
    env
  );
}

test("handleContractsManualCreate : rejette les méthodes autres que POST/OPTIONS", async () => {
  const res = await handleContractsManualCreate(new Request("https://getlocation.fr/api/contracts-manual-create", { method: "GET" }), makeEnv());
  assert.equal(res.status, 405);
});

test("handleContractsManualCreate : rejette des champs requis manquants", async () => {
  const res = await handleContractsManualCreate(
    makePostRequest("https://getlocation.fr/api/contracts-manual-create", { rawData: { vehiculeId: "opel-corsa" } }),
    makeEnv()
  );
  assert.equal(res.status, 400);
});

test("handleContractsManualCreate : cas nominal renvoie un id et un numéro", async () => {
  const res = await creerContrat(makeEnv());
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.match(json.id, /^res_[a-f0-9]{32}$/);
  assert.match(json.numero, /^GL-\d{8}-\d{4}$/);
});

test("handleContractsManualUpdate : rejette les méthodes autres que POST/OPTIONS", async () => {
  const res = await handleContractsManualUpdate(new Request("https://getlocation.fr/api/contracts-manual-update", { method: "GET" }), makeEnv());
  assert.equal(res.status, 405);
});

test("handleContractsManualUpdate : rejette un id mal formé", async () => {
  const res = await handleContractsManualUpdate(
    makePostRequest("https://getlocation.fr/api/contracts-manual-update", { id: "pas-un-id", rawData: rawDataValide }),
    makeEnv()
  );
  assert.equal(res.status, 400);
});

test("handleContractsManualUpdate : renvoie 404 si le contrat n'existe pas", async () => {
  const res = await handleContractsManualUpdate(
    makePostRequest("https://getlocation.fr/api/contracts-manual-update", { id: "res_" + "0".repeat(32), rawData: rawDataValide }),
    makeEnv()
  );
  assert.equal(res.status, 404);
});

test("handleContractsManualUpdate : met à jour en place (même numéro), aucun doublon", async () => {
  const env = makeEnv();
  const creation = await creerContrat(env, { kmDepart: "42150" });
  const { id, numero } = await creation.json();

  const res = await handleContractsManualUpdate(
    makePostRequest("https://getlocation.fr/api/contracts-manual-update", {
      id,
      rawData: { ...rawDataValide, kmDepart: "42150", kmRetour: "42736" }
    }),
    env
  );
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.numero, numero);

  const liste = await (await handleContractsHistory(makeGetRequest("https://getlocation.fr/api/contracts-history"), env)).json();
  assert.equal(liste.contracts.length, 1, "aucun contrat supplémentaire créé");
  assert.equal(liste.contracts[0].rawData.kmRetour, "42736");
});

test("handleContractsHistory : rejette les méthodes autres que GET/OPTIONS", async () => {
  const res = await handleContractsHistory(new Request("https://getlocation.fr/api/contracts-history", { method: "POST" }), makeEnv());
  assert.equal(res.status, 405);
});

test("handleContractsHistory : liste vide si aucun contrat", async () => {
  const res = await handleContractsHistory(makeGetRequest("https://getlocation.fr/api/contracts-history"), makeEnv());
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.deepEqual(json.contracts, []);
});

test("handleContractsHistory : renvoie les contrats manuels créés, du plus récent au plus ancien", async () => {
  const env = makeEnv();
  await creerContrat(env, { nom: "Premier" });
  await creerContrat(env, { nom: "Second" });

  const res = await handleContractsHistory(makeGetRequest("https://getlocation.fr/api/contracts-history"), env);
  const json = await res.json();
  assert.equal(json.contracts.length, 2);
  assert.equal(json.contracts[0].rawData.nom, "Second");
  assert.equal(json.contracts[1].rawData.nom, "Premier");
});
