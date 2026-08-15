// Validation du lien documentaire client. Le jeton arrive uniquement dans
// l'en-tête Authorization (jamais dans l'URL), est haché côté serveur, puis
// résolu via un index KV non énumérable par le client.

const { getVehiculeParId } = require("../../js/data.js");
const { hashDocumentToken } = require("../lib/document-access-token.js");
const { findReservationByDocumentTokenHash } = require("../lib/reservation-store.js");
const { checkRateLimit } = require("../lib/rate-limiter.js");

function headers() {
  return {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer"
  };
}

function clientIp(request) {
  return request.headers.get("cf-connecting-ip") ||
    (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    "unknown";
}

function bearerToken(request) {
  const authorization = request.headers.get("authorization") || "";
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization);
  return match ? match[1] : null;
}

function hasOption(reservation, id) {
  return Array.isArray(reservation.options) && reservation.options.some((option) => option && option.id === id);
}

function safeAccessView(reservation) {
  const vehicle = getVehiculeParId(reservation.vehiculeId);
  return {
    reference: reservation.id,
    vehicle: vehicle ? { id: vehicle.id, name: vehicle.nom } : null,
    documentsStatus: reservation.documentsStatus || "pending",
    secondDriverRequired: hasOption(reservation, "second-conducteur"),
    deliveryAddressRequired: hasOption(reservation, "livraison-adresse") ||
      reservation.lieuPrise === "livraison" || reservation.lieuRetour === "livraison",
    expiresAt: reservation.documentAccess && reservation.documentAccess.expiresAt
  };
}

async function handleDocumentsAccess(request, env) {
  const responseHeaders = headers();
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { ...responseHeaders, "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Authorization" }
    });
  }
  if (request.method !== "GET") {
    return new Response(JSON.stringify({ error: "Méthode non autorisée" }), { status: 405, headers: responseHeaders });
  }

  const rate = await checkRateLimit(env, `documents-access:${clientIp(request)}`, { windowMs: 60000, maxRequests: 20 });
  if (!rate.allowed) {
    return new Response(JSON.stringify({ error: "Trop de tentatives. Réessayez dans un instant." }), {
      status: 429,
      headers: { ...responseHeaders, "Retry-After": String(rate.retryAfterSeconds) }
    });
  }

  const token = bearerToken(request);
  if (!token || !env.DOCUMENT_TOKEN_PEPPER) {
    return new Response(JSON.stringify({ error: "Lien invalide ou expiré" }), { status: 401, headers: responseHeaders });
  }

  const tokenHash = await hashDocumentToken(token, env.DOCUMENT_TOKEN_PEPPER);
  const reservation = await findReservationByDocumentTokenHash(env, tokenHash);
  const access = reservation && reservation.documentAccess;
  const expired = !access || !access.expiresAt || new Date(access.expiresAt).getTime() <= Date.now();
  const invalid = !reservation || reservation.status !== "paid" || access.tokenHash !== tokenHash || access.revokedAt || expired;
  if (invalid) {
    return new Response(JSON.stringify({ error: "Lien invalide ou expiré" }), { status: 401, headers: responseHeaders });
  }

  return new Response(JSON.stringify(safeAccessView(reservation)), { status: 200, headers: responseHeaders });
}

module.exports = { handleDocumentsAccess };
