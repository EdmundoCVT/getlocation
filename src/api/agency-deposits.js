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
  getDepositForRental,
  getDepositById,
  listDepositCaptures,
  findCaptureByIdempotencyKey,
  createMollieAuthorizationRecord,
  refreshCustomerDepositLink,
  centsToMollieAmount,
  recordCaptureRequest,
  markReleaseRequested,
  generateDepositLinkToken
} = require("../lib/deposits.js");
const { createPayment, createCapture, releaseAuthorization, MollieApiError } = require("../lib/mollie-client.js");
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

  const deposit = await getDepositForRental(env, rentalId.slice(0, 100));
  const captures = deposit && deposit.provider === "mollie" ? await listDepositCaptures(env, deposit.id) : [];
  return new Response(JSON.stringify({ deposit, captures }), { status: 200, headers });
}

function siteOrigin(request) { return new URL(request.url).origin; }
function safeReason(value) {
  const reason = typeof value === "string" ? value.trim().slice(0, 500) : "";
  if (!reason) throw new Error("Motif de capture obligatoire");
  return reason;
}
function handleMollieError(err) {
  if (err instanceof MollieApiError && [401, 403, 404, 422].includes(err.statusCode)) {
    return "Mollie a refusé l’opération. Vérifiez dans le tableau de bord Mollie que les cartes et la préautorisation/capture manuelle sont activées pour ce profil.";
  }
  return err && err.message || "Erreur Mollie";
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
      await attemptSync(env, deposit.rentalId, auth.session.operator);
      return new Response(JSON.stringify({ deposit }), { status: 200, headers });
    }
    if (body.action === "create-mollie-authorization") {
      const rental = await getRentalById(env, body.rentalId);
      if (!rental) return new Response(JSON.stringify({ error: "Location introuvable" }), { status: 404, headers });
      if (!env.MOLLIE_API_KEY) throw new Error("MOLLIE_API_KEY manquante");
      const amountCents = Math.round(Number(body.amount) * 100);
      if (!Number.isInteger(amountCents) || amountCents < 50) throw new Error("Montant de préautorisation invalide");
      const token = generateDepositLinkToken();
      const origin = siteOrigin(request);
      const payment = await createPayment(env.MOLLIE_API_KEY, {
        amount: centsToMollieAmount(amountCents), description: `Dépôt de garantie — ${rental.contractNumero || rental.id}`,
        method: ["creditcard"], captureMode: "manual",
        redirectUrl: `${origin}/deposit.html?token=${encodeURIComponent(token)}`,
        webhookUrl: `${origin}/api/mollie-webhook`,
        metadata: { purpose: "deposit_authorization", rentalId: rental.id }
      }, `deposit-auth-${rental.id}-${token.slice(0, 16)}`);
      const created = await createMollieAuthorizationRecord(env, { rentalId: rental.id, amount: amountCents / 100, operator: auth.session.operator, payment, customerToken: token });
      await recordAuditEvent(env, { actor: auth.session.operator, eventType: "deposit_authorization_created", entityType: "deposit", entityId: created.deposit.id, metadata: { amountCents } });
      const customerLink = `${origin}/deposit.html?token=${encodeURIComponent(token)}`;
      return new Response(JSON.stringify({ deposit: created.deposit, customerLink, checkoutUrl: payment._links && payment._links.checkout && payment._links.checkout.href }), { status: 201, headers });
    }
    if (body.action === "new-customer-link") {
      const refreshed = await refreshCustomerDepositLink(env, body.id, auth.session.operator);
      if (!refreshed) return new Response(JSON.stringify({ error: "Préautorisation Mollie introuvable" }), { status: 404, headers });
      const customerLink = `${siteOrigin(request)}/deposit.html?token=${encodeURIComponent(refreshed.customerToken)}`;
      await recordAuditEvent(env, { actor: auth.session.operator, eventType: "deposit_link_regenerated", entityType: "deposit", entityId: refreshed.deposit.id });
      return new Response(JSON.stringify({ deposit: refreshed.deposit, customerLink }), { status: 201, headers });
    }
    if (body.action === "capture") {
      const deposit = await getDepositById(env, body.id);
      if (!deposit || deposit.provider !== "mollie" || !deposit.molliePaymentId) return new Response(JSON.stringify({ error: "Préautorisation Mollie introuvable" }), { status: 404, headers });
      if (deposit.authorizationStatus !== "authorized" && deposit.authorizationStatus !== "captured") throw new Error("La carte doit être autorisée par Mollie avant toute capture");
      const amountCents = Math.round(Number(body.amount) * 100);
      const reason = safeReason(body.reason);
      const captures = await listDepositCaptures(env, deposit.id);
      const alreadyCaptured = captures.filter((item) => !["failed", "canceled"].includes(item.status)).reduce((total, item) => total + Number(item.amountCents || 0), 0);
      if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > deposit.amountRequestedCents - alreadyCaptured) throw new Error("Montant de capture supérieur au solde autorisé");
      const requestKey = typeof body.idempotencyKey === "string" && /^[A-Za-z0-9_-]{16,100}$/.test(body.idempotencyKey) ? body.idempotencyKey : crypto.randomUUID();
      const key = `deposit-capture-${deposit.id}-${requestKey}`;
      const previous = await findCaptureByIdempotencyKey(env, key);
      if (previous) {
        return new Response(JSON.stringify({ deposit, captures: await listDepositCaptures(env, deposit.id), idempotent: true }), { status: 200, headers });
      }
      const capture = await createCapture(env.MOLLIE_API_KEY, deposit.molliePaymentId, { amount: centsToMollieAmount(amountCents), description: reason, metadata: { depositId: deposit.id, rentalId: deposit.rentalId } }, key);
      await recordCaptureRequest(env, { depositId: deposit.id, amountCents, reason, operator: auth.session.operator, idempotencyKey: key, mollieCapture: capture });
      await recordAuditEvent(env, { actor: auth.session.operator, eventType: "deposit_capture_requested", entityType: "deposit", entityId: deposit.id, metadata: { amountCents } });
      return new Response(JSON.stringify({ deposit: await getDepositById(env, deposit.id), captures: await listDepositCaptures(env, deposit.id) }), { status: 202, headers });
    }
    if (body.action === "release") {
      const deposit = await getDepositById(env, body.id);
      if (!deposit || deposit.provider !== "mollie" || !deposit.molliePaymentId) return new Response(JSON.stringify({ error: "Préautorisation Mollie introuvable" }), { status: 404, headers });
      await releaseAuthorization(env.MOLLIE_API_KEY, deposit.molliePaymentId, `deposit-release-${deposit.id}-${crypto.randomUUID()}`);
      const updated = await markReleaseRequested(env, deposit.id, auth.session.operator);
      await recordAuditEvent(env, { actor: auth.session.operator, eventType: "deposit_release_requested", entityType: "deposit", entityId: deposit.id });
      return new Response(JSON.stringify({ deposit: updated }), { status: 202, headers });
    }
    if (body.action === "update-request") {
      const deposit = await updateDepositRequest(env, body.id, body.data || {}, auth.session.operator);
      if (!deposit) return new Response(JSON.stringify({ error: "Caution introuvable" }), { status: 404, headers });
      await attemptSync(env, deposit.rentalId, auth.session.operator);
      return new Response(JSON.stringify({ deposit }), { status: 200, headers });
    }
    if (body.action === "receive") {
      const deposit = await receiveDeposit(env, body.id, auth.session.operator);
      if (!deposit) return new Response(JSON.stringify({ error: "Caution introuvable" }), { status: 404, headers });
      await recordAuditEvent(env, { actor: auth.session.operator, eventType: "deposit_received", entityType: "deposit", entityId: deposit.id });
      await attemptSync(env, deposit.rentalId, auth.session.operator);
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
      await attemptSync(env, deposit.rentalId, auth.session.operator);
      return new Response(JSON.stringify({ deposit }), { status: 200, headers });
    }
    return new Response(JSON.stringify({ error: "Action inconnue" }), { status: 400, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof MollieApiError ? handleMollieError(err) : err.message || "Requête invalide" }), { status: 400, headers });
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
