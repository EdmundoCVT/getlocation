// src/api/contracts-list.js
//
// Retourne les derniers contrats enregistrés (section "Derniers contrats"
// de contrat.html), utilisés à la fois pour l'affichage de l'historique et
// pour les actions "Ouvrir"/"Dupliquer" (les données sont déjà en mémoire
// côté client une fois ce endpoint appelé, pas de endpoint "get one"
// séparé — cohérent avec la faible volumétrie visée, voir contract-store.js).

const { listRecentContracts } = require("../lib/contract-store.js");
const { checkRateLimit } = require("../lib/rate-limiter.js");

function corsHeaders(request, env) {
  const origins = new Set(["https://getlocation.fr", "https://www.getlocation.fr", new URL(request.url).origin]);
  if (env.ALLOWED_ORIGINS) {
    env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean).forEach((o) => origins.add(o));
  }
  const originHeader = request.headers.get("origin");
  const headers = { "Content-Type": "application/json", Vary: "Origin", "Cache-Control": "no-store" };
  if (originHeader && origins.has(originHeader)) {
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

async function handleListContracts(request, env) {
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

  const rate = await checkRateLimit(env, `contracts-list:${clientIp(request)}`, { windowMs: 60000, maxRequests: 60 });
  if (!rate.allowed) {
    return new Response(JSON.stringify({ error: "Trop de requêtes, veuillez réessayer dans un instant." }), {
      status: 429,
      headers: { ...headers, "Retry-After": String(rate.retryAfterSeconds) }
    });
  }

  const contracts = await listRecentContracts(env, 20);
  return new Response(JSON.stringify({ contracts }), { status: 200, headers });
}

module.exports = { handleListContracts };
