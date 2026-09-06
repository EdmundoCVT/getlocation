// src/lib/payments.js
//
// Paiements d'une location (Lot 2, voir CLAUDE.md) — une location peut en
// contenir plusieurs (ex. 50€ carte + 190€ espèces). Montants stockés en
// CENTIMES (INTEGER), jamais en flottant. Jamais de suppression définitive :
// une correction/annulation change `status` + `void_reason`, la ligne
// d'origine reste consultable (voir voidPayment). `operator` provient
// toujours de la session agence vérifiée, jamais du payload.

const { generateId } = require("./id.js");

const METHODES_VALIDES = ["carte", "especes", "virement"];

function rowToPayment(row) {
  if (!row) return null;
  return {
    id: row.id,
    rentalId: row.rental_id,
    amountCents: row.amount_cents,
    method: row.method,
    reference: row.reference || "",
    paidAt: row.paid_at,
    status: row.status,
    voidReason: row.void_reason || "",
    operator: row.operator,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toCents(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) throw new Error("Montant invalide");
  return Math.round(n * 100);
}

async function addPayment(env, rentalId, data, operator) {
  if (!rentalId || typeof rentalId !== "string") throw new Error("Location manquante");
  if (!METHODES_VALIDES.includes(data.method)) throw new Error("Moyen de paiement invalide");
  const amountCents = toCents(data.amount);
  const reference = typeof data.reference === "string" ? data.reference.trim().slice(0, 200) : "";
  const paidAt = data.paidAt && typeof data.paidAt === "string" ? data.paidAt : new Date().toISOString();

  const id = generateId("pay");
  const now = new Date().toISOString();
  await env.AGENCY_DB.prepare(
    `INSERT INTO payments (id, rental_id, amount_cents, method, reference, paid_at, status, void_reason, operator, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, rentalId, amountCents, data.method, reference, paidAt, "valide", null, operator, now, now).run();
  return getPaymentById(env, id);
}

async function getPaymentById(env, id) {
  if (!id) return null;
  const row = await env.AGENCY_DB.prepare("SELECT * FROM payments WHERE id = ?").bind(id).first();
  return rowToPayment(row);
}

// Annule un paiement (jamais de suppression) : motif obligatoire, pour
// correction comme pour annulation pure — voir cahier des charges.
async function voidPayment(env, id, reason) {
  const trimmedReason = typeof reason === "string" ? reason.trim().slice(0, 500) : "";
  if (!trimmedReason) throw new Error("Motif d'annulation obligatoire");
  const existing = await getPaymentById(env, id);
  if (!existing) return null;
  if (existing.status === "annule") return existing;
  const now = new Date().toISOString();
  await env.AGENCY_DB.prepare("UPDATE payments SET status = ?, void_reason = ?, updated_at = ? WHERE id = ?")
    .bind("annule", trimmedReason, now, id)
    .run();
  return getPaymentById(env, id);
}

async function listPaymentsForRental(env, rentalId) {
  if (!rentalId) return [];
  const res = await env.AGENCY_DB.prepare("SELECT * FROM payments WHERE rental_id = ? ORDER BY paid_at ASC").bind(rentalId).all();
  return (res.results || []).map(rowToPayment);
}

// totalDueCents : montant total dû pour la location (calculé ailleurs,
// jamais recalculé ici à partir d'un champ envoyé par le navigateur — voir
// appelant). Les paiements annulés n'entrent jamais dans l'encaissé.
function summarizePayments(payments, totalDueCents) {
  const totalPaidCents = payments.filter((p) => p.status === "valide").reduce((sum, p) => sum + p.amountCents, 0);
  const balanceCents = Math.max(0, totalDueCents - totalPaidCents);
  let status = "impaye";
  if (totalPaidCents >= totalDueCents && totalDueCents > 0) status = "solde";
  else if (totalPaidCents > 0) status = "partiel";
  return { totalDueCents, totalPaidCents, balanceCents, status };
}

module.exports = { METHODES_VALIDES, addPayment, getPaymentById, voidPayment, listPaymentsForRental, summarizePayments };
