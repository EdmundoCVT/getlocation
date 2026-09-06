// tests/rentals.test.js
//
// src/lib/rentals.js — création/validation, correction en place (jamais de
// doublon), attribution du numéro de contrat (compteur D1 atomique partagé,
// voir src/lib/contract-numero.js).

const test = require("node:test");
const assert = require("node:assert/strict");

const { createFakeD1 } = require("./helpers/fake-d1.js");
const { createClient } = require("../src/lib/clients.js");
const { createRental, getRentalById, updateRental, generateRentalContract, listRentalsByClient } = require("../src/lib/rentals.js");

function makeEnv() {
  return { AGENCY_DB: createFakeD1() };
}

const dataValide = {
  vehiculeId: "opel-corsa",
  dateDebut: "2026-09-10",
  heureDebut: "10:00",
  dateFin: "2026-09-12",
  heureFin: "10:00"
};

async function creerClient(env) {
  return createClient(env, { firstName: "Jean", lastName: "Dupont" }, "Edmundo");
}

test("createRental : cas nominal, statut brouillon, pas de numéro de contrat", async () => {
  const env = makeEnv();
  const client = await creerClient(env);
  const rental = await createRental(env, client.id, dataValide, "Edmundo");
  assert.match(rental.id, /^rnt_[a-f0-9]{32}$/);
  assert.equal(rental.clientId, client.id);
  assert.equal(rental.status, "brouillon");
  assert.equal(rental.contractNumero, null);
  assert.equal(rental.createdBy, "Edmundo");
});

test("createRental : rejette un véhicule inconnu", async () => {
  const env = makeEnv();
  const client = await creerClient(env);
  await assert.rejects(createRental(env, client.id, { ...dataValide, vehiculeId: "vehicule-inexistant" }, "Edmundo"));
});

test("createRental : rejette une date de retour antérieure ou égale au départ", async () => {
  const env = makeEnv();
  const client = await creerClient(env);
  await assert.rejects(createRental(env, client.id, { ...dataValide, dateFin: "2026-09-10", heureFin: "10:00" }, "Edmundo"));
});

test("createRental : rejette un client manquant", async () => {
  const env = makeEnv();
  await assert.rejects(createRental(env, "", dataValide, "Edmundo"));
});

test("updateRental : corrige en place, jamais de doublon, ne modifie jamais le client associé", async () => {
  const env = makeEnv();
  const client = await creerClient(env);
  const created = await createRental(env, client.id, dataValide, "Edmundo");

  const updated = await updateRental(env, created.id, { ...dataValide, kmDepart: 42000 }, "Antonio");
  assert.equal(updated.id, created.id);
  assert.equal(updated.clientId, client.id);
  assert.equal(updated.kmDepart, 42000);
  assert.equal(updated.updatedBy, "Antonio");
  assert.equal(updated.createdBy, "Edmundo");

  const rentals = await listRentalsByClient(env, client.id);
  assert.equal(rentals.length, 1, "aucune location supplémentaire créée par la correction");
});

test("updateRental : renvoie null si la location est introuvable", async () => {
  const env = makeEnv();
  assert.equal(await updateRental(env, "rnt_inconnu", dataValide, "Edmundo"), null);
});

test("generateRentalContract : attribue un numéro GL-AAAAMMJJ-NNNN et passe en contrat_genere", async () => {
  const env = makeEnv();
  const client = await creerClient(env);
  const rental = await createRental(env, client.id, dataValide, "Edmundo");

  const withContract = await generateRentalContract(env, rental.id, "Edmundo");
  assert.match(withContract.contractNumero, /^GL-\d{8}-\d{4}$/);
  assert.equal(withContract.status, "contrat_genere");
});

test("generateRentalContract : idempotent, ne réattribue jamais un second numéro", async () => {
  const env = makeEnv();
  const client = await creerClient(env);
  const rental = await createRental(env, client.id, dataValide, "Edmundo");

  const first = await generateRentalContract(env, rental.id, "Edmundo");
  const second = await generateRentalContract(env, rental.id, "Edmundo");
  assert.equal(second.contractNumero, first.contractNumero);
});

test("generateRentalContract : deux locations le même jour reçoivent des numéros distincts et séquentiels", async () => {
  const env = makeEnv();
  const client = await creerClient(env);
  const r1 = await createRental(env, client.id, dataValide, "Edmundo");
  const r2 = await createRental(env, client.id, dataValide, "Edmundo");

  const c1 = await generateRentalContract(env, r1.id, "Edmundo");
  const c2 = await generateRentalContract(env, r2.id, "Edmundo");
  assert.notEqual(c1.contractNumero, c2.contractNumero);

  const seq1 = Number(c1.contractNumero.split("-")[2]);
  const seq2 = Number(c2.contractNumero.split("-")[2]);
  assert.equal(seq2, seq1 + 1);
});

test("listRentalsByClient : du plus récent au plus ancien, jamais les locations d'un autre client", async () => {
  const env = makeEnv();
  const client = await creerClient(env);
  const autreClient = await createClient(env, { firstName: "Marie", lastName: "Martin" }, "Edmundo");
  await createRental(env, autreClient.id, dataValide, "Edmundo");

  const premiere = await createRental(env, client.id, dataValide, "Edmundo");
  await new Promise((r) => setTimeout(r, 2));
  const seconde = await createRental(env, client.id, dataValide, "Edmundo");

  const rentals = await listRentalsByClient(env, client.id);
  assert.equal(rentals.length, 2);
  assert.equal(rentals[0].id, seconde.id);
  assert.equal(rentals[1].id, premiere.id);
});

test("getRentalById : renvoie null pour un id inconnu ou vide", async () => {
  const env = makeEnv();
  assert.equal(await getRentalById(env, "rnt_inconnu"), null);
  assert.equal(await getRentalById(env, ""), null);
});
