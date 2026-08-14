// tests/helpers/fake-kv.js
//
// Fausse implémentation de l'interface Cloudflare KV (get/put/list) utilisée
// par les tests de src/lib/reservation-store.js et src/lib/rate-limiter.js —
// en mémoire, non persistante, suffisante pour ces tests unitaires. Reproduit
// volontairement la contrainte réelle de KV (expirationTtl minimum de 60
// secondes) pour que les tests détectent un appel invalide comme il le
// serait en production.

function createFakeKv() {
  const store = new Map(); // key -> { value, expiresAt }

  function isExpired(entry) {
    return entry.expiresAt !== null && Date.now() >= entry.expiresAt;
  }

  return {
    async get(key) {
      const entry = store.get(key);
      if (!entry || isExpired(entry)) return null;
      return entry.value;
    },
    async put(key, value, options = {}) {
      if (options.expirationTtl !== undefined) {
        if (!Number.isFinite(options.expirationTtl) || options.expirationTtl < 60) {
          throw new Error("expirationTtl doit être un nombre >= 60 (contrainte Cloudflare KV)");
        }
      }
      const expiresAt = options.expirationTtl !== undefined ? Date.now() + options.expirationTtl * 1000 : null;
      store.set(key, { value, expiresAt });
    },
    async delete(key) {
      store.delete(key);
    },
    async list({ prefix = "", cursor } = {}) {
      const keys = [...store.keys()]
        .filter((k) => k.startsWith(prefix) && !isExpired(store.get(k)))
        .sort()
        .map((name) => ({ name }));
      // Pas de pagination réelle nécessaire pour ces tests (petit volume) :
      // toujours une seule page complète.
      return { keys, list_complete: true, cursor: undefined };
    },
    // Accès direct utile pour des assertions de test (ex. vérifier qu'une
    // clé d'index a bien été créée).
    _raw: store
  };
}

module.exports = { createFakeKv };
