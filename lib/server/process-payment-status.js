// lib/server/process-payment-status.js
//
// Logique métier pure du traitement d'un paiement Mollie (voir
// netlify/functions/mollie-webhook.js pour le contexte complet : modèle de
// sécurité, idempotence). Découplée du backend de stockage (Netlify Blobs
// vs Cloudflare KV, voir plan de migration B.1/B.3) et de l'entrée HTTP —
// reçoit ses dépendances en paramètre plutôt que d'importer un module
// singleton, pour être appelable identiquement depuis
// netlify/functions/mollie-webhook.js et functions/api/mollie-webhook.js.
//
// deps attendu : { store, sendConfirmationEmail, sendContractEmail }
// - store : interface createReservation/getReservation/
//   updateReservationStatus/findReservationByPaymentId (voir
//   reservation-store.js ou reservation-store-kv.js).
// - sendConfirmationEmail/sendContractEmail : voir
//   send-confirmation-email.js / send-contract-email.js.

async function resolveReservation(deps, payment) {
  const reservationId = payment.metadata && payment.metadata.reservationId;
  if (reservationId) {
    const byId = await deps.store.getReservation(reservationId);
    if (byId) return byId;
  }
  // Repli : recherche par index paymentId, au cas (rare) où le webhook
  // serait traité avant que create-payment n'ait fini de lier l'id à la
  // réservation.
  return deps.store.findReservationByPaymentId(payment.id);
}

async function handlePaid(deps, payment) {
  const reservation = await resolveReservation(deps, payment);
  if (!reservation) {
    console.error("[mollie-webhook] Aucune réservation trouvée pour le paiement (paid).");
    return;
  }
  if (reservation.status === "paid") return; // déjà traité : idempotent
  const updated = await deps.store.updateReservationStatus(reservation.id, "paid", {
    paymentId: payment.id,
    paidAt: new Date().toISOString()
  });
  // Best effort (voir send-confirmation-email.js / send-contract-email.js) :
  // un échec d'envoi ne remet jamais en cause la confirmation du paiement
  // ci-dessus, déjà enregistrée.
  await deps.sendConfirmationEmail(updated);
  await deps.sendContractEmail(updated);
}

async function handleFailedOrCanceled(deps, payment) {
  const reservation = await resolveReservation(deps, payment);
  if (!reservation) {
    console.error("[mollie-webhook] Aucune réservation trouvée pour le paiement (échec/annulation/expiration).");
    return;
  }
  // Ne jamais écraser un état final déjà atteint (idempotence + on ne
  // "dé-paie" jamais une réservation payée à cause d'un événement tardif).
  if (reservation.status === "paid" || reservation.status === "cancelled") return;
  await deps.store.updateReservationStatus(reservation.id, "cancelled", {
    paymentId: payment.id,
    failureReason: payment.status
  });
}

// Statuts Mollie possibles : open, pending, authorized, paid, canceled,
// expired, failed. Seuls paid/canceled/expired/failed sont des états
// finaux ; les autres n'entraînent aucune action ici (rien à confirmer ni
// à annuler tant que l'issue n'est pas connue).
async function processPaymentStatus(deps, payment) {
  switch (payment.status) {
    case "paid":
      await handlePaid(deps, payment);
      break;
    case "canceled":
    case "expired":
    case "failed":
      await handleFailedOrCanceled(deps, payment);
      break;
    default:
      break;
  }
}

module.exports = { processPaymentStatus, resolveReservation, handlePaid, handleFailedOrCanceled };
