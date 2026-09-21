// src/lib/mollie-client.js
//
// Client Mollie minimal basé sur fetch() natif, en remplacement du SDK
// @mollie/api-client utilisé par l'ancienne implémentation Netlify (Phase
// A) : ce SDK cible le runtime Node classique et n'offre aucune garantie de
// compatibilité avec le runtime Cloudflare Workers. L'API REST de Mollie
// est un simple JSON sur HTTPS ; ce fichier implémente les appels utilisés
// par ce projet :
//   - créer un paiement / relire son statut (paiement de location, voir
//     create-payment.js/mollie-webhook.js) — voir
//     https://docs.mollie.com/reference/v2/payments-api/create-payment et
//     .../get-payment ;
//   - annuler un paiement, créer/lister des captures (empreinte bancaire /
//     caution à préautorisation manuelle, voir
//     src/lib/deposit-authorizations.js) — voir
//     https://docs.mollie.com/reference/v2/payments-api/cancel-payment,
//     .../captures-api/create-capture et .../captures-api/list-captures.

const MOLLIE_API_BASE = "https://api.mollie.com/v2";

class MollieApiError extends Error {
  constructor(message, statusCode, body) {
    super(message);
    this.name = "MollieApiError";
    this.statusCode = statusCode;
    this.body = body;
  }
}

async function mollieRequest(apiKey, path, { method = "GET", body, idempotencyKey } = {}) {
  const headers = { Authorization: `Bearer ${apiKey}` };
  if (body) headers["Content-Type"] = "application/json";
  // Réutilise la clé générée côté client (voir js/app.js, initPaiementPage) :
  // un double-clic/retry réseau avec la même clé renvoie la réponse déjà
  // enregistrée par Mollie au lieu de créer un second paiement — voir
  // https://docs.mollie.com/reference/api-idempotency.
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  const res = await fetch(`${MOLLIE_API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new MollieApiError((json && json.detail) || `Erreur Mollie (${res.status})`, res.status, json);
  }
  return json;
}

function createPayment(apiKey, paymentData, idempotencyKey) {
  return mollieRequest(apiKey, "/payments", { method: "POST", body: paymentData, idempotencyKey });
}

function getPayment(apiKey, paymentId) {
  return mollieRequest(apiKey, `/payments/${encodeURIComponent(paymentId)}`);
}

// Annule un paiement — pour une autorisation carte (captureMode manual)
// pas encore (totalement) capturée, cela libère l'empreinte bancaire
// auprès de la banque du client. Réponse 204 sans corps en cas de succès
// (mollieRequest le gère déjà : json() échoue silencieusement -> null).
// Voir https://docs.mollie.com/reference/v2/payments-api/cancel-payment.
function cancelPayment(apiKey, paymentId) {
  return mollieRequest(apiKey, `/payments/${encodeURIComponent(paymentId)}`, { method: "DELETE" });
}

// Capture tout ou partie d'un paiement autorisé (captureMode manual).
// `captureData` doit au minimum contenir { amount: { currency, value } } —
// voir https://docs.mollie.com/reference/v2/captures-api/create-capture.
// Le montant n'est JAMAIS accepté tel quel depuis le navigateur : voir
// src/lib/deposit-authorizations.js pour la validation serveur (cohérence
// avec le montant restant autorisé) avant cet appel.
function createCapture(apiKey, paymentId, captureData, idempotencyKey) {
  return mollieRequest(apiKey, `/payments/${encodeURIComponent(paymentId)}/captures`, {
    method: "POST",
    body: captureData,
    idempotencyKey
  });
}

// Liste les captures déjà effectuées pour un paiement — utilisé pour
// vérifier l'état réel côté Mollie plutôt que de ne se fier qu'à notre
// propre total cumulé. Voir
// https://docs.mollie.com/reference/v2/captures-api/list-captures.
function listCaptures(apiKey, paymentId) {
  return mollieRequest(apiKey, `/payments/${encodeURIComponent(paymentId)}/captures`);
}

function releaseAuthorization(apiKey, paymentId) {
  return mollieRequest(apiKey, `/payments/${encodeURIComponent(paymentId)}/release-authorization`, { method: "POST" });
}

module.exports = { releaseAuthorization, createPayment, getPayment, cancelPayment, createCapture, listCaptures, MollieApiError };
