// tests/payments.test.js
//
// src/lib/payments.js — plusieurs paiements par location, jamais de
// suppression définitive (annulation avec motif), résumé
// total/encaissé/solde/statut en centimes.

const test = require("node:test");
const assert = require("node:assert/strict");

const { createFakeD1 } = require("./helpers/fake-d1.js");
const { addPayment, getPaymentById, voidPayment, listPaymentsForRental, summarizePayments, METHODES_VALIDES } = require("../src/lib/payments.js");

function makeEnv() {
  return { AGENCY_DB: createFakeD1() };
}

test("METHODES_VALIDES : carte, especes, virement (même vocabulaire que le reste du site)", () => {
  assert.deepEqual(METHODES_VALIDES, ["carte", "especes", "virement"]);
});

test("addPayment : cas nominal, montant converti en centimes", async () => {
  const env = makeEnv();
  const payment = await addPayment(env, "rnt_1", { amount: 50, method: "carte" }, "Edmundo");
  assert.match(payment.id, /^pay_[a-f0-9]{32}$/);
  assert.equal(payment.amountCents, 5000);
  assert.equal(payment.status, "valide");
  assert.equal(payment.operator, "Edmundo");
});

test("addPayment : rejette un montant invalide ou nul", async () => {
  const env = makeEnv();
  await assert.rejects(addPayment(env, "rnt_1", { amount: 0, method: "carte" }, "Edmundo"));
  await assert.rejects(addPayment(env, "rnt_1", { amount: -10, method: "carte" }, "Edmundo"));
  await assert.rejects(addPayment(env, "rnt_1", { amount: "abc", method: "carte" }, "Edmundo"));
});

test("addPayment : rejette un moyen de paiement inconnu", async () => {
  const env = makeEnv();
  await assert.rejects(addPayment(env, "rnt_1", { amount: 50, method: "bitcoin" }, "Edmundo"));
});

test("une location peut recevoir plusieurs paiements de moyens différents", async () => {
  const env = makeEnv();
  await addPayment(env, "rnt_1", { amount: 50, method: "carte" }, "Edmundo");
  await addPayment(env, "rnt_1", { amount: 190, method: "especes" }, "Antonio");
  const payments = await listPaymentsForRental(env, "rnt_1");
  assert.equal(payments.length, 2);
  assert.equal(payments[0].amountCents + payments[1].amountCents, 24000);
});

test("voidPayment : exige un motif, ne supprime jamais la ligne (status=annule)", async () => {
  const env = makeEnv();
  const payment = await addPayment(env, "rnt_1", { amount: 50, method: "carte" }, "Edmundo");
  await assert.rejects(voidPayment(env, payment.id, ""));
  await assert.rejects(voidPayment(env, payment.id, "   "));

  const voided = await voidPayment(env, payment.id, "Erreur de saisie, montant corrigé");
  assert.equal(voided.status, "annule");
  assert.equal(voided.voidReason, "Erreur de saisie, montant corrigé");

  const stillThere = await getPaymentById(env, payment.id);
  assert.equal(stillThere.status, "annule", "la ligne reste consultable, jamais supprimée");
});

test("voidPayment : renvoie null pour un paiement introuvable", async () => {
  const env = makeEnv();
  assert.equal(await voidPayment(env, "pay_inconnu", "motif"), null);
});

test("summarizePayments : impayé, partiel, soldé — les paiements annulés n'entrent jamais dans l'encaissé", async () => {
  const env = makeEnv();
  const p1 = await addPayment(env, "rnt_1", { amount: 100, method: "carte" }, "Edmundo");
  assert.equal(summarizePayments(await listPaymentsForRental(env, "rnt_1"), 20000).status, "partiel");

  await addPayment(env, "rnt_1", { amount: 100, method: "especes" }, "Edmundo");
  assert.equal(summarizePayments(await listPaymentsForRental(env, "rnt_1"), 20000).status, "solde");

  await voidPayment(env, p1.id, "annulé par erreur");
  const summary = summarizePayments(await listPaymentsForRental(env, "rnt_1"), 20000);
  assert.equal(summary.totalPaidCents, 10000, "le paiement annulé ne compte plus dans l'encaissé");
  assert.equal(summary.balanceCents, 10000);
  assert.equal(summary.status, "partiel");
});

test("summarizePayments : aucun paiement = impayé, solde jamais négatif même en cas de trop-perçu", () => {
  assert.equal(summarizePayments([], 20000).status, "impaye");
  const tropPercu = summarizePayments([{ status: "valide", amountCents: 25000 }], 20000);
  assert.equal(tropPercu.balanceCents, 0);
  assert.equal(tropPercu.status, "solde");
});
