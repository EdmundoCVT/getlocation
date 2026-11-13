// Prolongation canonique d'un contrat finalisé. Le navigateur ne fournit
// que la nouvelle fin : tarifs, kilométrage, options, protection, dépôt et
// historique financier sont relus depuis la version source puis recalculés
// ici, sans consulter le catalogue tarifaire courant.

const {
  createContractVersion,
  getReservation,
  listReservations,
  contractVersionInfo,
  isSignedContract,
  extendContractRetention,
  updateReservationStatus,
  deepCloneContractData
} = require("./reservation-store.js");
const {
  instantEuropeParis,
  joursFacturablesPourPeriode,
  kmInclusPourJours,
  creerConditionsKilometriquesContrat,
  getKmInclusParJour
} = require("../../js/data.js");

class ContractExtensionError extends Error {
  constructor(message, code, status = 400, details = null) {
    super(message);
    this.name = "ContractExtensionError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function money(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function finite(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function localParts(record, start) {
  const date = record && record[start ? "dateDebut" : "dateFin"];
  const time = record && record[start ? "heureDebut" : "heureFin"];
  if (/^\d{4}-\d{2}-\d{2}$/.test(date || "") && /^\d{2}:\d{2}$/.test(time || "")) return { date, time };
  const raw = String(record && (start ? record.depart || record.periodeDebut : record.retour || record.periodeFin) || "");
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(raw);
  return match ? { date: match[1], time: match[2] } : null;
}

function instant(parts) {
  return parts ? instantEuropeParis(parts.date, parts.time) : null;
}

function recordInterval(record) {
  const startParts = localParts(record, true);
  const endParts = localParts(record, false);
  const start = instant(startParts);
  const end = instant(endParts);
  return { startParts, endParts, start, end };
}

function rentalTotal(record) {
  for (const value of [record && record.total, record && record.montantFinalConvenu, record && record.agreedRentalTotal]) {
    const parsed = finite(value);
    if (parsed !== null && parsed >= 0) return money(parsed);
  }
  return 0;
}

function optionAmount(option, days) {
  const amount = finite(option && option.montant);
  if (amount !== null && amount >= 0) return amount;
  const price = finite(option && option.prix);
  if (price === null || price < 0) return 0;
  return option && option.type === "jour" ? price * Math.max(1, days || 1) : price;
}

function sourceExtras(record) {
  const days = recordInterval(record).startParts && recordInterval(record).endParts
    ? joursFacturablesPourPeriode(recordInterval(record).startParts.date, recordInterval(record).startParts.time, recordInterval(record).endParts.date, recordInterval(record).endParts.time)
    : 1;
  const options = Array.isArray(record && record.options) ? record.options.reduce((sum, option) => sum + optionAmount(option, days), 0) : 0;
  const protection = finite(record && record.protection && record.protection.montant) || 0;
  const young = finite(record && record.supplementJeuneConducteur && record.supplementJeuneConducteur.montant) || 0;
  return money(options + protection + young);
}

function contractualDailyRate(record, oldDays, oldTotal) {
  const extension = record && record.contractExtensionPricing;
  const snapshot = record && record.pricingSnapshot || {};
  const candidates = [
    extension && extension.contractDailyRate,
    record && record.tarifJournalierContractuel,
    record && record.tarifJournalierFixe && record.tarifJournalierFixe.tarifJournalier,
    finite(snapshot.montantLocationNet) !== null ? Number(snapshot.montantLocationNet) / oldDays : null,
    finite(record && record.locationNette) !== null ? Number(record.locationNette) / oldDays : null,
    finite(snapshot.montantLocationApresRemise) !== null ? Number(snapshot.montantLocationApresRemise) / oldDays : null,
    Math.max(0, oldTotal - sourceExtras(record)) / oldDays
  ];
  const rate = candidates.map(finite).find((value) => value !== null && value >= 0);
  if (rate === undefined) throw new ContractExtensionError("Tarif journalier contractuel introuvable", "contract_rate_missing", 409);
  return money(rate);
}

function recalculateOptions(options, oldDays, newDays) {
  return (Array.isArray(options) ? options : []).map((source) => {
    if (!source || typeof source !== "object") return source;
    const option = deepCloneContractData(source);
    if (option.type !== "jour") return option;
    const storedUnit = finite(option.contractUnitPrice);
    const catalogSnapshotUnit = finite(option.prix);
    const unit = storedUnit !== null ? storedUnit : catalogSnapshotUnit !== null ? catalogSnapshotUnit : optionAmount(option, oldDays) / oldDays;
    option.contractUnitPrice = money(unit);
    option.montant = money(unit * newDays);
    return option;
  });
}

function recalculateProtection(source, oldDays, newDays) {
  if (!source || typeof source !== "object") return source;
  const protection = deepCloneContractData(source);
  const amount = finite(protection.montant) || 0;
  const billed = Math.max(1, finite(protection.joursFactures) || oldDays);
  const unit = finite(protection.contractUnitPrice) ?? finite(protection.prixParJour) ?? money(amount / billed);
  const maxDaysFromPrice = unit > 0 && finite(protection.prixMax) !== null ? Math.round(Number(protection.prixMax) / unit) : null;
  const maxDays = finite(protection.contractMaxBilledDays) ?? maxDaysFromPrice;
  const chargedDays = unit > 0 ? Math.min(newDays, maxDays && maxDays > 0 ? maxDays : newDays) : 0;
  protection.contractUnitPrice = money(unit);
  if (maxDays) protection.contractMaxBilledDays = maxDays;
  protection.joursLocation = newDays;
  protection.joursFactures = chargedDays;
  protection.montant = money(unit * chargedDays);
  protection.plafonne = unit > 0 && chargedDays < newDays;
  return protection;
}

function recalculateYoungDriver(source, oldDays, newDays) {
  if (!source || typeof source !== "object") return source;
  const supplement = deepCloneContractData(source);
  const unit = finite(supplement.contractUnitPrice) ?? finite(supplement.montantParJour) ?? money((finite(supplement.montant) || 0) / oldDays);
  supplement.contractUnitPrice = money(unit);
  supplement.montantParJour = money(unit);
  supplement.montant = money(unit * newDays);
  return supplement;
}

function paidAmount(record, oldTotal) {
  const history = record && record.financialHistory || {};
  for (const value of [history.paidAmount, record && record.paidAmount, record && record.montantRegle]) {
    const parsed = finite(value);
    if (parsed !== null && parsed >= 0) return money(parsed);
  }
  return record && (record.status === "paid" || record.contractSourceType === "reservation") ? oldTotal : 0;
}

function mileageForExtension(source, oldDays, newDays) {
  const stored = source && source.contractMileage && typeof source.contractMileage === "object" ? source.contractMileage : {};
  if (stored.mode === "custom") {
    return creerConditionsKilometriquesContrat({ ...stored, joursFactures: newDays, vehiculeId: source.vehiculeId });
  }
  const oldStandard = getKmInclusParJour() * oldDays;
  const oldTotal = finite(stored.kilometresInclusTotal) ?? finite(source && source.kmInclus) ?? oldStandard;
  const fixedPackage = Math.max(0, oldTotal - oldStandard);
  return creerConditionsKilometriquesContrat({
    mode: "standard",
    joursFactures: newDays,
    vehiculeId: source && source.vehiculeId,
    kilometresInclusStandard: kmInclusPourJours(newDays, source && source.vehiculeId) + fixedPackage
  });
}

function extensionCalculation(source, newEnd) {
  const interval = recordInterval(source);
  const newEndParts = { date: newEnd.date, time: newEnd.time };
  const newEndMs = instant(newEndParts);
  if (interval.start === null || interval.end === null || newEndMs === null) {
    throw new ContractExtensionError("Date ou heure de retour invalide", "invalid_extension_end");
  }
  if (newEndMs <= interval.end) {
    throw new ContractExtensionError("La nouvelle date de retour doit être postérieure à la date de retour actuelle.", "extension_end_not_later");
  }
  const oldDays = joursFacturablesPourPeriode(interval.startParts.date, interval.startParts.time, interval.endParts.date, interval.endParts.time);
  const newDays = joursFacturablesPourPeriode(interval.startParts.date, interval.startParts.time, newEnd.date, newEnd.time);
  if (!oldDays || !newDays || newDays < oldDays) throw new ContractExtensionError("Durée de prolongation invalide", "invalid_extension_duration");

  return contractTermsForDays(source, oldDays, newDays, { interval, newEndMs });
}

function contractTermsForDays(source, oldDays, newDays, context = {}) {
  if (!Number.isInteger(oldDays) || oldDays < 1 || !Number.isInteger(newDays) || newDays < 1) {
    throw new ContractExtensionError("Durée contractuelle invalide", "invalid_contract_duration");
  }
  const oldTotal = rentalTotal(source);
  const dailyRate = contractualDailyRate(source, oldDays, oldTotal);
  const oldExtras = sourceExtras(source);
  const oldRental = money(dailyRate * oldDays);
  const fixedAdjustment = money(oldTotal - oldRental - oldExtras);
  const options = recalculateOptions(source.options, oldDays, newDays);
  const protection = recalculateProtection(source.protection, oldDays, newDays);
  const young = recalculateYoungDriver(source.supplementJeuneConducteur, oldDays, newDays);
  const optionsAmount = money(options.reduce((sum, option) => sum + optionAmount(option, newDays), 0));
  const protectionAmount = finite(protection && protection.montant) || 0;
  const youngAmount = finite(young && young.montant) || 0;
  const newRental = money(dailyRate * newDays);
  const newTotal = money(newRental + optionsAmount + protectionAmount + youngAmount + fixedAdjustment);
  const alreadyPaid = paidAmount(source, oldTotal);
  const additionalAmount = money(Math.max(0, newTotal - alreadyPaid));
  const mileage = mileageForExtension(source, oldDays, newDays);
  return {
    ...context, oldDays, newDays, oldTotal, newTotal, dailyRate,
    oldRental, newRental, fixedAdjustment, options, optionsAmount, protection,
    young, alreadyPaid, additionalAmount, mileage
  };
}

function contractPeriodCalculation(source, newStart, newEnd) {
  const sourceInterval = recordInterval(source);
  const startParts = { date: newStart && newStart.date, time: newStart && newStart.time };
  const endParts = { date: newEnd && newEnd.date, time: newEnd && newEnd.time };
  const startMs = instant(startParts);
  const endMs = instant(endParts);
  if (sourceInterval.start === null || sourceInterval.end === null || startMs === null || endMs === null || endMs <= startMs) {
    throw new ContractExtensionError("Période du nouveau contrat invalide", "invalid_contract_period");
  }
  const oldDays = joursFacturablesPourPeriode(sourceInterval.startParts.date, sourceInterval.startParts.time, sourceInterval.endParts.date, sourceInterval.endParts.time);
  const newDays = joursFacturablesPourPeriode(startParts.date, startParts.time, endParts.date, endParts.time);
  return contractTermsForDays(source, oldDays, newDays, { sourceInterval, startParts, endParts, startMs, endMs });
}

function isBlocking(record) {
  if (!record) return false;
  if (record.status === "paid") return true;
  if (record.status === "pending_payment") {
    const created = new Date(record.createdAt).getTime();
    return Number.isFinite(created) && Date.now() - created < 30 * 60 * 1000;
  }
  return ["manual_contract", "contract_version"].includes(record.status) && isSignedContract(record);
}

async function findExtensionConflict(env, source, oldEndMs, newEndMs) {
  const sourceContractId = contractVersionInfo(source).contractId;
  const records = await listReservations(env);
  // Un contrat versionné ne doit compter qu'une fois. On retient sa version
  // finalisée la plus récente : une ancienne V1 ne peut ainsi créer un faux
  // conflit si une V2 signée a volontairement changé de véhicule ou dates.
  const latestBlockingByContract = new Map();
  for (const record of records) {
    if (!isBlocking(record)) continue;
    const info = contractVersionInfo(record);
    if (info.contractId === sourceContractId) continue;
    const previous = latestBlockingByContract.get(info.contractId);
    if (!previous || contractVersionInfo(previous).version < info.version) latestBlockingByContract.set(info.contractId, record);
  }
  const conflicts = [...latestBlockingByContract.values()].filter((record) => {
    if (record.vehiculeId !== source.vehiculeId) return false;
    const interval = recordInterval(record);
    return interval.start !== null && interval.end !== null && oldEndMs < interval.end && interval.start < newEndMs;
  }).map((record) => ({
    record,
    startsAt: recordInterval(record).start,
    reference: record.contractNumero || record.id
  })).sort((a, b) => a.startsAt - b.startsAt);
  if (!conflicts.length) return null;
  const conflict = conflicts[0];
  return { reference: conflict.reference, startsAt: new Date(conflict.startsAt).toISOString() };
}

function extensionReason(newEnd, custom) {
  const trimmed = typeof custom === "string" ? custom.trim().slice(0, 500) : "";
  return trimmed || `Prolongation jusqu’au ${newEnd.date.split("-").reverse().join("/")} à ${newEnd.time}`;
}

function applyCalculation(draft, source, calculation, newEnd, operator) {
  const now = new Date().toISOString();
  const version = draft.contractVersion.version;
  const financialHistory = deepCloneContractData(draft.financialHistory || {});
  const extensionEntry = {
    sourceVersion: contractVersionInfo(source).version,
    newVersion: version,
    oldTotal: calculation.oldTotal,
    newTotal: calculation.newTotal,
    paidAmount: calculation.alreadyPaid,
    additionalAmount: calculation.additionalAmount,
    oldEndAt: new Date(calculation.interval.end).toISOString(),
    newEndAt: new Date(calculation.newEndMs).toISOString(),
    createdAt: now,
    createdBy: operator || null
  };
  financialHistory.paidAmount = calculation.alreadyPaid;
  financialHistory.extensions = [...(Array.isArray(financialHistory.extensions) ? financialHistory.extensions : []), extensionEntry];
  const pricingSnapshot = { ...(draft.pricingSnapshot || {}) };
  pricingSnapshot.dates = { ...(pricingSnapshot.dates || {}), fin: `${newEnd.date}T${newEnd.time}` };
  pricingSnapshot.nombreJours = calculation.newDays;
  pricingSnapshot.montantLocationApresRemise = calculation.newRental;
  pricingSnapshot.montantLocationNet = calculation.newRental;
  pricingSnapshot.prixMoyenJour = calculation.dailyRate;
  pricingSnapshot.kilometresInclusLocation = calculation.mileage.kilometresInclusTotal;
  pricingSnapshot.kilometresInclus = calculation.mileage.kilometresInclusTotal;
  pricingSnapshot.totalFinal = calculation.newTotal;
  return {
    ...draft,
    dateFin: newEnd.date,
    heureFin: newEnd.time,
    retour: `${newEnd.date}T${newEnd.time}`,
    periodeFin: new Date(calculation.newEndMs).toISOString(),
    jours: calculation.newDays,
    tarifJournalierContractuel: calculation.dailyRate,
    sousTotalBrut: calculation.newRental,
    locationNette: calculation.newRental,
    options: calculation.options,
    optionsMontant: calculation.optionsAmount,
    protection: calculation.protection,
    supplementJeuneConducteur: calculation.young,
    contractMileage: calculation.mileage,
    kmInclus: calculation.mileage.kilometresInclusTotal,
    total: calculation.newTotal,
    agreedRentalTotal: calculation.newTotal,
    tarifManuel: true,
    montantFinalConvenu: calculation.newTotal,
    amountAlreadyPaid: calculation.alreadyPaid,
    additionalAmountDue: calculation.additionalAmount,
    montantRegle: calculation.alreadyPaid,
    acompteRegle: calculation.alreadyPaid > 0,
    soldeRegle: calculation.additionalAmount <= 0,
    financialHistory,
    pricingSnapshot,
    contractExtensionPricing: {
      sourceVersion: contractVersionInfo(source).version,
      contractDailyRate: calculation.dailyRate,
      oldDays: calculation.oldDays,
      newDays: calculation.newDays,
      oldTotal: calculation.oldTotal,
      newTotal: calculation.newTotal,
      fixedContractualAdjustment: calculation.fixedAdjustment,
      additionalAmount: calculation.additionalAmount,
      oldEndAt: extensionEntry.oldEndAt,
      newEndAt: extensionEntry.newEndAt
    }
  };
}

async function refreshPaidRootRetention(env, source, newEndMs) {
  const contractId = contractVersionInfo(source).contractId;
  const records = await listReservations(env);
  const paidRoot = records.find((record) => record.status === "paid" && contractVersionInfo(record).contractId === contractId);
  if (!paidRoot) return;
  await extendContractRetention(env, paidRoot, new Date(newEndMs).toISOString());
}

async function prepareContractExtension(env, id, newEnd) {
  const source = await getReservation(env, id);
  if (!source || !["paid", "manual_contract", "contract_version"].includes(source.status)) {
    throw new ContractExtensionError("Contrat introuvable", "contract_not_found", 404);
  }
  const versionInfo = contractVersionInfo(source);
  const updatesDraft = !isSignedContract(source);
  if (updatesDraft && versionInfo.status !== "draft") {
    throw new ContractExtensionError("Seul un brouillon ou une version finalisée peut être prolongé", "source_not_extendable", 409);
  }
  if (!newEnd || !/^\d{4}-\d{2}-\d{2}$/.test(newEnd.date || "") || !/^\d{2}:\d{2}$/.test(newEnd.time || "")) {
    throw new ContractExtensionError("Nouvelle date et nouvelle heure de retour obligatoires", "invalid_extension_end");
  }
  const calculation = extensionCalculation(source, newEnd);
  const conflict = await findExtensionConflict(env, source, calculation.interval.end, calculation.newEndMs);
  if (conflict) {
    throw new ContractExtensionError("Ce véhicule est déjà réservé pendant la période de prolongation.", "extension_vehicle_conflict", 409, conflict);
  }
  return { source, calculation, updatesDraft };
}

function publicPreview(source, calculation, newEnd, updatesDraft = false) {
  return {
    contractId: contractVersionInfo(source).contractId,
    contractNumero: source.contractNumero,
    sourceVersion: contractVersionInfo(source).version,
    vehicleId: source.vehiculeId,
    currentEnd: `${calculation.interval.endParts.date}T${calculation.interval.endParts.time}`,
    newEnd: `${newEnd.date}T${newEnd.time}`,
    contractDailyRate: calculation.dailyRate,
    days: calculation.newDays,
    includedMileage: calculation.mileage.kilometresInclusTotal,
    newTotal: calculation.newTotal,
    alreadyPaid: calculation.alreadyPaid,
    additionalAmount: calculation.additionalAmount,
    mode: updatesDraft ? "draft_update" : "new_version",
    targetVersion: updatesDraft ? contractVersionInfo(source).version : contractVersionInfo(source).version + 1
  };
}

async function previewContractExtension(env, id, newEnd) {
  const { source, calculation, updatesDraft } = await prepareContractExtension(env, id, newEnd);
  return publicPreview(source, calculation, newEnd, updatesDraft);
}

async function createContractExtension(env, id, newEnd, operator, reason) {
  const { source, calculation, updatesDraft } = await prepareContractExtension(env, id, newEnd);
  let version;
  if (updatesDraft) {
    version = applyCalculation(deepCloneContractData(source), source, calculation, newEnd, operator);
    version.updatedAt = new Date().toISOString();
    version.updatedBy = operator || source.updatedBy || null;
    if (source.status === "paid") version = await updateReservationStatus(env, source.id, "paid", version);
    else await env.RESERVATIONS_KV.put(source.id, JSON.stringify(version));
  } else {
    version = await createContractVersion(env, id, operator, extensionReason(newEnd, reason), (draft) => applyCalculation(draft, source, calculation, newEnd, operator));
  }
  try { await refreshPaidRootRetention(env, source, calculation.newEndMs); }
  catch (error) { console.error("[contract-extension] Échec de prolongation du TTL KV", source.id); }
  return { version, preview: publicPreview(source, calculation, newEnd, updatesDraft), updatedExisting: updatesDraft };
}

module.exports = {
  ContractExtensionError,
  extensionCalculation,
  contractPeriodCalculation,
  findExtensionConflict,
  previewContractExtension,
  createContractExtension
};
