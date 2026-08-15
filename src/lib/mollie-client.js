// src/lib/mollie-client.js
//
// Client Mollie minimal basé sur fetch() natif, en remplacement du SDK
// @mollie/api-client utilisé par l'ancienne implémentation Netlify (Phase
// A) : ce SDK cible le runtime Node classique et n'offre aucune garantie de
// compatibilité avec le runtime Cloudflare Workers. L'API REST de Mollie
// est un simple JSON sur HTTPS ; ce fichier n'implémente que les deux
// appels utilisés par ce projet (créer un paiement, relire son statut) —
// voir https://docs.mollie.com/reference/v2/payments-api/create-payment et
// .../get-payment.

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

module.exports = { createPayment, getPayment, MollieApiError };
