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

function toCents(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n < 0) throw new Error("Montant invalide");
  return Math.round(n * 100);
}

async function getDepositForRental(env, rentalId) {
  if (!rentalId) return null;
  const row = await env.AGENCY_DB.prepare("SELECT * FROM deposits WHERE rental_id = ?").bind(rentalId).first();
  return rowToDeposit(row);
}

async function getDepositById(env, id) {
  if (!id) return null;
  const row = await env.AGENCY_DB.prepare("SELECT * FROM deposits WHERE id = ?").bind(id).first();
  return rowToDeposit(row);
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

module.exports = {
  METHODES_VALIDES,
  createDepositRequest,
  updateDepositRequest,
  receiveDeposit,
  returnDeposit,
  getDepositForRental,
  getDepositById
};
