// src/api/agency-payments.js
//
// Paiements d'une location (Lot 2, voir CLAUDE.md) : plusieurs paiements
// par location, jamais de suppression définitive (voir voidPayment). Le
// résumé (total/encaissé/solde/statut) se base sur price_total_cents de la
// location, jamais sur un total envoyé par le navigateur. Protégé par
// session agence — CSRF + origine stricte sur les écritures.

const { requireAgencySession } = require("../lib/agency-auth.js");
const { addPayment, voidPayment, listPaymentsForRental, summarizePayments } = require("../lib/payments.js");
const { getRentalById } = require("../lib/rentals.js");
const { recordAuditEvent } = require("../lib/audit-log.js");
const { attemptSync } = require("../lib/sheet-sync-outbox.js");

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

  const rental = await getRentalById(env, rentalId.slice(0, 100));
  if (!rental) return new Response(JSON.stringify({ error: "Location introuvable" }), { status: 404, headers });

  const payments = await listPaymentsForRental(env, rental.id);
  const summary = summarizePayments(payments, rental.priceTotalCents || 0);
  return new Response(JSON.stringify({ payments, summary }), { status: 200, headers });
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
    if (body.action === "add") {
      const rental = await getRentalById(env, body.rentalId);
      if (!rental) return new Response(JSON.stringify({ error: "Location introuvable" }), { status: 404, headers });
      const payment = await addPayment(env, body.rentalId, body.data || {}, auth.session.operator);
      await recordAuditEvent(env, {
        actor: auth.session.operator,
        eventType: "payment_recorded",
        entityType: "payment",
        entityId: payment.id,
        metadata: { rentalId: rental.id, amountCents: payment.amountCents, method: payment.method }
      });
      await attemptSync(env, rental.id, auth.session.operator);
      return new Response(JSON.stringify({ payment }), { status: 200, headers });
    }
    if (body.action === "void") {
      const payment = await voidPayment(env, body.id, body.reason);
      if (!payment) return new Response(JSON.stringify({ error: "Paiement introuvable" }), { status: 404, headers });
      await recordAuditEvent(env, {
        actor: auth.session.operator,
        eventType: "payment_voided",
        entityType: "payment",
        entityId: payment.id,
        metadata: { amountCents: payment.amountCents }
      });
      await attemptSync(env, payment.rentalId, auth.session.operator);
      return new Response(JSON.stringify({ payment }), { status: 200, headers });
    }
    return new Response(JSON.stringify({ error: "Action inconnue" }), { status: 400, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || "Requête invalide" }), { status: 400, headers });
  }
}

async function handleAgencyPayments(request, env) {
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

module.exports = { handleAgencyPayments };
