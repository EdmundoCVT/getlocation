// lib/server/http-cors.js
//
// CORS pour les adaptateurs Cloudflare Pages Functions (functions/api/*.js).
// Une fois la Phase B en production, front (Cloudflare Pages) et fonctions
// (Cloudflare Pages Functions, /api/*) sont servis depuis le MÊME domaine —
// contrairement à la Phase A (front sur Cloudflare, fonctions encore sur
// Netlify), la plupart des requêtes réelles seront donc same-origin et
// n'auront pas besoin de CORS. Ce module reste utile pour les aperçus
// (*.pages.dev/*.workers.dev) et toute intégration cross-origin future.
//
// env.ALLOWED_ORIGINS (optionnel, Cloudflare Pages > Settings > Environment
// variables) : liste de domaines de confiance supplémentaires, séparés par
// des virgules — même convention que côté Netlify (voir netlify/functions/
// create-payment.js).
function getAllowedOrigins(env) {
  const origins = new Set(["https://getlocation.fr", "https://www.getlocation.fr"]);
  if (env && env.ALLOWED_ORIGINS) {
    env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean).forEach((o) => origins.add(o));
  }
  return origins;
}

// extraHeaders : objet simple à fusionner (ex. Cache-Control, Retry-After).
function corsHeaders(request, env, extraHeaders = {}) {
  const allowed = getAllowedOrigins(env);
  const origin = request.headers.get("origin");
  const headers = new Headers({ "Content-Type": "application/json", Vary: "Origin", ...extraHeaders });
  if (origin && allowed.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  return headers;
}

module.exports = { getAllowedOrigins, corsHeaders };
