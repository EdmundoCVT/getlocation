// src/lib/reservation-store.js
//
// Persistance des réservations sur Cloudflare KV (binding RESERVATIONS_KV,
// voir wrangler.jsonc). Remplace Netlify Blobs — utilisé par l'ancienne
// implémentation netlify/functions/lib/reservation-store.js (Phase A),
// conservée telle quelle pour référence/rollback tant que cette version
// n'est pas confirmée en production (voir DEPLOIEMENT.md, Phase B).
//
// Contrairement à la version Netlify Blobs, aucun repli mémoire n'est
// nécessaire ici : les tests fournissent une fausse implémentation de
// l'interface KV (voir tests/helpers/fake-kv.js) plutôt qu'un mode dégradé
// caché dans le code de production.
//
// Statuts possibles : "pending_payment" | "paid" | "cancelled" | "expired"

const RESERVATION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 jours
// Décision validée (revue de sécurité PR #3-8, finding "haute") : les
// documents d'identité sont purgés automatiquement 30 jours après la
// restitution — voir document-retention.js, seul endroit qui doit rester
// synchronisé avec cette valeur (d'où l'export).
const PAID_RETENTION_AFTER_RETURN_MS = 30 * 24 * 60 * 60 * 1000;
// Marge technique PUREMENT KV : la purge documentaire tourne une fois par
// jour et peut retenter plusieurs jours de suite en cas d'échec partiel de
// suppression R2 (voir document-retention.js). La fiche réservation elle-
// même ne doit jamais expirer avant que la purge ait eu l'occasion de
// s'exécuter (et de réessayer) — cette marge ne change PAS le déclenchement
// de la purge (toujours exactement J+30), seulement la durée de survie de
// l'enregistrement KV.
const KV_RETENTION_SAFETY_MARGIN_MS = 5 * 24 * 60 * 60 * 1000; // 5 jours
// Fenêtre pendant laquelle une réservation "pending_payment" (non encore
// payée) bloque le véhicule pour éviter une double vente pendant le tunnel
// de paiement. Voir l'équivalent Netlify Blobs pour le détail du
// raisonnement (limite connue : pas de verrou distribué, acceptable pour une
// petite flotte à faible volume).
const RESERVATION_HOLD_MS = 1000 * 60 * 30; // 30 minutes

function generateReservationId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `res_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

// Les enregistrements KV ne contiennent que des données JSON. Cette copie
// explicite garantit qu'une nouvelle version ne partage jamais un tableau ou
// un objet mutable avec sa source (signature, options, CGL, observations…).
function deepCloneContractData(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function contractLanguage(record) {
  // `contractLanguage` appartient à la version de contrat et prévaut sur la
  // langue de navigation historique de la réservation. Cela permet par
  // exemple V1 EN signée puis V2 FR sans rouvrir ni altérer V1.
  if (record && (record.contractLanguage === "fr" || record.contractLanguage === "en")) return record.contractLanguage;
  if (record && record.contractDossier && (record.contractDossier.contractLanguage === "fr" || record.contractDossier.contractLanguage === "en")) return record.contractDossier.contractLanguage;
  return record && (record.langueClient === "en" || record.langue === "en") ? "en" : "fr";
}

// Numéro de contrat lisible GL-AAAAMMJJ-NNNN (distinct de l'id KV opaque
// res_<hex> et de la "référence de réservation" GL-<8 derniers hex>
// affichée au client sur confirmation.html — ni l'un ni l'autre n'est
// séquentiel). Depuis le Lot 2 (voir CLAUDE.md), délègue à
// src/lib/contract-numero.js : compteur D1 atomique (UPSERT SQLite), partagé
// avec les nouvelles locations (src/lib/rentals.js) pour ne jamais avoir
// deux compteurs indépendants sur le même format. Remplace l'ancien
// compteur Cloudflare KV lecture-puis-écriture (non garanti unique en cas de
// double écriture quasi simultanée).
const { generateContractNumero } = require("./contract-numero.js");
const { normalizeContractMileage, agreedTotal } = require("./contract-mileage.js");

// Contrat créé à la main par l'agence (client sans réservation en ligne, ou
// contrat recréé après une location déjà effectuée) — statut dédié
// "manual_contract", jamais confondu avec une réservation en ligne
// (pending_payment/paid/cancelled/expired) par listActiveReservationsForVehicule
// / hasOverlappingReservation, qui ne regardent que ces statuts-là. Stocké
// SANS TTL (contrairement à createReservation) : c'est un document
// commercial à conserver, pas une réservation à durée de vie limitée.
// `operator` : nom de l'opérateur connecté (session agence vérifiée, voir
// src/lib/agency-auth.js), JAMAIS une valeur envoyée par le navigateur —
// placé après le spread de rawData pour ne jamais pouvoir être écrasé par
// un champ du même nom dans le formulaire.
async function createManualContract(env, rawData, operator) {
  const id = generateReservationId();
  const numero = await generateContractNumero(env);
  const now = new Date().toISOString();
  // Les champs internes d'inspection ne proviennent jamais du formulaire
  // contrat, y compris si un appelant forge le corps de la requête.
  const { contractDossier, contractAgencyAccess, manualClientAccess, inspectionSchema, ...contractFields } = rawData;
  const contractMileage = normalizeContractMileage(contractFields, rawData.contractMileage);
  const record = {
    ...contractFields,
    contractMileage,
    agreedRentalTotal: agreedTotal(contractFields),
    // Une saisie du contrat (dont kmDepart/etatDepart) n'est jamais une
    // validation de l'état des lieux autonome.
    inspectionSchema: "modern",
    id,
    contractNumero: numero,
    status: "manual_contract",
    contractLanguage: contractLanguage(rawData),
    contractVersion: {
      contractId: numero,
      version: 1,
      isActive: true,
      status: "draft",
      createdAt: now,
      signedAt: null,
      finalizedAt: null,
      supersedesVersion: null,
      versionReason: null
    },
    createdAt: now,
    updatedAt: now,
    createdBy: operator || null,
    updatedBy: operator || null
  };
  await env.RESERVATIONS_KV.put(id, JSON.stringify(record));
  return record;
}

// Met à jour un contrat manuel EN PLACE (même id, même numéro, même
// createdAt) — typiquement pour compléter le kilométrage retour ou corriger
// une information avant restitution. rawData remplace intégralement les
// données métier (le formulaire renvoie toujours son état complet, jamais
// un patch partiel — même convention que createManualContract). Renvoie
// null si l'id est introuvable ou ne correspond pas à un contrat manuel.
// Même règle que createManualContract pour `operator` : jamais depuis le
// payload. createdBy n'est jamais réécrit (on garde l'auteur d'origine).
async function updateManualContract(env, id, rawData, operator) {
  const record = await getReservation(env, id);
  if (!record || (record.status !== "manual_contract" && !(record.status === "contract_version" && record.contractSourceType === "manual"))) return null;
  if (isSignedContract(record)) throw new Error("Version signée — archivée : créez une nouvelle version");
  const {
    id: ignoredId,
    status: ignoredStatus,
    contractNumero: ignoredNumero,
    contractVersion: ignoredVersion,
    contractDossier: ignoredDossier,
    inspectionRevisions: ignoredInspectionRevisions,
    inspectionArchives: ignoredInspectionArchives,
    contractAgencyAccess: ignoredAgencyAccess,
    contractClientAccess: ignoredClientAccess,
    manualClientAccess: ignoredManualAccess,
    drivePdfFiles: ignoredPdfFiles,
    paymentId: ignoredPaymentId,
    paidAt: ignoredPaidAt,
    paymentHistory: ignoredPaymentHistory,
    transactions: ignoredTransactions,
    financialHistory: ignoredFinancialHistory,
    paidAmount: ignoredPaidAmount,
    depositOperations: ignoredDepositOperations,
    depositHistory: ignoredDepositHistory,
    molliePaymentId: ignoredMolliePaymentId,
    createdAt: ignoredCreatedAt,
    createdBy: ignoredCreatedBy,
    updatedAt: ignoredUpdatedAt,
    updatedBy: ignoredUpdatedBy,
    ...contractFields
  } = rawData;
  const contractMileage = normalizeContractMileage(contractFields, contractFields.contractMileage || record.contractMileage);
  const updated = {
    ...contractFields,
    contractMileage,
    agreedRentalTotal: agreedTotal(contractFields),
    // Le formulaire contrat remplace ses champs métier, mais n'a aucune
    // autorité sur le dossier d'inspection ou ses jetons agence/client.
    inspectionSchema: record.inspectionSchema,
    contractDossier: record.contractDossier,
    inspectionRevisions: record.inspectionRevisions,
    inspectionArchives: record.inspectionArchives,
    contractAgencyAccess: record.contractAgencyAccess,
    manualClientAccess: record.manualClientAccess,
    drivePdfFiles: record.drivePdfFiles,
    paymentId: record.paymentId,
    paidAt: record.paidAt,
    paymentHistory: record.paymentHistory,
    transactions: record.transactions,
    financialHistory: record.financialHistory,
    paidAmount: record.paidAmount,
    depositOperations: record.depositOperations,
    depositHistory: record.depositHistory,
    molliePaymentId: record.molliePaymentId,
    contractVersion: record.contractVersion,
    contractSourceType: record.contractSourceType,
    contractLanguage: contractLanguage(rawData),
    id: record.id,
    contractNumero: record.contractNumero,
    status: record.status,
    createdAt: record.createdAt,
    createdBy: record.createdBy || null,
    updatedAt: new Date().toISOString(),
    updatedBy: operator || null
  };
  await env.RESERVATIONS_KV.put(id, JSON.stringify(updated));
  // La copie Drive est best-effort : jamais d'impact sur le contrat local.
  try { require("./google-drive-backup.js").enqueueDriveSync(env, id).catch(() => undefined); } catch (e) { /* module facultatif */ }
  return updated;
}

async function createReservation(env, data) {
  const id = generateReservationId();
  const now = new Date().toISOString();
  const record = {
    ...data,
    inspectionSchema: "modern",
    id,
    status: "pending_payment",
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date(Date.now() + RESERVATION_TTL_SECONDS * 1000).toISOString(),
    paymentId: data.paymentId || null
  };
  await env.RESERVATIONS_KV.put(id, JSON.stringify(record), { expirationTtl: RESERVATION_TTL_SECONDS });
  return record;
}

async function getReservation(env, id) {
  if (!id || typeof id !== "string") return null;
  const raw = await env.RESERVATIONS_KV.get(id);
  return raw ? JSON.parse(raw) : null;
}

// Les réservations payées doivent rester disponibles au moins jusqu'à 30
// jours après le retour. Le TTL fixe de 7 jours reste adapté au tunnel de
// paiement, mais ferait sinon disparaître une réservation future de KV et
// libérerait à tort le véhicule dans le contrôle de disponibilité.
function reservationTtlSeconds(record) {
  if (!record || record.status !== "paid") return RESERVATION_TTL_SECONDS;
  const returnMs = record.periodeFin
    ? new Date(record.periodeFin).getTime()
    : record.dateFin && record.heureFin
      ? new Date(`${record.dateFin}T${record.heureFin}:00`).getTime()
      : NaN;
  if (!Number.isFinite(returnMs)) return RESERVATION_TTL_SECONDS;
  const untilRetentionEnd = Math.ceil(
    (returnMs + PAID_RETENTION_AFTER_RETURN_MS + KV_RETENTION_SAFETY_MARGIN_MS - Date.now()) / 1000
  );
  return Math.max(RESERVATION_TTL_SECONDS, untilRetentionEnd);
}

// extra peut contenir n'importe quel champ métier à fusionner (ex.
// paymentId, cglVersion, cglAcceptedAt, failureReason...). Les champs
// id/createdAt ne sont jamais écrasables.
async function updateReservationStatus(env, id, status, extra = {}) {
  const record = await getReservation(env, id);
  if (!record) return null;
  const updated = {
    ...record,
    ...extra,
    id: record.id,
    createdAt: record.createdAt,
    status,
    updatedAt: new Date().toISOString()
  };

  const expirationTtl = reservationTtlSeconds(updated);
  updated.expiresAt = new Date(Date.now() + expirationTtl * 1000).toISOString();
  await env.RESERVATIONS_KV.put(id, JSON.stringify(updated), { expirationTtl });
  if (updated.paymentId) {
    await env.RESERVATIONS_KV.put(`pay_${updated.paymentId}`, id, { expirationTtl });
  }
  return updated;
}

async function findReservationByPaymentId(env, paymentId) {
  if (!paymentId) return null;
  const id = await env.RESERVATIONS_KV.get(`pay_${paymentId}`);
  if (!id) return null;
  return getReservation(env, id);
}

async function saveDocumentAccessIndex(env, reservationId, tokenHash, expiresAt) {
  if (!reservationId || !/^[a-f0-9]{64}$/.test(tokenHash || "")) return false;
  const expiryMs = new Date(expiresAt).getTime();
  if (!Number.isFinite(expiryMs)) return false;
  const expirationTtl = Math.max(60, Math.ceil((expiryMs - Date.now()) / 1000));
  await env.RESERVATIONS_KV.put(`doc_${tokenHash}`, reservationId, { expirationTtl });
  return true;
}

async function findReservationByDocumentTokenHash(env, tokenHash) {
  if (!/^[a-f0-9]{64}$/.test(tokenHash || "")) return null;
  const id = await env.RESERVATIONS_KV.get(`doc_${tokenHash}`);
  return id ? getReservation(env, id) : null;
}

async function saveAgencyDocumentAccessIndex(env, reservationId, tokenHash, expiresAt) {
  if (!reservationId || !/^[a-f0-9]{64}$/.test(tokenHash || "")) return false;
  const expiryMs = new Date(expiresAt).getTime();
  if (!Number.isFinite(expiryMs)) return false;
  const expirationTtl = Math.max(60, Math.ceil((expiryMs - Date.now()) / 1000));
  await env.RESERVATIONS_KV.put(`agency_doc_${tokenHash}`, reservationId, { expirationTtl });
  return true;
}

async function findReservationByAgencyDocumentTokenHash(env, tokenHash) {
  if (!/^[a-f0-9]{64}$/.test(tokenHash || "")) return null;
  const id = await env.RESERVATIONS_KV.get(`agency_doc_${tokenHash}`);
  return id ? getReservation(env, id) : null;
}

async function updateReservationDocuments(env, id, extra) {
  const record = await getReservation(env, id);
  if (!record || record.status !== "paid") return null;
  return updateReservationStatus(env, id, "paid", extra);
}

// Index des jetons du dossier contrat (voir contract-dossier-token.js) —
// même schéma que doc_*/agency_doc_* ci-dessus, deux préfixes distincts pour
// ne jamais confondre un jeton AGENCE (lecture/écriture) et un jeton CLIENT
// (lecture + signature uniquement).
async function saveContractAgencyAccessIndex(env, reservationId, tokenHash, expiresAt) {
  if (!reservationId || !/^[a-f0-9]{64}$/.test(tokenHash || "")) return false;
  const expiryMs = new Date(expiresAt).getTime();
  if (!Number.isFinite(expiryMs)) return false;
  const expirationTtl = Math.max(60, Math.ceil((expiryMs - Date.now()) / 1000));
  await env.RESERVATIONS_KV.put(`contract_agency_${tokenHash}`, reservationId, { expirationTtl });
  return true;
}

async function findReservationByContractAgencyTokenHash(env, tokenHash) {
  if (!/^[a-f0-9]{64}$/.test(tokenHash || "")) return null;
  const id = await env.RESERVATIONS_KV.get(`contract_agency_${tokenHash}`);
  return id ? getReservation(env, id) : null;
}

async function saveContractClientAccessIndex(env, reservationId, tokenHash, expiresAt) {
  if (!reservationId || !/^[a-f0-9]{64}$/.test(tokenHash || "")) return false;
  const expiryMs = new Date(expiresAt).getTime();
  if (!Number.isFinite(expiryMs)) return false;
  const expirationTtl = Math.max(60, Math.ceil((expiryMs - Date.now()) / 1000));
  await env.RESERVATIONS_KV.put(`contract_client_${tokenHash}`, reservationId, { expirationTtl });
  return true;
}

async function findReservationByContractClientTokenHash(env, tokenHash) {
  if (!/^[a-f0-9]{64}$/.test(tokenHash || "")) return null;
  const id = await env.RESERVATIONS_KV.get(`contract_client_${tokenHash}`);
  return id ? getReservation(env, id) : null;
}

// Index du lien COURT partagé (WhatsApp/SMS/copie) pour un CONTRAT MANUEL
// (voir contract-dossier-token.js, issueManualClientLinkAccess) — préfixe
// distinct de contract_client_ ci-dessus, qui concerne uniquement le dossier
// d'une réservation payée en ligne. Même schéma hash->id que les index
// ci-dessus.
async function saveContractManualClientAccessIndex(env, contractId, tokenHash, expiresAt) {
  if (!contractId || !/^[a-f0-9]{64}$/.test(tokenHash || "")) return false;
  const expiryMs = new Date(expiresAt).getTime();
  if (!Number.isFinite(expiryMs)) return false;
  const expirationTtl = Math.max(60, Math.ceil((expiryMs - Date.now()) / 1000));
  await env.RESERVATIONS_KV.put(`contract_manual_client_${tokenHash}`, contractId, { expirationTtl });
  return true;
}

async function findReservationByContractManualClientTokenHash(env, tokenHash) {
  if (!/^[a-f0-9]{64}$/.test(tokenHash || "")) return null;
  const id = await env.RESERVATIONS_KV.get(`contract_manual_client_${tokenHash}`);
  return id ? getReservation(env, id) : null;
}

// Attache l'accès CLIENT (jeton court) à un contrat manuel EN PLACE, sans
// toucher au reste du document (rawData, numéro, dates de création/mise à
// jour) — appelé juste après création/mise à jour du contrat, jamais à la
// place de createManualContract/updateManualContract. Renvoie null si l'id
// est introuvable ou ne correspond pas à un contrat manuel (même garde que
// updateManualContract).
async function setManualContractClientAccess(env, id, stored) {
  const record = await getReservation(env, id);
  if (!record || (record.status !== "manual_contract" && !(record.status === "contract_version" && record.contractSourceType === "manual"))) return null;
  const updated = { ...record, manualClientAccess: stored };
  await env.RESERVATIONS_KV.put(id, JSON.stringify(updated));
  return updated;
}

async function updateManualContractAgencyAccess(env, id, stored, activateModernInspection = false) {
  const record = await getReservation(env, id);
  if (!record || record.status !== "manual_contract") return null;
  // Un ancien contrat sans marqueur, mais sans relevé historique, peut être
  // ouvert dans le nouvel outil : son premier lien agence fixe alors le
  // schéma moderne avant tout upload/sauvegarde. Les vrais historiques sont
  // écartés par contract-agency-link avant cet appel.
  const updated = { ...record, contractAgencyAccess: stored, inspectionSchema: activateModernInspection ? "modern" : record.inspectionSchema };
  await env.RESERVATIONS_KV.put(id, JSON.stringify(updated));
  return updated;
}

// L'émission d'un lien agence ne modifie aucune donnée métier ni la signature.
// Cette opération doit rester possible pour consulter une version archivée.
async function setContractAgencyAccess(env, id, stored, activateModernInspection = false) {
  const record = await getReservation(env, id);
  if (!record || !["paid", "manual_contract", "contract_version"].includes(record.status)) return null;
  const updated = {
    ...record,
    contractAgencyAccess: stored,
    inspectionSchema: activateModernInspection ? "modern" : record.inspectionSchema
  };
  await env.RESERVATIONS_KV.put(id, JSON.stringify(updated));
  return updated;
}

async function setDrivePdfFile(env, id, item) {
  const record = await getReservation(env, id);
  if (!record || !["paid", "manual_contract", "contract_version"].includes(record.status)) return null;
  const files = Array.isArray(record.drivePdfFiles) ? record.drivePdfFiles.filter((file) => file && file.sourceKey !== item.sourceKey) : [];
  files.push(item);
  const updated = { ...record, drivePdfFiles: files, updatedAt: isSignedContract(record) ? record.updatedAt : new Date().toISOString() };
  await env.RESERVATIONS_KV.put(id, JSON.stringify(updated));
  return updated;
}

// Même garde que updateReservationDocuments (réservation payée uniquement) :
// le dossier contrat (champs contrat, remise, retour) ne doit jamais pouvoir
// être modifié sur une réservation qui n'a jamais été payée.
async function updateContractDossier(env, id, extra) {
  const record = await getReservation(env, id);
  if (!record || !["paid", "manual_contract", "contract_version"].includes(record.status)) return null;
  if (isSignedContract(record)) throw new Error("Version signée — archivée : créez une nouvelle version");
  if (record.status === "paid") {
    const updatedPaid = await updateReservationStatus(env, id, "paid", extra);
    try { require("./google-drive-backup.js").enqueueDriveSync(env, id).catch(() => undefined); } catch (e) { /* module facultatif */ }
    return updatedPaid;
  }
  const updated = { ...record, ...extra, id: record.id, status: record.status, createdAt: record.createdAt, updatedAt: new Date().toISOString() };
  await env.RESERVATIONS_KV.put(id, JSON.stringify(updated));
  try { require("./google-drive-backup.js").enqueueDriveSync(env, id).catch(() => undefined); } catch (e) { /* module facultatif */ }
  return updated;
}

// Correction administrative limitée à l'horodatage affiché d'une signature
// EDL. Elle reste autorisée après signature/finalisation, sans jamais
// toucher au binaire, au nom ni à `signedAt` de la signature d'origine.
async function updateInspectionSignatureDisplay(env, id, mode, role, displaySignedAt, correctedBy = null) {
  if (!["depart", "retour"].includes(mode) || !["client", "agence"].includes(role)) return null;
  const record = await getReservation(env, id);
  if (!record || !["paid", "manual_contract", "contract_version"].includes(record.status)) return null;
  const dossier = record.contractDossier || {};
  const stage = dossier[mode];
  const signature = stage && stage.signatures && stage.signatures[role];
  if (!signature || !signature.signedAt) return null;
  const previousDisplaySignedAt = signature.displaySignedAt || null;
  const correctedAt = new Date().toISOString();
  const correction = { role, previousDisplaySignedAt, newDisplaySignedAt: displaySignedAt || null, correctedAt, correctedBy: correctedBy || null };
  const nextSignature = { ...signature };
  if (displaySignedAt) nextSignature.displaySignedAt = displaySignedAt;
  else delete nextSignature.displaySignedAt;
  const nextStage = {
    ...stage,
    signatures: { ...stage.signatures, [role]: nextSignature },
    signatureDisplayCorrections: [...(Array.isArray(stage.signatureDisplayCorrections) ? stage.signatureDisplayCorrections : []), correction].slice(-50)
  };
  const updated = { ...record, contractDossier: { ...dossier, [mode]: nextStage, updatedAt: correctedAt }, updatedAt: correctedAt };
  await env.RESERVATIONS_KV.put(id, JSON.stringify(updated));
  try { require("./google-drive-backup.js").enqueueDriveSync(env, id).catch(() => undefined); } catch (e) { /* module facultatif */ }
  return { record: updated, correction };
}

function contractVersionInfo(record) {
  const legacy = record && record.contractVersion;
  const dossier = record && record.contractDossier || {};
  return {
    contractId: legacy && legacy.contractId || record && record.contractNumero || record && record.id,
    version: Number(legacy && legacy.version) || 1,
    isActive: legacy ? legacy.isActive !== false : true,
    status: legacy && legacy.status || (dossier.status === "signed" ? "signed" : "draft"),
    createdAt: legacy && legacy.createdAt || record && record.createdAt || null,
    signedAt: legacy && legacy.signedAt || (dossier.signature && dossier.signature.signedAt) || null,
    finalizedAt: legacy && legacy.finalizedAt || null,
    supersedesVersion: legacy && legacy.supersedesVersion || null,
    versionReason: legacy && legacy.versionReason || null,
    createdBy: legacy && legacy.createdBy || record && record.createdBy || null
  };
}

function isSignedContract(record) {
  const version = contractVersionInfo(record);
  return version.status === "signed" || version.status === "finalized" || Boolean(record && record.contractDossier && record.contractDossier.status === "signed");
}

async function updateContractVersionSignature(env, id, signature, operator) {
  const record = await getReservation(env, id);
  if (!record || !["paid", "manual_contract", "contract_version"].includes(record.status)) return null;
  if (isSignedContract(record)) throw new Error("Version finalisée — créez une nouvelle version");
  const now = new Date().toISOString();
  const dossier = record.contractDossier || { status: "draft", fields: null, depart: null, retour: null, observations: "" };
  const updated = {
    ...record,
    contractDossier: { ...dossier, status: "draft", signature: signature ? deepCloneContractData(signature) : null, updatedAt: now },
    contractVersion: { ...contractVersionInfo(record), status: "draft", isActive: true, signedAt: null, finalizedAt: null },
    updatedAt: now,
    updatedBy: operator || record.updatedBy || null
  };
  await env.RESERVATIONS_KV.put(id, JSON.stringify(updated));
  return updated;
}

async function updateContractVersionData(env, id, changes, operator) {
  const record = await getReservation(env, id);
  if (!record || !["paid", "manual_contract", "contract_version"].includes(record.status)) return null;
  if (isSignedContract(record)) throw new Error("Version finalisée — créez une nouvelle version");
  const patch = {};
  const stringFields = ["vehiculeId", "immat", "immatriculation", "dateDebut", "heureDebut", "dateFin", "heureFin", "periodeDebut", "periodeFin", "depart", "retour", "lieuPrise", "lieuRetour", "adressePrise", "adresseRetour", "nom", "prenom", "tel", "email", "naissance", "protectionId", "codePromo", "contractLanguage", "langue", "langueClient"];
  for (const key of stringFields) if (Object.prototype.hasOwnProperty.call(changes || {}, key)) {
    if (typeof changes[key] !== "string") throw new Error(`Champ contractuel invalide : ${key}`);
    patch[key] = changes[key].trim().slice(0, key.startsWith("adresse") || key.startsWith("lieu") ? 300 : 150);
  }
  const numericFields = ["total", "sousTotalBrut", "optionsMontant", "depotGarantie", "cautionContractuelle", "reductionPromoMontant", "supplementJeuneConducteur"];
  for (const key of numericFields) if (Object.prototype.hasOwnProperty.call(changes || {}, key)) {
    const value = Number(changes[key]);
    if (!Number.isFinite(value) || value < 0 || value > 1000000) throw new Error(`Montant contractuel invalide : ${key}`);
    patch[key] = value;
  }
  if (Object.prototype.hasOwnProperty.call(changes || {}, "conducteur")) {
    if (!changes.conducteur || typeof changes.conducteur !== "object" || Array.isArray(changes.conducteur)) throw new Error("Conducteur invalide");
    patch.conducteur = {};
    for (const key of ["nom", "prenom", "telephone", "email", "naissance"]) if (typeof changes.conducteur[key] === "string") patch.conducteur[key] = changes.conducteur[key].trim().slice(0, 150);
  }
  if (Object.prototype.hasOwnProperty.call(changes || {}, "options")) {
    if (!Array.isArray(changes.options) || changes.options.length > 50) throw new Error("Options contractuelles invalides");
    patch.options = changes.options.filter((item) => item && typeof item === "object" && typeof item.id === "string").map((item) => deepCloneContractData(item));
  }
  for (const key of ["protection", "reductionDuree"]) if (Object.prototype.hasOwnProperty.call(changes || {}, key)) {
    if (changes[key] !== null && (typeof changes[key] !== "object" || Array.isArray(changes[key]))) throw new Error(`Champ contractuel invalide : ${key}`);
    patch[key] = deepCloneContractData(changes[key]);
  }
  const now = new Date().toISOString();
  const updated = { ...record, ...patch, id: record.id, contractNumero: record.contractNumero, status: record.status, contractVersion: record.contractVersion, contractDossier: record.contractDossier, paymentId: record.paymentId, paidAt: record.paidAt, createdAt: record.createdAt, createdBy: record.createdBy || null, updatedAt: now, updatedBy: operator || null };
  await env.RESERVATIONS_KV.put(id, JSON.stringify(updated));
  return updated;
}

async function finalizeContractVersion(env, id, operator) {
  const record = await getReservation(env, id);
  if (!record || !["paid", "manual_contract", "contract_version"].includes(record.status)) return null;
  if (isSignedContract(record)) throw new Error("Cette version est déjà finalisée");
  const dossier = record.contractDossier || {};
  if (!dossier.signature || !dossier.signature.imageDataUrl) throw new Error("Une signature est requise avant la finalisation");
  const now = new Date().toISOString();
  const signedAt = dossier.signature.signedAt || now;
  const updated = {
    ...record,
    contractDossier: {
      ...dossier,
      status: "signed",
      cglAcceptedAt: dossier.cglAcceptedAt || now,
      signature: { ...dossier.signature, signedAt },
      updatedAt: now
    },
    contractVersion: { ...contractVersionInfo(record), status: "signed", isActive: true, signedAt, finalizedAt: now },
    updatedAt: now,
    updatedBy: operator || record.updatedBy || null
  };
  await env.RESERVATIONS_KV.put(id, JSON.stringify(updated));
  return updated;
}

class ContractDraftExistsError extends Error {
  constructor(record) {
    const info = contractVersionInfo(record);
    super(`Un brouillon est déjà en cours : V${info.version}`);
    this.name = "ContractDraftExistsError";
    this.code = "contract_draft_exists";
    this.draft = { id: record.id, version: info.version };
  }
}

function isDraftContract(record) {
  const info = contractVersionInfo(record);
  if (["signed", "finalized", "archived"].includes(info.status)) return false;
  return info.status === "draft" || info.status === "sent" || !isSignedContract(record);
}

async function createContractVersion(env, id, operator, versionReason) {
  const source = await getReservation(env, id);
  if (!source || !["paid", "manual_contract", "contract_version"].includes(source.status)) return null;
  if (!isSignedContract(source)) throw new Error("Seule une version signée peut être archivée et versionnée");
  const reason = typeof versionReason === "string" ? versionReason.trim().slice(0, 500) : "";
  if (!reason) throw new Error("Motif de la nouvelle version obligatoire");
  const sourceVersion = contractVersionInfo(source);
  const contractId = sourceVersion.contractId;
  const records = await listReservations(env);
  const versions = records.filter((record) => contractVersionInfo(record).contractId === contractId);
  const existingDraft = versions.find((record) => record.id !== source.id && isDraftContract(record));
  if (existingDraft) throw new ContractDraftExistsError(existingDraft);
  const nextVersion = Math.max.apply(null, versions.map((record) => contractVersionInfo(record).version)) + 1;
  const now = new Date().toISOString();
  // La source n'est jamais réécrite. Son statut, ses timestamps, sa
  // signature et ses pointeurs PDF restent strictement identiques.
  const sourceCopy = deepCloneContractData(source);
  const {
    contractAgencyAccess,
    contractClientAccess,
    manualClientAccess,
    drivePdfFiles,
    driveSync,
    ...copy
  } = sourceCopy;
  const clonedDossier = sourceCopy.contractDossier ? {
    ...sourceCopy.contractDossier,
    status: "draft",
    sentAt: null,
    // La signature est héritée par copie profonde. Elle peut ensuite être
    // conservée, corrigée ou remplacée uniquement dans le brouillon Vn.
    signature: sourceCopy.contractDossier.signature || null,
    updatedAt: now
  } : { status: "draft", fields: null, depart: null, retour: null, observations: "" };
  const newId = generateReservationId();
  const record = {
    ...copy,
    id: newId,
    status: source.status === "manual_contract" || source.contractSourceType === "manual" ? "manual_contract" : "contract_version",
    contractSourceType: source.status === "manual_contract" || source.contractSourceType === "manual" ? "manual" : "reservation",
    contractDossier: clonedDossier,
    financialHistory: sourceCopy.financialHistory || {
      paymentId: sourceCopy.paymentId || null,
      paidAt: sourceCopy.paidAt || null,
      paidAmount: sourceCopy.paidAmount !== undefined ? sourceCopy.paidAmount : sourceCopy.total !== undefined ? sourceCopy.total : null
    },
    contractVersion: {
      contractId,
      version: nextVersion,
      isActive: true,
      status: "draft",
      createdAt: now,
      signedAt: null,
      finalizedAt: null,
      supersedesVersion: sourceVersion.version,
      versionReason: reason,
      createdBy: operator || null
    },
    createdAt: now,
    updatedAt: now,
    createdBy: operator || null,
    updatedBy: operator || null
  };
  await env.RESERVATIONS_KV.put(newId, JSON.stringify(record));
  return record;
}

async function listReservations(env) {
  const records = [];
  let cursor;
  do {
    const page = await env.RESERVATIONS_KV.list({ prefix: "res_", cursor });
    for (const key of page.keys) {
      const raw = await env.RESERVATIONS_KV.get(key.name);
      if (raw) records.push(JSON.parse(raw));
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return records;
}

// Historique unifié des contrats numérotés (voir generateContractNumero) —
// couvre à la fois les contrats manuels (status "manual_contract") ET les
// dossiers contrat des réservations payées en ligne (status "paid" avec un
// contractNumero assigné à la confirmation du paiement, voir
// mollie-webhook.js), déjà tous dans listReservations() puisqu'ils
// partagent le même préfixe "res_". Réutilise l'implémentation existante
// plutôt qu'un second parcours KV dédié.
//
// Vue volontairement minimale pour les dossiers en ligne (nom, véhicule,
// dates, statut) — jamais permis/naissance/téléphone/adresse/signature —
// car cette liste, contrairement à l'accès par jeton du dossier, n'est pas
// protégée individuellement par un secret. Vue complète pour les contrats
// manuels (nécessaire à "Ouvrir"/"Dupliquer" côté formulaire) — accessible
// uniquement à une session agence valide depuis le Lot 1 (voir
// src/api/contracts-history.js, src/lib/agency-auth.js, CLAUDE.md).
async function listContractsHistory(env, limit = 30) {
  const records = await listReservations(env);
  const avecNumero = records.filter((r) => r.contractNumero);

  function historyEntry(r) {
    const version = contractVersionInfo(r);
    // Métadonnée de consultation seulement : jamais de clé R2 dans la liste
    // navigateur. La route agence-contract-pdf relit et autorise le fichier.
    const pdfKind = r.contractDossier && r.contractDossier.status === "signed" ? "contract-signed" : "contract-draft";
    const pdf = { available: Array.isArray(r.drivePdfFiles) && r.drivePdfFiles.some((file) => file && file.sourceKey === `${pdfKind}-v${version.version}` && file.key), signed: pdfKind === "contract-signed" };
    if (r.status === "manual_contract" || r.contractSourceType === "manual") {
      return { id: r.id, numero: r.contractNumero, origine: "manuel", createdAt: r.createdAt, updatedAt: r.updatedAt, rawData: r, version, pdf };
    }
    return {
      id: r.id,
      numero: r.contractNumero,
      origine: "reservation",
      createdAt: r.createdAt,
      resume: {
        vehiculeId: r.vehiculeId || null,
        nom: (r.conducteur && r.conducteur.nom) || "",
        prenom: (r.conducteur && r.conducteur.prenom) || "",
        depart: r.periodeDebut || (r.dateDebut && r.heureDebut ? `${r.dateDebut}T${r.heureDebut}` : ""),
        statut: r.status,
        immatriculation: r.immatriculation || ""
      }, version, pdf, updatedAt: r.updatedAt
    };
  }

  // Une carte par contrat logique. Les versions complètes restent jointes à
  // la carte pour l'historique et pour repartir de n'importe quelle version.
  const groups = new Map();
  for (const record of avecNumero) {
    const id = contractVersionInfo(record).contractId;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(record);
  }
  const cards = [];
  for (const group of groups.values()) {
    group.sort((a, b) => contractVersionInfo(b).version - contractVersionInfo(a).version);
    const draft = group.find(isDraftContract);
    const current = draft || group[0];
    const versions = group.map((record) => {
      const entry = historyEntry(record);
      entry.version = { ...entry.version, isActive: record.id === current.id };
      return entry;
    });
    const card = versions.find((entry) => entry.id === current.id);
    const metadataRaw = await env.RESERVATIONS_KV.get(`contract_meta_${contractVersionInfo(current).contractId}`);
    let metadata = null;
    try { metadata = metadataRaw ? JSON.parse(metadataRaw) : null; } catch (error) { metadata = null; }
    cards.push({ ...card, versions, archived: Boolean(metadata && metadata.archivedAt), archivedAt: metadata && metadata.archivedAt || null, archivedBy: metadata && metadata.archivedBy || null });
  }
  cards.sort((a, b) => {
    const byDate = String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || ""));
    return byDate || String(b.numero || "").localeCompare(String(a.numero || ""));
  });
  return cards.slice(0, limit);
}

async function setContractArchived(env, id, archived, operator) {
  const record = await getReservation(env, id);
  if (!record || !["paid", "manual_contract", "contract_version"].includes(record.status)) return null;
  const contractId = contractVersionInfo(record).contractId;
  const metadata = archived ? { contractId, archivedAt: new Date().toISOString(), archivedBy: operator || null } : { contractId, archivedAt: null, archivedBy: null };
  await env.RESERVATIONS_KV.put(`contract_meta_${contractId}`, JSON.stringify(metadata));
  return metadata;
}

// Liste les réservations "actives" (pending_payment récent ou paid) pour un
// véhicule donné. Implémentation volontairement simple (parcours des clés
// préfixées "res_", index "pay_*" jamais listé) : adaptée à une petite
// flotte / faible volume, pas conçue pour un grand nombre de réservations
// simultanées.
async function listActiveReservationsForVehicule(env, vehiculeId) {
  const records = [];
  let cursor;
  do {
    const page = await env.RESERVATIONS_KV.list({ prefix: "res_", cursor });
    for (const key of page.keys) {
      const raw = await env.RESERVATIONS_KV.get(key.name);
      if (raw) records.push(JSON.parse(raw));
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  const now = Date.now();
  return records.filter((r) => {
    if (r.vehiculeId !== vehiculeId) return false;
    if (r.status === "paid") return true;
    if (r.status === "pending_payment") {
      const createdAt = new Date(r.createdAt).getTime();
      return isFinite(createdAt) && now - createdAt < RESERVATION_HOLD_MS;
    }
    return false;
  });
}

function periodsOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

// periodeDebutISO / periodeFinISO : bornes de la nouvelle demande, au format
// ISO 8601 complet (date + heure). excludeReservationId : à fournir lors
// d'une revérification d'une réservation déjà créée (pour ne pas se
// bloquer elle-même).
async function hasOverlappingReservation(env, vehiculeId, periodeDebutISO, periodeFinISO, excludeReservationId) {
  const start = new Date(periodeDebutISO).getTime();
  const end = new Date(periodeFinISO).getTime();
  if (!isFinite(start) || !isFinite(end) || start >= end) return true; // période invalide => on refuse par prudence

  const reservations = await listActiveReservationsForVehicule(env, vehiculeId);
  return reservations.some((r) => {
    if (excludeReservationId && r.id === excludeReservationId) return false;
    if (!r.periodeDebut || !r.periodeFin) return false;
    const rStart = new Date(r.periodeDebut).getTime();
    const rEnd = new Date(r.periodeFin).getTime();
    if (!isFinite(rStart) || !isFinite(rEnd)) return false;
    return periodsOverlap(start, end, rStart, rEnd);
  });
}

module.exports = {
  createReservation,
  getReservation,
  updateReservationStatus,
  findReservationByPaymentId,
  saveDocumentAccessIndex,
  findReservationByDocumentTokenHash,
  saveAgencyDocumentAccessIndex,
  findReservationByAgencyDocumentTokenHash,
  updateReservationDocuments,
  saveContractAgencyAccessIndex,
  findReservationByContractAgencyTokenHash,
  saveContractClientAccessIndex,
  findReservationByContractClientTokenHash,
  saveContractManualClientAccessIndex,
  findReservationByContractManualClientTokenHash,
  setManualContractClientAccess,
  updateManualContractAgencyAccess,
  setContractAgencyAccess,
  setDrivePdfFile,
  updateContractDossier,
  updateInspectionSignatureDisplay,
  listReservations,
  hasOverlappingReservation,
  generateReservationId,
  reservationTtlSeconds,
  PAID_RETENTION_AFTER_RETURN_MS,
  generateContractNumero,
  createManualContract,
  updateManualContract,
  listContractsHistory,
  setContractArchived,
  contractVersionInfo,
  isSignedContract,
  createContractVersion,
  updateContractVersionSignature,
  updateContractVersionData,
  finalizeContractVersion,
  ContractDraftExistsError,
  deepCloneContractData,
  contractLanguage
};
