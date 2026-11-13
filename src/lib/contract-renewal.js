// Renouvellement canonique d'un contrat en un nouveau contrat logique.
// Le navigateur ne fournit que la nouvelle période : identité, véhicule,
// conditions contractuelles et calculs sont relus depuis la source.

const {
  getReservation,
  listReservations,
  contractVersionInfo,
  isSignedContract,
  generateReservationId,
  deepCloneContractData
} = require("./reservation-store.js");
const { generateContractNumero } = require("./contract-numero.js");
const { contractPeriodCalculation, ContractExtensionError } = require("./contract-extension.js");
const { instantEuropeParis } = require("../../js/data.js");

class ContractRenewalError extends Error {
  constructor(message, code, status = 400, details = null) {
    super(message);
    this.name = "ContractRenewalError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
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

function recordPeriod(record) {
  const startMs = record && /^\d{4}-\d{2}-\d{2}$/.test(record.dateDebut || "") && /^\d{2}:\d{2}$/.test(record.heureDebut || "")
    ? instantEuropeParis(record.dateDebut, record.heureDebut)
    : new Date(record && (record.depart || record.periodeDebut) || "").getTime();
  const endMs = record && /^\d{4}-\d{2}-\d{2}$/.test(record.dateFin || "") && /^\d{2}:\d{2}$/.test(record.heureFin || "")
    ? instantEuropeParis(record.dateFin, record.heureFin)
    : new Date(record && (record.retour || record.periodeFin) || "").getTime();
  return { startMs, endMs };
}

async function findRenewalConflict(env, source, startMs, endMs) {
  const records = await listReservations(env);
  const latestBlockingByContract = new Map();
  for (const record of records) {
    if (!isBlocking(record) || record.vehiculeId !== source.vehiculeId) continue;
    const info = contractVersionInfo(record);
    const previous = latestBlockingByContract.get(info.contractId);
    if (!previous || contractVersionInfo(previous).version < info.version) latestBlockingByContract.set(info.contractId, record);
  }
  const conflicts = [...latestBlockingByContract.values()].filter((record) => {
    const period = recordPeriod(record);
    return Number.isFinite(period.startMs) && Number.isFinite(period.endMs) && startMs < period.endMs && period.startMs < endMs;
  }).map((record) => ({
    reference: record.contractNumero || record.id,
    startsAt: new Date(recordPeriod(record).startMs).toISOString()
  })).sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
  return conflicts[0] || null;
}

function cleanRenewalBase(source) {
  const copy = deepCloneContractData(source);
  const forbidden = [
    "id", "contractNumero", "status", "contractSourceType", "contractVersion",
    "createdAt", "updatedAt", "createdBy", "updatedBy", "expiresAt",
    "paymentId", "paidAt", "paidAmount", "paymentStatus", "paymentHistory",
    "financialHistory", "amountAlreadyPaid", "additionalAmountDue",
    "depositId", "depositStatus", "depositOperations",
    "documentAccess", "agencyDocumentAccess", "documents", "documentFiles",
    "documentsStatus", "documentsSubmittedAt", "documentsPurgedAt", "documentsAccessToken",
    "contractAgencyAccess", "contractClientAccess", "manualClientAccess",
    "drivePdfFiles", "driveSync", "inspectionRevisions", "inspectionArchives",
    "etatDepart", "etatRetour", "kmDepart", "kmRetour", "signature", "signedAt",
    "pricingSnapshot", "contractExtensionPricing", "reductionDuree", "reductionPromo",
    "reductionPromoMontant", "codePromo"
  ];
  for (const key of forbidden) delete copy[key];
  return copy;
}

function publicPreview(source, calculation, period) {
  const driver = source.conducteur || {};
  return {
    sourceContractId: contractVersionInfo(source).contractId,
    sourceContractNumero: source.contractNumero,
    clientName: [driver.prenom || source.prenom || "", driver.nom || source.nom || ""].join(" ").trim(),
    vehicleId: source.vehiculeId,
    start: `${period.start.date}T${period.start.time}`,
    end: `${period.end.date}T${period.end.time}`,
    days: calculation.newDays,
    includedMileage: calculation.mileage.kilometresInclusTotal,
    contractDailyRate: calculation.dailyRate,
    estimatedTotal: calculation.newTotal
  };
}

async function prepareRenewal(env, sourceId, period) {
  const source = await getReservation(env, sourceId);
  if (!source || !["paid", "manual_contract", "contract_version"].includes(source.status)) {
    throw new ContractRenewalError("Contrat source introuvable", "contract_not_found", 404);
  }
  if (!isSignedContract(source)) {
    throw new ContractRenewalError("Seul un contrat finalisé peut être renouvelé", "source_not_finalized", 409);
  }
  const start = period && period.start || {};
  const end = period && period.end || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start.date || "") || !/^\d{2}:\d{2}$/.test(start.time || "") ||
      !/^\d{4}-\d{2}-\d{2}$/.test(end.date || "") || !/^\d{2}:\d{2}$/.test(end.time || "")) {
    throw new ContractRenewalError("Dates et heures du nouveau contrat obligatoires", "invalid_renewal_period");
  }
  let calculation;
  try { calculation = contractPeriodCalculation(source, start, end); }
  catch (error) {
    if (error instanceof ContractExtensionError) throw new ContractRenewalError(error.message, error.code, error.status || 400);
    throw error;
  }
  const conflict = await findRenewalConflict(env, source, calculation.startMs, calculation.endMs);
  if (conflict) throw new ContractRenewalError("Ce véhicule est déjà réservé sur cette période.", "renewal_vehicle_conflict", 409, conflict);
  return { source, calculation, period: { start, end } };
}

async function previewContractRenewal(env, sourceId, period) {
  const prepared = await prepareRenewal(env, sourceId, period);
  return publicPreview(prepared.source, prepared.calculation, prepared.period);
}

async function renewContract(env, sourceId, period, operator) {
  const { source, calculation, period: normalizedPeriod } = await prepareRenewal(env, sourceId, period);
  const now = new Date().toISOString();
  const id = generateReservationId();
  const contractNumero = await generateContractNumero(env);
  const sourceInfo = contractVersionInfo(source);
  const sourceDossier = source.contractDossier || {};
  const base = cleanRenewalBase(source);
  const record = {
    ...base,
    id,
    contractNumero,
    status: "manual_contract",
    contractSourceType: "manual",
    inspectionSchema: "modern",
    dateDebut: normalizedPeriod.start.date,
    heureDebut: normalizedPeriod.start.time,
    dateFin: normalizedPeriod.end.date,
    heureFin: normalizedPeriod.end.time,
    depart: `${normalizedPeriod.start.date}T${normalizedPeriod.start.time}`,
    retour: `${normalizedPeriod.end.date}T${normalizedPeriod.end.time}`,
    periodeDebut: new Date(calculation.startMs).toISOString(),
    periodeFin: new Date(calculation.endMs).toISOString(),
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
    montantRegle: 0,
    acompteRegle: false,
    soldeRegle: false,
    amountAlreadyPaid: 0,
    additionalAmountDue: calculation.newTotal,
    financialHistory: {},
    pricingSnapshot: {
      dates: { debut: `${normalizedPeriod.start.date}T${normalizedPeriod.start.time}`, fin: `${normalizedPeriod.end.date}T${normalizedPeriod.end.time}` },
      nombreJours: calculation.newDays,
      montantLocationApresRemise: calculation.newRental,
      montantLocationNet: calculation.newRental,
      prixMoyenJour: calculation.dailyRate,
      kilometresInclusLocation: calculation.mileage.kilometresInclusTotal,
      kilometresInclus: calculation.mileage.kilometresInclusTotal,
      totalFinal: calculation.newTotal
    },
    contractDossier: {
      status: "draft",
      fields: deepCloneContractData(sourceDossier.fields || null),
      observations: sourceDossier.observations || "",
      contractLanguage: sourceDossier.contractLanguage || source.contractLanguage || null,
      cglVersion: sourceDossier.cglVersion || source.cglVersion || null,
      signature: null,
      depart: null,
      retour: null,
      sentAt: null,
      updatedAt: now
    },
    contractVersion: {
      contractId: contractNumero,
      version: 1,
      isActive: true,
      status: "draft",
      createdAt: now,
      signedAt: null,
      finalizedAt: null,
      supersedesVersion: null,
      versionReason: null,
      createdBy: operator || null
    },
    renewedFromContractId: sourceInfo.contractId,
    renewedFromContractNumero: source.contractNumero,
    createdAt: now,
    updatedAt: now,
    createdBy: operator || null,
    updatedBy: operator || null
  };
  await env.RESERVATIONS_KV.put(id, JSON.stringify(record));
  return { contract: record, preview: publicPreview(source, calculation, normalizedPeriod) };
}

module.exports = {
  ContractRenewalError,
  findRenewalConflict,
  previewContractRenewal,
  renewContract
};
