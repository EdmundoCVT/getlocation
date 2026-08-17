// tests/worker-contracts-numero-historique.test.js
//
// Tests des ajouts à src/lib/reservation-store.js pour la numérotation
// automatique des contrats (GL-AAAAMMJJ-NNNN) et l'historique unifié
// (contrats manuels + dossiers de réservations payées en ligne). Même
// style que tests/worker-reservation-store.test.js.

const test = require("node:test");
const assert = require("node:assert/strict");

const { createFakeKv } = require("./helpers/fake-kv.js");
const {
  generateContractNumero,
  createManualContract,
  updateManualContract,
  listContractsHistory,
  createReservation,
  updateReservationStatus
} = require("../src/lib/reservation-store.js");

function makeEnv() {
  return { RESERVATIONS_KV: createFakeKv() };
}

const rawDataValide = {
  vehiculeId: "opel-corsa",
  immat: "HJ-967-KQ",
  depart: "2026-08-13T10:00",
  retour: "2026-08-15T10:00",
  nom: "Benzaama",
  prenom: "Israa"
};

test("generateContractNumero : format GL-AAAAMMJJ-NNNN, incrémente séquentiellement, jamais réutilisé", async () => {
  const env = makeEnv();
  const n1 = await generateContractNumero(env);
  const n2 = await generateContractNumero(env);
  assert.match(n1, /^GL-\d{8}-0001$/);
  assert.match(n2, /^GL-\d{8}-0002$/);
  assert.notEqual(n1, n2);
});

test("createManualContract : assigne un numéro, statut manual_contract dédié, jamais confondu avec une réservation", async () => {
  const env = makeEnv();
  const record = await createManualContract(env, rawDataValide);
  assert.match(record.contractNumero, /^GL-\d{8}-\d{4}$/);
  assert.equal(record.status, "manual_contract");
  assert.match(record.id, /^res_[a-f0-9]{32}$/);
  assert.ok(record.createdAt);
});

test("createManualContract : stocké sans TTL (document commercial à conserver)", async () => {
  const env = makeEnv();
  const record = await createManualContract(env, rawDataValide);
  // La fausse KV lève une exception si expirationTtl est fourni et < 60s ;
  // ici on vérifie indirectement l'absence de TTL en inspectant le stockage
  // interne (voir tests/helpers/fake-kv.js, `_raw`).
  const entry = env.RESERVATIONS_KV._raw.get(record.id);
  assert.equal(entry.expiresAt, null);
});

test("updateManualContract : met à jour en place (même id, même numéro, même createdAt)", async () => {
  const env = makeEnv();
  const cree = await createManualContract(env, rawDataValide);
  const maj = await updateManualContract(env, cree.id, { ...rawDataValide, kmDepart: "42150", kmRetour: "42736" });

  assert.equal(maj.id, cree.id);
  assert.equal(maj.contractNumero, cree.contractNumero);
  assert.equal(maj.createdAt, cree.createdAt);
  assert.equal(maj.kmRetour, "42736");

  const historique = await listContractsHistory(env, 10);
  assert.equal(historique.length, 1, "la mise à jour ne doit jamais créer un second contrat");
});

test("updateManualContract : id introuvable renvoie null (pas de crash)", async () => {
  const env = makeEnv();
  const result = await updateManualContract(env, "res_" + "0".repeat(32), rawDataValide);
  assert.equal(result, null);
});

test("updateManualContract : refuse de modifier une réservation en ligne (mauvais statut)", async () => {
  const env = makeEnv();
  const reservation = await createReservation(env, { vehiculeId: "opel-corsa" });
  const result = await updateManualContract(env, reservation.id, rawDataValide);
  assert.equal(result, null);
});

test("listContractsHistory : ignore les réservations sans contractNumero (jamais payées)", async () => {
  const env = makeEnv();
  await createReservation(env, { vehiculeId: "opel-corsa" }); // pending_payment, pas de numéro
  const historique = await listContractsHistory(env, 10);
  assert.deepEqual(historique, []);
});

test("listContractsHistory : contrat manuel — vue complète (rawData) pour Ouvrir/Dupliquer", async () => {
  const env = makeEnv();
  const cree = await createManualContract(env, rawDataValide);
  const historique = await listContractsHistory(env, 10);

  assert.equal(historique.length, 1);
  assert.equal(historique[0].origine, "manuel");
  assert.equal(historique[0].numero, cree.contractNumero);
  assert.equal(historique[0].rawData.nom, "Benzaama");
});

test("listContractsHistory : réservation payée — vue minimale seulement (jamais permis/naissance/téléphone/adresse)", async () => {
  const env = makeEnv();
  const reservation = await createReservation(env, {
    vehiculeId: "peugeot-3008",
    dateDebut: "2026-08-01",
    heureDebut: "10:00",
    conducteur: { nom: "Dupont", prenom: "Jean", telephone: "0601020304", naissance: "1990-01-01", email: "jean@example.com" }
  });
  const numero = await generateContractNumero(env);
  await updateReservationStatus(env, reservation.id, "paid", { contractNumero: numero });

  const historique = await listContractsHistory(env, 10);
  assert.equal(historique.length, 1);
  const entry = historique[0];
  assert.equal(entry.origine, "reservation");
  assert.equal(entry.numero, numero);
  assert.equal(entry.resume.nom, "Dupont");
  assert.equal(entry.resume.prenom, "Jean");
  assert.equal(entry.resume.vehiculeId, "peugeot-3008");

  // Aucune donnée sensible au-delà du nom : ni dans `resume`, ni ailleurs
  // dans l'entrée renvoyée par l'historique.
  assert.equal("rawData" in entry, false);
  const serialise = JSON.stringify(entry);
  assert.equal(serialise.includes("0601020304"), false);
  assert.equal(serialise.includes("1990-01-01"), false);
  assert.equal(serialise.includes("jean@example.com"), false);
});

test("listContractsHistory : historique unifié, tri par numéro décroissant, contrats manuels et en ligne mélangés", async () => {
  const env = makeEnv();
  const manuel = await createManualContract(env, { ...rawDataValide, nom: "Manuel" });
  const reservation = await createReservation(env, { vehiculeId: "opel-corsa", conducteur: { nom: "EnLigne", prenom: "Client" } });
  const numeroReservation = await generateContractNumero(env);
  await updateReservationStatus(env, reservation.id, "paid", { contractNumero: numeroReservation });

  const historique = await listContractsHistory(env, 10);
  assert.equal(historique.length, 2);
  // Le plus récent (numéro le plus élevé) en premier.
  assert.equal(historique[0].numero, numeroReservation);
  assert.equal(historique[1].numero, manuel.contractNumero);
});

test("listContractsHistory : respecte la limite", async () => {
  const env = makeEnv();
  for (let i = 0; i < 5; i++) {
    await createManualContract(env, { ...rawDataValide, nom: `Client ${i}` });
  }
  const historique = await listContractsHistory(env, 3);
  assert.equal(historique.length, 3);
});
