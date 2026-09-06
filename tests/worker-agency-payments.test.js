// tests/worker-agency-payments.test.js
//
// src/api/agency-payments.js — plusieurs paiements par location, résumé
// basé sur price_total_cents de la location (jamais un total envoyé par le
// navigateur), annulation avec motif jamais une suppression.

const test = require("node:test");
const assert = require("node:assert/strict");

const { makeAgencyEnv, loginAgency, agencyRequest } = require("./helpers/agency-session.js");
const { handleAgencyClients } = require("../src/api/agency-clients.js");
const { handleAgencyRentals } = require("../src/api/agency-rentals.js");
const { handleAgencyPayments } = require("../src/api/agency-payments.js");

async function creerLocation(env, session, priceTotal) {
  const clientRes = await handleAgencyClients(
    agencyRequest("https://getlocation.fr/api/agency-clients", { method: "POST", session, body: { action: "create", data: { firstName: "Jean", lastName: "Dupont" } } }),
    env
  );
  const { client } = await clientRes.json();
  const rentalRes = await handleAgencyRentals(
    agencyRequest("https://getlocation.fr/api/agency-rentals", {
      method: "POST",
      session,
      body: { action: "create", clientId: client.id, data: { vehiculeId: "opel-corsa", dateDebut: "2026-09-10", heureDebut: "10:00", dateFin: "2026-09-12", heureFin: "10:00", priceTotal }
      }
    }),
    env
  );
  return (await rentalRes.json()).rental;
}

test("GET : 401 sans session agence", async () => {
  const res = await handleAgencyPayments(agencyRequest("https://getlocation.fr/api/agency-payments?rentalId=rnt_x"), makeAgencyEnv());
  assert.equal(res.status, 401);
});

test("ajoute deux paiements de moyens différents et calcule le résumé", async () => {
  const env = makeAgencyEnv();
  const session = await loginAgency(env);
  const rental = await creerLocation(env, session, 240); // 240€

  await handleAgencyPayments(
    agencyRequest("https://getlocation.fr/api/agency-payments", { method: "POST", session, body: { action: "add", rentalId: rental.id, data: { amount: 50, method: "carte" } } }),
    env
  );
  await handleAgencyPayments(
    agencyRequest("https://getlocation.fr/api/agency-payments", { method: "POST", session, body: { action: "add", rentalId: rental.id, data: { amount: 190, method: "especes" } } }),
    env
  );

  const res = await handleAgencyPayments(agencyRequest(`https://getlocation.fr/api/agency-payments?rentalId=${rental.id}`, { session }), env);
  const { payments, summary } = await res.json();
  assert.equal(payments.length, 2);
  assert.equal(summary.totalPaidCents, 24000);
  assert.equal(summary.balanceCents, 0);
  assert.equal(summary.status, "solde");

  const auditTypes = env.AGENCY_DB._raw.auditLog.map((e) => e.event_type);
  assert.equal(auditTypes.filter((t) => t === "payment_recorded").length, 2);
});

test("un paiement envoyant un total différent ne change jamais price_total_cents de la location", async () => {
  const env = makeAgencyEnv();
  const session = await loginAgency(env);
  const rental = await creerLocation(env, session, 100);

  await handleAgencyPayments(
    agencyRequest("https://getlocation.fr/api/agency-payments", {
      method: "POST",
      session,
      body: { action: "add", rentalId: rental.id, data: { amount: 10, method: "carte", totalDue: 999999 } }
    }),
    env
  );

  const res = await handleAgencyPayments(agencyRequest(`https://getlocation.fr/api/agency-payments?rentalId=${rental.id}`, { session }), env);
  const { summary } = await res.json();
  assert.equal(summary.totalDueCents, 10000, "le total dû reste celui de la location (100€), jamais celui envoyé dans le paiement");
});

test("voidPayment : annule avec motif, jamais de suppression, exclu du résumé", async () => {
  const env = makeAgencyEnv();
  const session = await loginAgency(env);
  const rental = await creerLocation(env, session, 50);

  const addRes = await handleAgencyPayments(
    agencyRequest("https://getlocation.fr/api/agency-payments", { method: "POST", session, body: { action: "add", rentalId: rental.id, data: { amount: 50, method: "carte" } } }),
    env
  );
  const { payment } = await addRes.json();

  const voidRes = await handleAgencyPayments(
    agencyRequest("https://getlocation.fr/api/agency-payments", { method: "POST", session, body: { action: "void", id: payment.id, reason: "Erreur de saisie" } }),
    env
  );
  assert.equal(voidRes.status, 200);

  const res = await handleAgencyPayments(agencyRequest(`https://getlocation.fr/api/agency-payments?rentalId=${rental.id}`, { session }), env);
  const { payments, summary } = await res.json();
  assert.equal(payments.length, 1, "la ligne reste consultable");
  assert.equal(payments[0].status, "annule");
  assert.equal(summary.totalPaidCents, 0);
  assert.equal(summary.status, "impaye");
});

test("void sans motif : rejeté (400)", async () => {
  const env = makeAgencyEnv();
  const session = await loginAgency(env);
  const rental = await creerLocation(env, session, 50);
  const addRes = await handleAgencyPayments(
    agencyRequest("https://getlocation.fr/api/agency-payments", { method: "POST", session, body: { action: "add", rentalId: rental.id, data: { amount: 50, method: "carte" } } }),
    env
  );
  const { payment } = await addRes.json();
  const res = await handleAgencyPayments(
    agencyRequest("https://getlocation.fr/api/agency-payments", { method: "POST", session, body: { action: "void", id: payment.id, reason: "" } }),
    env
  );
  assert.equal(res.status, 400);
});
