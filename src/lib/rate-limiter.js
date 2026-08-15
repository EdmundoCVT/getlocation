// src/lib/rate-limiter.js
//
// Protection anti-abus "best effort" pour les endpoints sensibles, sur
// Cloudflare KV (binding RATE_LIMITS_KV, voir wrangler.jsonc). Compteur par
// clé (typiquement IP + nom d'endpoint) sur une fenêtre glissante
// simplifiée (fenêtre fixe) — mêmes limites connues que l'ancienne version
// Netlify Blobs (netlify/functions/lib/rate-limiter.js, Phase A) :
// - protège contre un abus applicatif simple, pas contre une attaque DDoS
//   distribuée à grande échelle ;
// - Cloudflare KV est à cohérence "éventuelle" entre points de présence
//   (quelques secondes de propagation possibles) : ce compteur reste une
//   protection best effort, pas une garantie stricte de nombre exact de
//   requêtes autorisées. Acceptable pour ce cas d'usage (petite flotte,
//   faible volume — voir AUDIT.md).
//
// Cloudflare propose aussi une fonctionnalité native de rate limiting (WAF,
// règles déclarées dans le dashboard). Cette protection complémentaire n'est
// pas configurée par ce code : elle reste une recommandation à activer côté
// dashboard, pas une garantie du code applicatif.

// KV n'accepte pas expirationTtl < 60 secondes.
const MIN_KV_TTL_SECONDS = 60;

// Retourne { allowed: boolean, remaining: number, retryAfterSeconds: number }
// windowMs : durée de la fenêtre. maxRequests : nombre de requêtes autorisées
// par fenêtre pour cette clé.
async function checkRateLimit(env, key, { windowMs, maxRequests }) {
  const now = Date.now();

  const raw = await env.RATE_LIMITS_KV.get(key);
  const current = raw ? JSON.parse(raw) : null;

  let count = 1;
  let windowStart = now;
  if (current && isFinite(current.windowStart) && now - current.windowStart < windowMs) {
    windowStart = current.windowStart;
    count = current.count + 1;
  }

  const ttlSeconds = Math.max(MIN_KV_TTL_SECONDS, Math.ceil(windowMs / 1000) + 5);
  await env.RATE_LIMITS_KV.put(key, JSON.stringify({ count, windowStart }), { expirationTtl: ttlSeconds });

  const allowed = count <= maxRequests;
  const retryAfterSeconds = allowed ? 0 : Math.ceil((windowStart + windowMs - now) / 1000);
  return { allowed, remaining: Math.max(maxRequests - count, 0), retryAfterSeconds };
}

module.exports = { checkRateLimit };
