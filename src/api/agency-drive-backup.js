const { requireAgencySession } = require("../lib/agency-auth.js");
const { getReservation } = require("../lib/reservation-store.js");
const { driveConfigured, driveConfigurationChecks, enqueueDriveSync, syncDriveBackup, getDriveSyncStatus } = require("../lib/google-drive-backup.js");
const ID = /^res_[a-f0-9]{32}$/;
function headers(request) { return { "Content-Type": "application/json", "Cache-Control": "no-store", Vary: "Origin", ...(request.headers.get("origin") === new URL(request.url).origin ? { "Access-Control-Allow-Origin": new URL(request.url).origin } : {}) }; }
function pdfStatus(record) {
  const files = Array.isArray(record && record.drivePdfFiles) ? record.drivePdfFiles : [];
  const has = (kind) => files.some((file) => file && file.kind === kind && file.key);
  const dossier = record && record.contractDossier || {};
  return {
    contract: { expected: dossier.status === "signed" ? "contract-signed" : "contract-draft", present: has(dossier.status === "signed" ? "contract-signed" : "contract-draft") },
    edlDepart: { expected: Boolean(dossier.depart), present: has("edl-depart") },
    edlRetour: { expected: Boolean(dossier.retour), present: has("edl-return") }
  };
}
async function handleAgencyDriveBackup(request, env) {
  const h = headers(request);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...h, "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, X-Agency-Csrf" } });
  const auth = await requireAgencySession(request, env, request.method === "POST" ? { requireCsrf: true, requireOrigin: true } : undefined);
  if (auth.error) return auth.error;
  const id = request.method === "GET" ? new URL(request.url).searchParams.get("id") : ((await request.json().catch(() => ({}))).id);
  if (!ID.test(id || "")) return new Response(JSON.stringify({ error: "Identifiant de dossier invalide" }), { status: 400, headers: h });
  if (request.method === "GET") { const record = await getReservation(env, id); return new Response(JSON.stringify({ configured: driveConfigured(env), checks: driveConfigurationChecks(env), sync: { ...(await getDriveSyncStatus(env, id) || {}), pdfs: pdfStatus(record) } }), { status: 200, headers: h }); }
  if (request.method !== "POST") return new Response(JSON.stringify({ error: "Méthode non autorisée" }), { status: 405, headers: h });
  if (!await getReservation(env, id)) return new Response(JSON.stringify({ error: "Dossier introuvable" }), { status: 404, headers: h });
  await enqueueDriveSync(env, id);
  const result = await syncDriveBackup(env, id, auth.session.operator);
  return new Response(JSON.stringify({ ...result, sync: { ...(await getDriveSyncStatus(env, id) || {}), pdfs: pdfStatus(await getReservation(env, id)) } }), { status: result.ok ? 200 : 202, headers: h });
}
module.exports = { handleAgencyDriveBackup };
