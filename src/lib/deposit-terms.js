// Authoritative server snapshots. No API key or browser price is used at checkout.
const { getVehiculeParId } = require("../../js/data.js");
function depositTerms(data) {
  const vehicle = getVehiculeParId(data.vehiculeId);
  if (!vehicle) throw new Error("Véhicule inconnu");
  const amount = data.depositAmount === undefined ? vehicle.caution : Number(data.depositAmount);
  if (!["number", "string", "undefined"].includes(typeof data.depositAmount) || !Number.isFinite(amount) || amount <= 0 || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001 || !Number.isSafeInteger(Math.round(amount * 100))) throw new Error("Montant de caution invalide");
  return { defaultDepositAmount: vehicle.caution, depositAmount: amount };
}
async function saveContractDepositTerms(env, record) {
  await env.AGENCY_DB.prepare("INSERT INTO deposit_subjects (id, deposit_amount_cents, default_deposit_amount_cents, finalized, contract_numero) VALUES (?, ?, ?, ?, ?)")
    .bind(record.id, record.depositAmount == null ? null : Math.round(record.depositAmount * 100), record.defaultDepositAmount == null ? null : Math.round(record.defaultDepositAmount * 100), 1, record.contractNumero || null).run();
}
async function getDepositSubject(env, id) {
  const rental = await require("./rentals.js").getRentalById(env, id);
  if (rental) return rental;
  let row = await env.AGENCY_DB.prepare("SELECT * FROM deposit_subjects WHERE id = ?").bind(id).first();
  if (!row && env.RESERVATIONS_KV) {
    const record = await require("./reservation-store.js").getReservation(env, id);
    if (!record || !["manual_contract", "paid"].includes(record.status)) return null;
    // Legacy contracts retain their saved amount; absent historical amounts remain unknown.
    try { await saveContractDepositTerms(env, record); }
    catch (err) {
      row = await env.AGENCY_DB.prepare("SELECT * FROM deposit_subjects WHERE id = ?").bind(id).first();
      if (!row) throw err;
    }
    row = row || await env.AGENCY_DB.prepare("SELECT * FROM deposit_subjects WHERE id = ?").bind(id).first();
  }
  return row ? { id: row.id, depositAmountCents: row.deposit_amount_cents, defaultDepositAmount: row.default_deposit_amount_cents == null ? null : row.default_deposit_amount_cents / 100, contractNumero: row.contract_numero } : null;
}
module.exports = { depositTerms, saveContractDepositTerms, getDepositSubject };
