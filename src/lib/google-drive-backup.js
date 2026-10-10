// Copie de sauvegarde privée vers Google Drive. KV/R2 restent la source de
// vérité : aucune écriture métier ne dépend de ce module.
const { getAccessToken } = require("./google-auth.js");
const { getReservation, contractVersionInfo } = require("./reservation-store.js");
const { recordAuditEvent } = require("./audit-log.js");

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const DRIVE_API = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3/files";
const DRIVE_BATCH_SIZE = 3;
const DRIVE_FOLDER_KEYS = ["clients", "year", "month", "root", "contracts", "inspections", "documents", "deposit"];

class DriveBackupError extends Error {}
function esc(value) { return String(value || "").replace(/'/g, "\\'"); }
function safePart(value) { return String(value || "INCONNU").replace(/[^A-Za-zÀ-ÿ0-9 _.-]/g, "_").trim().slice(0, 100) || "INCONNU"; }
function driveConfigurationChecks(env) {
  return {
    agencyDb: Boolean(env && env.AGENCY_DB),
    driveRootFolderId: Boolean(env && typeof env.GOOGLE_DRIVE_ROOT_FOLDER_ID === "string" && env.GOOGLE_DRIVE_ROOT_FOLDER_ID.trim()),
    googleServiceAccountKey: Boolean(env && typeof env.GOOGLE_SERVICE_ACCOUNT_KEY === "string" && env.GOOGLE_SERVICE_ACCOUNT_KEY.trim())
  };
}
function missingDriveComponents(checks) {
  return Object.entries(checks).filter(([, present]) => !present).map(([name]) => ({ agencyDb: "AGENCY_DB", driveRootFolderId: "GOOGLE_DRIVE_ROOT_FOLDER_ID", googleServiceAccountKey: "GOOGLE_SERVICE_ACCOUNT_KEY" })[name]);
}
function driveConfigured(env) { return Object.values(driveConfigurationChecks(env)).every(Boolean); }
function sharedDriveUrl(path, base = DRIVE_API, list = false) {
  const url = new URL(`${base}${path}`);
  // Obligatoire pour tout accès à un dossier/fichier d'un Drive partagé.
  // includeItemsFromAllDrives/corpora s'appliquent aux recherches : ils
  // rendent l'idempotence fiable quand le parent appartient à un Drive partagé.
  url.searchParams.set("supportsAllDrives", "true");
  if (list) {
    url.searchParams.set("includeItemsFromAllDrives", "true");
    url.searchParams.set("corpora", "allDrives");
  }
  return url.toString();
}

async function request(env, path, options = {}, accessToken = null) {
  const token = accessToken || await getAccessToken(env, DRIVE_SCOPE);
  const { upload, list, ...fetchOptions } = options;
  const res = await fetch(sharedDriveUrl(path, upload ? DRIVE_UPLOAD_API : DRIVE_API, Boolean(list)), { ...fetchOptions, headers: { Authorization: `Bearer ${token}`, ...(fetchOptions.headers || {}) } });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new DriveBackupError((json && json.error && json.error.message) || `Google Drive (${res.status})`);
  return json;
}
async function folder(env, parentId, name, accessToken) {
  const q = `name = '${esc(name)}' and mimeType = 'application/vnd.google-apps.folder' and '${esc(parentId)}' in parents and trashed = false`;
  const found = await request(env, `?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1`, { list: true }, accessToken);
  if (found.files && found.files[0]) return found.files[0].id;
  const created = await request(env, "?fields=id", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] }) }, accessToken);
  return created.id;
}
async function fileId(env, reservationId, sourceKey) {
  const res = await env.AGENCY_DB.prepare("SELECT drive_file_id, immutable FROM drive_sync_files WHERE reservation_id = ? AND source_key = ?").bind(reservationId, sourceKey).first();
  return res || null;
}
async function upload(env, reservationId, sourceKey, parentId, name, body, contentType, immutable, accessToken) {
  const old = await fileId(env, reservationId, sourceKey);
  if (old && old.immutable) return old.drive_file_id;
  const boundary = `gl-${crypto.randomUUID()}`;
  const bytes = body instanceof Uint8Array ? body : new TextEncoder().encode(body);
  const prefix = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: old ? undefined : [parentId] })}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`;
  const suffix = `\r\n--${boundary}--`;
  const merged = new Uint8Array(new TextEncoder().encode(prefix).length + bytes.length + new TextEncoder().encode(suffix).length);
  let i = 0; [new TextEncoder().encode(prefix), bytes, new TextEncoder().encode(suffix)].forEach((part) => { merged.set(part, i); i += part.length; });
  const path = old ? `/${old.drive_file_id}?uploadType=multipart&fields=id` : `?uploadType=multipart&fields=id`;
  const result = await request(env, path, { upload: true, method: old ? "PATCH" : "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body: merged }, accessToken);
  const now = new Date().toISOString();
  await env.AGENCY_DB.prepare("INSERT INTO drive_sync_files (reservation_id, source_key, drive_file_id, immutable, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(reservation_id, source_key) DO UPDATE SET drive_file_id=excluded.drive_file_id, immutable=excluded.immutable, updated_at=excluded.updated_at").bind(reservationId, sourceKey, result.id, immutable ? 1 : 0, now).run();
  return result.id;
}
function safeSnapshot(record) {
  const dossier = record.contractDossier || {};
  return { id: record.id, contractNumero: record.contractNumero || null, status: record.status, createdAt: record.createdAt, updatedAt: record.updatedAt, vehiculeId: record.vehiculeId || null, immatriculation: record.immat || record.immatriculation || null, conducteur: record.conducteur ? { prenom: record.conducteur.prenom || null, nom: record.conducteur.nom || null } : { prenom: record.prenom || null, nom: record.nom || null }, periodeDebut: record.periodeDebut || record.depart || null, periodeFin: record.periodeFin || record.retour || null, contractVersion: contractVersionInfo(record), contractDossier: { status: dossier.status || "draft", fields: dossier.fields || null, depart: dossier.depart || null, retour: dossier.retour || null, observations: dossier.observations || "", media: dossier.media || { depart: [], retour: [] }, signature: dossier.signature ? { signedAt: dossier.signature.signedAt || null, signatureId: dossier.signature.signatureId || null } : null } };
}
async function enqueueDriveSync(env, reservationId) {
  if (!env || !env.AGENCY_DB || !reservationId) return null;
  const now = new Date().toISOString();
  await env.AGENCY_DB.prepare("INSERT INTO drive_sync_outbox (reservation_id,status,attempt_count,created_at,updated_at) VALUES (?, 'pending', 0, ?, ?) ON CONFLICT(reservation_id) DO UPDATE SET status='pending', updated_at=excluded.updated_at").bind(reservationId, now, now).run();
  // Seuls les brouillons/fichiers modifiables repartent : un PDF signé,
  // déjà archivé, reste immuable et n'est donc jamais dupliqué.
  await env.AGENCY_DB.prepare("UPDATE drive_sync_jobs SET status='pending', updated_at=? WHERE reservation_id=? AND immutable=0").bind(now, reservationId).run();
  return reservationId;
}

function jobsForRecord(record) {
  const version = contractVersionInfo(record), stem = `${safePart(record.contractNumero || record.id)}-V${version.version}`;
  const signed = version.status === "signed" || version.status === "archived";
  const jobs = [{ sourceKey: `snapshot-v${version.version}-${signed ? "SIGNE" : "BROUILLON"}`, jobType: "snapshot", targetFolder: "contracts", filename: `${stem}-DOSSIER.json`, contentType: "application/json", immutable: signed ? 1 : 0 }];
  const dossier = record.contractDossier || {}, media = dossier.media || {};
  for (const stage of ["depart", "retour"]) for (const item of Array.isArray(media[stage]) ? media[stage] : []) if (item && item.key) jobs.push({ sourceKey: item.key, jobType: "r2", sourceR2Key: item.key, targetFolder: "inspections", filename: `${safePart(record.contractNumero || record.id)}-${stage.toUpperCase()}-${safePart(item.slot || "photo")}.${(item.contentType || "image/jpeg").split("/")[1] || "jpg"}`, contentType: item.contentType || "image/jpeg", immutable: 0 });
  for (const item of Array.isArray(record.documentFiles) ? record.documentFiles : []) if (item && item.key) jobs.push({ sourceKey: item.key, jobType: "r2", sourceR2Key: item.key, targetFolder: "documents", filename: `${safePart(record.contractNumero || record.id)}-${safePart(item.type || "document")}`, contentType: item.contentType || "application/octet-stream", immutable: 0 });
  for (const item of Array.isArray(record.drivePdfFiles) ? record.drivePdfFiles : []) if (item && item.key) jobs.push({ sourceKey: item.sourceKey, jobType: "r2", sourceR2Key: item.key, targetFolder: item.kind && item.kind.indexOf("edl-") === 0 ? "inspections" : "contracts", filename: `${safePart(record.contractNumero || record.id)}-V${item.version}-${item.kind === "contract-signed" ? "SIGNE" : item.kind === "contract-draft" ? "BROUILLON" : item.kind === "edl-depart" ? "EDL-DEPART" : "EDL-RETOUR"}.pdf`, contentType: "application/pdf", immutable: item.immutable ? 1 : 0 });
  return jobs;
}
function driveJobsManifest(jobs) {
  // Empreinte déterministe, uniquement destinée à éviter les UPSERT D1
  // inutiles. Elle n'est ni une signature ni une donnée exposée à l'API.
  const source = jobs.map((job) => [job.sourceKey, job.jobType, job.sourceR2Key || "", job.targetFolder, job.filename, job.contentType, job.immutable].join("\u001f")).sort().join("\u001e");
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) hash = Math.imul(hash ^ source.charCodeAt(index), 16777619);
  return `v1-${(hash >>> 0).toString(16)}-${jobs.length}`;
}
function takeDriveJobs(rows, limit = DRIVE_BATCH_SIZE) {
  return (rows || []).filter((job) => job.status === "pending" || job.status === "error").slice(0, limit);
}
async function prepareDriveJobs(env, record, outbox) {
  const jobs = jobsForRecord(record);
  const manifest = driveJobsManifest(jobs);
  if (outbox && outbox.drive_jobs_manifest === manifest) return { prepared: false, jobs };
  const now = new Date().toISOString();
  const statements = jobs.map((job) => env.AGENCY_DB.prepare("INSERT INTO drive_sync_jobs (reservation_id,source_key,job_type,source_r2_key,target_folder,filename,content_type,immutable,status,attempt_count,created_at,updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?) ON CONFLICT(reservation_id,source_key) DO UPDATE SET job_type=excluded.job_type, source_r2_key=excluded.source_r2_key, target_folder=excluded.target_folder, filename=excluded.filename, content_type=excluded.content_type, immutable=excluded.immutable, updated_at=excluded.updated_at").bind(record.id, job.sourceKey, job.jobType, job.sourceR2Key || null, job.targetFolder, job.filename, job.contentType, job.immutable, now, now));
  statements.push(env.AGENCY_DB.prepare("UPDATE drive_sync_outbox SET drive_jobs_manifest=?, updated_at=? WHERE reservation_id=?").bind(manifest, now, record.id));
  await env.AGENCY_DB.batch(statements);
  return { prepared: true, jobs };
}
async function progress(env, reservationId) {
  const rows = await env.AGENCY_DB.prepare("SELECT status, COUNT(*) AS count FROM drive_sync_jobs WHERE reservation_id = ? GROUP BY status").bind(reservationId).all();
  const counts = { pending: 0, processing: 0, synced: 0, error: 0 }; (rows.results || []).forEach((r) => { counts[r.status] = Number(r.count) || 0; });
  return { total: counts.pending + counts.processing + counts.synced + counts.error, ...counts };
}
function folderProgress(serializedFolders) {
  let folders = {};
  try { folders = JSON.parse(serializedFolders || "{}"); } catch (e) { /* l'état sera recréé à la prochaine synchronisation */ }
  return { completed: DRIVE_FOLDER_KEYS.filter((key) => Boolean(folders[key])).length, total: DRIVE_FOLDER_KEYS.length };
}
function driveSyncDiagnostic(row, files, jobError = null) {
  if (!row) return null;
  return {
    status: row.status,
    folderProgress: folderProgress(row.drive_folders_json),
    files: { total: files.total, synced: files.synced, pending: files.pending, processing: files.processing, error: files.error },
    lastAttemptAt: row.last_attempt_at || null,
    // Une erreur de job précise est plus utile que le compteur conservé dans
    // l'outbox. Aucun détail d'authentification n'est stocké ni renvoyé.
    lastError: jobError || row.last_error || null,
    syncedAt: row.synced_at || null,
    lastRun: parseLastRun(row.drive_last_run_json)
  };
}
function parseLastRun(value) {
  try {
    const run = JSON.parse(value || "null");
    if (!run || typeof run !== "object") return null;
    return {
      stage: typeof run.stage === "string" ? run.stage.slice(0, 40) : null,
      pendingBefore: Number(run.pendingBefore) || 0,
      selected: Number(run.selected) || 0,
      attempted: Number(run.attempted) || 0,
      syncedThisRun: Number(run.syncedThisRun) || 0,
      failedThisRun: Number(run.failedThisRun) || 0
    };
  } catch (e) { return null; }
}
async function ensureFolderStep(env, record, outbox, accessToken) {
  const ids = JSON.parse(outbox.drive_folders_json || "{}");
  const path = [["clients", env.GOOGLE_DRIVE_ROOT_FOLDER_ID, "DOSSIERS CLIENTS"], ["year", "clients", String(new Date(record.createdAt || Date.now()).getFullYear())], ["month", "year", `${String(new Date(record.createdAt || Date.now()).getMonth() + 1).padStart(2, "0")} - ${new Date(record.createdAt || Date.now()).toLocaleDateString("fr-FR", { month: "long" }).replace(/^./, (x) => x.toUpperCase())}`], ["root", "month", `${safePart(record.contractNumero || record.id)} - ${safePart(`${(record.conducteur || record).nom || ""} ${(record.conducteur || record).prenom || ""}`)}`], ["contracts", "root", "01 - Contrats"], ["inspections", "root", "02 - États des lieux"], ["documents", "root", "03 - Documents client"], ["deposit", "root", "04 - Dépôt de garantie"]];
  for (const [key, parent, name] of path) if (!ids[key]) { const now = new Date().toISOString(); ids[key] = await folder(env, parent === env.GOOGLE_DRIVE_ROOT_FOLDER_ID ? parent : ids[parent], name, accessToken); await env.AGENCY_DB.prepare("UPDATE drive_sync_outbox SET status='processing', drive_folders_json=?, last_attempt_at=?, last_error=NULL, drive_last_run_json=?, updated_at=? WHERE reservation_id=?").bind(JSON.stringify(ids), now, JSON.stringify({ stage: "folders", pendingBefore: 0, selected: 0, attempted: 0, syncedThisRun: 0, failedThisRun: 0 }), now, record.id).run(); return null; }
  return ids;
}
async function syncDriveBackup(env, reservationId, actor = null) {
  const checks = driveConfigurationChecks(env);
  const missing = missingDriveComponents(checks);
  if (!driveConfigured(env)) {
    const now = new Date().toISOString();
    const reason = `Google Drive non configuré : ${missing.join(", ")}`;
    if (checks.agencyDb) {
      await enqueueDriveSync(env, reservationId);
      await env.AGENCY_DB.prepare("UPDATE drive_sync_outbox SET status='error', attempt_count=attempt_count+1, last_attempt_at=?, last_error=?, updated_at=? WHERE reservation_id=?").bind(now, reason, now, reservationId).run();
      await recordAuditEvent(env, { actor, eventType: "drive_backup_failed", entityType: "contract", entityId: reservationId, metadata: { error: reason } });
    }
    return { ok: false, reason, checks };
  }
  const now = new Date().toISOString();
  try {
    // Un seul jeton OAuth par invocation : avec trois envois cela fait au
    // plus quatre sous-requêtes externes (OAuth + trois appels Drive).
    const accessToken = await getAccessToken(env, DRIVE_SCOPE);
    const record = await getReservation(env, reservationId);
    if (!record) throw new DriveBackupError("Dossier introuvable");
    const outbox = await env.AGENCY_DB.prepare("SELECT * FROM drive_sync_outbox WHERE reservation_id=?").bind(record.id).first();
    await prepareDriveJobs(env, record, outbox || {});
    const folders = await ensureFolderStep(env, record, outbox || {}, accessToken);
    if (!folders) return { ok: true, status: "processing", ...(await progress(env, record.id)) };
    const before = await progress(env, record.id);
    const pending = await env.AGENCY_DB.prepare("SELECT * FROM drive_sync_jobs WHERE reservation_id=? AND status IN ('pending','error') ORDER BY updated_at ASC LIMIT ?").bind(record.id, DRIVE_BATCH_SIZE).all();
    const selected = takeDriveJobs(pending.results);
    let attempted = 0, syncedThisRun = 0, failedThisRun = 0;
    const jobUpdates = [];
    for (const job of selected) {
      attempted += 1;
      try {
        const body = job.job_type === "snapshot" ? JSON.stringify(safeSnapshot(record), null, 2) : new Uint8Array(await (await env.DOCUMENTS_BUCKET.get(job.source_r2_key)).arrayBuffer());
        await upload(env, record.id, job.source_key, folders[job.target_folder], job.filename, body, job.content_type, Boolean(job.immutable), accessToken);
        syncedThisRun += 1;
        jobUpdates.push(env.AGENCY_DB.prepare("UPDATE drive_sync_jobs SET status='synced', attempt_count=attempt_count+1, last_error=NULL, synced_at=?, updated_at=? WHERE reservation_id=? AND source_key=?").bind(now, now, record.id, job.source_key));
      } catch (jobError) { failedThisRun += 1; jobUpdates.push(env.AGENCY_DB.prepare("UPDATE drive_sync_jobs SET status='error', attempt_count=attempt_count+1, last_error=?, updated_at=? WHERE reservation_id=? AND source_key=?").bind(String(jobError.message || "Erreur Drive").slice(0, 500), now, record.id, job.source_key)); }
    }
    if (jobUpdates.length) await env.AGENCY_DB.batch(jobUpdates);
    const state = await progress(env, record.id);
    const status = state.pending || state.processing ? "processing" : state.error ? "error" : "synced";
    const run = { stage: "files", pendingBefore: before.pending + before.error, selected: selected.length, attempted, syncedThisRun, failedThisRun };
    await env.AGENCY_DB.prepare("UPDATE drive_sync_outbox SET status=?, drive_folder_id=?, attempt_count=attempt_count+1, last_attempt_at=?, last_error=?, drive_last_run_json=?, synced_at=?, updated_at=? WHERE reservation_id=?").bind(status, folders.root, now, state.error ? `${state.error} élément(s) en erreur` : null, JSON.stringify(run), status === "synced" ? now : null, now, record.id).run();
    return { ok: status !== "error", folderId: folders.root, status, ...state, lastRun: run };
  } catch (err) {
    const reason = (err && err.message) || "Erreur Google Drive";
    const run = JSON.stringify({ stage: "global-error", pendingBefore: 0, selected: 0, attempted: 0, syncedThisRun: 0, failedThisRun: 0 });
    await env.AGENCY_DB.prepare("UPDATE drive_sync_outbox SET status='error', attempt_count=attempt_count+1, last_attempt_at=?, last_error=?, drive_last_run_json=?, updated_at=? WHERE reservation_id=?").bind(now, reason.slice(0, 500), run, now, reservationId).run().catch(() => undefined);
    await recordAuditEvent(env, { actor, eventType: "drive_backup_failed", entityType: "contract", entityId: reservationId, metadata: { error: reason.slice(0, 180) } });
    return { ok: false, reason };
  }
}
async function getDriveSyncStatus(env, reservationId) {
  if (!env || !env.AGENCY_DB) return null;
  const row = await env.AGENCY_DB.prepare("SELECT status, drive_folders_json, drive_last_run_json, last_attempt_at, last_error, synced_at FROM drive_sync_outbox WHERE reservation_id=?").bind(reservationId).first();
  if (!row) return null;
  const files = await progress(env, reservationId);
  const latest = await env.AGENCY_DB.prepare("SELECT last_error FROM drive_sync_jobs WHERE reservation_id=? AND status='error' AND last_error IS NOT NULL ORDER BY updated_at DESC LIMIT 1").bind(reservationId).first();
  return driveSyncDiagnostic(row, files, latest && latest.last_error);
}
// Le cron ne traite qu'un dossier par invocation : 3 opérations Drive au
// maximum (ou une étape de dossier), jamais une boucle non bornée.
async function retryPendingDriveSyncs(env) { if (!env || !env.AGENCY_DB) return; const rows = await env.AGENCY_DB.prepare("SELECT reservation_id FROM drive_sync_outbox WHERE status IN ('pending','processing','error') ORDER BY updated_at ASC LIMIT 1").all(); for (const row of rows.results || []) await syncDriveBackup(env, row.reservation_id, null); }
module.exports = { driveConfigured, driveConfigurationChecks, enqueueDriveSync, syncDriveBackup, getDriveSyncStatus, retryPendingDriveSyncs, safeSnapshot, sharedDriveUrl, driveSyncDiagnostic, driveJobsManifest, jobsForRecord, takeDriveJobs };
