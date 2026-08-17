// src/api/contracts-update.js
//
// Met à jour un contrat existant en place (typiquement pour enregistrer le
// kilométrage retour d'une location déjà commencée) — déclenché quand
// l'agence rouvre un contrat depuis l'historique de contrat.html ("Ouvrir")
// puis clique sur "Mettre à jour le contrat". Le numéro et la date de
// création d'origine sont conservés (voir src/lib/contract-store.js).

const { updateContract } = require("../lib/contract-store.js");
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

const NUMERO_REGEX = /^GL-\d{8}-\d{4}$/;

function estValide(body) {
  return Boolean(
    body &&
      typeof body === "object" &&
      typeof body.numero === "string" &&
      NUMERO_REGEX.test(body.numero) &&
      body.rawData &&
      typeof body.rawData === "object"
  );
}

async function handleUpdateContract(request, env) {
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

  const rate = await checkRateLimit(env, `contracts-update:${clientIp(request)}`, { windowMs: 60000, maxRequests: 30 });
  if (!rate.allowed) {
    return new Response(JSON.stringify({ error: "Trop de requêtes, veuillez réessayer dans un instant." }), {
      status: 429,
      headers: { ...headers, "Retry-After": String(rate.retryAfterSeconds) }
    });
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: "Corps de requête JSON invalide" }), { status: 400, headers });
  }

  if (!estValide(body)) {
    return new Response(JSON.stringify({ error: "Numéro de contrat ou données manquantes/invalides" }), { status: 400, headers });
  }

  const record = await updateContract(env, body.numero, body.rawData);
  if (!record) {
    return new Response(JSON.stringify({ error: "Contrat introuvable : " + body.numero }), { status: 404, headers });
  }

  return new Response(JSON.stringify({ numero: record.numero, updatedAt: record.updatedAt }), { status: 200, headers });
}

module.exports = { handleUpdateContract };
