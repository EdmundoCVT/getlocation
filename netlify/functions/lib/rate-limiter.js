// netlify/functions/lib/rate-limiter.js
//
// Protection anti-abus minimale, "best effort", pour les endpoints
// sensibles (ex. création de PaymentIntent). Compteur par clé (typiquement
// IP + nom de fonction) sur une fenêtre glissante simplifiée (fenêtre fixe).
//
// Backend : Netlify Blobs (même mécanisme que reservation-store.js), avec
// repli mémoire en dev/tests. Comme documenté dans reservation-store.js,
// n'invente aucun credential : Netlify Blobs est fourni automatiquement par
// le runtime Netlify Functions.
//
// IMPORTANT — limites connues de cette protection :
// - Elle protège contre un abus applicatif simple (ex. un script qui
//   bombarde l'endpoint de paiement), pas contre une attaque DDoS distribuée
//   à grande échelle.
// - Netlify propose aussi une fonctionnalité native de rate limiting
//   (règles déclarées dans le fichier de la fonction ou dans l'UI Netlify,
//   cf. https://docs.netlify.com/manage/security/secure-access-to-sites/rate-limiting/).
//   Cette protection complémentaire n'est PAS activée par ce code : elle est
//   documentée comme recommandation dans AUDIT.md plutôt qu'annoncée comme
//   opérationnelle, faute de pouvoir la valider par un déploiement réel ici.

let warnedMemoryFallback = false;
const memoryCounters = new Map(); // key -> { count, windowStart }

function memoryWarnOnce() {
  if (!warnedMemoryFallback) {
    warnedMemoryFallback = true;
    console.warn(
      "[rate-limiter] Netlify Blobs indisponible : repli en mémoire " +
      "(non partagé entre instances, ne pas considérer comme fiable en production)."
    );
  }
}

function getBlobsStore() {
  try {
    const { getStore } = require("@netlify/blobs");
    return getStore("getlocation-rate-limits");
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
      memoryWarnOnce();
      return fallbackFn();
    }
  }
  memoryWarnOnce();
  return fallbackFn();
}

// Retourne { allowed: boolean, remaining: number, retryAfterSeconds: number }
// windowMs : durée de la fenêtre. maxRequests : nombre de requêtes autorisées
// par fenêtre pour cette clé.
async function checkRateLimit(key, { windowMs, maxRequests }) {
  const now = Date.now();

  return withStore(
    async (store) => {
      const current = (await store.get(key, { type: "json" })) || null;
      let count = 1;
      let windowStart = now;
      if (current && isFinite(current.windowStart) && now - current.windowStart < windowMs) {
        windowStart = current.windowStart;
        count = current.count + 1;
      }
      await store.setJSON(key, { count, windowStart });
      const allowed = count <= maxRequests;
      const retryAfterSeconds = allowed ? 0 : Math.ceil((windowStart + windowMs - now) / 1000);
      return { allowed, remaining: Math.max(maxRequests - count, 0), retryAfterSeconds };
    },
    () => {
      const current = memoryCounters.get(key);
      let count = 1;
      let windowStart = now;
      if (current && now - current.windowStart < windowMs) {
        windowStart = current.windowStart;
        count = current.count + 1;
      }
      memoryCounters.set(key, { count, windowStart });
      const allowed = count <= maxRequests;
      const retryAfterSeconds = allowed ? 0 : Math.ceil((windowStart + windowMs - now) / 1000);
      return { allowed, remaining: Math.max(maxRequests - count, 0), retryAfterSeconds };
    }
  );
}

module.exports = { checkRateLimit };
