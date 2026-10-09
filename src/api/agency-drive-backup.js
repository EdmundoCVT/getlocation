const { requireAgencySession } = require("../lib/agency-auth.js");
const { getReservation } = require("../lib/reservation-store.js");
const { driveConfigured, enqueueDriveSync, syncDriveBackup, getDriveSyncStatus } = require("../lib/google-drive-backup.js");
const ID = /^res_[a-f0-9]{32}$/;
function headers(request) { return { "Content-Type": "application/json", "Cache-Control": "no-store", Vary: "Origin", ...(request.headers.get("origin") === new URL(request.url).origin ? { "Access-Control-Allow-Origin": new URL(request.url).origin } : {}) }; }
async function handleAgencyDriveBackup(request, env) {
  const h = headers(request);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...h, "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, X-Agency-Csrf" } });
  const auth = await requireAgencySession(request, env, request.method === "POST" ? { requireCsrf: true, requireOrigin: true } : undefined);
  if (auth.error) return auth.error;
  const id = request.method === "GET" ? new URL(request.url).searchParams.get("id") : ((await request.json().catch(() => ({}))).id);
  if (!ID.test(id || "")) return new Response(JSON.stringify({ error: "Identifiant de dossier invalide" }), { status: 400, headers: h });
  if (request.method === "GET") return new Response(JSON.stringify({ configured: driveConfigured(env), sync: await getDriveSyncStatus(env, id) }), { status: 200, headers: h });
  if (request.method !== "POST") return new Response(JSON.stringify({ error: "Méthode non autorisée" }), { status: 405, headers: h });
  if (!await getReservation(env, id)) return new Response(JSON.stringify({ error: "Dossier introuvable" }), { status: 404, headers: h });
  await enqueueDriveSync(env, id);
  const result = await syncDriveBackup(env, id, auth.session.operator);
  return new Response(JSON.stringify(result), { status: result.ok ? 200 : 202, headers: h });
}
module.exports = { handleAgencyDriveBackup };
