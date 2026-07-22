// netlify/functions/stripe-webhook.js
//
// Webhook Stripe : source de vérité pour la confirmation d'une réservation.
// Une réservation ne passe JAMAIS au statut "paid" sur la seule foi d'une
// déclaration du navigateur (ex. redirection après confirmCardPayment côté
// client) — uniquement après vérification cryptographique de la signature
// Stripe sur cet endpoint serveur-à-serveur.
//
// Idempotence : Stripe peut livrer un même événement plusieurs fois (retry
// réseau, etc.). Les handlers ci-dessous vérifient l'état actuel de la
// réservation avant d'agir, donc rejouer un événement déjà traité n'a pas
// d'effet supplémentaire (pas de double confirmation, pas d'écrasement
// d'un état final par un événement obsolète).
//
// Configuration requise (Netlify > Site configuration > Environment
// variables) :
//   - STRIPE_SECRET_KEY    (déjà utilisée par create-payment-intent.js)
//   - STRIPE_WEBHOOK_SECRET (fournie par Stripe lors de la création du
//     endpoint webhook — Dashboard Stripe > Developers > Webhooks, ou
//     `stripe listen` en local pour les tests)
//
// À FAIRE avant mise en production : configurer ce endpoint dans le
// Dashboard Stripe (URL : https://<site>/.netlify/functions/stripe-webhook)
// pour au moins les événements payment_intent.succeeded,
// payment_intent.payment_failed et payment_intent.canceled, puis vérifier
// avec `stripe trigger payment_intent.succeeded` (voir procédure de test
// dans la livraison finale). Cette fonction n'a pas pu être testée en
// conditions réelles dans cet environnement (pas de déploiement Netlify
// disponible ici) — seule sa logique interne est couverte par des tests
// unitaires (cf. tests/stripe-webhook.test.js).

const {
  updateReservationStatus,
  getReservation,
  findReservationByPaymentIntent
} = require("./lib/reservation-store.js");

async function resolveReservation(paymentIntent) {
  const reservationId = paymentIntent.metadata && paymentIntent.metadata.reservationId;
  if (reservationId) {
    const byId = await getReservation(reservationId);
    if (byId) return byId;
  }
  // Repli : recherche par index paymentIntentId, au cas (rare) où le
  // webhook serait traité avant que create-payment-intent.js n'ait fini de
  // lier l'id à la réservation.
  return findReservationByPaymentIntent(paymentIntent.id);
}

async function handleSucceeded(paymentIntent) {
  const reservation = await resolveReservation(paymentIntent);
  if (!reservation) {
    console.error("[stripe-webhook] Aucune réservation trouvée pour le PaymentIntent (succeeded).");
    return;
  }
  if (reservation.status === "paid") return; // déjà traité : idempotent
  await updateReservationStatus(reservation.id, "paid", {
    paymentIntentId: paymentIntent.id,
    paidAt: new Date().toISOString()
  });
}

async function handleFailedOrCanceled(paymentIntent, eventType) {
  const reservation = await resolveReservation(paymentIntent);
  if (!reservation) {
    console.error("[stripe-webhook] Aucune réservation trouvée pour le PaymentIntent (échec/annulation).");
    return;
  }
  // Ne jamais écraser un état final déjà atteint (idempotence + on ne
  // "dé-paie" jamais une réservation payée à cause d'un événement tardif).
  if (reservation.status === "paid" || reservation.status === "cancelled") return;
  await updateReservationStatus(reservation.id, "cancelled", {
    paymentIntentId: paymentIntent.id,
    failureReason: eventType
  });
}

async function processStripeEvent(stripeEvent) {
  switch (stripeEvent.type) {
    case "payment_intent.succeeded":
      await handleSucceeded(stripeEvent.data.object);
      break;
    case "payment_intent.payment_failed":
    case "payment_intent.canceled":
      await handleFailedOrCanceled(stripeEvent.data.object, stripeEvent.type);
      break;
    default:
      // Événement non géré par ce endpoint : accusé de réception sans
      // action, pour éviter des retentatives inutiles de la part de Stripe.
      break;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secretKey || !webhookSecret) {
    // Ne jamais accepter un webhook si sa signature ne peut pas être
    // vérifiée : on préfère un 500 explicite (visible dans les logs et
    // dans le tableau de bord Stripe) à une confirmation non vérifiée.
    console.error("[stripe-webhook] STRIPE_SECRET_KEY ou STRIPE_WEBHOOK_SECRET manquant(e).");
    return { statusCode: 500, body: "Webhook non configuré" };
  }

  const signature = event.headers && (event.headers["stripe-signature"] || event.headers["Stripe-Signature"]);
  if (!signature) {
    return { statusCode: 400, body: "Signature manquante" };
  }

  // Stripe exige le corps BRUT (octet pour octet) pour vérifier la
  // signature HMAC — jamais un JSON re-sérialisé après un JSON.parse().
  const rawBody = event.isBase64Encoded ? Buffer.from(event.body || "", "base64") : (event.body || "");

  let stripeEvent;
  try {
    const stripe = require("stripe")(secretKey);
    stripeEvent = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error("[stripe-webhook] Signature invalide :", err && err.message);
    return { statusCode: 400, body: "Signature invalide" };
  }

  try {
    await processStripeEvent(stripeEvent);
    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  } catch (err) {
    console.error("[stripe-webhook] Erreur de traitement :", err && err.message);
    // 500 => Stripe retentera l'envoi automatiquement plus tard.
    return { statusCode: 500, body: "Erreur interne" };
  }
};

// Exporté pour les tests unitaires (traitement d'un événement déjà
// vérifié, sans passer par la vérification de signature HTTP).
exports.processStripeEvent = processStripeEvent;
