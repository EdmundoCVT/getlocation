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

function pad2(n) {
  return String(n).padStart(2, "0");
}

// Numéro de contrat lisible GL-AAAAMMJJ-NNNN (distinct de l'id KV opaque
// res_<hex> et de la "référence de réservation" GL-<8 derniers hex>
// affichée au client sur confirmation.html — ni l'un ni l'autre n'est
// séquentiel). Compteur journalier stocké dans RESERVATIONS_KV (clé
// "contract_counter_AAAAMMJJ", préfixe disjoint de tous les autres déjà
// utilisés dans ce fichier : res_/pay_/doc_/agency_doc_/contract_agency_/
// contract_client_). Lecture-puis-écriture non atomique — limite acceptée
// pour une petite agence à faible volume (même compromis que
// RESERVATION_HOLD_MS ci-dessus).
async function generateContractNumero(env) {
  const now = new Date();
  const datePart = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`;
  const counterKey = `contract_counter_${datePart}`;
  const current = await env.RESERVATIONS_KV.get(counterKey);
  const next = (current ? parseInt(current, 10) : 0) + 1;
  await env.RESERVATIONS_KV.put(counterKey, String(next));
  return `GL-${datePart}-${String(next).padStart(4, "0")}`;
}

// Contrat créé à la main par l'agence (client sans réservation en ligne, ou
// contrat recréé après une location déjà effectuée) — statut dédié
// "manual_contract", jamais confondu avec une réservation en ligne
// (pending_payment/paid/cancelled/expired) par listActiveReservationsForVehicule
// / hasOverlappingReservation, qui ne regardent que ces statuts-là. Stocké
// SANS TTL (contrairement à createReservation) : c'est un document
// commercial à conserver, pas une réservation à durée de vie limitée.
async function createManualContract(env, rawData) {
  const id = generateReservationId();
  const numero = await generateContractNumero(env);
  const now = new Date().toISOString();
  const record = { ...rawData, id, contractNumero: numero, status: "manual_contract", createdAt: now, updatedAt: now };
  await env.RESERVATIONS_KV.put(id, JSON.stringify(record));
  return record;
}

// Met à jour un contrat manuel EN PLACE (même id, même numéro, même
// createdAt) — typiquement pour compléter le kilométrage retour ou corriger
// une information avant restitution. rawData remplace intégralement les
// données métier (le formulaire renvoie toujours son état complet, jamais
// un patch partiel — même convention que createManualContract). Renvoie
// null si l'id est introuvable ou ne correspond pas à un contrat manuel.
async function updateManualContract(env, id, rawData) {
  const record = await getReservation(env, id);
  if (!record || record.status !== "manual_contract") return null;
  const updated = {
    ...rawData,
    id: record.id,
    contractNumero: record.contractNumero,
    status: "manual_contract",
    createdAt: record.createdAt,
    updatedAt: new Date().toISOString()
  };
  await env.RESERVATIONS_KV.put(id, JSON.stringify(updated));
  return updated;
}

async function createReservation(env, data) {
  const id = generateReservationId();
  const now = new Date().toISOString();
  const record = {
    ...data,
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

// Même garde que updateReservationDocuments (réservation payée uniquement) :
// le dossier contrat (champs contrat, remise, retour) ne doit jamais pouvoir
// être modifié sur une réservation qui n'a jamais été payée.
async function updateContractDossier(env, id, extra) {
  const record = await getReservation(env, id);
  if (!record || record.status !== "paid") return null;
  return updateReservationStatus(env, id, "paid", extra);
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
// manuels (nécessaire à "Ouvrir"/"Dupliquer" côté formulaire), qui restent
// dans le même modèle de confiance qu'avant (page /contrat non
// authentifiée, choix assumé — voir CLAUDE.md).
async function listContractsHistory(env, limit = 30) {
  const records = await listReservations(env);
  const avecNumero = records.filter((r) => r.contractNumero);

  avecNumero.sort((a, b) => (b.contractNumero || "").localeCompare(a.contractNumero || ""));

  return avecNumero.slice(0, limit).map((r) => {
    if (r.status === "manual_contract") {
      return { id: r.id, numero: r.contractNumero, origine: "manuel", createdAt: r.createdAt, rawData: r };
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
        statut: r.status
      }
    };
  });
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
  updateContractDossier,
  listReservations,
  hasOverlappingReservation,
  generateReservationId,
  reservationTtlSeconds,
  PAID_RETENTION_AFTER_RETURN_MS,
  generateContractNumero,
  createManualContract,
  updateManualContract,
  listContractsHistory
};
