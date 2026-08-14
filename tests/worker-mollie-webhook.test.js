// tests/worker-mollie-webhook.test.js
//
// Équivalent de tests/mollie-webhook.test.js pour src/api/mollie-webhook.js
// (Cloudflare Worker, Phase B — voir DEPLOIEMENT.md). Le webhook Mollie ne
// transporte qu'un id : pour connaître le statut réel, le handler HTTP doit
// rappeler l'API Mollie en réseau (src/lib/mollie-client.js, via fetch()).
// Ce chemin réseau ne peut pas être testé ici sans clé Mollie réelle ni
// accès réseau sortant — il devra être vérifié manuellement en mode test
// Mollie avant mise en production (voir DEPLOIEMENT.md). Ce fichier teste
// donc séparément :
//   1. Les réponses HTTP du handler qui ne nécessitent PAS d'appel réseau
//      (méthode refusée, configuration manquante, id absent du corps).
//   2. La logique de traitement métier (processPaymentStatus), directement,
//      avec des objets "payment" construits à la main — exactement les
//      mêmes chemins que si l'appel réseau à Mollie avait réussi.

const test = require("node:test");
const assert = require("node:assert/strict");

const { createFakeKv } = require("./helpers/fake-kv.js");
const { handleMollieWebhook, processPaymentStatus } = require("../src/api/mollie-webhook.js");
const { createReservation, getReservation, updateReservationStatus } = require("../src/lib/reservation-store.js");

function makeEnv(overrides = {}) {
  return { RESERVATIONS_KV: createFakeKv(), ...overrides };
}

function makePayment(status, overrides = {}) {
  return {
    id: `tr_${Math.random().toString(36).slice(2)}`,
    resource: "payment",
    status,
    metadata: {},
    ...overrides
  };
}

test("rejette les méthodes autres que POST", async () => {
  const res = await handleMollieWebhook(new Request("https://getlocation.fr/api/mollie-webhook", { method: "GET" }), makeEnv());
  assert.equal(res.status, 405);
});

test("refuse si MOLLIE_API_KEY n'est pas configurée", async () => {
  const res = await handleMollieWebhook(
    new Request("https://getlocation.fr/api/mollie-webhook", { method: "POST", body: "id=tr_xxx" }),
    makeEnv()
  );
  assert.equal(res.status, 500);
});

test("refuse une requête sans id dans le corps", async () => {
  const res = await handleMollieWebhook(
    new Request("https://getlocation.fr/api/mollie-webhook", { method: "POST", body: "" }),
    makeEnv({ MOLLIE_API_KEY: "test_dummy_for_unit_tests" })
  );
  assert.equal(res.status, 400);
});

test("accepte un paiement payé et confirme la réservation liée", async () => {
  const env = makeEnv();
  const reservation = await createReservation(env, { vehiculeId: "opel-corsa" });
  const paymentId = `tr_${Math.random().toString(36).slice(2)}`;
  await updateReservationStatus(env, reservation.id, "pending_payment", { paymentId });

  const payment = makePayment("paid", { id: paymentId, metadata: { reservationId: reservation.id } });
  await processPaymentStatus(env, payment);

  const updated = await getReservation(env, reservation.id);
  assert.equal(updated.status, "paid");
  assert.ok(updated.paidAt);
});

test("idempotence : rejouer le même statut paid ne change rien de plus", async () => {
  const env = makeEnv();
  const reservation = await createReservation(env, { vehiculeId: "peugeot-3008" });
  const paymentId = `tr_${Math.random().toString(36).slice(2)}`;
  await updateReservationStatus(env, reservation.id, "pending_payment", { paymentId });

  const payment = makePayment("paid", { id: paymentId, metadata: { reservationId: reservation.id } });

  await processPaymentStatus(env, payment);
  const afterFirst = await getReservation(env, reservation.id);
  assert.equal(afterFirst.status, "paid");
  const paidAtFirst = afterFirst.paidAt;

  await processPaymentStatus(env, payment);
  const afterSecond = await getReservation(env, reservation.id);
  assert.equal(afterSecond.status, "paid");
  assert.equal(afterSecond.paidAt, paidAtFirst); // pas retraité, donc pas réécrit
});

test("un paiement expiré/annulé/échoué annule la réservation, sans écraser un paiement déjà confirmé", async () => {
  const env = makeEnv();
  const reservation = await createReservation(env, { vehiculeId: "toyota-proace-city" });
  const paymentId = `tr_${Math.random().toString(36).slice(2)}`;
  await updateReservationStatus(env, reservation.id, "pending_payment", { paymentId });

  await processPaymentStatus(env, makePayment("failed", { id: paymentId, metadata: { reservationId: reservation.id } }));
  let updated = await getReservation(env, reservation.id);
  assert.equal(updated.status, "cancelled");

  // Un statut "paid" tardif (ex. le client retente avec un autre moyen de
  // paiement sur le même paiement) doit pouvoir confirmer la réservation.
  await processPaymentStatus(env, makePayment("paid", { id: paymentId, metadata: { reservationId: reservation.id } }));
  updated = await getReservation(env, reservation.id);
  assert.equal(updated.status, "paid");

  // Mais un échec qui arriverait APRÈS une confirmation ne doit jamais
  // "dé-payer" la réservation (idempotence + protection d'un état final).
  await processPaymentStatus(env, makePayment("expired", { id: paymentId, metadata: { reservationId: reservation.id } }));
  updated = await getReservation(env, reservation.id);
  assert.equal(updated.status, "paid");
});

test("paiement sans réservation correspondante : ignoré sans erreur", async () => {
  const env = makeEnv();
  await assert.doesNotReject(processPaymentStatus(env, makePayment("paid", { id: "tr_inexistant", metadata: {} })));
});

test("statut non final (open/pending/authorized) : aucune action", async () => {
  const env = makeEnv();
  await assert.doesNotReject(processPaymentStatus(env, makePayment("open")));
  await assert.doesNotReject(processPaymentStatus(env, makePayment("pending")));
  await assert.doesNotReject(processPaymentStatus(env, makePayment("authorized")));
});
