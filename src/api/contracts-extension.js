const { requireAgencySession } = require("../lib/agency-auth.js");
const { createContractExtension, previewContractExtension } = require("../lib/contract-extension.js");
const { enqueueDriveSync } = require("../lib/google-drive-backup.js");
const { recordAuditEvent } = require("../lib/audit-log.js");

function responseHeaders(request, env) {
  const allowed = new Set(["https://getlocation.fr", "https://www.getlocation.fr", new URL(request.url).origin]);
  if (env.ALLOWED_ORIGINS) env.ALLOWED_ORIGINS.split(",").map((item) => item.trim()).filter(Boolean).forEach((item) => allowed.add(item));
  const origin = request.headers.get("origin");
  return { "Content-Type": "application/json", "Cache-Control": "no-store", Vary: "Origin", ...(origin && allowed.has(origin) ? { "Access-Control-Allow-Origin": origin } : {}) };
}

async function handleContractsExtension(request, env) {
  const headers = responseHeaders(request, env);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...headers, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, X-Agency-Csrf" } });
  if (request.method !== "POST") return new Response(JSON.stringify({ error: "Méthode non autorisée" }), { status: 405, headers });
  const auth = await requireAgencySession(request, env, { requireCsrf: true, requireOrigin: true });
  if (auth.error) return auth.error;
  try {
    const body = await request.json();
    if (!body || typeof body.id !== "string" || !/^res_[a-f0-9]{32}$/.test(body.id)) throw new Error("Identifiant de contrat invalide");
    const newEnd = { date: body.newEndDate, time: body.newEndTime };
    if (body.preview === true) {
      const preview = await previewContractExtension(env, body.id, newEnd);
      return new Response(JSON.stringify({ preview }), { status: 200, headers });
    }
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (reason.length > 500) throw new Error("Motif trop long (500 caractères maximum)");
    const result = await createContractExtension(env, body.id, newEnd, auth.session.operator, reason);
    const version = result.version;
    enqueueDriveSync(env, version.id).catch(() => undefined);
    await recordAuditEvent(env, {
      actor: auth.session.operator,
      eventType: "contract_extension_created",
      entityType: "contract",
      entityId: version.id,
      metadata: {
        contractId: version.contractVersion.contractId,
        sourceVersion: version.contractVersion.supersedesVersion,
        newVersion: version.contractVersion.version,
        oldEndAt: version.contractExtensionPricing.oldEndAt,
        newEndAt: version.contractExtensionPricing.newEndAt,
        oldTotal: version.contractExtensionPricing.oldTotal,
        newTotal: version.contractExtensionPricing.newTotal,
        additionalAmount: version.contractExtensionPricing.additionalAmount,
        operator: auth.session.operator
      }
    });
    return new Response(JSON.stringify({
      id: version.id,
      numero: version.contractNumero,
      version: version.contractVersion,
      preview: result.preview
    }), { status: 201, headers });
  } catch (error) {
    const status = Number(error && error.status) || (error && error.code === "contract_draft_exists" ? 409 : 400);
    return new Response(JSON.stringify({
      error: error && error.message || "Prolongation impossible",
      code: error && error.code || undefined,
      details: error && error.details || undefined,
      draft: error && error.draft || undefined
    }), { status, headers });
  }
}

module.exports = { handleContractsExtension };
