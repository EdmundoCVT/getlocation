// src/api/mollie-deposit-webhook.js
//
// Webhook Mollie dédié à l'empreinte bancaire (caution à préautorisation
// manuelle) — voir src/lib/deposit-authorizations.js. Endpoint distinct de
// /api/mollie-webhook (paiement de location, clé MOLLIE_API_KEY) : celui-ci
// utilise MOLLIE_DEPOSIT_API_KEY (secret Cloudflare Worker DISTINCT), pour
// qu'une caution de test ne puisse jamais interférer avec un paiement de
// location réel — voir migrations/0005_deposit_authorizations.sql.
//
// Même modèle de sécurité Mollie que mollie-webhook.js (voir ce fichier
// pour le détail complet) : le corps du webhook ne contient qu'un id de
// paiement, en application/x-www-form-urlencoded (`id=tr_xxx`), jamais un
// statut de confiance — celui-ci est TOUJOURS revérifié auprès de l'API
// Mollie avant toute mise à jour (voir
// src/lib/deposit-authorizations.js#syncDepositAuthorizationFromWebhook).
//
// Transmis comme `webhookUrl` à chaque création d'empreinte (voir
// deposit-authorizations.js#createDepositAuthorization) : aucune
// configuration manuelle dans le dashboard Mollie n'est nécessaire.

const { getPayment } = require("../lib/mollie-client.js");
const { getDepositAuthorizationByMolliePaymentId, syncDepositAuthorizationFromWebhook } = require("../lib/deposit-authorizations.js");
const { recordAuditEvent } = require("../lib/audit-log.js");

async function handleMollieDepositWebhook(request, env) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const apiKey = env.MOLLIE_DEPOSIT_API_KEY;
  if (!apiKey) {
    console.error("[mollie-deposit-webhook] MOLLIE_DEPOSIT_API_KEY manquante.");
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

    const before = await getDepositAuthorizationByMolliePaymentId(env, paymentId);
    if (!before) {
      // id inconnu de notre côté (ex. notification tardive après une
      // tentative jamais persistée, ou paiement d'un autre usage de cette
      // clé) : jamais une erreur, jamais d'information révélée — même
      // posture que mollie-webhook.js face à un id inconnu de Mollie.
      return new Response(JSON.stringify({ received: true }), { status: 200 });
    }

    const updated = await syncDepositAuthorizationFromWebhook(env, payment);
    if (updated && updated.status !== before.status) {
      await recordAuditEvent(env, {
        actor: "mollie",
        eventType: "deposit_authorization_status_changed",
        entityType: "deposit_authorization",
        entityId: updated.id,
        metadata: { from: before.status, to: updated.status }
      });
    }
    return new Response(JSON.stringify({ received: true }), { status: 200 });
  } catch (err) {
    if (err && err.statusCode === 404) {
      // id inconnu de Mollie : ne pas faire échouer le webhook (évite des
      // retentatives inutiles pendant ~26h) ni révéler d'information — voir
      // https://docs.mollie.com/reference/webhooks.
      console.error("[mollie-deposit-webhook] Paiement inconnu de Mollie pour cet id.");
      return new Response(JSON.stringify({ received: true }), { status: 200 });
    }
    console.error("[mollie-deposit-webhook] Erreur de traitement :", err && err.message);
    // 500 => Mollie retentera l'envoi automatiquement plus tard.
    return new Response("Erreur interne", { status: 500 });
  }
}

module.exports = { handleMollieDepositWebhook };
