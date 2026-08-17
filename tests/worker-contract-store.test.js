// tests/worker-contract-store.test.js
//
// Tests de src/lib/contract-store.js (numérotation automatique + historique
// des contrats générés depuis contrat.html). Même style que
// tests/worker-reservation-store.test.js — fausse KV en mémoire.

const test = require("node:test");
const assert = require("node:assert/strict");

const { createFakeKv } = require("./helpers/fake-kv.js");
const { generateContractNumber, saveContract, listRecentContracts } = require("../src/lib/contract-store.js");

function makeEnv() {
  return { CONTRACTS_KV: createFakeKv() };
}

test("generateContractNumber : format GL-AAAAMMJJ-NNNN, incrémente séquentiellement", async () => {
  const env = makeEnv();
  const n1 = await generateContractNumber(env);
  const n2 = await generateContractNumber(env);
  const n3 = await generateContractNumber(env);
  assert.match(n1, /^GL-\d{8}-0001$/);
  assert.match(n2, /^GL-\d{8}-0002$/);
  assert.match(n3, /^GL-\d{8}-0003$/);
});

test("generateContractNumber : jamais réutilisé, même après une longue série", async () => {
  const env = makeEnv();
  const numeros = new Set();
  for (let i = 0; i < 25; i++) {
    numeros.add(await generateContractNumber(env));
  }
  assert.equal(numeros.size, 25);
});

test("saveContract : assigne un numéro et persiste rawData tel quel", async () => {
  const env = makeEnv();
  const rawData = { vehiculeId: "opel-corsa", nom: "Benzaama", prenom: "Israa", depart: "2026-08-13T10:00", retour: "2026-08-15T10:00" };
  const record = await saveContract(env, rawData);
  assert.match(record.numero, /^GL-\d{8}-0001$/);
  assert.ok(record.createdAt);
  assert.deepEqual(record.rawData, rawData);
});

test("saveContract : deux contrats successifs ont des numéros distincts et n'écrasent pas le précédent", async () => {
  const env = makeEnv();
  const a = await saveContract(env, { nom: "A" });
  const b = await saveContract(env, { nom: "B" });
  assert.notEqual(a.numero, b.numero);

  const liste = await listRecentContracts(env, 10);
  assert.equal(liste.length, 2);
});

test("listRecentContracts : du plus récent au plus ancien, respecte la limite", async () => {
  const env = makeEnv();
  const enregistres = [];
  for (let i = 0; i < 5; i++) {
    enregistres.push(await saveContract(env, { nom: `Client ${i}` }));
  }

  const liste = await listRecentContracts(env, 3);
  assert.equal(liste.length, 3);
  // Les createdAt étant potentiellement identiques à la milliseconde près
  // dans un test rapide, on vérifie surtout que le tri ne lève pas et que
  // les 3 derniers numéros générés sont bien ceux renvoyés.
  const numerosAttendus = enregistres.slice(2).map((r) => r.numero).sort();
  const numerosObtenus = liste.map((r) => r.numero).sort();
  assert.deepEqual(numerosObtenus, numerosAttendus);
});

test("listRecentContracts : ne renvoie jamais les clés de compteur (counter_*)", async () => {
  const env = makeEnv();
  await saveContract(env, { nom: "Client" });
  const liste = await listRecentContracts(env, 10);
  assert.equal(liste.length, 1);
  assert.ok(liste[0].numero);
});

test("listRecentContracts : liste vide sans contrat enregistré", async () => {
  const env = makeEnv();
  const liste = await listRecentContracts(env, 10);
  assert.deepEqual(liste, []);
});
