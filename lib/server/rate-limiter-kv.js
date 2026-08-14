// lib/server/rate-limiter-kv.js
//
// Équivalent Cloudflare KV de lib/server/rate-limiter.js (Netlify Blobs)
// — voir plan de migration Cloudflare, B.3. Même principe qu'un binding
// disponible seulement par requête (env.RATE_LIMITS_KV) qu'un module
// singleton, donc une fabrique createRateLimiter(kv).
//
// Pas de repli mémoire silencieux ici non plus (voir reservation-store-kv.js
// pour la justification complète — incident Netlify Blobs du 12/08/2026) :
// un rate limiter qui échoue silencieusement en mémoire non partagée entre
// instances Workers deviendrait inefficace sans que personne ne le sache.

function createRateLimiter(kv) {
  if (!kv) {
    throw new Error(
      "[rate-limiter-kv] Binding KV manquant (env.RATE_LIMITS_KV). " +
      "Refus de continuer silencieusement — voir incident Netlify Blobs du 12/08/2026."
    );
  }

  // Retourne { allowed: boolean, remaining: number, retryAfterSeconds: number }
  async function checkRateLimit(key, { windowMs, maxRequests }) {
    const now = Date.now();
    const current = await kv.get(key, { type: "json" });

    let count = 1;
    let windowStart = now;
    if (current && isFinite(current.windowStart) && now - current.windowStart < windowMs) {
      windowStart = current.windowStart;
      count = current.count + 1;
    }

    // expirationTtl couvre la fenêtre + une marge : la clé disparaît toute
    // seule une fois la fenêtre expirée, pas besoin de nettoyage manuel.
    await kv.put(key, JSON.stringify({ count, windowStart }), {
      expirationTtl: Math.ceil(windowMs / 1000) + 60
    });

    const allowed = count <= maxRequests;
    const retryAfterSeconds = allowed ? 0 : Math.ceil((windowStart + windowMs - now) / 1000);
    return { allowed, remaining: Math.max(maxRequests - count, 0), retryAfterSeconds };
  }

  return { checkRateLimit };
}

module.exports = { createRateLimiter };
