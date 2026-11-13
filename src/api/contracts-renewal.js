const { requireAgencySession } = require("../lib/agency-auth.js");
const { previewContractRenewal, renewContract } = require("../lib/contract-renewal.js");
const { enqueueDriveSync } = require("../lib/google-drive-backup.js");
const { recordAuditEvent } = require("../lib/audit-log.js");

function responseHeaders(request, env) {
  const allowed = new Set(["https://getlocation.fr", "https://www.getlocation.fr", new URL(request.url).origin]);
  if (env.ALLOWED_ORIGINS) env.ALLOWED_ORIGINS.split(",").map((item) => item.trim()).filter(Boolean).forEach((item) => allowed.add(item));
  const origin = request.headers.get("origin");
  return { "Content-Type": "application/json", "Cache-Control": "no-store", Vary: "Origin", ...(origin && allowed.has(origin) ? { "Access-Control-Allow-Origin": origin } : {}) };
}

function renewalPeriod(body) {
  return {
    start: { date: body && body.startDate, time: body && body.startTime },
    end: { date: body && body.endDate, time: body && body.endTime }
  };
}

async function handleContractsRenewal(request, env) {
  const headers = responseHeaders(request, env);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...headers, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, X-Agency-Csrf" } });
  if (request.method !== "POST") return new Response(JSON.stringify({ error: "Méthode non autorisée" }), { status: 405, headers });
  const auth = await requireAgencySession(request, env, { requireCsrf: true, requireOrigin: true });
  if (auth.error) return auth.error;
  try {
    const body = await request.json();
    if (!body || typeof body.sourceId !== "string" || !/^res_[a-f0-9]{32}$/.test(body.sourceId)) throw new Error("Identifiant de contrat invalide");
    const period = renewalPeriod(body);
    if (body.preview === true) {
      const preview = await previewContractRenewal(env, body.sourceId, period);
      return new Response(JSON.stringify({ preview }), { status: 200, headers });
    }
    const result = await renewContract(env, body.sourceId, period, auth.session.operator);
    const contract = result.contract;
    void enqueueDriveSync(env, contract.id).catch(() => undefined);
    await recordAuditEvent(env, {
      actor: auth.session.operator,
      eventType: "contract_renewed",
      entityType: "contract",
      entityId: contract.id,
      metadata: {
        sourceContractId: contract.renewedFromContractId,
        sourceContractNumero: contract.renewedFromContractNumero,
        newContractId: contract.contractVersion.contractId,
        newContractNumero: contract.contractNumero,
        startAt: contract.periodeDebut,
        endAt: contract.periodeFin,
        operator: auth.session.operator
      }
    });
    return new Response(JSON.stringify({
      id: contract.id,
      numero: contract.contractNumero,
      version: contract.contractVersion,
      preview: result.preview
    }), { status: 201, headers });
  } catch (error) {
    return new Response(JSON.stringify({
      error: error && error.message || "Renouvellement impossible",
      code: error && error.code || undefined,
      details: error && error.details || undefined
    }), { status: Number(error && error.status) || 400, headers });
  }
}

module.exports = { handleContractsRenewal };
