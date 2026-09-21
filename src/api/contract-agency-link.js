// src/api/contract-agency-link.js
//
// Réémet le lien AGENCE (#agencyToken=) d'une réservation payée, pour ne
// plus dépendre de retrouver l'e-mail envoyé une seule fois au moment du
// paiement (le seul endroit où ce lien existait jusqu'ici — voir
// mollie-webhook.js/deliverContractEmail). Utilisé par le bouton "Renvoyer
// le lien" de l'historique "Derniers contrats" de contrat.html (vue
// AGENCE), pour que l'agence (Edmundo ou Antonio) puisse à tout moment
// retrouver/partager le dossier d'une réservation — par exemple envoyer à
// Antonio le lien pour compléter l'état des lieux de retour depuis son
// téléphone, sans avoir à fouiller une boîte mail.
//
// Même principe que contract-manual-link.js (POST) pour les contrats
// manuels : réémettre un jeton invalide implicitement l'ancien (plus jamais
// référencé par contractAgencyAccess une fois remplacé par
// updateContractDossier ci-dessous ; l'ancien index KV expire de toute
// façon avec son TTL). Session agence requise (voir agency-auth.js) —
// aucun jeton par réservation à connaître au préalable.

const { getReservation, saveContractAgencyAccessIndex, updateContractDossier } = require("../lib/reservation-store.js");
const { checkRateLimit } = require("../lib/rate-limiter.js");
const { requireAgencySession } = require("../lib/agency-auth.js");
const { issueContractAgencyAccess } = require("../lib/contract-dossier-token.js");

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

const ID_REGEX = /^res_[a-f0-9]{32}$/;
const MAX_BODY_LEN = 200;

async function handlePost(request, env, headers) {
  const auth = await requireAgencySession(request, env, { requireCsrf: true, requireOrigin: true });
  if (auth.error) return auth.error;

  const rate = await checkRateLimit(env, `contract-agency-link:${clientIp(request)}`, { windowMs: 60000, maxRequests: 30 });
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

  if (!body || typeof body.id !== "string" || !ID_REGEX.test(body.id)) {
    return new Response(JSON.stringify({ error: "Identifiant de réservation manquant ou invalide" }), { status: 400, headers });
  }

  const reservation = await getReservation(env, body.id);
  if (!reservation || reservation.status !== "paid") {
    return new Response(JSON.stringify({ error: "Réservation introuvable ou non payée" }), { status: 404, headers });
  }

  const access = await issueContractAgencyAccess(env, reservation, reservation.paidAt || reservation.createdAt);
  if (!access) {
    return new Response(JSON.stringify({ error: "Lien indisponible pour le moment (configuration serveur)." }), { status: 503, headers });
  }
  const saved = await saveContractAgencyAccessIndex(env, body.id, access.stored.tokenHash, access.stored.expiresAt);
  if (!saved) {
    return new Response(JSON.stringify({ error: "Lien indisponible pour le moment." }), { status: 503, headers });
  }
  const updated = await updateContractDossier(env, body.id, { contractAgencyAccess: access.stored });
  if (!updated) {
    return new Response(JSON.stringify({ error: "Réservation introuvable" }), { status: 404, headers });
  }

  const origin = env.SITE_URL || new URL(request.url).origin;
  // Jeton en FRAGMENT (#agencyToken=), jamais en paramètre de requête —
  // même principe que #clientToken=/#manualToken= (voir
  // contract-dossier-token.js et contrat.html).
  return new Response(JSON.stringify({ agencyUrl: `${origin}/contrat.html#agencyToken=${access.token}` }), { status: 200, headers });
}

async function handleContractAgencyLink(request, env) {
  const headers = corsHeaders(request, env);

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { ...headers, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, X-Agency-Csrf" }
    });
  }
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Méthode non autorisée" }), { status: 405, headers });
  }
  return handlePost(request, env, headers);
}

module.exports = { handleContractAgencyLink };
