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

const { molliePaymentsGet } = require("../../lib/server/mollie-client.js");
const reservationStore = require("../../lib/server/reservation-store.js");
const { sendConfirmationEmail } = require("../../lib/server/send-confirmation-email.js");
const { sendContractEmail } = require("../../lib/server/send-contract-email.js");
const { processPaymentStatus: processPaymentStatusShared } = require("../../lib/server/process-payment-status.js");

// Logique métier (resolveReservation/handlePaid/handleFailedOrCanceled/
// processPaymentStatus) déplacée dans lib/server/process-payment-status.js
// — partagée avec le futur adaptateur Cloudflare functions/api/
// mollie-webhook.js (voir plan de migration, B.1/B.3), qui utilisera un
// store Cloudflare KV à la place de reservationStore (Netlify Blobs) ici.
const deps = { store: reservationStore, sendConfirmationEmail, sendContractEmail };

// Conserve la signature à un seul argument utilisée par
// tests/mollie-webhook.test.js et par le handler ci-dessous.
function processPaymentStatus(payment) {
  return processPaymentStatusShared(deps, payment);
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
  // atob()/TextDecoder (Web-standard) plutôt que Buffer.from (API Node
  // "legacy") : disponibles nativement en Node, navigateurs et Cloudflare
  // Workers — voir plan de migration Cloudflare, B.2.
  const rawBody = event.isBase64Encoded
    ? new TextDecoder().decode(Uint8Array.from(atob(event.body || ""), (c) => c.charCodeAt(0)))
    : (event.body || "");
  const paymentId = new URLSearchParams(rawBody).get("id");
  if (!paymentId) {
    return { statusCode: 400, body: "id manquant" };
  }

  try {
    // Ne jamais faire confiance au corps du webhook : on revérifie toujours
    // le statut réel directement auprès de l'API Mollie avec cet id.
    const payment = await molliePaymentsGet(apiKey, paymentId);
    await processPaymentStatus(payment);
    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  } catch (err) {
    if (err && err.status === 404) {
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
