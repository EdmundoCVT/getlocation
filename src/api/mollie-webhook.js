// src/api/mollie-webhook.js
//
// Webhook Mollie : source de vérité pour la confirmation d'une réservation.
// Équivalent Cloudflare Worker de l'ancienne netlify/functions/mollie-webhook.js
// (Phase A, conservée telle quelle pour référence/rollback — voir
// DEPLOIEMENT.md, Phase B). Une réservation ne passe JAMAIS au statut
// "paid" sur la seule foi d'une déclaration du navigateur — uniquement
// après vérification côté serveur.
//
// Modèle de sécurité Mollie (différent de Stripe) : ce webhook ne reçoit
// PAS de statut ni de signature, uniquement un id de paiement, en
// application/x-www-form-urlencoded (`id=tr_xxx`). La seule façon fiable de
// connaître le statut réel est de rappeler l'API Mollie avec cet id — ne
// jamais faire confiance au corps du webhook lui-même.
// Voir https://docs.mollie.com/reference/webhooks
//
// Idempotence : Mollie peut appeler ce webhook plusieurs fois pour le même
// paiement (retry réseau, changements de statut successifs). Les handlers
// ci-dessous vérifient l'état actuel de la réservation avant d'agir, donc
// rejouer un événement déjà traité n'a pas d'effet supplémentaire (pas de
// double confirmation, pas d'écrasement d'un état final par un événement
// obsolète).
//
// Configuration requise (secrets Cloudflare Worker, voir DEPLOIEMENT.md) :
//   - MOLLIE_API_KEY (déjà utilisée par create-payment.js)
//   - RESEND_API_KEY / AGENCY_EMAIL (envoi de l'email de confirmation au
//     client et du contrat pré-rempli à l'agence — voir
//     lib/send-confirmation-email.js et lib/send-contract-email.js ; tant
//     qu'elles ne sont pas définies, la confirmation de paiement fonctionne
//     quand même, seuls ces emails ne sont pas envoyés)
//
// Ce endpoint est transmis comme `webhookUrl` à chaque création de paiement
// (voir create-payment.js), donc aucune configuration manuelle dans le
// dashboard Mollie n'est nécessaire.

const { getPayment } = require("../lib/mollie-client.js");
const {
  updateReservationStatus,
  getReservation,
  findReservationByPaymentId
} = require("../lib/reservation-store.js");
const { sendConfirmationEmail } = require("../lib/send-confirmation-email.js");
const { sendContractEmail } = require("../lib/send-contract-email.js");

async function resolveReservation(env, payment) {
  const reservationId = payment.metadata && payment.metadata.reservationId;
  if (reservationId) {
    const byId = await getReservation(env, reservationId);
    if (byId) return byId;
  }
  // Repli : recherche par index paymentId, au cas (rare) où le webhook
  // serait traité avant que create-payment.js n'ait fini de lier l'id à la
  // réservation.
  return findReservationByPaymentId(env, payment.id);
}

async function handlePaid(env, payment) {
  const reservation = await resolveReservation(env, payment);
  if (!reservation) {
    console.error("[mollie-webhook] Aucune réservation trouvée pour le paiement (paid).");
    return;
  }
  if (reservation.status === "paid") return; // déjà traité : idempotent
  const updated = await updateReservationStatus(env, reservation.id, "paid", {
    paymentId: payment.id,
    paidAt: new Date().toISOString()
  });
  // Best effort (voir send-confirmation-email.js / send-contract-email.js) :
  // un échec d'envoi ne remet jamais en cause la confirmation du paiement
  // ci-dessus, déjà enregistrée.
  await sendConfirmationEmail(env, updated);
  await sendContractEmail(env, updated);
}

async function handleFailedOrCanceled(env, payment) {
  const reservation = await resolveReservation(env, payment);
  if (!reservation) {
    console.error("[mollie-webhook] Aucune réservation trouvée pour le paiement (échec/annulation/expiration).");
    return;
  }
  // Ne jamais écraser un état final déjà atteint (idempotence + on ne
  // "dé-paie" jamais une réservation payée à cause d'un événement tardif).
  if (reservation.status === "paid" || reservation.status === "cancelled") return;
  await updateReservationStatus(env, reservation.id, "cancelled", {
    paymentId: payment.id,
    failureReason: payment.status
  });
}

// Statuts Mollie possibles : open, pending, authorized, paid, canceled,
// expired, failed. Seuls paid/canceled/expired/failed sont des états
// finaux ; les autres n'entraînent aucune action ici (rien à confirmer ni
// à annuler tant que l'issue n'est pas connue).
async function processPaymentStatus(env, payment) {
  switch (payment.status) {
    case "paid":
      await handlePaid(env, payment);
      break;
    case "canceled":
    case "expired":
    case "failed":
      await handleFailedOrCanceled(env, payment);
      break;
    default:
      break;
  }
}

async function handleMollieWebhook(request, env) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const apiKey = env.MOLLIE_API_KEY;
  if (!apiKey) {
    console.error("[mollie-webhook] MOLLIE_API_KEY manquante.");
    return new Response("Webhook non configuré", { status: 500 });
  }

  // Mollie envoie application/x-www-form-urlencoded (`id=tr_xxx`), jamais
  // du JSON — voir https://docs.mollie.com/reference/webhooks.
  const rawBody = await request.text();
  const paymentId = new URLSearchParams(rawBody).get("id");
  if (!paymentId) {
    return new Response("id manquant", { status: 400 });
  }

  try {
    // Ne jamais faire confiance au corps du webhook : on revérifie toujours
    // le statut réel directement auprès de l'API Mollie avec cet id.
    const payment = await getPayment(apiKey, paymentId);
    await processPaymentStatus(env, payment);
    return new Response(JSON.stringify({ received: true }), { status: 200 });
  } catch (err) {
    if (err && err.statusCode === 404) {
      // id inconnu de Mollie : ne pas faire échouer le webhook (évite des
      // retentatives inutiles pendant ~26h) ni révéler d'information —
      // voir https://docs.mollie.com/reference/webhooks.
      console.error("[mollie-webhook] Paiement inconnu de Mollie pour cet id.");
      return new Response(JSON.stringify({ received: true }), { status: 200 });
    }
    console.error("[mollie-webhook] Erreur de traitement :", err && err.message);
    // 500 => Mollie retentera l'envoi automatiquement plus tard.
    return new Response("Erreur interne", { status: 500 });
  }
}

module.exports = { handleMollieWebhook, processPaymentStatus };
