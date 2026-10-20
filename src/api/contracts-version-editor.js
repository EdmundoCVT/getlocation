const { requireAgencySession } = require("../lib/agency-auth.js");
const {
  getReservation,
  isSignedContract,
  contractVersionInfo,
  updateContractFromForm,
  updateContractVersionSignature,
  finalizeContractVersion
} = require("../lib/reservation-store.js");
const { recordToContractForm } = require("../lib/contract-form-data.js");
const { recordAuditEvent } = require("../lib/audit-log.js");
const { enqueueDriveSync } = require("../lib/google-drive-backup.js");

const ID = /^res_[a-f0-9]{32}$/;

function headers() {
  return { "Content-Type": "application/json", "Cache-Control": "no-store" };
}

function view(record) {
  const version = contractVersionInfo(record);
  const dossier = record.contractDossier || {};
  return {
    id: record.id,
    numero: record.contractNumero || null,
    version,
    editable: !isSignedContract(record),
    form: recordToContractForm(record),
    signature: dossier.signature ? JSON.parse(JSON.stringify(dossier.signature)) : null
  };
}

function displayTime(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error("Date et heure affichées invalides");
  return value;
}

function signatureId() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}

async function handleGet(request, env) {
  const auth = await requireAgencySession(request, env);
  if (auth.error) return auth.error;
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!ID.test(id)) return new Response(JSON.stringify({ error: "Identifiant de contrat invalide" }), { status: 400, headers: headers() });
  const record = await getReservation(env, id);
  if (!record || !["paid", "manual_contract", "contract_version"].includes(record.status)) return new Response(JSON.stringify({ error: "Version de contrat introuvable" }), { status: 404, headers: headers() });
  // Lecture pure : aucune normalisation n'est persistée lors de l'ouverture.
  return new Response(JSON.stringify(view(record)), { status: 200, headers: headers() });
}

async function handlePost(request, env) {
  const auth = await requireAgencySession(request, env, { requireCsrf: true, requireOrigin: true });
  if (auth.error) return auth.error;
  let body;
  try {
    const raw = await request.text();
    if (!raw || raw.length > 420000) throw new Error("invalid");
    body = JSON.parse(raw);
  } catch (error) {
    return new Response(JSON.stringify({ error: "Requête invalide" }), { status: 400, headers: headers() });
  }
  if (!body || !ID.test(body.id || "")) return new Response(JSON.stringify({ error: "Identifiant de contrat invalide" }), { status: 400, headers: headers() });
  const current = await getReservation(env, body.id);
  if (!current) return new Response(JSON.stringify({ error: "Version de contrat introuvable" }), { status: 404, headers: headers() });
  try {
    let updated;
    if (body.action === "save-form") {
      updated = await updateContractFromForm(env, body.id, body.rawData, auth.session.operator);
      await recordAuditEvent(env, { actor: auth.session.operator, eventType: "contract_version_saved", entityType: "contract", entityId: body.id, metadata: { version: contractVersionInfo(current).version } });
    } else if (body.action === "update-signature") {
      if (body.clear === true) {
        updated = await updateContractVersionSignature(env, body.id, null, auth.session.operator);
        await recordAuditEvent(env, { actor: auth.session.operator, eventType: "contract_signature_cleared", entityType: "contract", entityId: body.id, metadata: { version: contractVersionInfo(current).version } });
      } else {
        const previous = current.contractDossier && current.contractDossier.signature || null;
        const imageDataUrl = typeof body.imageDataUrl === "string" && body.imageDataUrl ? body.imageDataUrl : previous && previous.imageDataUrl;
        if (!imageDataUrl || !imageDataUrl.startsWith("data:image/png") || imageDataUrl.length < 100 || imageDataUrl.length > 300000) throw new Error("Signature manquante ou invalide");
        const newImage = !previous || previous.imageDataUrl !== imageDataUrl;
        const shownAt = displayTime(body.displaySignedAt);
        const signature = {
          imageDataUrl,
          name: typeof body.name === "string" ? body.name.trim().slice(0, 150) : previous && previous.name || "",
          signedAt: newImage ? new Date().toISOString() : previous.signedAt,
          signatureId: newImage ? signatureId() : previous.signatureId,
          ...(shownAt ? { displaySignedAt: shownAt } : {})
        };
        updated = await updateContractVersionSignature(env, body.id, signature, auth.session.operator);
        await recordAuditEvent(env, { actor: auth.session.operator, eventType: newImage ? "contract_signature_replaced" : "contract_signature_metadata_updated", entityType: "contract", entityId: body.id, metadata: { version: contractVersionInfo(current).version } });
      }
      enqueueDriveSync(env, body.id).catch(() => undefined);
    } else if (body.action === "finalize") {
      updated = await finalizeContractVersion(env, body.id, auth.session.operator);
      enqueueDriveSync(env, body.id).catch(() => undefined);
      await recordAuditEvent(env, { actor: auth.session.operator, eventType: "contract_version_finalized", entityType: "contract", entityId: body.id, metadata: { version: contractVersionInfo(updated).version } });
    } else {
      return new Response(JSON.stringify({ error: "Action inconnue" }), { status: 400, headers: headers() });
    }
    if (!updated) return new Response(JSON.stringify({ error: "Version de contrat introuvable" }), { status: 404, headers: headers() });
    return new Response(JSON.stringify(view(updated)), { status: 200, headers: headers() });
  } catch (error) {
    const status = /finalisée|signée|déjà finalisée/i.test(error.message || "") ? 409 : 400;
    return new Response(JSON.stringify({ error: error.message || "Mise à jour impossible" }), { status, headers: headers() });
  }
}

async function handleContractsVersionEditor(request, env) {
  if (request.method === "GET") return handleGet(request, env);
  if (request.method === "POST") return handlePost(request, env);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...headers(), "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, X-Agency-Csrf" } });
  return new Response(JSON.stringify({ error: "Méthode non autorisée" }), { status: 405, headers: headers() });
}

module.exports = { handleContractsVersionEditor, view };
