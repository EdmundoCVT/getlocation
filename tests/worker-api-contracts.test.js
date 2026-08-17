// tests/worker-api-contracts.test.js
//
// Tests de src/api/contracts-create.js, src/api/contracts-list.js et
// src/api/contracts-update.js. Même style que
// tests/worker-reservation-status.test.js.

const test = require("node:test");
const assert = require("node:assert/strict");

const { createFakeKv } = require("./helpers/fake-kv.js");
const { handleCreateContract } = require("../src/api/contracts-create.js");
const { handleListContracts } = require("../src/api/contracts-list.js");
const { handleUpdateContract } = require("../src/api/contracts-update.js");

function makeEnv() {
  return { CONTRACTS_KV: createFakeKv(), RATE_LIMITS_KV: createFakeKv() };
}

let ipCounter = 0;
function makePostRequest(url, body, headers = {}) {
  ipCounter += 1;
  return new Request(url, {
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

function creerContrat(env, override = {}) {
  return handleCreateContract(
    makePostRequest("https://getlocation.fr/api/contracts-create", { rawData: { ...rawDataValide, ...override } }),
    env
  );
}

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
  const res = await handleCreateContract(
    makePostRequest("https://getlocation.fr/api/contracts-create", { rawData: { vehiculeId: "opel-corsa" } }),
    makeEnv()
  );
  assert.equal(res.status, 400);
});

test("handleCreateContract : cas nominal renvoie un numéro GL-AAAAMMJJ-NNNN", async () => {
  const res = await creerContrat(makeEnv());
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
  await creerContrat(env, { nom: "Premier" });
  await creerContrat(env, { nom: "Second" });

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

test("handleUpdateContract : rejette les méthodes autres que POST/OPTIONS", async () => {
  const res = await handleUpdateContract(new Request("https://getlocation.fr/api/contracts-update", { method: "GET" }), makeEnv());
  assert.equal(res.status, 405);
});

test("handleUpdateContract : rejette un numéro mal formé", async () => {
  const res = await handleUpdateContract(
    makePostRequest("https://getlocation.fr/api/contracts-update", { numero: "pas-un-numero", rawData: rawDataValide }),
    makeEnv()
  );
  assert.equal(res.status, 400);
});

test("handleUpdateContract : renvoie 404 si le contrat n'existe pas", async () => {
  const res = await handleUpdateContract(
    makePostRequest("https://getlocation.fr/api/contracts-update", { numero: "GL-20260817-0001", rawData: rawDataValide }),
    makeEnv()
  );
  assert.equal(res.status, 404);
});

test("handleUpdateContract : met à jour en place (même numéro, même createdAt), kilométrage retour ajouté", async () => {
  const env = makeEnv();
  const creation = await creerContrat(env, { kmDepart: "42150" });
  const { numero } = await creation.json();

  const avantListe = await (await handleListContracts(makeGetRequest(), env)).json();
  const createdAtOrigine = avantListe.contracts[0].createdAt;

  const res = await handleUpdateContract(
    makePostRequest("https://getlocation.fr/api/contracts-update", {
      numero,
      rawData: { ...rawDataValide, kmDepart: "42150", kmRetour: "42736" }
    }),
    env
  );
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.numero, numero);

  const apresListe = await (await handleListContracts(makeGetRequest(), env)).json();
  assert.equal(apresListe.contracts.length, 1, "aucun contrat supplémentaire créé");
  assert.equal(apresListe.contracts[0].numero, numero);
  assert.equal(apresListe.contracts[0].createdAt, createdAtOrigine, "createdAt d'origine conservé");
  assert.equal(apresListe.contracts[0].rawData.kmRetour, "42736");
});
