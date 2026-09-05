// src/api/agency-session.js
//
// Vérifie une session agence existante (cookie) sans redemander le code —
// utilisé par contrat.html au chargement de la page pour savoir s'il faut
// afficher l'écran de connexion ou directement le formulaire, et pour
// récupérer un jeton CSRF à jour (jamais stocké, toujours dérivé — voir
// src/lib/agency-auth.js, deriveCsrfToken). Pas de vérification d'origine
// stricte ici : lecture seule, et un cookie SameSite=Lax n'est de toute
// façon jamais transmis sur une requête fetch/XHR cross-site.

const { requireAgencySession } = require("../lib/agency-auth.js");

function jsonHeaders() {
  return { "Content-Type": "application/json", "Cache-Control": "no-store" };
}

async function handleAgencySession(request, env) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { ...jsonHeaders(), "Access-Control-Allow-Methods": "GET, OPTIONS" } });
  }
  if (request.method !== "GET") {
    return new Response(JSON.stringify({ error: "Méthode non autorisée" }), { status: 405, headers: jsonHeaders() });
  }

  const resolved = await requireAgencySession(request, env);
  if (resolved.error) {
    return new Response(JSON.stringify({ authenticated: false }), { status: 200, headers: jsonHeaders() });
  }
  return new Response(
    JSON.stringify({ authenticated: true, operator: resolved.session.operator, csrfToken: resolved.session.csrfToken }),
    { status: 200, headers: jsonHeaders() }
  );
}

module.exports = { handleAgencySession };
