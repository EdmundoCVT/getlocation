// tests/worker-api-contracts.test.js
//
// Tests de src/api/contracts-create.js et src/api/contracts-list.js. Même
// style que tests/worker-reservation-status.test.js.

const test = require("node:test");
const assert = require("node:assert/strict");

const { createFakeKv } = require("./helpers/fake-kv.js");
const { handleCreateContract } = require("../src/api/contracts-create.js");
const { handleListContracts } = require("../src/api/contracts-list.js");

function makeEnv() {
  return { CONTRACTS_KV: createFakeKv(), RATE_LIMITS_KV: createFakeKv() };
}

let ipCounter = 0;
function makePostRequest(body, headers = {}) {
  ipCounter += 1;
  return new Request("https://getlocation.fr/api/contracts-create", {
    method: "POST",
    headers: { origin: "https://getlocation.fr", "cf-connecting-ip": `198.51.100.${ipCounter}`, "content-type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
}
function makeGetRequest(headers = {}) {
  ipCounter += 1;
  return new Request("https://getlocation.fr/api/contracts-list", {
    method: "GET",
    headers: { origin: "https://getlocation.fr", "cf-connecting-ip": `198.51.100.${ipCounter}`, ...headers }
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

test("handleCreateContract : rejette les méthodes autres que POST/OPTIONS", async () => {
  const res = await handleCreateContract(new Request("https://getlocation.fr/api/contracts-create", { method: "GET" }), makeEnv());
  assert.equal(res.status, 405);
});

test("handleCreateContract : rejette un corps JSON invalide", async () => {
  const res = await handleCreateContract(
    new Request("https://getlocation.fr/api/contracts-create", { method: "POST", body: "{pas du json", headers: { "cf-connecting-ip": "198.51.100.9" } }),
    makeEnv()
  );
  assert.equal(res.status, 400);
});

test("handleCreateContract : rejette des champs requis manquants", async () => {
  const res = await handleCreateContract(makePostRequest({ vehiculeId: "opel-corsa" }), makeEnv());
  assert.equal(res.status, 400);
});

test("handleCreateContract : cas nominal renvoie un numéro GL-AAAAMMJJ-NNNN", async () => {
  const res = await handleCreateContract(makePostRequest(rawDataValide), makeEnv());
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.match(json.numero, /^GL-\d{8}-\d{4}$/);
  assert.ok(json.createdAt);
});

test("handleListContracts : rejette les méthodes autres que GET/OPTIONS", async () => {
  const res = await handleListContracts(new Request("https://getlocation.fr/api/contracts-list", { method: "POST" }), makeEnv());
  assert.equal(res.status, 405);
});

test("handleListContracts : renvoie les contrats créés, du plus récent au plus ancien", async () => {
  const env = makeEnv();
  await handleCreateContract(makePostRequest({ ...rawDataValide, nom: "Premier" }), env);
  await handleCreateContract(makePostRequest({ ...rawDataValide, nom: "Second" }), env);

  const res = await handleListContracts(makeGetRequest(), env);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.contracts.length, 2);
  assert.equal(json.contracts[0].rawData.nom, "Second");
  assert.equal(json.contracts[1].rawData.nom, "Premier");
});

test("handleListContracts : liste vide si aucun contrat", async () => {
  const res = await handleListContracts(makeGetRequest(), makeEnv());
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.deepEqual(json.contracts, []);
});
