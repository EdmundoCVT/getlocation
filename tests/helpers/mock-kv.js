// tests/helpers/mock-kv.js
//
// Simule la surface de l'API Workers KV (get/put/list) réellement utilisée
// par lib/server/reservation-store-kv.js et lib/server/rate-limiter-kv.js,
// en mémoire — suffisant pour tester la logique métier de ces modules sans
// dépendre d'un vrai namespace Cloudflare KV. N'implémente pas le TTL réel
// (expirationTtl est accepté mais ignoré) ni la cohérence éventuelle réelle
// de KV — ces deux modules documentent explicitement cette limite.

function createMockKv() {
  const store = new Map(); // key -> raw string value

  return {
    async get(key, opts) {
      if (!store.has(key)) return null;
      const raw = store.get(key);
      if (opts && opts.type === "json") return JSON.parse(raw);
      return raw;
    },
    async put(key, value) {
      store.set(key, value);
    },
    async delete(key) {
      store.delete(key);
    },
    async list({ cursor } = {}) {
      // Pas de pagination réelle nécessaire pour ces tests (peu de clés) :
      // tout est renvoyé en une seule page, list_complete: true.
      return {
        keys: Array.from(store.keys()).map((name) => ({ name })),
        list_complete: true,
        cursor: undefined
      };
    }
  };
}

module.exports = { createMockKv };
