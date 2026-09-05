// src/api/agency-login.js
//
// Connexion agence par code personnel (Edmundo/Antonio) — Lot 1. Vérifie le
// code contre les secrets Cloudflare AGENCY_CODE_EDMUNDO/AGENCY_CODE_ANTONIO
// (jamais en base, jamais dans le dépôt) puis pose un cookie de session
// opaque HttpOnly/Secure/SameSite=Lax (voir src/lib/agency-auth.js). Ne
// révèle jamais si un code incorrect "ressemblait" à celui d'un opérateur en
// particulier — un seul message générique dans tous les cas d'échec.
//
// Limité par IP (login_attempts en D1, IP toujours hachée) AVANT même de
// lire le corps de la requête, pour ne jamais faire dépendre le blocage
// d'un JSON valide.

const {
  clientIp,
  hashIp,
  matchOperator,
  countRecentFailedAttempts,
  recordLoginAttempt,
  createSession,
  deriveCsrfToken,
  sessionCookieHeader,
  hasAllowedOrigin,
  LOGIN_ATTEMPT_MAX
} = require("../lib/agency-auth.js");

const SESSION_LIFETIME_SECONDS = 30 * 24 * 60 * 60;

function jsonHeaders(extra = {}) {
  return { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra };
}

async function handleAgencyLogin(request, env) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: jsonHeaders({ "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" })
    });
  }
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Méthode non autorisée" }), { status: 405, headers: jsonHeaders() });
  }
  if (!hasAllowedOrigin(request, env)) {
    return new Response(JSON.stringify({ error: "Origine non autorisée" }), { status: 403, headers: jsonHeaders() });
  }
  if (!env.AGENCY_DB || !env.AGENCY_AUTH_PEPPER) {
    return new Response(JSON.stringify({ error: "Connexion agence indisponible (configuration serveur)." }), { status: 503, headers: jsonHeaders() });
  }

  const ip = clientIp(request);
  const ipHash = await hashIp(ip, env.AGENCY_AUTH_PEPPER);

  const recentFailures = await countRecentFailedAttempts(env, ipHash);
  if (recentFailures >= LOGIN_ATTEMPT_MAX) {
    return new Response(JSON.stringify({ error: "Trop de tentatives. Réessayez dans quelques minutes." }), {
      status: 429,
      headers: jsonHeaders({ "Retry-After": "300" })
    });
  }

  let body;
  try {
    const rawBody = await request.text();
    if (!rawBody || rawBody.length > 200) throw new Error("corps de requête vide ou trop volumineux");
    body = JSON.parse(rawBody);
  } catch (e) {
    return new Response(JSON.stringify({ error: "Requête invalide" }), { status: 400, headers: jsonHeaders() });
  }

  const code = typeof body.code === "string" ? body.code : "";
  const match = await matchOperator(code, env);

  await recordLoginAttempt(env, ipHash, Boolean(match));

  if (!match) {
    return new Response(JSON.stringify({ error: "Code incorrect." }), { status: 401, headers: jsonHeaders() });
  }

  const session = await createSession(env, match.name, match.codeHash);
  const csrfToken = await deriveCsrfToken(session.id, env.AGENCY_AUTH_PEPPER);

  return new Response(
    JSON.stringify({ operator: match.name, csrfToken, expiresAt: session.expiresAt.toISOString() }),
    { status: 200, headers: jsonHeaders({ "Set-Cookie": sessionCookieHeader(session.token, SESSION_LIFETIME_SECONDS) }) }
  );
}

module.exports = { handleAgencyLogin };
