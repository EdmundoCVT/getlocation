// Copie de sauvegarde privée vers Google Drive. KV/R2 restent la source de
// vérité : aucune écriture métier ne dépend de ce module.
const { getAccessToken } = require("./google-auth.js");
const { getReservation, contractVersionInfo } = require("./reservation-store.js");
const { recordAuditEvent } = require("./audit-log.js");

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const DRIVE_API = "https://www.googleapis.com/drive/v3/files";

class DriveBackupError extends Error {}
function esc(value) { return String(value || "").replace(/'/g, "\\'"); }
function safePart(value) { return String(value || "INCONNU").replace(/[^A-Za-zÀ-ÿ0-9 _.-]/g, "_").trim().slice(0, 100) || "INCONNU"; }
function driveConfigured(env) { return Boolean(env && env.GOOGLE_DRIVE_ROOT_FOLDER_ID && env.GOOGLE_SERVICE_ACCOUNT_KEY && env.AGENCY_DB); }

async function request(env, path, options = {}) {
  const token = await getAccessToken(env, DRIVE_SCOPE);
  const res = await fetch(`${DRIVE_API}${path}`, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) } });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new DriveBackupError((json && json.error && json.error.message) || `Google Drive (${res.status})`);
  return json;
}
async function folder(env, parentId, name) {
  const q = `name = '${esc(name)}' and mimeType = 'application/vnd.google-apps.folder' and '${esc(parentId)}' in parents and trashed = false`;
  const found = await request(env, `?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1`);
  if (found.files && found.files[0]) return found.files[0].id;
  const created = await request(env, "?fields=id", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] }) });
  return created.id;
}
async function fileId(env, reservationId, sourceKey) {
  const res = await env.AGENCY_DB.prepare("SELECT drive_file_id, immutable FROM drive_sync_files WHERE reservation_id = ? AND source_key = ?").bind(reservationId, sourceKey).first();
  return res || null;
}
async function upload(env, reservationId, sourceKey, parentId, name, body, contentType, immutable) {
  const old = await fileId(env, reservationId, sourceKey);
  if (old && old.immutable) return old.drive_file_id;
  const boundary = `gl-${crypto.randomUUID()}`;
  const bytes = body instanceof Uint8Array ? body : new TextEncoder().encode(body);
  const prefix = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: old ? undefined : [parentId] })}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`;
  const suffix = `\r\n--${boundary}--`;
  const merged = new Uint8Array(new TextEncoder().encode(prefix).length + bytes.length + new TextEncoder().encode(suffix).length);
  let i = 0; [new TextEncoder().encode(prefix), bytes, new TextEncoder().encode(suffix)].forEach((part) => { merged.set(part, i); i += part.length; });
  const path = old ? `/${old.drive_file_id}?uploadType=multipart&fields=id` : `?uploadType=multipart&fields=id`;
  const result = await request(env, path, { method: old ? "PATCH" : "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body: merged });
  const now = new Date().toISOString();
  await env.AGENCY_DB.prepare("INSERT INTO drive_sync_files (reservation_id, source_key, drive_file_id, immutable, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(reservation_id, source_key) DO UPDATE SET drive_file_id=excluded.drive_file_id, immutable=excluded.immutable, updated_at=excluded.updated_at").bind(reservationId, sourceKey, result.id, immutable ? 1 : 0, now).run();
  return result.id;
}
function safeSnapshot(record) {
  const dossier = record.contractDossier || {};
  return { id: record.id, contractNumero: record.contractNumero || null, status: record.status, createdAt: record.createdAt, updatedAt: record.updatedAt, vehiculeId: record.vehiculeId || null, immatriculation: record.immat || record.immatriculation || null, conducteur: record.conducteur ? { prenom: record.conducteur.prenom || null, nom: record.conducteur.nom || null } : { prenom: record.prenom || null, nom: record.nom || null }, periodeDebut: record.periodeDebut || record.depart || null, periodeFin: record.periodeFin || record.retour || null, contractVersion: contractVersionInfo(record), contractDossier: { status: dossier.status || "draft", fields: dossier.fields || null, depart: dossier.depart || null, retour: dossier.retour || null, observations: dossier.observations || "", media: dossier.media || { depart: [], retour: [] }, signature: dossier.signature ? { signedAt: dossier.signature.signedAt || null, signatureId: dossier.signature.signatureId || null } : null } };
}
async function ensureFolders(env, record) {
  const date = new Date(record.createdAt || Date.now());
  const year = String(isNaN(date.getTime()) ? new Date().getFullYear() : date.getFullYear());
  const month = isNaN(date.getTime()) ? "01 - Janvier" : `${String(date.getMonth() + 1).padStart(2, "0")} - ${date.toLocaleDateString("fr-FR", { month: "long" }).replace(/^./, (x) => x.toUpperCase())}`;
  const client = record.conducteur || record;
  const number = safePart(record.contractNumero || record.id);
  const dossierName = `${number} - ${safePart(`${client.nom || ""} ${client.prenom || ""}`)}`;
  const clients = await folder(env, env.GOOGLE_DRIVE_ROOT_FOLDER_ID, "DOSSIERS CLIENTS");
  const yearFolder = await folder(env, clients, year);
  const monthFolder = await folder(env, yearFolder, month);
  const root = await folder(env, monthFolder, dossierName);
  return { root, contracts: await folder(env, root, "01 - Contrats"), inspections: await folder(env, root, "02 - États des lieux"), documents: await folder(env, root, "03 - Documents client"), deposit: await folder(env, root, "04 - Dépôt de garantie") };
}
async function enqueueDriveSync(env, reservationId) {
  if (!env || !env.AGENCY_DB || !reservationId) return null;
  const now = new Date().toISOString();
  await env.AGENCY_DB.prepare("INSERT INTO drive_sync_outbox (reservation_id,status,attempt_count,created_at,updated_at) VALUES (?, 'pending', 0, ?, ?) ON CONFLICT(reservation_id) DO UPDATE SET status='pending', updated_at=excluded.updated_at").bind(reservationId, now, now).run();
  return reservationId;
}
async function syncDriveBackup(env, reservationId, actor = null) {
  if (!driveConfigured(env)) return { ok: false, reason: "Google Drive non configuré" };
  await enqueueDriveSync(env, reservationId);
  const now = new Date().toISOString();
  try {
    const record = await getReservation(env, reservationId);
    if (!record) throw new DriveBackupError("Dossier introuvable");
    const folders = await ensureFolders(env, record);
    const snapshot = safeSnapshot(record), version = snapshot.contractVersion;
    const stem = `${safePart(record.contractNumero || record.id)}-V${version.version}`;
    const state = version.status === "signed" || version.status === "archived" ? "SIGNE" : "BROUILLON";
    await upload(env, record.id, `snapshot-v${version.version}-${state}`, folders.contracts, `${stem}-DOSSIER.json`, JSON.stringify(snapshot, null, 2), "application/json", state === "SIGNE");
    const media = snapshot.contractDossier.media || {};
    for (const stage of ["depart", "retour"]) for (const item of Array.isArray(media[stage]) ? media[stage] : []) {
      if (!env.DOCUMENTS_BUCKET || !item || !item.key) continue;
      const object = await env.DOCUMENTS_BUCKET.get(item.key); if (!object) continue;
      const extension = (item.contentType || "image/jpeg").split("/")[1] || "jpg";
      await upload(env, record.id, item.key, folders.inspections, `${safePart(record.contractNumero || record.id)}-${stage.toUpperCase()}-${safePart(item.slot || "photo")}.${extension}`, new Uint8Array(await object.arrayBuffer()), item.contentType || "image/jpeg", false);
    }
    for (const item of Array.isArray(record.documentFiles) ? record.documentFiles : []) {
      if (!env.DOCUMENTS_BUCKET || !item || !item.key) continue;
      const object = await env.DOCUMENTS_BUCKET.get(item.key); if (!object) continue;
      await upload(env, record.id, item.key, folders.documents, `${safePart(record.contractNumero || record.id)}-${safePart(item.type || "document")}`, new Uint8Array(await object.arrayBuffer()), item.contentType || "application/octet-stream", false);
    }
    await env.AGENCY_DB.prepare("UPDATE drive_sync_outbox SET status='synced', drive_folder_id=?, attempt_count=attempt_count+1, last_attempt_at=?, last_error=NULL, synced_at=?, updated_at=? WHERE reservation_id=?").bind(folders.root, now, now, now, record.id).run();
    await recordAuditEvent(env, { actor, eventType: "drive_backup_succeeded", entityType: "contract", entityId: record.id });
    return { ok: true, folderId: folders.root };
  } catch (err) {
    const reason = (err && err.message) || "Erreur Google Drive";
    await env.AGENCY_DB.prepare("UPDATE drive_sync_outbox SET status='error', attempt_count=attempt_count+1, last_attempt_at=?, last_error=?, updated_at=? WHERE reservation_id=?").bind(now, reason.slice(0, 500), now, reservationId).run().catch(() => undefined);
    await recordAuditEvent(env, { actor, eventType: "drive_backup_failed", entityType: "contract", entityId: reservationId, metadata: { error: reason.slice(0, 180) } });
    return { ok: false, reason };
  }
}
async function getDriveSyncStatus(env, reservationId) { if (!env || !env.AGENCY_DB) return null; return env.AGENCY_DB.prepare("SELECT status, drive_folder_id, last_attempt_at, last_error, synced_at FROM drive_sync_outbox WHERE reservation_id=?").bind(reservationId).first(); }
async function retryPendingDriveSyncs(env) { if (!env || !env.AGENCY_DB) return; const rows = await env.AGENCY_DB.prepare("SELECT reservation_id FROM drive_sync_outbox WHERE status IN ('pending','error')").all(); for (const row of rows.results || []) await syncDriveBackup(env, row.reservation_id, null); }
module.exports = { driveConfigured, enqueueDriveSync, syncDriveBackup, getDriveSyncStatus, retryPendingDriveSyncs, safeSnapshot };
