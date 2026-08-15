// src/api/validate-promo.js
//
// Confirme (ou infirme) un code promo dès sa saisie, sans attendre la page
// de paiement Mollie. Les codes publics (CODES_PROMO, js/data.js) sont déjà
// connus du navigateur et validés instantanément côté client (voir
// initReservationPage dans js/app.js) : ce endpoint ne sert donc qu'au code
// de test interne (TEST_DISCOUNT_CODE, secret Worker jamais présent dans le
// code source public — voir create-payment.js) puisque lui seul ne peut pas
// être vérifié sans appel serveur.
//
// Ne renvoie jamais la valeur du secret ni aucun indice dessus : uniquement
// `{ valid: true/false }` (+ le montant réduit si valide, pour affichage).
// Rate-limité nettement plus strictement que create-payment : ce endpoint
// n'a normalement besoin que de quelques appels par minute et par visiteur,
// une limite basse réduit la marge de manœuvre d'une devinette par force
// brute du secret.

const { estCodeDeTestValide } = require("./create-payment.js");
const { checkRateLimit } = require("../lib/rate-limiter.js");

const TEST_DISCOUNT_CENTIMES = 10; // 0,10 € — doit rester identique à create-payment.js
const MAX_CODE_LEN = 40; // identique à la limite validée côté create-payment (validate-reservation-input.js)

function getAllowedOrigins(request, env) {
  const origins = new Set(["https://getlocation.fr", "https://www.getlocation.fr", new URL(request.url).origin]);
  if (env.ALLOWED_ORIGINS) {
    env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean).forEach((o) => origins.add(o));
  }
  return origins;
}

function corsHeaders(request, env) {
  const allowed = getAllowedOrigins(request, env);
  const originHeader = request.headers.get("origin");
  const headers = { "Content-Type": "application/json", Vary: "Origin", "Cache-Control": "no-store" };
  if (originHeader && allowed.has(originHeader)) {
    headers["Access-Control-Allow-Origin"] = originHeader;
  }
  return headers;
}

function clientIp(request) {
  return (
    request.headers.get("cf-connecting-ip") ||
    (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    "unknown"
  );
}

async function handleValidatePromo(request, env) {
  const headers = corsHeaders(request, env);

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { ...headers, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" }
    });
  }
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Méthode non autorisée" }), { status: 405, headers });
  }

  const rate = await checkRateLimit(env, `validate-promo:${clientIp(request)}`, { windowMs: 60000, maxRequests: 10 });
  if (!rate.allowed) {
    return new Response(JSON.stringify({ error: "Trop de tentatives, veuillez réessayer dans un instant." }), {
      status: 429,
      headers: { ...headers, "Retry-After": String(rate.retryAfterSeconds) }
    });
  }

  let payload;
  try {
    const rawBody = await request.text();
    if (!rawBody || rawBody.length > 2000) throw new Error("corps de requête vide ou trop volumineux");
    payload = JSON.parse(rawBody);
  } catch (e) {
    return new Response(JSON.stringify({ error: "Requête invalide" }), { status: 400, headers });
  }

  const code = typeof payload.code === "string" ? payload.code.slice(0, MAX_CODE_LEN) : "";
  const valid = estCodeDeTestValide(code, env.TEST_DISCOUNT_CODE);

  if (!valid) {
    return new Response(JSON.stringify({ valid: false }), { status: 200, headers });
  }
  return new Response(
    JSON.stringify({ valid: true, totalFacture: TEST_DISCOUNT_CENTIMES / 100 }),
    { status: 200, headers }
  );
}

module.exports = { handleValidatePromo };
