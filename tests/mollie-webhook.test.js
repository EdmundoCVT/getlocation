// tests/mollie-webhook.test.js
//
// Le webhook Mollie ne transporte qu'un id (voir mollie-webhook.js) : pour
// connaître le statut réel, le handler HTTP doit rappeler l'API Mollie en
// réseau (mollieClient.payments.get). Ce chemin réseau ne peut pas être
// testé ici sans clé Mollie réelle ni accès réseau sortant (même limite que
// pour create-payment.js) — il devra être vérifié manuellement en mode test
// Mollie avant mise en production. Ce fichier teste donc séparément :
//   1. Les réponses HTTP du handler qui ne nécessitent PAS d'appel réseau
//      (méthode refusée, configuration manquante, id absent du corps).
//   2. La logique de traitement métier (processPaymentStatus), directement,
//      avec des objets "payment" construits à la main — exactement les
//      mêmes chemins que si l'appel réseau à Mollie avait réussi.

const test = require("node:test");
const assert = require("node:assert/strict");

const { handler, processPaymentStatus } = require("../netlify/functions/mollie-webhook.js");
const { createReservation, getReservation, updateReservationStatus } = require("../lib/server/reservation-store.js");

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
  const res = await handler({ httpMethod: "GET", headers: {}, body: "" });
  assert.equal(res.statusCode, 405);
});

test("refuse si MOLLIE_API_KEY n'est pas configurée", async () => {
  delete process.env.MOLLIE_API_KEY;
  const res = await handler({ httpMethod: "POST", headers: {}, body: "id=tr_xxx" });
  assert.equal(res.statusCode, 500);
});

test("refuse une requête sans id dans le corps", async () => {
  process.env.MOLLIE_API_KEY = "test_dummy_for_unit_tests";
  try {
    const res = await handler({ httpMethod: "POST", headers: {}, body: "" });
    assert.equal(res.statusCode, 400);
  } finally {
    delete process.env.MOLLIE_API_KEY;
  }
});

test("accepte un paiement payé et confirme la réservation liée", async () => {
  const reservation = await createReservation({ vehiculeId: "opel-corsa" });
  const paymentId = `tr_${Math.random().toString(36).slice(2)}`;
  await updateReservationStatus(reservation.id, "pending_payment", { paymentId });

  const payment = makePayment("paid", { id: paymentId, metadata: { reservationId: reservation.id } });
  await processPaymentStatus(payment);

  const updated = await getReservation(reservation.id);
  assert.equal(updated.status, "paid");
  assert.ok(updated.paidAt);
});

test("idempotence : rejouer le même statut paid ne change rien de plus", async () => {
  const reservation = await createReservation({ vehiculeId: "peugeot-3008" });
  const paymentId = `tr_${Math.random().toString(36).slice(2)}`;
  await updateReservationStatus(reservation.id, "pending_payment", { paymentId });

  const payment = makePayment("paid", { id: paymentId, metadata: { reservationId: reservation.id } });

  await processPaymentStatus(payment);
  const afterFirst = await getReservation(reservation.id);
  assert.equal(afterFirst.status, "paid");
  const paidAtFirst = afterFirst.paidAt;

  await processPaymentStatus(payment);
  const afterSecond = await getReservation(reservation.id);
  assert.equal(afterSecond.status, "paid");
  assert.equal(afterSecond.paidAt, paidAtFirst); // pas retraité, donc pas réécrit
});

test("un paiement expiré/annulé/échoué annule la réservation, sans écraser un paiement déjà confirmé", async () => {
  const reservation = await createReservation({ vehiculeId: "toyota-proace-city" });
  const paymentId = `tr_${Math.random().toString(36).slice(2)}`;
  await updateReservationStatus(reservation.id, "pending_payment", { paymentId });

  await processPaymentStatus(makePayment("failed", { id: paymentId, metadata: { reservationId: reservation.id } }));
  let updated = await getReservation(reservation.id);
  assert.equal(updated.status, "cancelled");

  // Un statut "paid" tardif (ex. le client retente avec un autre moyen de
  // paiement sur le même paiement) doit pouvoir confirmer la réservation.
  await processPaymentStatus(makePayment("paid", { id: paymentId, metadata: { reservationId: reservation.id } }));
  updated = await getReservation(reservation.id);
  assert.equal(updated.status, "paid");

  // Mais un échec qui arriverait APRÈS une confirmation ne doit jamais
  // "dé-payer" la réservation (idempotence + protection d'un état final).
  await processPaymentStatus(makePayment("expired", { id: paymentId, metadata: { reservationId: reservation.id } }));
  updated = await getReservation(reservation.id);
  assert.equal(updated.status, "paid");
});

test("paiement sans réservation correspondante : ignoré sans erreur", async () => {
  await assert.doesNotReject(
    processPaymentStatus(makePayment("paid", { id: "tr_inexistant", metadata: {} }))
  );
});

test("statut non final (open/pending/authorized) : aucune action", async () => {
  await assert.doesNotReject(processPaymentStatus(makePayment("open")));
  await assert.doesNotReject(processPaymentStatus(makePayment("pending")));
  await assert.doesNotReject(processPaymentStatus(makePayment("authorized")));
});
