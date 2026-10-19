const { setContractArchived } = require("../lib/reservation-store.js");
const { requireAgencySession } = require("../lib/agency-auth.js");
const { recordAuditEvent } = require("../lib/audit-log.js");

function headers(request, env) {
  const allowed = new Set(["https://getlocation.fr", "https://www.getlocation.fr", new URL(request.url).origin]);
  if (env.ALLOWED_ORIGINS) env.ALLOWED_ORIGINS.split(",").map((value) => value.trim()).filter(Boolean).forEach((value) => allowed.add(value));
  const origin = request.headers.get("origin");
  return { "Content-Type": "application/json", "Cache-Control": "no-store", Vary: "Origin", ...(origin && allowed.has(origin) ? { "Access-Control-Allow-Origin": origin } : {}) };
}

async function handleContractsArchive(request, env) {
  const responseHeaders = headers(request, env);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...responseHeaders, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, X-Agency-Csrf" } });
  if (request.method !== "POST") return new Response(JSON.stringify({ error: "Méthode non autorisée" }), { status: 405, headers: responseHeaders });
  const auth = await requireAgencySession(request, env, { requireCsrf: true, requireOrigin: true });
  if (auth.error) return auth.error;
  try {
    const body = await request.json();
    if (!body || typeof body.id !== "string" || !/^res_[a-f0-9]{32}$/.test(body.id) || typeof body.archived !== "boolean") throw new Error("Requête d’archivage invalide");
    const metadata = await setContractArchived(env, body.id, body.archived, auth.session.operator);
    if (!metadata) return new Response(JSON.stringify({ error: "Contrat introuvable" }), { status: 404, headers: responseHeaders });
    await recordAuditEvent(env, { actor: auth.session.operator, eventType: body.archived ? "contract_archived" : "contract_restored", entityType: "contract", entityId: metadata.contractId, metadata: { logicalContract: true } });
    return new Response(JSON.stringify({ ok: true, archived: Boolean(metadata.archivedAt), archivedAt: metadata.archivedAt }), { status: 200, headers: responseHeaders });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message || "Archivage impossible" }), { status: 400, headers: responseHeaders });
  }
}

module.exports = { handleContractsArchive };
