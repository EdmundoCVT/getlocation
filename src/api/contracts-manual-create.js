// src/api/contracts-manual-create.js
//
// Enregistre un nouveau contrat créé à la main par l'agence depuis la vue
// AGENCE historique de contrat.html (initOwnerView, bouton "Générer le
// contrat officiel") — client sans réservation en ligne, ou contrat
// recréé après une location déjà effectuée. Assigne un numéro unique et
// persiste les données du formulaire (voir src/lib/reservation-store.js,
// createManualContract). Depuis le Lot 1 (voir CLAUDE.md), nécessite une
// session agence valide (Edmundo/Antonio, src/lib/agency-auth.js) — la
// limite de débit ci-dessous reste une protection best-effort
// complémentaire, pas le seul rempart.

const { createManualContract } = require("../lib/reservation-store.js");
const { checkRateLimit } = require("../lib/rate-limiter.js");
const { requireAgencySession } = require("../lib/agency-auth.js");

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

const MAX_BODY_LEN = 20000; // formulaire agence complet, large marge

// Champs minimaux requis pour qu'un contrat ait un sens (véhicule, dates,
// identité du locataire). Les autres champs (adresse, permis, options,
// notes...) restent optionnels, comme pour le reste du formulaire.
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

async function handleContractsManualCreate(request, env) {
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

  // Lot 1 (voir CLAUDE.md) : cet endpoint n'est plus accessible sans session
  // agence valide (Edmundo/Antonio) — remplace le modèle de confiance décrit
  // ci-dessus ("page /contrat non authentifiée"). Vérifié AVANT le
  // rate-limit/le corps de la requête.
  const auth = await requireAgencySession(request, env, { requireCsrf: true, requireOrigin: true });
  if (auth.error) return auth.error;

  const rate = await checkRateLimit(env, `contracts-manual-create:${clientIp(request)}`, { windowMs: 60000, maxRequests: 30 });
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

  const rawData = body && body.rawData;
  if (!estValide(rawData)) {
    return new Response(JSON.stringify({ error: "Champs requis manquants (véhicule, dates, nom, prénom)" }), { status: 400, headers });
  }

  const record = await createManualContract(env, rawData, auth.session.operator);
  return new Response(JSON.stringify({ id: record.id, numero: record.contractNumero, createdAt: record.createdAt }), { status: 200, headers });
}

module.exports = { handleContractsManualCreate };
