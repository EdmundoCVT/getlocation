// netlify/functions/lib/reservation-store.js
//
// Abstraction de persistance des réservations. Utilisée UNIQUEMENT côté
// serveur (netlify/functions) — ne jamais importer ce fichier depuis le
// navigateur.
//
// Backend de production : Netlify Blobs (@netlify/blobs). Ce service est
// fourni automatiquement par l'environnement d'exécution Netlify Functions :
// aucun identifiant à créer ni à stocker, le contexte (site, jeton) est
// injecté par Netlify au moment de l'exécution. Voir
// https://docs.netlify.com/blobs/overview/
//
// Repli développement/tests : si Netlify Blobs n'est pas disponible (code
// exécuté hors runtime Netlify, ex. `node --test` en local), on bascule
// automatiquement sur un stockage en mémoire (Map). Ce mode n'est PAS
// persistant (perdu à chaque redémarrage et non partagé entre instances de
// fonction) et ne doit JAMAIS être utilisé en production. Un avertissement
// est émis une seule fois si ce mode est activé.
//
// Aucun identifiant/API key de base de données n'est inventé ici : si un
// jour un backend différent de Netlify Blobs est requis, il suffit
// d'implémenter la même interface (createReservation/getReservation/
// updateReservationStatus/findReservationByPaymentIntent) et de documenter
// les variables d'environnement nécessaires — voir README section
// "Configuration production".
//
// Statuts possibles : "pending_payment" | "paid" | "cancelled" | "expired"

const crypto = require("crypto");

const STORE_NAME = "getlocation-reservations";
const RESERVATION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 jours (purge logique, cf. expiresAt)
// Fenêtre pendant laquelle une réservation "pending_payment" (non encore
// payée) bloque le véhicule pour éviter une double vente pendant le tunnel
// de paiement. Passé ce délai, une réservation jamais payée est considérée
// comme abandonnée et ne bloque plus les nouvelles demandes (elle garde
// littéralement le statut "pending_payment" en base tant qu'aucun webhook
// ne l'a fait évoluer ; un nettoyage/expiration explicite pourra être
// ajouté plus tard — voir AUDIT.md, non bloquant pour la disponibilité).
const RESERVATION_HOLD_MS = 1000 * 60 * 30; // 30 minutes

let warnedMemoryFallback = false;

function generateReservationId() {
  return `res_${crypto.randomBytes(16).toString("hex")}`;
}

// --- Repli mémoire (dev/tests uniquement, non persistant) ------------------
const memoryStore = new Map(); // id -> record
const memoryPaymentIntentIndex = new Map(); // paymentIntentId -> id

function memoryWarnOnce() {
  if (!warnedMemoryFallback) {
    warnedMemoryFallback = true;
    console.warn(
      "[reservation-store] Netlify Blobs indisponible : repli en mémoire " +
      "(non persistant, ne pas utiliser en production)."
    );
  }
}

// --- Sélection du backend ---------------------------------------------------
function getBlobsStore() {
  try {
    // require() différé : évite un crash au chargement du module si
    // @netlify/blobs n'est pas installé (ne devrait pas arriver en
    // production une fois la dépendance ajoutée à package.json, mais reste
    // sûr pour les environnements de test).
    const { getStore } = require("@netlify/blobs");
    return getStore(STORE_NAME);
  } catch (err) {
    return null;
  }
}

async function withStore(fn, fallbackFn) {
  const store = getBlobsStore();
  if (store) {
    try {
      return await fn(store);
    } catch (err) {
      // Blobs déclaré mais mal configuré (ex. hors contexte Netlify) :
      // on retombe sur la mémoire plutôt que de faire planter la fonction.
      memoryWarnOnce();
      return fallbackFn();
    }
  }
  memoryWarnOnce();
  return fallbackFn();
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
    expiresAt: new Date(Date.now() + RESERVATION_TTL_MS).toISOString(),
    paymentIntentId: data.paymentIntentId || null
  };

  await withStore(
    async (store) => {
      await store.setJSON(id, record);
    },
    () => {
      memoryStore.set(id, record);
    }
  );
  return record;
}

async function getReservation(id) {
  if (!id || typeof id !== "string") return null;
  return withStore(
    async (store) => {
      const record = await store.get(id, { type: "json" });
      return record || null;
    },
    () => memoryStore.get(id) || null
  );
}

// extra peut contenir n'importe quel champ métier à fusionner (ex.
// paymentIntentId, cglVersion, cglAcceptedAt, failureReason...). Les champs
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

  await withStore(
    async (store) => {
      await store.setJSON(id, updated);
      if (updated.paymentIntentId) {
        await store.set(`pi_${updated.paymentIntentId}`, id);
      }
    },
    () => {
      memoryStore.set(id, updated);
      if (updated.paymentIntentId) {
        memoryPaymentIntentIndex.set(updated.paymentIntentId, id);
      }
    }
  );
  return updated;
}

async function findReservationByPaymentIntent(paymentIntentId) {
  if (!paymentIntentId) return null;
  const id = await withStore(
    async (store) => store.get(`pi_${paymentIntentId}`),
    () => memoryPaymentIntentIndex.get(paymentIntentId) || null
  );
  if (!id) return null;
  return getReservation(id);
}

// Liste les réservations "actives" (pending_payment récent ou paid) pour un
// véhicule donné. Implémentation volontairement simple (parcours complet du
// store) : adaptée à une petite flotte / faible volume, pas conçue pour un
// grand nombre de réservations simultanées.
async function listActiveReservationsForVehicule(vehiculeId) {
  const all = await withStore(
    async (store) => {
      const records = [];
      const { blobs } = await store.list();
      for (const blob of blobs) {
        if (blob.key.startsWith("pi_")) continue; // index secondaire, pas une réservation
        const record = await store.get(blob.key, { type: "json" });
        if (record) records.push(record);
      }
      return records;
    },
    () => Array.from(memoryStore.values())
  );

  const now = Date.now();
  return all.filter((r) => {
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

module.exports = {
  createReservation,
  getReservation,
  updateReservationStatus,
  findReservationByPaymentIntent,
  hasOverlappingReservation,
  generateReservationId
};
