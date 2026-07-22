// tests/stripe-webhook.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const Stripe = require("stripe");

const { handler, processStripeEvent } = require("../netlify/functions/stripe-webhook.js");
const { createReservation, getReservation, updateReservationStatus } = require("../netlify/functions/lib/reservation-store.js");

const FAKE_SECRET_KEY = "sk_test_dummy_for_unit_tests";
const FAKE_WEBHOOK_SECRET = "whsec_dummy_for_unit_tests";

function withStripeEnv(fn) {
  return async () => {
    process.env.STRIPE_SECRET_KEY = FAKE_SECRET_KEY;
    process.env.STRIPE_WEBHOOK_SECRET = FAKE_WEBHOOK_SECRET;
    try {
      await fn();
    } finally {
      delete process.env.STRIPE_SECRET_KEY;
      delete process.env.STRIPE_WEBHOOK_SECRET;
    }
  };
}

function signedEvent(payloadObject, secret = FAKE_WEBHOOK_SECRET) {
  const payload = JSON.stringify(payloadObject);
  const header = Stripe.webhooks.generateTestHeaderString({ payload, secret });
  return { payload, header };
}

function makePaymentIntentEvent(type, paymentIntentOverrides = {}) {
  return {
    id: `evt_${Math.random().toString(36).slice(2)}`,
    object: "event",
    type,
    data: {
      object: {
        id: `pi_${Math.random().toString(36).slice(2)}`,
        object: "payment_intent",
        metadata: {},
        ...paymentIntentOverrides
      }
    }
  };
}

test("rejette les méthodes autres que POST", async () => {
  const res = await handler({ httpMethod: "GET", headers: {}, body: "" });
  assert.equal(res.statusCode, 405);
});

test("refuse si STRIPE_WEBHOOK_SECRET n'est pas configuré", async () => {
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  const res = await handler({ httpMethod: "POST", headers: { "stripe-signature": "t=1,v1=abc" }, body: "{}" });
  assert.equal(res.statusCode, 500);
});

test(
  "refuse une requête sans en-tête de signature",
  withStripeEnv(async () => {
    const res = await handler({ httpMethod: "POST", headers: {}, body: "{}" });
    assert.equal(res.statusCode, 400);
  })
);

test(
  "refuse une signature invalide (mauvais secret)",
  withStripeEnv(async () => {
    const { payload, header } = signedEvent(makePaymentIntentEvent("payment_intent.succeeded"), "whsec_un_autre_secret");
    const res = await handler({
      httpMethod: "POST",
      headers: { "stripe-signature": header },
      body: payload
    });
    assert.equal(res.statusCode, 400);
  })
);

test(
  "accepte un événement correctement signé et confirme la réservation liée",
  withStripeEnv(async () => {
    const reservation = await createReservation({ vehiculeId: "opel-corsa" });
    const paymentIntentId = `pi_${Math.random().toString(36).slice(2)}`;
    await updateReservationStatus(reservation.id, "pending_payment", { paymentIntentId });

    const stripeEvent = makePaymentIntentEvent("payment_intent.succeeded", {
      id: paymentIntentId,
      metadata: { reservationId: reservation.id }
    });
    const { payload, header } = signedEvent(stripeEvent);

    const res = await handler({
      httpMethod: "POST",
      headers: { "stripe-signature": header },
      body: payload
    });
    assert.equal(res.statusCode, 200);

    const updated = await getReservation(reservation.id);
    assert.equal(updated.status, "paid");
    assert.ok(updated.paidAt);
  })
);

test("idempotence : rejouer le même événement succeeded ne change rien de plus", async () => {
  const reservation = await createReservation({ vehiculeId: "peugeot-3008" });
  const paymentIntentId = `pi_${Math.random().toString(36).slice(2)}`;
  await updateReservationStatus(reservation.id, "pending_payment", { paymentIntentId });

  const stripeEvent = {
    type: "payment_intent.succeeded",
    data: { object: { id: paymentIntentId, metadata: { reservationId: reservation.id } } }
  };

  await processStripeEvent(stripeEvent);
  const afterFirst = await getReservation(reservation.id);
  assert.equal(afterFirst.status, "paid");
  const paidAtFirst = afterFirst.paidAt;

  await processStripeEvent(stripeEvent);
  const afterSecond = await getReservation(reservation.id);
  assert.equal(afterSecond.status, "paid");
  assert.equal(afterSecond.paidAt, paidAtFirst); // pas retraité, donc pas réécrit
});

test("un échec de paiement annule la réservation, sans écraser un paiement déjà confirmé", async () => {
  const reservation = await createReservation({ vehiculeId: "toyota-proace-city" });
  const paymentIntentId = `pi_${Math.random().toString(36).slice(2)}`;
  await updateReservationStatus(reservation.id, "pending_payment", { paymentIntentId });

  await processStripeEvent({
    type: "payment_intent.payment_failed",
    data: { object: { id: paymentIntentId, metadata: { reservationId: reservation.id } } }
  });
  let updated = await getReservation(reservation.id);
  assert.equal(updated.status, "cancelled");

  // Un événement "succeeded" tardif (ex. le client retente avec une autre
  // carte sur le même PaymentIntent) doit pouvoir confirmer la réservation.
  await processStripeEvent({
    type: "payment_intent.succeeded",
    data: { object: { id: paymentIntentId, metadata: { reservationId: reservation.id } } }
  });
  updated = await getReservation(reservation.id);
  assert.equal(updated.status, "paid");

  // Mais un échec qui arriverait APRÈS une confirmation ne doit jamais
  // "dé-payer" la réservation (idempotence + protection d'un état final).
  await processStripeEvent({
    type: "payment_intent.payment_failed",
    data: { object: { id: paymentIntentId, metadata: { reservationId: reservation.id } } }
  });
  updated = await getReservation(reservation.id);
  assert.equal(updated.status, "paid");
});

test("événement sans réservation correspondante : ignoré sans erreur", async () => {
  await assert.doesNotReject(
    processStripeEvent({
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_inexistant", metadata: {} } }
    })
  );
});

test("type d'événement non géré : accusé de réception sans action", async () => {
  await assert.doesNotReject(
    processStripeEvent({ type: "charge.refunded", data: { object: {} } })
  );
});
