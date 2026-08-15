const { getVehiculeParId } = require("../../js/data.js");
const { hashAgencyDocumentToken } = require("../lib/agency-document-token.js");
const { findReservationByAgencyDocumentTokenHash } = require("../lib/reservation-store.js");
const { checkRateLimit } = require("../lib/rate-limiter.js");

function jsonHeaders() {
  return { "Content-Type": "application/json", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
}

function bearerToken(request) {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.get("authorization") || "");
  return match ? match[1] : null;
}

function clientIp(request) {
  return request.headers.get("cf-connecting-ip") || (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
}

async function resolveAgencyDocumentAccess(request, env) {
  const token = bearerToken(request);
  if (!token || !env.DOCUMENT_TOKEN_PEPPER) return null;
  const tokenHash = await hashAgencyDocumentToken(token, env.DOCUMENT_TOKEN_PEPPER);
  const reservation = await findReservationByAgencyDocumentTokenHash(env, tokenHash);
  const access = reservation && reservation.agencyDocumentAccess;
  const expired = !access || !access.expiresAt || new Date(access.expiresAt).getTime() <= Date.now();
  const invalid = !reservation || reservation.status !== "paid" || reservation.documentsStatus !== "submitted" ||
    access.tokenHash !== tokenHash || access.revokedAt || expired;
  return invalid ? null : { reservation };
}

async function handleAgencyDocumentsAccess(request, env) {
  const headers = jsonHeaders();
  if (request.method !== "GET") return new Response(JSON.stringify({ error: "Méthode non autorisée" }), { status: 405, headers });
  const rate = await checkRateLimit(env, `agency-documents:${clientIp(request)}`, { windowMs: 60000, maxRequests: 30 });
  if (!rate.allowed) return new Response(JSON.stringify({ error: "Trop de tentatives" }), { status: 429, headers });
  const resolved = await resolveAgencyDocumentAccess(request, env);
  if (!resolved) return new Response(JSON.stringify({ error: "Lien invalide ou expiré" }), { status: 401, headers });
  const reservation = resolved.reservation;
  const vehicle = getVehiculeParId(reservation.vehiculeId);
  const files = Array.isArray(reservation.documentFiles) ? reservation.documentFiles : [];
  return new Response(JSON.stringify({
    reference: reservation.id,
    vehicle: vehicle ? vehicle.nom : reservation.vehiculeId,
    submittedAt: reservation.documentsSubmittedAt,
    expiresAt: reservation.agencyDocumentAccess.expiresAt,
    files: files.map((file, index) => ({ id: String(index), type: file.type, contentType: file.contentType, size: file.size }))
  }), { status: 200, headers });
}

module.exports = { handleAgencyDocumentsAccess, resolveAgencyDocumentAccess };
