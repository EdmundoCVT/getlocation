// src/api/contracts-manual-update.js
//
// Met à jour un contrat manuel existant en place (typiquement pour
// enregistrer le kilométrage retour ou corriger une information avant
// restitution) — déclenché quand l'agence rouvre un contrat depuis
// l'historique de contrat.html ("Ouvrir") puis clique sur "Mettre à jour
// le contrat". L'id et le numéro sont conservés (voir
// src/lib/reservation-store.js, updateManualContract).

const { updateManualContract } = require("../lib/reservation-store.js");
const { checkRateLimit } = require("../lib/rate-limiter.js");

function getAllowedOrigins(request, env) {
  const origins = new Set(["https://getlocation.fr", "https://www.getlocation.fr", new URL(request.url).origin]);
  if (env.ALLOWED_ORIGINS) {
    env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean).forEach((o) => origins.add(o));
  }
  return origins;
}

function corsHeaders(request, env) {
  const allowed = getAllowedOrigins(request, env);
  const originHeader = request.headers.get("origin");
  const headers = { "Content-Type": "application/json", Vary: "Origin", "Cache-Control": "no-store" };
  if (originHeader && allowed.has(originHeader)) {
    headers["Access-Control-Allow-Origin"] = originHeader;
  }
  return headers;
}

function clientIp(request) {
  return (
    request.headers.get("cf-connecting-ip") ||
    (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    "unknown"
  );
}

const MAX_BODY_LEN = 20000;
const ID_REGEX = /^res_[a-f0-9]{32}$/;

function estValide(body) {
  return Boolean(
    body &&
      typeof body === "object" &&
      typeof body.id === "string" &&
      ID_REGEX.test(body.id) &&
      body.rawData &&
      typeof body.rawData === "object"
  );
}

async function handleContractsManualUpdate(request, env) {
  const headers = corsHeaders(request, env);

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { ...headers, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" }
    });
  }
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Méthode non autorisée" }), { status: 405, headers });
  }

  const rate = await checkRateLimit(env, `contracts-manual-update:${clientIp(request)}`, { windowMs: 60000, maxRequests: 30 });
  if (!rate.allowed) {
    return new Response(JSON.stringify({ error: "Trop de requêtes, veuillez réessayer dans un instant." }), {
      status: 429,
      headers: { ...headers, "Retry-After": String(rate.retryAfterSeconds) }
    });
  }

  let body;
  try {
    const rawBody = await request.text();
    if (!rawBody || rawBody.length > MAX_BODY_LEN) throw new Error("corps de requête vide ou trop volumineux");
    body = JSON.parse(rawBody);
  } catch (e) {
    return new Response(JSON.stringify({ error: "Requête invalide" }), { status: 400, headers });
  }

  if (!estValide(body)) {
    return new Response(JSON.stringify({ error: "Identifiant de contrat ou données manquantes/invalides" }), { status: 400, headers });
  }

  const record = await updateManualContract(env, body.id, body.rawData);
  if (!record) {
    return new Response(JSON.stringify({ error: "Contrat manuel introuvable" }), { status: 404, headers });
  }

  return new Response(JSON.stringify({ id: record.id, numero: record.contractNumero, updatedAt: record.updatedAt }), { status: 200, headers });
}

module.exports = { handleContractsManualUpdate };
