const { requireAgencySession } = require("../lib/agency-auth.js");
const { getReservation, setDrivePdfFile, contractVersionInfo } = require("../lib/reservation-store.js");
const { enqueueDriveSync } = require("../lib/google-drive-backup.js");
const { resolveContractAgencyAccess } = require("./contract-dossier-agency.js");
const { resolveContractClientAccess } = require("./contract-dossier-client.js");
const ID = /^res_[a-f0-9]{32}$/;
const KINDS = new Set(["contract-draft", "contract-signed", "edl-depart", "edl-return"]);
const MAX_BYTES = 12 * 1024 * 1024;
function headers() { return { "Content-Type": "application/json", "Cache-Control": "no-store" }; }
async function handleAgencyDrivePdf(request, env) {
  if (request.method !== "POST") return new Response(JSON.stringify({ error: "Méthode non autorisée" }), { status: 405, headers: headers() });
  let reservation = null, clientArchive = false;
  if (request.headers.get("authorization")) {
    const agency = await resolveContractAgencyAccess(request, env);
    if (agency) reservation = agency.reservation;
    else {
      const client = await resolveContractClientAccess(request, env);
      if (!client) return new Response(JSON.stringify({ error: "Accès au dossier invalide ou expiré" }), { status: 401, headers: headers() });
      reservation = client.reservation; clientArchive = true;
    }
  } else {
    const auth = await requireAgencySession(request, env, { requireCsrf: true, requireOrigin: true });
    if (auth.error) return auth.error;
  }
  if (!env.DOCUMENTS_BUCKET) return new Response(JSON.stringify({ error: "Stockage indisponible" }), { status: 503, headers: headers() });
  const form = await request.formData().catch(() => null);
  const id = form && form.get("id"), kind = form && form.get("kind"), version = Number(form && form.get("version")), file = form && form.get("file");
  if (!ID.test(id || "") || !KINDS.has(kind) || !Number.isInteger(version) || version < 1 || !file || file.type !== "application/pdf" || typeof file.arrayBuffer !== "function" || file.size <= 0 || file.size > MAX_BYTES) return new Response(JSON.stringify({ error: "PDF invalide" }), { status: 400, headers: headers() });
  if (reservation && reservation.id !== id) return new Response(JSON.stringify({ error: "Dossier non autorisé" }), { status: 403, headers: headers() });
  if (!reservation) reservation = await getReservation(env, id);
  if (!reservation) return new Response(JSON.stringify({ error: "Dossier introuvable" }), { status: 404, headers: headers() });
  const currentVersion = contractVersionInfo(reservation).version;
  if (version !== currentVersion) return new Response(JSON.stringify({ error: "Version de contrat invalide" }), { status: 409, headers: headers() });
  if (clientArchive && (kind !== "contract-signed" || !(reservation.contractDossier && reservation.contractDossier.status === "signed"))) return new Response(JSON.stringify({ error: "Seul le PDF signé peut être archivé depuis le lien client" }), { status: 403, headers: headers() });
  const sourceKey = `${kind}-v${version}`;
  if (Array.isArray(reservation.drivePdfFiles) && reservation.drivePdfFiles.some((item) => item && item.sourceKey === sourceKey && item.immutable)) return new Response(JSON.stringify({ error: "Le PDF signé est archivé et ne peut pas être remplacé" }), { status: 409, headers: headers() });
  const key = `drive-pdf/${id}/${sourceKey}.pdf`;
  await env.DOCUMENTS_BUCKET.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: "application/pdf" }, customMetadata: { reservationId: id, kind, version: String(version) } });
  const saved = await setDrivePdfFile(env, id, { key, sourceKey, kind, version, size: file.size, uploadedAt: new Date().toISOString(), immutable: kind === "contract-signed" });
  if (!saved) return new Response(JSON.stringify({ error: "Dossier introuvable" }), { status: 404, headers: headers() });
  enqueueDriveSync(env, id).catch(() => undefined);
  return new Response(JSON.stringify({ ok: true, pending: true }), { status: 202, headers: headers() });
}
module.exports = { handleAgencyDrivePdf };
