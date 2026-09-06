// src/api/agency-deposits.js
//
// Caution d'une location (Lot 2, voir CLAUDE.md) — jamais confondue avec un
// paiement de location (voir src/lib/deposits.js). Protégé par session
// agence — CSRF + origine stricte sur les écritures.

const { requireAgencySession } = require("../lib/agency-auth.js");
const {
  createDepositRequest,
  updateDepositRequest,
  receiveDeposit,
  returnDeposit,
  getDepositForRental
} = require("../lib/deposits.js");
const { getRentalById } = require("../lib/rentals.js");
const { recordAuditEvent } = require("../lib/audit-log.js");

function corsHeaders(request, env) {
  const origins = new Set(["https://getlocation.fr", "https://www.getlocation.fr", new URL(request.url).origin]);
  if (env.ALLOWED_ORIGINS) {
    env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean).forEach((o) => origins.add(o));
  }
  const originHeader = request.headers.get("origin");
  const headers = { "Content-Type": "application/json", Vary: "Origin", "Cache-Control": "no-store" };
  if (originHeader && origins.has(originHeader)) headers["Access-Control-Allow-Origin"] = originHeader;
  return headers;
}

const MAX_BODY_LEN = 5000;

async function handleGet(request, env, headers) {
  const auth = await requireAgencySession(request, env);
  if (auth.error) return auth.error;

  const url = new URL(request.url);
  const rentalId = url.searchParams.get("rentalId");
  if (!rentalId) return new Response(JSON.stringify({ error: "Paramètre rentalId requis" }), { status: 400, headers });

  const deposit = await getDepositForRental(env, rentalId.slice(0, 100));
  return new Response(JSON.stringify({ deposit }), { status: 200, headers });
}

async function handlePost(request, env, headers) {
  const auth = await requireAgencySession(request, env, { requireCsrf: true, requireOrigin: true });
  if (auth.error) return auth.error;

  let body;
  try {
    const rawBody = await request.text();
    if (!rawBody || rawBody.length > MAX_BODY_LEN) throw new Error("corps de requête vide ou trop volumineux");
    body = JSON.parse(rawBody);
  } catch (e) {
    return new Response(JSON.stringify({ error: "Requête invalide" }), { status: 400, headers });
  }

  try {
    if (body.action === "create") {
      const rental = await getRentalById(env, body.rentalId);
      if (!rental) return new Response(JSON.stringify({ error: "Location introuvable" }), { status: 404, headers });
      const deposit = await createDepositRequest(env, body.rentalId, body.data || {}, auth.session.operator);
      await recordAuditEvent(env, { actor: auth.session.operator, eventType: "deposit_requested", entityType: "deposit", entityId: deposit.id });
      return new Response(JSON.stringify({ deposit }), { status: 200, headers });
    }
    if (body.action === "update-request") {
      const deposit = await updateDepositRequest(env, body.id, body.data || {}, auth.session.operator);
      if (!deposit) return new Response(JSON.stringify({ error: "Caution introuvable" }), { status: 404, headers });
      return new Response(JSON.stringify({ deposit }), { status: 200, headers });
    }
    if (body.action === "receive") {
      const deposit = await receiveDeposit(env, body.id, auth.session.operator);
      if (!deposit) return new Response(JSON.stringify({ error: "Caution introuvable" }), { status: 404, headers });
      await recordAuditEvent(env, { actor: auth.session.operator, eventType: "deposit_received", entityType: "deposit", entityId: deposit.id });
      return new Response(JSON.stringify({ deposit }), { status: 200, headers });
    }
    if (body.action === "return") {
      const deposit = await returnDeposit(env, body.id, body.data || {}, auth.session.operator);
      if (!deposit) return new Response(JSON.stringify({ error: "Caution introuvable" }), { status: 404, headers });
      await recordAuditEvent(env, {
        actor: auth.session.operator,
        eventType: deposit.status === "restituee" ? "deposit_returned" : "deposit_retained",
        entityType: "deposit",
        entityId: deposit.id,
        metadata: { returnedAmountCents: deposit.returnedAmountCents, retainedAmountCents: deposit.retainedAmountCents }
      });
      return new Response(JSON.stringify({ deposit }), { status: 200, headers });
    }
    return new Response(JSON.stringify({ error: "Action inconnue" }), { status: 400, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || "Requête invalide" }), { status: 400, headers });
  }
}

async function handleAgencyDeposits(request, env) {
  const headers = corsHeaders(request, env);
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { ...headers, "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Agency-Csrf" }
    });
  }
  if (request.method !== "GET" && request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Méthode non autorisée" }), { status: 405, headers });
  }
  return request.method === "GET" ? handleGet(request, env, headers) : handlePost(request, env, headers);
}

module.exports = { handleAgencyDeposits };
