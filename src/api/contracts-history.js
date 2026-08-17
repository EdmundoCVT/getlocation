// src/api/contracts-history.js
//
// Historique unifié des contrats numérotés (section "Derniers contrats" de
// contrat.html) : contrats manuels ET dossiers des réservations payées en
// ligne (voir src/lib/reservation-store.js, listContractsHistory). Vue
// volontairement minimale pour les dossiers en ligne (jamais de données
// personnelles sensibles au-delà du nom) — voir le commentaire détaillé
// dans listContractsHistory.

const { listContractsHistory } = require("../lib/reservation-store.js");
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

async function handleContractsHistory(request, env) {
  const headers = corsHeaders(request, env);

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { ...headers, "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" }
    });
  }
  if (request.method !== "GET") {
    return new Response(JSON.stringify({ error: "Méthode non autorisée" }), { status: 405, headers });
  }

  const rate = await checkRateLimit(env, `contracts-history:${clientIp(request)}`, { windowMs: 60000, maxRequests: 60 });
  if (!rate.allowed) {
    return new Response(JSON.stringify({ error: "Trop de requêtes, veuillez réessayer dans un instant." }), {
      status: 429,
      headers: { ...headers, "Retry-After": String(rate.retryAfterSeconds) }
    });
  }

  const contracts = await listContractsHistory(env, 30);
  return new Response(JSON.stringify({ contracts }), { status: 200, headers });
}

module.exports = { handleContractsHistory };
