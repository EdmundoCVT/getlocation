// src/api/contracts-create.js
//
// Enregistre un nouveau contrat (déclenché quand l'agence clique sur
// "Générer le contrat officiel" dans contrat.html) : assigne un numéro
// unique et persiste les données du formulaire en KV (voir
// src/lib/contract-store.js). Page /contrat non authentifiée (choix
// assumé par l'agence) : même niveau de confiance que le reste du
// formulaire, protégé uniquement par une limite de débit best-effort.

const { saveContract } = require("../lib/contract-store.js");
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

// Champs minimaux requis pour qu'un contrat ait un sens (véhicule, dates,
// identité du locataire). Les autres champs (adresse, permis, options...)
// restent optionnels à ce stade, comme pour le reste du formulaire.
function estValide(rawData) {
  return Boolean(
    rawData &&
      typeof rawData === "object" &&
      rawData.vehiculeId &&
      rawData.depart &&
      rawData.retour &&
      rawData.nom &&
      rawData.prenom
  );
}

async function handleCreateContract(request, env) {
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

  const rate = await checkRateLimit(env, `contracts-create:${clientIp(request)}`, { windowMs: 60000, maxRequests: 30 });
  if (!rate.allowed) {
    return new Response(JSON.stringify({ error: "Trop de requêtes, veuillez réessayer dans un instant." }), {
      status: 429,
      headers: { ...headers, "Retry-After": String(rate.retryAfterSeconds) }
    });
  }

  let rawData;
  try {
    rawData = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: "Corps de requête JSON invalide" }), { status: 400, headers });
  }

  if (!estValide(rawData)) {
    return new Response(JSON.stringify({ error: "Champs requis manquants (véhicule, dates, nom, prénom)" }), { status: 400, headers });
  }

  const record = await saveContract(env, rawData);
  return new Response(JSON.stringify({ numero: record.numero, createdAt: record.createdAt }), { status: 200, headers });
}

module.exports = { handleCreateContract };
