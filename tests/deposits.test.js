// tests/deposits.test.js
//
// src/lib/deposits.js — caution distincte des paiements de location : une
// par location, demande -> réception -> restitution/retenue, jamais de
// montant qui disparaît silencieusement.

const test = require("node:test");
const assert = require("node:assert/strict");

const { createFakeD1 } = require("./helpers/fake-d1.js");
const {
  createDepositRequest,
  updateDepositRequest,
  receiveDeposit,
  returnDeposit,
  getDepositForRental,
  getDepositById
} = require("../src/lib/deposits.js");

function makeEnv() {
  return { AGENCY_DB: createFakeD1() };
}

test("createDepositRequest : cas nominal, statut attendue", async () => {
  const env = makeEnv();
  const deposit = await createDepositRequest(env, "rnt_1", { amount: 500, method: "carte" }, "Edmundo");
  assert.match(deposit.id, /^dep_[a-f0-9]{32}$/);
  assert.equal(deposit.amountRequestedCents, 50000);
  assert.equal(deposit.status, "attendue");
  assert.equal(deposit.createdBy, "Edmundo");
});

test("createDepositRequest : une seule caution par location", async () => {
  const env = makeEnv();
  await createDepositRequest(env, "rnt_1", { amount: 500, method: "carte" }, "Edmundo");
  await assert.rejects(createDepositRequest(env, "rnt_1", { amount: 500, method: "carte" }, "Edmundo"));
});

test("createDepositRequest : rejette un mode de remise inconnu", async () => {
  const env = makeEnv();
  await assert.rejects(createDepositRequest(env, "rnt_1", { amount: 500, method: "bitcoin" }, "Edmundo"));
});

test("updateDepositRequest : modifie le montant/mode prévus tant que non reçue", async () => {
  const env = makeEnv();
  const deposit = await createDepositRequest(env, "rnt_1", { amount: 500, method: "carte" }, "Edmundo");
  const updated = await updateDepositRequest(env, deposit.id, { amount: 800, method: "especes" }, "Antonio");
  assert.equal(updated.amountRequestedCents, 80000);
  assert.equal(updated.method, "especes");
});

test("updateDepositRequest : refuse de modifier une caution déjà reçue", async () => {
  const env = makeEnv();
  const deposit = await createDepositRequest(env, "rnt_1", { amount: 500, method: "carte" }, "Edmundo");
  await receiveDeposit(env, deposit.id, "Edmundo");
  await assert.rejects(updateDepositRequest(env, deposit.id, { amount: 800, method: "especes" }, "Edmundo"));
});

test("receiveDeposit : passe en recue, renseigne l'opérateur et la date", async () => {
  const env = makeEnv();
  const deposit = await createDepositRequest(env, "rnt_1", { amount: 500, method: "carte" }, "Edmundo");
  const received = await receiveDeposit(env, deposit.id, "Antonio");
  assert.equal(received.status, "recue");
  assert.equal(received.receivedBy, "Antonio");
  assert.ok(received.receivedAt);
});

test("receiveDeposit : refuse une seconde réception", async () => {
  const env = makeEnv();
  const deposit = await createDepositRequest(env, "rnt_1", { amount: 500, method: "carte" }, "Edmundo");
  await receiveDeposit(env, deposit.id, "Edmundo");
  await assert.rejects(receiveDeposit(env, deposit.id, "Edmundo"));
});

test("returnDeposit : restitution intégrale", async () => {
  const env = makeEnv();
  const deposit = await createDepositRequest(env, "rnt_1", { amount: 500, method: "carte" }, "Edmundo");
  await receiveDeposit(env, deposit.id, "Edmundo");
  const returned = await returnDeposit(env, deposit.id, { returnedAmount: 500, retainedAmount: 0 }, "Edmundo");
  assert.equal(returned.status, "restituee");
  assert.equal(returned.returnedAmountCents, 50000);
  assert.equal(returned.retainedAmountCents, 0);
});

test("returnDeposit : retenue partielle exige un motif", async () => {
  const env = makeEnv();
  const deposit = await createDepositRequest(env, "rnt_1", { amount: 500, method: "carte" }, "Edmundo");
  await receiveDeposit(env, deposit.id, "Edmundo");
  await assert.rejects(returnDeposit(env, deposit.id, { returnedAmount: 400, retainedAmount: 100 }, "Edmundo"));

  const returned = await returnDeposit(env, deposit.id, { returnedAmount: 400, retainedAmount: 100, retainedReason: "Rayure portière avant" }, "Edmundo");
  assert.equal(returned.status, "retenue_partielle");
  assert.equal(returned.retainedReason, "Rayure portière avant");
});

test("returnDeposit : retenue totale", async () => {
  const env = makeEnv();
  const deposit = await createDepositRequest(env, "rnt_1", { amount: 500, method: "carte" }, "Edmundo");
  await receiveDeposit(env, deposit.id, "Edmundo");
  const returned = await returnDeposit(env, deposit.id, { returnedAmount: 0, retainedAmount: 500, retainedReason: "Dommage important" }, "Edmundo");
  assert.equal(returned.status, "retenue_totale");
});

test("returnDeposit : rejette si restitué + retenu ne correspond pas exactement au montant reçu", async () => {
  const env = makeEnv();
  const deposit = await createDepositRequest(env, "rnt_1", { amount: 500, method: "carte" }, "Edmundo");
  await receiveDeposit(env, deposit.id, "Edmundo");
  await assert.rejects(returnDeposit(env, deposit.id, { returnedAmount: 400, retainedAmount: 50 }, "Edmundo"));
});

test("returnDeposit : refuse tant que la caution n'a pas été reçue", async () => {
  const env = makeEnv();
  const deposit = await createDepositRequest(env, "rnt_1", { amount: 500, method: "carte" }, "Edmundo");
  await assert.rejects(returnDeposit(env, deposit.id, { returnedAmount: 500, retainedAmount: 0 }, "Edmundo"));
});

test("getDepositForRental / getDepositById : null si introuvable", async () => {
  const env = makeEnv();
  assert.equal(await getDepositForRental(env, "rnt_inconnu"), null);
  assert.equal(await getDepositById(env, "dep_inconnu"), null);
});
