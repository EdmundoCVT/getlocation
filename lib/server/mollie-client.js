// lib/server/mollie-client.js
//
// Remplace le SDK @mollie/api-client par des appels REST directs (fetch)
// — voir plan de migration Cloudflare, B.2. Le SDK Node n'est pas garanti
// compatible avec le runtime Cloudflare Workers ; fetch() est disponible
// nativement partout (Node, Workers, navigateurs).
//
// Ne couvre que les deux opérations réellement utilisées par ce projet
// (créer un paiement, relire son statut) — voir
// https://docs.mollie.com/reference/v2/payments-api/create-payment et
// https://docs.mollie.com/reference/v2/payments-api/get-payment.
//
// Point critique (voir https://docs.mollie.com/reference/api-idempotency) :
// la clé d'idempotence passe en HEADER HTTP `Idempotency-Key`, jamais en
// champ du corps JSON — contrairement à ce que suggérerait l'ancien SDK
// (option `idempotencyKey` du body). Un oubli ici romprait silencieusement
// la protection contre les doubles paiements en cas de retry réseau.

const MOLLIE_API_BASE = "https://api.mollie.com/v2";

function mollieError(status, data) {
  const message = (data && (data.detail || data.title)) || `Erreur API Mollie (HTTP ${status})`;
  const err = new Error(message);
  err.status = status;
  err.mollieResponse = data;
  return err;
}

// idempotencyKey est optionnel (ex. absent sur un GET, qui n'a pas besoin
// d'être idempotent au sens retry — Mollie l'ignore de toute façon hors
// création de ressource).
async function molliePaymentsCreate(apiKey, body, idempotencyKey) {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  const res = await fetch(`${MOLLIE_API_BASE}/payments`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw mollieError(res.status, data);
  return data;
}

async function molliePaymentsGet(apiKey, paymentId) {
  const res = await fetch(`${MOLLIE_API_BASE}/payments/${encodeURIComponent(paymentId)}`, {
    headers: { Authorization: `Bearer ${apiKey}` }
  });
  const data = await res.json();
  if (!res.ok) throw mollieError(res.status, data);
  return data;
}

module.exports = { molliePaymentsCreate, molliePaymentsGet };
