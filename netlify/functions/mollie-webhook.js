// netlify/functions/mollie-webhook.js
//
// Webhook Mollie : source de vérité pour la confirmation d'une réservation.
// Une réservation ne passe JAMAIS au statut "paid" sur la seule foi d'une
// déclaration du navigateur — uniquement après vérification côté serveur.
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
// Configuration requise (Netlify > Site configuration > Environment
// variables) :
//   - MOLLIE_API_KEY (déjà utilisée par create-payment.js)
//   - GMAIL_USER / GMAIL_APP_PASSWORD (envoi de l'email de confirmation au
//     client avec copie cachée à cette même adresse — voir
//     lib/send-confirmation-email.js — et de l'email agence contenant le
//     contrat pré-rempli — voir lib/send-contract-email.js ; tant qu'elles
//     ne sont pas définies, la confirmation de paiement fonctionne quand
//     même, seuls ces emails ne sont pas envoyés)
//
// À FAIRE avant mise en production : ce endpoint est déjà transmis comme
// `webhookUrl` à chaque création de paiement (voir create-payment.js), donc
// aucune configuration manuelle dans le dashboard Mollie n'est nécessaire.
// Cette fonction n'a pas pu être testée en conditions réelles dans cet
// environnement (pas de déploiement Netlify disponible ici) — seule sa
// logique interne est couverte par des tests unitaires (cf.
// tests/mollie-webhook.test.js).

const { createMollieClient } = require("@mollie/api-client");
const {
  updateReservationStatus,
  getReservation,
  findReservationByPaymentId
} = require("../../lib/server/reservation-store.js");
const { sendConfirmationEmail } = require("../../lib/server/send-confirmation-email.js");
const { sendContractEmail } = require("../../lib/server/send-contract-email.js");

async function resolveReservation(payment) {
  const reservationId = payment.metadata && payment.metadata.reservationId;
  if (reservationId) {
    const byId = await getReservation(reservationId);
    if (byId) return byId;
  }
  // Repli : recherche par index paymentId, au cas (rare) où le webhook
  // serait traité avant que create-payment.js n'ait fini de lier l'id à la
  // réservation.
  return findReservationByPaymentId(payment.id);
}

async function handlePaid(payment) {
  const reservation = await resolveReservation(payment);
  if (!reservation) {
    console.error("[mollie-webhook] Aucune réservation trouvée pour le paiement (paid).");
    return;
  }
  if (reservation.status === "paid") return; // déjà traité : idempotent
  const updated = await updateReservationStatus(reservation.id, "paid", {
    paymentId: payment.id,
    paidAt: new Date().toISOString()
  });
  // Best effort (voir send-confirmation-email.js / send-contract-email.js) :
  // un échec d'envoi ne remet jamais en cause la confirmation du paiement
  // ci-dessus, déjà enregistrée.
  await sendConfirmationEmail(updated);
  await sendContractEmail(updated);
}

async function handleFailedOrCanceled(payment) {
  const reservation = await resolveReservation(payment);
  if (!reservation) {
    console.error("[mollie-webhook] Aucune réservation trouvée pour le paiement (échec/annulation/expiration).");
    return;
  }
  // Ne jamais écraser un état final déjà atteint (idempotence + on ne
  // "dé-paie" jamais une réservation payée à cause d'un événement tardif).
  if (reservation.status === "paid" || reservation.status === "cancelled") return;
  await updateReservationStatus(reservation.id, "cancelled", {
    paymentId: payment.id,
    failureReason: payment.status
  });
}

// Statuts Mollie possibles : open, pending, authorized, paid, canceled,
// expired, failed. Seuls paid/canceled/expired/failed sont des états
// finaux ; les autres n'entraînent aucune action ici (rien à confirmer ni
// à annuler tant que l'issue n'est pas connue).
async function processPaymentStatus(payment) {
  switch (payment.status) {
    case "paid":
      await handlePaid(payment);
      break;
    case "canceled":
    case "expired":
    case "failed":
      await handleFailedOrCanceled(payment);
      break;
    default:
      break;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const apiKey = process.env.MOLLIE_API_KEY;
  if (!apiKey) {
    console.error("[mollie-webhook] MOLLIE_API_KEY manquante.");
    return { statusCode: 500, body: "Webhook non configuré" };
  }

  // Mollie envoie application/x-www-form-urlencoded (`id=tr_xxx`), jamais
  // du JSON — voir https://docs.mollie.com/reference/webhooks.
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || "", "base64").toString("utf8")
    : (event.body || "");
  const paymentId = new URLSearchParams(rawBody).get("id");
  if (!paymentId) {
    return { statusCode: 400, body: "id manquant" };
  }

  try {
    const mollieClient = createMollieClient({ apiKey });
    // Ne jamais faire confiance au corps du webhook : on revérifie toujours
    // le statut réel directement auprès de l'API Mollie avec cet id.
    const payment = await mollieClient.payments.get(paymentId);
    await processPaymentStatus(payment);
    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  } catch (err) {
    if (err && err.statusCode === 404) {
      // id inconnu de Mollie : ne pas faire échouer le webhook (évite des
      // retentatives inutiles pendant ~26h) ni révéler d'information —
      // voir https://docs.mollie.com/reference/webhooks.
      console.error("[mollie-webhook] Paiement inconnu de Mollie pour cet id.");
      return { statusCode: 200, body: JSON.stringify({ received: true }) };
    }
    console.error("[mollie-webhook] Erreur de traitement :", err && err.message);
    // 500 => Mollie retentera l'envoi automatiquement plus tard.
    return { statusCode: 500, body: "Erreur interne" };
  }
};

// Exporté pour les tests unitaires (traitement d'un paiement déjà récupéré,
// sans passer par l'appel HTTP à l'API Mollie).
exports.processPaymentStatus = processPaymentStatus;
