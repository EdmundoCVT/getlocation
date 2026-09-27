// Accès au fichier de pilotage Google Sheets, uniquement après authentification
// agence. L'URL n'est jamais présente dans les assets publics : elle vit dans
// le secret Worker GOOGLE_SHEETS_URL et est renvoyée à une session valide.

const { requireAgencySession } = require("../lib/agency-auth.js");

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}

function configuredSheetUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && url.hostname === "docs.google.com" && /^\/spreadsheets\/d\//.test(url.pathname)
      ? url.toString()
      : null;
  } catch (_) {
    return null;
  }
}

async function handleAgencyGoogleSheets(request, env) {
  if (request.method !== "GET") return json(405, { error: "Méthode non autorisée" });
  const auth = await requireAgencySession(request, env);
  if (auth.error) return auth.error;

  const url = configuredSheetUrl(env.GOOGLE_SHEETS_URL);
  return json(200, { configured: Boolean(url), url });
}

module.exports = { handleAgencyGoogleSheets, configuredSheetUrl };
