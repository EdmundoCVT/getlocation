// functions/api/mollie-webhook.js
//
// Adaptateur Cloudflare Pages Functions de netlify/functions/
// mollie-webhook.js — voir ce fichier pour le contexte complet (modèle de
// sécurité Mollie : ne jamais faire confiance au corps du webhook,
// toujours revérifier le statut réel auprès de l'API ; idempotence). La
// logique métier (resolveReservation/handlePaid/handleFailedOrCanceled/
// processPaymentStatus) vit dans lib/server/process-payment-status.js,
// partagée avec la version Netlify — rien n'est dupliqué ou réimplémenté
// ici, seule la traduction Request/env ↔ cette logique change.
//
// Email : send-confirmation-email.js/send-contract-email.js (Gmail/
// nodemailer, comme côté Netlify) ne peuvent PAS être importés ici —
// nodemailer dépend de modules Node natifs (events/stream/crypto/net) qui
// font échouer le bundle esbuild de ce Worker, et même avec le flag de
// compatibilité nodejs_compat, le transport SMTP de nodemailer n'est pas
// garanti fonctionner sur le runtime Workers (sockets bruts). Remplacement
// par Resend (API HTTP, compatible fetch()) prévu en B.4 — PAS ENCORE FAIT.
// En attendant, l'envoi d'email est un no-op explicite : la confirmation du
// paiement (le plus important, voir processPaymentStatus) fonctionne
// normalement, seul l'email n'est pas envoyé — comportement "best effort"
// déjà existant côté Netlify quand GMAIL_USER/GMAIL_APP_PASSWORD sont
// absentes, ici permanent tant que B.4 n'est pas fait.
async function sendConfirmationEmailStub() {
  console.warn("[mollie-webhook] Email de confirmation non envoyé : Resend (B.4) pas encore implémenté.");
}
async function sendContractEmailStub() {
  console.warn("[mollie-webhook] Email contrat agence non envoyé : Resend (B.4) pas encore implémenté.");
}

const { molliePaymentsGet } = require("../../lib/server/mollie-client.js");
const { createReservationStore } = require("../../lib/server/reservation-store-kv.js");
const { processPaymentStatus } = require("../../lib/server/process-payment-status.js");

async function onRequestPost({ request, env }) {
  const apiKey = env.MOLLIE_API_KEY;
  if (!apiKey) {
    console.error("[mollie-webhook] MOLLIE_API_KEY manquante.");
    return new Response("Webhook non configuré", { status: 500 });
  }

  let store;
  try {
    store = createReservationStore(env.RESERVATIONS_KV);
  } catch (err) {
    console.error("[mollie-webhook] Binding KV manquant :", err && err.message);
    return new Response("Service temporairement indisponible", { status: 500 });
  }
  const deps = { store, sendConfirmationEmail: sendConfirmationEmailStub, sendContractEmail: sendContractEmailStub };

  // Mollie envoie application/x-www-form-urlencoded (`id=tr_xxx`), jamais du
  // JSON — voir https://docs.mollie.com/reference/webhooks. request.text()
  // gère nativement le décodage (Web-standard), pas besoin de
  // atob/Buffer comme côté Netlify (event.body pouvait arriver en base64).
  const rawBody = await request.text();
  const paymentId = new URLSearchParams(rawBody).get("id");
  if (!paymentId) {
    return new Response("id manquant", { status: 400 });
  }

  try {
    // Ne jamais faire confiance au corps du webhook : on revérifie toujours
    // le statut réel directement auprès de l'API Mollie avec cet id.
    const payment = await molliePaymentsGet(apiKey, paymentId);
    await processPaymentStatus(deps, payment);
    return new Response(JSON.stringify({ received: true }), { status: 200 });
  } catch (err) {
    if (err && err.status === 404) {
      // id inconnu de Mollie : ne pas faire échouer le webhook (évite des
      // retentatives inutiles pendant ~26h) ni révéler d'information — voir
      // https://docs.mollie.com/reference/webhooks.
      console.error("[mollie-webhook] Paiement inconnu de Mollie pour cet id.");
      return new Response(JSON.stringify({ received: true }), { status: 200 });
    }
    console.error("[mollie-webhook] Erreur de traitement :", err && err.message);
    // 500 => Mollie retentera l'envoi automatiquement plus tard.
    return new Response("Erreur interne", { status: 500 });
  }
}

export { onRequestPost };
