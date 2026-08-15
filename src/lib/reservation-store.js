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
const PAID_RETENTION_AFTER_RETURN_MS = 30 * 24 * 60 * 60 * 1000;
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
  const untilRetentionEnd = Math.ceil((returnMs + PAID_RETENTION_AFTER_RETURN_MS - Date.now()) / 1000);
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

async function updateReservationDocuments(env, id, extra) {
  const record = await getReservation(env, id);
  if (!record || record.status !== "paid") return null;
  return updateReservationStatus(env, id, "paid", extra);
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
  updateReservationDocuments,
  hasOverlappingReservation,
  generateReservationId,
  reservationTtlSeconds
};
