// src/lib/deposits.js
//
// Caution (dépôt de garantie) d'une location (Lot 2, voir CLAUDE.md) —
// JAMAIS confondue avec un paiement de location (voir payments.js, table
// séparée). Une seule caution par location (contrainte UNIQUE sur
// rental_id, voir migrations/0002_clients_rentals.sql). Montants en
// CENTIMES. `operator` provient toujours de la session agence vérifiée,
// jamais du payload.

const { generateId } = require("./id.js");

const METHODES_VALIDES = ["carte", "especes", "virement"];

class DepositLinkConfigurationError extends Error {
  constructor() {
    super("DEPOSIT_LINK_PEPPER manquant");
    this.name = "DepositLinkConfigurationError";
  }
}

function rowToDeposit(row) {
  if (!row) return null;
  return {
    id: row.id,
    rentalId: row.rental_id,
    amountRequestedCents: row.amount_requested_cents,
    method: row.method,
    status: row.status,
    receivedAt: row.received_at || null,
    receivedBy: row.received_by || null,
    returnedAt: row.returned_at || null,
    returnedBy: row.returned_by || null,
    returnedAmountCents: row.returned_amount_cents,
    retainedAmountCents: row.retained_amount_cents,
    retainedReason: row.retained_reason || "",
    supportingDocsNote: row.supporting_docs_note || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by
  };
}

function centsToMollieAmount(cents) {
  return { currency: "EUR", value: (Number(cents) / 100).toFixed(2) };
}

function base64Url(bytes) {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function opaqueToken() {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

async function linkHash(token, pepper) {
  if (!pepper) throw new DepositLinkConfigurationError();
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pepper), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`deposit-link:${token}`));
  return Array.from(new Uint8Array(signature), (part) => part.toString(16).padStart(2, "0")).join("");
}

function mollieState(payment) {
  const status = payment && payment.status;
  if (status === "authorized") return "authorized";
  if (status === "paid") return "captured";
  if (["canceled", "expired", "failed"].includes(status)) return status;
  return status || "pending";
}

function depositFromRow(row) {
  const deposit = rowToDeposit(row);
  if (!deposit) return null;
  return {
    ...deposit,
    provider: row.provider || null,
    molliePaymentId: row.mollie_payment_id || null,
    authorizationStatus: row.authorization_status || null,
    authorizationExpiresAt: row.authorization_expires_at || null,
    authorizedAt: row.authorized_at || null,
    releasedAt: row.released_at || null,
    customerLinkExpiresAt: row.customer_link_expires_at || null
  };
}

// État de pilotage calculé à partir de la source Mollie et des captures :
// aucun statut métier parallèle n'est enregistré. Les valeurs historiques
// (cautions hors Mollie) restent lisibles sans être transformées.
function dashboardStatus(deposit, capturedCents) {
  if (deposit.provider !== "mollie") return deposit.status || "attendue";
  const state = deposit.authorizationStatus;
  if (["pending", "open", null].includes(state)) return "pending";
  if (state === "authorized" || state === "captured") {
    if (capturedCents >= deposit.amountRequestedCents) return "captured";
    if (capturedCents > 0) return "partially_captured";
    return "authorized";
  }
  if (state === "canceled") return "released";
  return state;
}

function dashboardItem(row) {
  const deposit = depositFromRow(row);
  if (!deposit) return null;
  const capturedCents = Number(row.captured_cents) || 0;
  return {
    ...deposit,
    client: { firstName: row.first_name || "", lastName: row.last_name || "" },
    rental: { id: row.rental_id, contractNumero: row.contract_numero || null, vehiculeId: row.vehicule_id || "", immatriculation: row.immatriculation || "" },
    capturedCents,
    availableCents: Math.max(0, deposit.amountRequestedCents - capturedCents),
    dashboardStatus: dashboardStatus(deposit, capturedCents)
  };
}

async function listDepositsForDashboard(env) {
  const result = await env.AGENCY_DB.prepare(
    `SELECT d.*, r.contract_numero, r.vehicule_id, r.immatriculation, c.first_name, c.last_name,
      COALESCE((SELECT SUM(dc.amount_cents) FROM deposit_captures dc WHERE dc.deposit_id = d.id AND dc.status NOT IN ('failed', 'canceled')), 0) AS captured_cents
     FROM deposits d JOIN rentals r ON r.id = d.rental_id JOIN clients c ON c.id = r.client_id
     ORDER BY CASE WHEN d.authorization_expires_at IS NULL THEN 1 ELSE 0 END, d.authorization_expires_at ASC, d.created_at DESC`
  ).all();
  return (result.results || []).map(dashboardItem);
}

function toCents(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n < 0) throw new Error("Montant invalide");
  return Math.round(n * 100);
}

async function getDepositForRental(env, rentalId) {
  if (!rentalId) return null;
  const row = await env.AGENCY_DB.prepare("SELECT * FROM deposits WHERE rental_id = ?").bind(rentalId).first();
  return depositFromRow(row);
}

async function getDepositById(env, id) {
  if (!id) return null;
  const row = await env.AGENCY_DB.prepare("SELECT * FROM deposits WHERE id = ?").bind(id).first();
  return depositFromRow(row);
}

async function getMollieDepositByPaymentId(env, paymentId) {
  const row = await env.AGENCY_DB.prepare("SELECT * FROM deposits WHERE mollie_payment_id = ?").bind(paymentId).first();
  return depositFromRow(row);
}

async function listDepositCaptures(env, depositId) {
  const result = await env.AGENCY_DB.prepare("SELECT * FROM deposit_captures WHERE deposit_id = ? ORDER BY requested_at ASC").bind(depositId).all();
  return (result.results || []).map((row) => ({
    id: row.id, mollieCaptureId: row.mollie_capture_id || null, amountCents: row.amount_cents,
    reason: row.reason, status: row.status, requestedAt: row.requested_at,
    completedAt: row.completed_at || null, failureReason: row.failure_reason || null
  }));
}

async function findCaptureByIdempotencyKey(env, idempotencyKey) {
  if (!idempotencyKey) return null;
  const row = await env.AGENCY_DB.prepare("SELECT * FROM deposit_captures WHERE idempotency_key = ?").bind(idempotencyKey).first();
  if (!row) return null;
  return { id: row.id, depositId: row.deposit_id, amountCents: row.amount_cents, status: row.status };
}

async function createMollieAuthorizationRecord(env, { rentalId, amount, operator, payment, customerToken = opaqueToken(), linkLifetimeHours = 72 }) {
  const existing = await getDepositForRental(env, rentalId);
  if (existing) throw new Error("Une caution existe déjà pour cette location");
  const amountRequestedCents = toCents(amount);
  if (!payment || !payment.id) throw new Error("Réponse Mollie incomplète");
  const now = new Date();
  const id = generateId("dep");
  const expires = new Date(now.getTime() + linkLifetimeHours * 60 * 60 * 1000).toISOString();
  await env.AGENCY_DB.prepare(
    `INSERT INTO deposits (id, rental_id, amount_requested_cents, method, status, provider, mollie_payment_id, authorization_status, authorization_expires_at, authorized_at, released_at, customer_link_hash, customer_link_expires_at, release_requested_at, created_at, updated_at, created_by, updated_by)
     VALUES (?, ?, ?, 'carte', 'attendue', 'mollie', ?, ?, ?, NULL, NULL, ?, ?, NULL, ?, ?, ?, ?)`
  ).bind(id, rentalId, amountRequestedCents, payment.id, mollieState(payment), payment.captureBefore || null,
    await linkHash(customerToken, env.DEPOSIT_LINK_PEPPER), expires, now.toISOString(), now.toISOString(), operator, operator).run();
  return { deposit: await getDepositById(env, id), customerToken };
}

async function resolveCustomerDepositLink(env, token) {
  if (!token || typeof token !== "string" || token.length < 32) return null;
  const hash = await linkHash(token, env.DEPOSIT_LINK_PEPPER);
  const row = await env.AGENCY_DB.prepare("SELECT * FROM deposits WHERE customer_link_hash = ? AND customer_link_expires_at > ?")
    .bind(hash, new Date().toISOString()).first();
  return depositFromRow(row);
}

async function refreshCustomerDepositLink(env, id, operator, linkLifetimeHours = 72) {
  const deposit = await getDepositById(env, id);
  if (!deposit || deposit.provider !== "mollie") return null;
  const token = opaqueToken();
  const now = new Date();
  const expires = new Date(now.getTime() + linkLifetimeHours * 60 * 60 * 1000).toISOString();
  await env.AGENCY_DB.prepare("UPDATE deposits SET customer_link_hash = ?, customer_link_expires_at = ?, updated_at = ?, updated_by = ? WHERE id = ?")
    .bind(await linkHash(token, env.DEPOSIT_LINK_PEPPER), expires, now.toISOString(), operator, id).run();
  return { deposit: await getDepositById(env, id), customerToken: token };
}

async function applyMolliePaymentState(env, payment) {
  const deposit = await getMollieDepositByPaymentId(env, payment.id);
  if (!deposit) return null;
  const now = new Date().toISOString();
  const status = mollieState(payment);
  const authorizedAt = status === "authorized" && !deposit.authorizedAt ? now : deposit.authorizedAt;
  const releasedAt = ["canceled", "expired", "failed"].includes(status) ? now : deposit.releasedAt;
  await env.AGENCY_DB.prepare(
    "UPDATE deposits SET authorization_status = ?, authorization_expires_at = ?, authorized_at = ?, released_at = ?, updated_at = ?, updated_by = ? WHERE id = ?"
  ).bind(status, payment.captureBefore || deposit.authorizationExpiresAt, authorizedAt, releasedAt, now, "mollie-webhook", deposit.id).run();
  const captures = payment._embedded && Array.isArray(payment._embedded.captures) ? payment._embedded.captures : [];
  for (const capture of captures) {
    if (!capture.id) continue;
    const cents = Math.round(Number(capture.amount && capture.amount.value) * 100);
    await env.AGENCY_DB.prepare(
      "UPDATE deposit_captures SET mollie_capture_id = ?, status = ?, completed_at = ?, failure_reason = NULL WHERE deposit_id = ? AND (mollie_capture_id = ? OR (amount_cents = ? AND status = 'pending'))"
    ).bind(capture.id, capture.status || "pending", capture.status === "paid" ? now : null, deposit.id, capture.id, cents).run();
  }
  return getDepositById(env, deposit.id);
}

// Crée la demande de caution (montant + mode de remise prévus) — avant toute
// réception effective (statut "attendue").
async function createDepositRequest(env, rentalId, data, operator) {
  if (!rentalId || typeof rentalId !== "string") throw new Error("Location manquante");
  if (!METHODES_VALIDES.includes(data.method)) throw new Error("Mode de remise de la caution invalide");
  const existing = await getDepositForRental(env, rentalId);
  if (existing) throw new Error("Une caution existe déjà pour cette location");

  const amountRequestedCents = toCents(data.amount);
  const supportingDocsNote = typeof data.supportingDocsNote === "string" ? data.supportingDocsNote.trim().slice(0, 500) : "";
  const id = generateId("dep");
  const now = new Date().toISOString();
  await env.AGENCY_DB.prepare(
    `INSERT INTO deposits (id, rental_id, amount_requested_cents, method, status, received_at, received_by, returned_at, returned_by, returned_amount_cents, retained_amount_cents, retained_reason, supporting_docs_note, created_at, updated_at, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, rentalId, amountRequestedCents, data.method, "attendue",
    null, null, null, null, null, null, null,
    supportingDocsNote, now, now, operator, operator
  ).run();
  return getDepositForRental(env, rentalId);
}

// Modifie le montant/mode PRÉVUS — uniquement tant que la caution n'a pas
// encore été reçue (une fois reçue, on ne réécrit plus ce qui a été
// effectivement demandé/remis, seule la restitution peut évoluer).
async function updateDepositRequest(env, id, data, operator) {
  const existing = await getDepositById(env, id);
  if (!existing) return null;
  if (existing.status !== "attendue") throw new Error("La caution a déjà été reçue : impossible de modifier la demande");
  if (!METHODES_VALIDES.includes(data.method)) throw new Error("Mode de remise de la caution invalide");
  const amountRequestedCents = toCents(data.amount);
  const supportingDocsNote = typeof data.supportingDocsNote === "string" ? data.supportingDocsNote.trim().slice(0, 500) : "";
  const now = new Date().toISOString();
  await env.AGENCY_DB.prepare(
    "UPDATE deposits SET amount_requested_cents = ?, method = ?, supporting_docs_note = ?, updated_at = ?, updated_by = ? WHERE id = ?"
  ).bind(amountRequestedCents, data.method, supportingDocsNote, now, operator, id).run();
  return getDepositById(env, id);
}

async function receiveDeposit(env, id, operator) {
  const existing = await getDepositById(env, id);
  if (!existing) return null;
  if (existing.status !== "attendue") throw new Error("Cette caution a déjà été marquée reçue");
  const now = new Date().toISOString();
  await env.AGENCY_DB.prepare(
    "UPDATE deposits SET status = ?, received_at = ?, received_by = ?, updated_at = ?, updated_by = ? WHERE id = ?"
  ).bind("recue", now, operator, now, operator, id).run();
  return getDepositById(env, id);
}

// Restitution (totale, partielle, ou retenue totale) — returnedAmount +
// retainedAmount doivent correspondre exactement au montant reçu (aucune
// somme ne doit disparaître silencieusement). retainedReason obligatoire
// dès qu'un montant est retenu.
async function returnDeposit(env, id, data, operator) {
  const existing = await getDepositById(env, id);
  if (!existing) return null;
  if (existing.status !== "recue") throw new Error("La caution doit être reçue avant d'être restituée");

  const returnedAmountCents = toCents(data.returnedAmount ?? 0);
  const retainedAmountCents = toCents(data.retainedAmount ?? 0);
  if (returnedAmountCents + retainedAmountCents !== existing.amountRequestedCents) {
    throw new Error("Le montant restitué + le montant retenu doit correspondre exactement au montant de la caution");
  }
  const retainedReason = typeof data.retainedReason === "string" ? data.retainedReason.trim().slice(0, 1000) : "";
  if (retainedAmountCents > 0 && !retainedReason) throw new Error("Motif de retenue obligatoire dès qu'un montant est retenu");

  const status = retainedAmountCents === 0 ? "restituee" : returnedAmountCents === 0 ? "retenue_totale" : "retenue_partielle";
  const now = new Date().toISOString();
  await env.AGENCY_DB.prepare(
    `UPDATE deposits SET status = ?, returned_at = ?, returned_by = ?, returned_amount_cents = ?, retained_amount_cents = ?, retained_reason = ?, updated_at = ?, updated_by = ? WHERE id = ?`
  ).bind(status, now, operator, returnedAmountCents, retainedAmountCents, retainedReason || null, now, operator, id).run();
  return getDepositById(env, id);
}

async function recordCaptureRequest(env, { depositId, amountCents, reason, operator, idempotencyKey, mollieCapture }) {
  const id = generateId("dcp");
  const now = new Date().toISOString();
  await env.AGENCY_DB.prepare(
    "INSERT INTO deposit_captures (id, deposit_id, mollie_capture_id, amount_cents, reason, status, idempotency_key, requested_by, requested_at, completed_at, failure_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)"
  ).bind(id, depositId, mollieCapture && mollieCapture.id || null, amountCents, reason, mollieCapture && mollieCapture.status || "pending", idempotencyKey, operator, now, mollieCapture && mollieCapture.status === "paid" ? now : null).run();
  return id;
}

async function markReleaseRequested(env, id, operator) {
  const now = new Date().toISOString();
  await env.AGENCY_DB.prepare(
    "UPDATE deposits SET release_requested_at = ?, updated_at = ?, updated_by = ? WHERE id = ?"
  ).bind(now, now, operator, id).run();
  return getDepositById(env, id);
}

module.exports = {
  METHODES_VALIDES,
  createDepositRequest,
  updateDepositRequest,
  receiveDeposit,
  returnDeposit,
  getDepositForRental,
  getDepositById,
  getMollieDepositByPaymentId,
  listDepositsForDashboard,
  dashboardStatus,
  listDepositCaptures,
  findCaptureByIdempotencyKey,
  createMollieAuthorizationRecord,
  resolveCustomerDepositLink,
  refreshCustomerDepositLink,
  applyMolliePaymentState,
  centsToMollieAmount,
  recordCaptureRequest,
  markReleaseRequested,
  DepositLinkConfigurationError,
  generateDepositLinkToken: opaqueToken
};
