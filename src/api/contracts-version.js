// Création contrôlée d'une nouvelle version : la version signée précédente
// est archivée et reste consultable, la copie devient la seule active.
const { createContractVersion } = require("../lib/reservation-store.js");
const { requireAgencySession } = require("../lib/agency-auth.js");

function headers(request, env) {
  const allowed = new Set(["https://getlocation.fr", "https://www.getlocation.fr", new URL(request.url).origin]);
  if (env.ALLOWED_ORIGINS) env.ALLOWED_ORIGINS.split(",").map((x) => x.trim()).filter(Boolean).forEach((x) => allowed.add(x));
  const origin = request.headers.get("origin");
  return { "Content-Type": "application/json", "Cache-Control": "no-store", Vary: "Origin", ...(origin && allowed.has(origin) ? { "Access-Control-Allow-Origin": origin } : {}) };
}

async function handleContractsVersion(request, env) {
  const responseHeaders = headers(request, env);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...responseHeaders, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, X-Agency-Csrf" } });
  if (request.method !== "POST") return new Response(JSON.stringify({ error: "Méthode non autorisée" }), { status: 405, headers: responseHeaders });
  const auth = await requireAgencySession(request, env, { requireCsrf: true, requireOrigin: true });
  if (auth.error) return auth.error;
  try {
    const body = await request.json();
    if (!body || typeof body.id !== "string" || !/^res_[a-f0-9]{32}$/.test(body.id)) throw new Error("Identifiant de contrat invalide");
    const version = await createContractVersion(env, body.id, auth.session.operator);
    if (!version) return new Response(JSON.stringify({ error: "Contrat introuvable" }), { status: 404, headers: responseHeaders });
    return new Response(JSON.stringify({ id: version.id, numero: version.contractNumero, version: version.contractVersion }), { status: 201, headers: responseHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || "Création de version impossible" }), { status: 400, headers: responseHeaders });
  }
}

module.exports = { handleContractsVersion };
