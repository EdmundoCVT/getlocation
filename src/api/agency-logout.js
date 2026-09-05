// src/api/agency-logout.js
//
// Déconnexion agence : révoque la session courante (voir
// src/lib/agency-auth.js, revokeSessionById) et efface le cookie. Protégé
// comme toute opération d'écriture (origine + CSRF), même si son effet est
// bénin — cohérence avec le reste des endpoints agence.

const { requireAgencySession, revokeSessionById, clearSessionCookieHeader } = require("../lib/agency-auth.js");

function jsonHeaders(extra = {}) {
  return { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra };
}

async function handleAgencyLogout(request, env) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: jsonHeaders({ "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, X-Agency-Csrf" })
    });
  }
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Méthode non autorisée" }), { status: 405, headers: jsonHeaders() });
  }

  const resolved = await requireAgencySession(request, env, { requireCsrf: true, requireOrigin: true });
  if (resolved.error) return resolved.error;

  await revokeSessionById(env, resolved.session.sessionId);
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: jsonHeaders({ "Set-Cookie": clearSessionCookieHeader() }) });
}

module.exports = { handleAgencyLogout };
