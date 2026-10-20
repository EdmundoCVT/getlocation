// Résolution unique du dépôt de garantie d'un dossier.
//
// Dès qu'un montant contractuel a été enregistré, il reste indépendant des
// évolutions ultérieures du catalogue. Le catalogue est uniquement le repli
// d'une nouvelle réservation ou d'un ancien dossier sans instantané.

const { getVehiculeParId } = require("../../js/data.js");

function storedContractDeposit(record) {
  if (!record || typeof record !== "object") return null;
  for (const key of ["cautionContractuelle", "depotGarantie"]) {
    const raw = record[key];
    if (raw === undefined || raw === null || raw === "") continue;
    const value = Number(raw);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  return null;
}

function resolveContractDeposit(record, vehicle) {
  const stored = storedContractDeposit(record);
  if (stored !== null) return stored;
  const catalogVehicle = vehicle || getVehiculeParId(record && record.vehiculeId);
  if (!catalogVehicle || catalogVehicle.caution === undefined || catalogVehicle.caution === null || catalogVehicle.caution === "") return null;
  const fallback = Number(catalogVehicle.caution);
  return Number.isFinite(fallback) && fallback >= 0 ? fallback : null;
}

module.exports = { storedContractDeposit, resolveContractDeposit };
