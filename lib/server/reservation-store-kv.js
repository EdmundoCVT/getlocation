// lib/server/reservation-store-kv.js
//
// Équivalent Cloudflare KV de lib/server/reservation-store.js (Netlify
// Blobs) — voir plan de migration Cloudflare, B.3. Même interface
// publique (createReservation/getReservation/updateReservationStatus/
// findReservationByPaymentId/hasOverlappingReservation) pour ne pas
// changer les appelants, mais un binding KV n'est disponible qu'au moment
// de la requête (`env.RESERVATIONS_KV`, pas une variable globale) — d'où
// une fabrique createReservationStore(kv) plutôt qu'un module singleton.
//
// LEÇON DE L'INCIDENT NETLIFY BLOBS DU 12/08/2026 (voir DEPLOIEMENT.md) :
// le repli silencieux vers un stockage non partagé (mémoire) avait masqué
// une panne de configuration pendant des jours — aucune réservation
// jamais retrouvée par le webhook, aucun email de confirmation envoyé,
// sans aucune alerte visible. Ce module ne reproduit PAS ce repli : si le
// binding KV est absent, createReservationStore() échoue immédiatement et
// bruyamment (l'appelant — functions/api/*.js — doit journaliser et
// répondre 500, jamais continuer silencieusement en mémoire).
//
// Statuts possibles : "pending_payment" | "paid" | "cancelled" | "expired"

const RESERVATION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 jours
// Fenêtre pendant laquelle une réservation "pending_payment" bloque le
// véhicule (voir reservation-store.js pour la justification complète).
const RESERVATION_HOLD_MS = 1000 * 60 * 30; // 30 minutes

function generateReservationId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `res_${hex}`;
}

function periodsOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function createReservationStore(kv) {
  if (!kv) {
    throw new Error(
      "[reservation-store-kv] Binding KV manquant (env.RESERVATIONS_KV). " +
      "Refus de continuer silencieusement — voir incident Netlify Blobs du 12/08/2026."
    );
  }

  async function createReservation(data) {
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
    await kv.put(id, JSON.stringify(record), { expirationTtl: RESERVATION_TTL_SECONDS });
    return record;
  }

  async function getReservation(id) {
    if (!id || typeof id !== "string") return null;
    const record = await kv.get(id, { type: "json" });
    return record || null;
  }

  // extra peut contenir n'importe quel champ métier à fusionner. Les champs
  // id/createdAt ne sont jamais écrasables.
  async function updateReservationStatus(id, status, extra = {}) {
    const record = await getReservation(id);
    if (!record) return null;
    const updated = {
      ...record,
      ...extra,
      id: record.id,
      createdAt: record.createdAt,
      status,
      updatedAt: new Date().toISOString()
    };
    await kv.put(id, JSON.stringify(updated), { expirationTtl: RESERVATION_TTL_SECONDS });
    if (updated.paymentId) {
      await kv.put(`pay_${updated.paymentId}`, id, { expirationTtl: RESERVATION_TTL_SECONDS });
    }
    return updated;
  }

  async function findReservationByPaymentId(paymentId) {
    if (!paymentId) return null;
    const id = await kv.get(`pay_${paymentId}`);
    if (!id) return null;
    return getReservation(id);
  }

  // Parcours complet du namespace (hors clés pay_*), comme l'implémentation
  // Netlify Blobs — adapté à une petite flotte, pas à un grand volume. KV a
  // une cohérence éventuelle (propagation jusqu'à ~60s selon la doc
  // Cloudflare) : à garder en tête, ça peut légèrement élargir la fenêtre de
  // double-vente déjà documentée comme non atomique (voir create-payment.js).
  async function listActiveReservationsForVehicule(vehiculeId) {
    const records = [];
    let cursor;
    do {
      const page = await kv.list({ cursor });
      for (const key of page.keys) {
        if (key.name.startsWith("pay_")) continue; // index secondaire, pas une réservation
        const record = await kv.get(key.name, { type: "json" });
        if (record) records.push(record);
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

  async function hasOverlappingReservation(vehiculeId, periodeDebutISO, periodeFinISO, excludeReservationId) {
    const start = new Date(periodeDebutISO).getTime();
    const end = new Date(periodeFinISO).getTime();
    if (!isFinite(start) || !isFinite(end) || start >= end) return true; // période invalide => on refuse par prudence

    const reservations = await listActiveReservationsForVehicule(vehiculeId);
    return reservations.some((r) => {
      if (excludeReservationId && r.id === excludeReservationId) return false;
      if (!r.periodeDebut || !r.periodeFin) return false;
      const rStart = new Date(r.periodeDebut).getTime();
      const rEnd = new Date(r.periodeFin).getTime();
      if (!isFinite(rStart) || !isFinite(rEnd)) return false;
      return periodsOverlap(start, end, rStart, rEnd);
    });
  }

  return {
    createReservation,
    getReservation,
    updateReservationStatus,
    findReservationByPaymentId,
    hasOverlappingReservation,
    generateReservationId
  };
}

module.exports = { createReservationStore };
