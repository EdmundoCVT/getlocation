// États des lieux autonomes. Ils sont volontairement séparés des réservations:
// aucun faux contrat ni jeton client n'est créé pour une inspection agence.
const { requireAgencySession } = require("../lib/agency-auth.js");
const { listReservations, getReservation } = require("../lib/reservation-store.js");
const { validateConditionReport } = require("../lib/validate-contract-dossier.js");
const { recordAuditEvent } = require("../lib/audit-log.js");
const { listInspectionRevisions, getInspectionRevision, createInspectionRevision, updateInspectionRevisionDraft } = require("../lib/inspection-revisions.js");
const { finalizeRevisionWithPdf } = require("../lib/finalize-inspection-revision.js");
const { summarizeInspectionRevisions } = require("../lib/inspection-revision-summary.js");

const PREFIX = "standalone-inspection:";
const DIAGNOSTIC_PREFIX = "diagnostic:standalone:";
const DIAGNOSTIC_TTL_SECONDS = 10 * 60;
const ID = /^edl_[a-f0-9-]{16,64}$/;
const REQUEST_ID = /^edlreq_[a-f0-9]{8}$/;
const DIAGNOSTIC_STAGES = {
  a: "handler-entered",
  b: "auth-ok",
  c: "body-read",
  d: "record-read",
  e: "revision-read",
  f: "snapshot-validation",
  g: "before-revision-update",
  h: "after-revision-update",
  i: "before-serialization",
  j: "after-serialization",
  k: "before-kv-write",
  l: "after-kv-write",
  m: "after-audit-log"
};
function requestId(request) {
  const supplied = request.headers.get("x-edl-request-id");
  return REQUEST_ID.test(supplied || "") ? supplied : "edlreq_" + crypto.randomUUID().replace(/-/g, "").slice(0, 8);
}
function json(body, status = 200, id = null) {
  const payload = id ? { ...body, requestId: id } : body;
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  if (id) headers["X-EDL-Request-ID"] = id;
  return new Response(JSON.stringify(payload), { status, headers });
}
async function withRequestId(response, id) {
  if (!id) return response;
  let body;
  try { body = await response.json(); }
  catch (_) { body = { error: "Erreur d’authentification" }; }
  return json(body, response.status, id);
}
function byteLength(value) { return new TextEncoder().encode(value).byteLength; }
function requestBodyBytes(request) {
  const raw = request.headers.get("content-length") || request.headers.get("x-edl-body-bytes");
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}
function serializeRecordWithMetrics(record, stage, snapshot) {
  let signatureBytes = 0, signatureCopies = 0;
  const serializedRecord = JSON.stringify(record, (key, value) => {
    if (key === "imageDataUrl" && typeof value === "string") {
      // Une data URL base64 est ASCII : sa longueur est son nombre d’octets.
      // Évite un TextEncoder et son allocation binaire pour chaque signature.
      signatureBytes += value.length;
      signatureCopies++;
    }
    return value;
  });
  const revisions = record.inspectionRevisions && Array.isArray(record.inspectionRevisions[stage]) ? record.inspectionRevisions[stage] : [];
  const current = revisions.find(item => item.snapshot === snapshot) || revisions[revisions.length - 1] || {};
  return { serializedRecord, sizes: {
    recordBytes: byteLength(serializedRecord),
    revisionCount: revisions.length,
    // Ces deux métriques exigeaient auparavant deux sérialisations lourdes
    // supplémentaires. Le record persistant n'est maintenant sérialisé qu'une fois.
    inspectionRevisionsBytes: null,
    snapshotBytes: null,
    signatureBytes,
    signatureCopies,
    mediaCount: Array.isArray(current.media) ? current.media.length : 0
  } };
}
async function writeDiagnosticBreadcrumb(env, id, startedAt, code, details = {}) {
  if (!env.RESERVATIONS_KV || !id || !DIAGNOSTIC_STAGES[code]) return;
  const payload = {
    v: 2,
    q: id,
    s: code,
    t: Math.max(0, Date.now() - startedAt),
    ...(details.inspectionId ? { i: details.inspectionId } : {}),
    ...(Number.isInteger(details.revision) ? { r: details.revision } : {}),
    ...(Number.isFinite(details.bodyBytes) ? { b: details.bodyBytes } : {}),
    ...(details.expectedUpdatedAt ? { u: details.expectedUpdatedAt } : {}),
    ...(details.sizes ? { z: [details.sizes.recordBytes, details.sizes.revisionCount, details.sizes.snapshotBytes, details.sizes.signatureBytes, details.sizes.signatureCopies, details.sizes.mediaCount, details.sizes.inspectionRevisionsBytes] } : {})
  };
  // Une clé par étape évite la limite Workers KV d'une écriture par seconde
  // sur une même clé. Le lecteur choisit ensuite l'étape alphabétique la plus
  // avancée (a…m). Les anciens breadcrumbs mono-clé restent lisibles.
  try { await env.RESERVATIONS_KV.put(DIAGNOSTIC_PREFIX + id + ":" + code, JSON.stringify(payload), { expirationTtl: DIAGNOSTIC_TTL_SECONDS }); }
  catch (_) { /* Le diagnostic ne doit jamais bloquer la sauvegarde métier. */ }
}
function publicDiagnostic(diagnostic) {
  return { stage: diagnostic.stage, timings: diagnostic.timings, ...(Number.isFinite(diagnostic.bodyBytes) ? { bodyBytes: diagnostic.bodyBytes } : {}), ...(diagnostic.sizes || {}) };
}
function text(value, max = 300) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
function safeMode(value) { return value === "retour" ? "retour" : value === "depart" ? "depart" : null; }
function displaySignatureTime(value) { if (value === null || value === undefined || value === "") return null; if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) || Number.isNaN(new Date(value + ":00Z").getTime())) throw new Error("Date et heure affichées invalides"); return value; }
function preserveInspectionSignatures(report, previous) { ["client", "agence"].forEach(role => { const before = previous && previous.signatures && previous.signatures[role], next = report.signatures && report.signatures[role]; if (before && next && before.signedAt && before.imageDataUrl === next.imageDataUrl) report.signatures[role] = { ...next, signedAt: before.signedAt, ...(before.displaySignedAt ? { displaySignedAt: before.displaySignedAt } : {}) }; }); return report; }
function validateRevisionReport(value, previous) {
  const source = value && typeof value === "object" ? value : {};
  const candidate = { ...source, signatures: { ...((source && source.signatures) || {}) } };
  const trusted = {};
  // Une correction hérite des signatures historiques. Si leur binaire est
  // renvoyé inchangé, il est déjà approuvé et stocké côté serveur : ne pas le
  // soumettre à nouveau à la limite réservée aux nouvelles images. Cela rend
  // notamment modifiables les V2 issues d'anciennes V1 plus volumineuses.
  for (const role of ["client", "agence"]) {
    const before = previous && previous.signatures && previous.signatures[role];
    const next = candidate.signatures[role];
    if (before && next && before.signedAt && before.imageDataUrl && next.imageDataUrl === before.imageDataUrl) {
      trusted[role] = before;
      candidate.signatures[role] = { ...next, imageDataUrl: "data:image/png;base64,AA==" };
    }
  }
  const report = preserveInspectionSignatures(validateConditionReport(candidate), previous);
  for (const role of Object.keys(trusted)) {
    const before = trusted[role], next = report.signatures[role] || {};
    report.signatures[role] = { ...next, imageDataUrl: before.imageDataUrl, signedAt: before.signedAt, ...(before.displaySignedAt ? { displaySignedAt: before.displaySignedAt } : {}) };
  }
  return report;
}
function publicItem(record) {
  return { id: record.id, mode: record.mode, client: record.client || {}, vehicule: record.vehicule || {}, linkedContractId: record.linkedContractId || null, linkedContractNumero: record.linkedContractNumero || null, pairedInspectionId: record.pairedInspectionId || null, pairedAt: record.pairedAt || null, pairedBy: record.pairedBy || null, dateHeure: record.dossier && record.dossier[record.mode] && record.dossier[record.mode].dateHeure || record.createdAt, status: record.status || "draft", pdf: record.pdf || null, inspectionRevisions: summarizeInspectionRevisions(record.inspectionRevisions), archivedAt: record.archivedAt || null, archivedBy: record.archivedBy || null, updatedAt: record.updatedAt };
}
async function read(env, id) { const raw = ID.test(id || "") && await env.RESERVATIONS_KV.get(PREFIX + id); return raw ? JSON.parse(raw) : null; }
async function write(env, record) { record.updatedAt = new Date().toISOString(); await env.RESERVATIONS_KV.put(PREFIX + record.id, JSON.stringify(record)); return record; }
function createId() { return "edl_" + crypto.randomUUID(); }
async function contracts(env, needle) {
  const q = text(needle, 100).toLocaleLowerCase("fr-FR");
  const records = await listReservations(env);
  return records.filter(r => r && ["paid", "manual_contract", "contract_version"].includes(r.status)).filter(r => !q || [r.contractNumero, r.id, r.nom, r.prenom, r.immat, r.immatriculation, r.conducteur && r.conducteur.nom, r.conducteur && r.conducteur.prenom].join(" ").toLocaleLowerCase("fr-FR").includes(q)).slice(0, 30).map(r => ({ id: r.id, contractNumero: r.contractNumero || null, client: r.conducteur ? { prenom: r.conducteur.prenom || "", nom: r.conducteur.nom || "" } : { prenom: r.prenom || "", nom: r.nom || "" }, vehiculeId: r.vehiculeId || "", immatriculation: r.immatriculation || r.immat || "" }));
}
async function readDiagnostic(env, id, inspectionId) {
  if (!REQUEST_ID.test(id || "") || !ID.test(inspectionId || "")) return null;
  const baseKey = DIAGNOSTIC_PREFIX + id;
  let raw = null;
  try {
    const page = await env.RESERVATIONS_KV.list({ prefix: baseKey + ":", limit: 20 });
    const latest = (page.keys || []).map(key => key.name).filter(name => /^[a-m]$/.test(name.slice(-1))).sort().at(-1);
    if (latest) raw = await env.RESERVATIONS_KV.get(latest);
  } catch (_) { /* Repli sur l'ancien breadcrumb mono-clé. */ }
  if (!raw) raw = await env.RESERVATIONS_KV.get(baseKey);
  if (!raw) return null;
  let diagnostic;
  try { diagnostic = JSON.parse(raw); } catch (_) { return null; }
  if (diagnostic && diagnostic.v === 2 && DIAGNOSTIC_STAGES[diagnostic.s]) {
    diagnostic = {
      stage: DIAGNOSTIC_STAGES[diagnostic.s],
      expectedUpdatedAt: diagnostic.u,
      bodyBytes: diagnostic.b,
      timings: [{ stage: DIAGNOSTIC_STAGES[diagnostic.s], durationMs: diagnostic.t }],
      ...(Array.isArray(diagnostic.z) ? { sizes: {
        recordBytes: diagnostic.z[0],
        revisionCount: diagnostic.z[1],
        snapshotBytes: diagnostic.z[2],
        signatureBytes: diagnostic.z[3],
        signatureCopies: diagnostic.z[4],
        mediaCount: diagnostic.z[5],
        inspectionRevisionsBytes: diagnostic.z[6]
      } } : {})
    };
  } else if (diagnostic && diagnostic.s === "b" && Array.isArray(diagnostic.z)) {
    diagnostic = {
      stage: "before-kv-write",
      expectedUpdatedAt: diagnostic.u,
      timings: [],
      sizes: {
        recordBytes: diagnostic.z[0],
        revisionCount: diagnostic.z[1],
        snapshotBytes: diagnostic.z[2],
        signatureBytes: diagnostic.z[3],
        signatureCopies: diagnostic.z[4],
        mediaCount: diagnostic.z[5],
        inspectionRevisionsBytes: diagnostic.z[6]
      }
    };
  }
  const record = await read(env, inspectionId);
  let stage = diagnostic.stage || "unknown";
  if (record && diagnostic.expectedUpdatedAt && record.updatedAt === diagnostic.expectedUpdatedAt && stage !== "after-kv-write" && stage !== "after-audit-log") stage = "after-kv-write";
  if (stage === "after-kv-write" && env.AGENCY_DB) {
    try {
      const audit = await env.AGENCY_DB.prepare("SELECT id FROM audit_log WHERE entity_id = ? AND metadata LIKE ? ORDER BY id DESC LIMIT 1").bind(inspectionId, `%${id}%`).first();
      if (audit) stage = "after-audit-log";
    } catch (_) { /* Le diagnostic KV reste exploitable si D1 est indisponible. */ }
  }
  return { ...diagnostic, stage };
}
async function handleStandaloneInspectionsRequest(request, env, id = null) {
  const startedAt = Date.now(), timings = [];
  const bodyBytes = requestBodyBytes(request);
  const breadcrumb = (code, details = {}) => writeDiagnosticBreadcrumb(env, id, startedAt, code, { bodyBytes, ...details });
  const mark = (stage, since) => timings.push({ stage, durationMs: Math.max(0, Date.now() - since) });
  const reply = (body, status = 200) => json(body, status, id);
  if (!env.RESERVATIONS_KV) return reply({ error: "Stockage des états des lieux indisponible" }, 503);
  const authStarted = Date.now();
  const auth = await requireAgencySession(request, env, request.method === "GET" ? {} : { requireCsrf: true, requireOrigin: true });
  mark("auth", authStarted);
  if (auth.error) return withRequestId(auth.error, id);
  const url = new URL(request.url);
  if (request.method === "GET") {
    if (url.searchParams.get("diagnostic")) {
      const diagnostic = await readDiagnostic(env, url.searchParams.get("diagnostic"), url.searchParams.get("id"));
      return diagnostic ? json({ diagnostic: publicDiagnostic(diagnostic) }) : json({ error: "Diagnostic temporaire introuvable" }, 404);
    }
    if (url.searchParams.get("contracts") === "1") return json({ contracts: await contracts(env, url.searchParams.get("q")) });
    const id = url.searchParams.get("id");
    if (id) { const inspection = await read(env, id); if (!inspection) return json({ error: "État des lieux introuvable" }, 404); const stage = safeMode(url.searchParams.get("stage")); if (stage && url.searchParams.get("history") === "1") return json({ revisions: listInspectionRevisions(inspection, stage, inspection.dossier && inspection.dossier[stage], inspection.dossier && inspection.dossier.media && inspection.dossier.media[stage], inspection.createdBy) }); return json({ inspection }); }
    const keyNames = [];
    let cursor;
    do {
      const page = await env.RESERVATIONS_KV.list({ prefix: PREFIX, limit: 200, ...(cursor ? { cursor } : {}) });
      keyNames.push(...page.keys.map(key => key.name));
      cursor = page.list_complete ? null : page.cursor;
    } while (cursor);
    const inspections = (await Promise.all(keyNames.map(key => env.RESERVATIONS_KV.get(key)))).filter(Boolean).map(JSON.parse).map(publicItem).sort((a,b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    return json({ inspections });
  }
  if (request.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);
  const readBodyStarted = Date.now();
  const body = await request.json().catch(() => null); mark("request-read", readBodyStarted);
  if (!body || typeof body !== "object") return reply({ error: "Requête invalide" }, 400);
  if (body.action === "create") {
    const mode = safeMode(body.mode); if (!mode) return reply({ error: "Type d’état des lieux invalide" }, 400);
    const now = new Date().toISOString(), id = createId();
    const record = { id, kind: "standalone-inspection", mode, client: { prenom: text(body.client && body.client.prenom, 100), nom: text(body.client && body.client.nom, 100), telephone: text(body.client && body.client.telephone, 40) }, vehicule: { nom: text(body.vehicule && body.vehicule.nom, 150), immatriculation: text(body.vehicule && body.vehicule.immatriculation, 40), vehicleFamily: body.vehicule && body.vehicule.vehicleFamily === "utility" ? "utility" : "car" }, linkedContractId: null, linkedContractNumero: null, internalNote: text(body.internalNote, 2000), dossier: { status: "draft", depart: null, retour: null, media: { depart: [], retour: [] } }, inspectionRevisions: { [mode]: [{ revision: 1, status: "draft", snapshot: null, media: [], pdfKey: null, finalizedAt: null, createdAt: now, createdBy: auth.session.operator || null, basedOnRevision: null }] }, status: "draft", createdAt: now, updatedAt: now, createdBy: auth.session.operator || null };
    if (body.linkedContractId) { const contract = await getReservation(env, text(body.linkedContractId, 100)); if (!contract) return reply({ error: "Contrat associé introuvable" }, 404); record.linkedContractId = contract.id; record.linkedContractNumero = contract.contractNumero || null; }
    await write(env, record); return reply({ inspection: record }, 201);
  }
  const kvReadStarted = Date.now();
  const record = await read(env, body.id); mark("kv-read", kvReadStarted);
  if (!record) return reply({ error: "État des lieux introuvable" }, 404);
  if (body.action === "associate-inspection") {
    const pairId = text(body.pairedInspectionId, 100);
    const previousPair = record.pairedInspectionId ? await read(env, record.pairedInspectionId) : null;
    if (!pairId) {
      if (previousPair && previousPair.pairedInspectionId === record.id) { delete previousPair.pairedInspectionId; delete previousPair.pairedAt; delete previousPair.pairedBy; await write(env, previousPair); }
      delete record.pairedInspectionId; delete record.pairedAt; delete record.pairedBy; await write(env, record);
      return reply({ inspection: record, pairedInspection: null });
    }
    const pair = await read(env, pairId);
    if (!pair || pair.id === record.id) return reply({ error: "État des lieux à associer introuvable" }, 404);
    if (safeMode(pair.mode) === safeMode(record.mode)) return reply({ error: "L’association doit relier un départ et un retour" }, 400);
    if (previousPair && previousPair.id !== pair.id && previousPair.pairedInspectionId === record.id) { delete previousPair.pairedInspectionId; delete previousPair.pairedAt; delete previousPair.pairedBy; await write(env, previousPair); }
    if (pair.pairedInspectionId && pair.pairedInspectionId !== record.id) {
      const displaced = await read(env, pair.pairedInspectionId);
      if (displaced && displaced.pairedInspectionId === pair.id) { delete displaced.pairedInspectionId; delete displaced.pairedAt; delete displaced.pairedBy; await write(env, displaced); }
    }
    const pairedAt = new Date().toISOString(), pairedBy = auth.session.operator || null;
    record.pairedInspectionId = pair.id; record.pairedAt = pairedAt; record.pairedBy = pairedBy;
    pair.pairedInspectionId = record.id; pair.pairedAt = pairedAt; pair.pairedBy = pairedBy;
    await write(env, pair); await write(env, record);
    await recordAuditEvent(env, { actor: auth.session.operator, eventType: "standalone_inspections_paired", entityType: "standalone_inspection", entityId: record.id, metadata: { pairedInspectionId: pair.id, stages: [record.mode, pair.mode] } });
    return reply({ inspection: record, pairedInspection: publicItem(pair) });
  }
  if (body.action === "set-archived") {
    const archived = body.archived === true;
    const now = new Date().toISOString();
    if (archived) { record.archivedAt = now; record.archivedBy = auth.session.operator || null; }
    else { delete record.archivedAt; delete record.archivedBy; }
    await write(env, record);
    await recordAuditEvent(env, { actor: auth.session.operator, eventType: archived ? "inspection_archived" : "inspection_restored", entityType: "standalone_inspection", entityId: record.id, metadata: archived ? { archivedAt: now, archivedBy: auth.session.operator || null } : { restoredAt: now, restoredBy: auth.session.operator || null } });
    return reply({ inspection: record, archived });
  }
  if (body.action === "create-revision") {
    const stage = safeMode(body.stage || record.mode); if (!stage) return reply({ error: "Type d’état des lieux invalide" }, 400);
    try {
      const created = createInspectionRevision(record, stage, record.dossier && record.dossier[stage], record.dossier && record.dossier.media && record.dossier.media[stage], auth.session.operator, body.baseRevision, body.revisionReason);
      record.inspectionRevisions = { ...(record.inspectionRevisions || {}), [stage]: created.revisions };
      await write(env, record);
      await recordAuditEvent(env, { actor: auth.session.operator, eventType: "inspection_revision_created", entityType: "standalone_inspection", entityId: record.id, metadata: { stage, basedOnRevision: created.revision.basedOnRevision, revision: created.revision.revision, revisionReason: created.revision.revisionReason } });
      return reply({ inspection: record, revision: created.revision }, 201);
    } catch (error) { return reply({ error: error.message || "Révision impossible" }, 409); }
  }
  if (body.action === "update-stage") {
    const stage = safeMode(record.mode);
    if (!stage) return reply({ error: "Type d’état des lieux invalide" }, 400);
    const revision = Number(body.revision);
    const dossier = record.dossier && typeof record.dossier === "object" ? record.dossier : { status: "draft", depart: null, retour: null, media: { depart: [], retour: [] } };
    dossier.media = dossier.media && typeof dossier.media === "object" ? dossier.media : { depart: [], retour: [] };
    record.dossier = dossier;
    const revisionStarted = Date.now();
    const previous = Number.isInteger(revision)
      ? getInspectionRevision(record, stage, dossier[stage], dossier.media[stage], record.createdBy, revision)
      : dossier[stage];
    mark("revision-read", revisionStarted);
    let report;
    const validationStarted = Date.now();
    try { report = validateRevisionReport(body.stage, previous && previous.snapshot || previous); mark("snapshot-validation", validationStarted); }
    catch (error) { mark("snapshot-validation", validationStarted); return reply({ error: error.message || "État des lieux invalide", diagnostic: publicDiagnostic({ stage: "snapshot-validation", timings, bodyBytes }) }, 400); }
    if (Number.isInteger(revision)) {
      const diagnostic = { stage: "revision-update", timings, sizes: null, bodyBytes };
      try {
        await breadcrumb("g", { inspectionId: record.id, revision });
        const updateStarted = Date.now();
        const result = body.finalize ? await finalizeRevisionWithPdf({ env, record, stage, revision, snapshot: report, fallbackSnapshot: dossier[stage], fallbackMedia: dossier.media[stage], actor: auth.session.operator, standalone: true }) : updateInspectionRevisionDraft(record, stage, dossier[stage], dossier.media[stage], auth.session.operator, revision, report);
        if (Array.isArray(result.updateTimings)) timings.push(...result.updateTimings);
        mark(body.finalize ? "revision-finalize" : "revision-update", updateStarted);
        record.inspectionRevisions = result.inspectionRevisions;
        record.status = body.finalize ? "finalized" : record.status;

        const serializationStarted = Date.now();
        record.updatedAt = new Date().toISOString();
        const serialized = serializeRecordWithMetrics(record, stage, result.revision && result.revision.snapshot || report);
        const serializedRecord = serialized.serializedRecord;
        diagnostic.sizes = serialized.sizes;
        diagnostic.stage = "before-kv-write";
        mark("record-serialization", serializationStarted);
        await breadcrumb("k", { inspectionId: record.id, revision, expectedUpdatedAt: record.updatedAt, sizes: diagnostic.sizes });

        const writeStarted = Date.now();
        await env.RESERVATIONS_KV.put(PREFIX + record.id, serializedRecord);
        mark("kv-write", writeStarted);
        diagnostic.stage = "after-kv-write";

        const auditStarted = Date.now();
        await recordAuditEvent(env, { actor: auth.session.operator, eventType: body.finalize ? "inspection_revision_finalized" : "inspection_revision_updated", entityType: "standalone_inspection", entityId: record.id, metadata: { stage, revision, requestId: id } });
        mark("audit-log", auditStarted);
        diagnostic.stage = "after-audit-log";
        mark("total", startedAt);
        return reply({ revision: result.revision, status: record.status, updatedAt: record.updatedAt, revisionCount: (result.revisions || result.inspectionRevisions[stage] || []).length, diagnostic: publicDiagnostic(diagnostic) });
      } catch (error) {
        const status = Number.isInteger(error && error.status) ? error.status : 500;
        mark("total", startedAt);
        if (status >= 500) console.error("standalone_inspection_update_error", { requestId: id, action: body.finalize ? "finalize" : "save", stage, revision, diagnosticStage: diagnostic.stage, status, name: error && error.name || "Error" });
        return reply({ error: status >= 500 ? "Erreur serveur lors de l’enregistrement de l’état des lieux" : error && error.message || "Enregistrement impossible", diagnostic: publicDiagnostic(diagnostic) }, status);
      }
    }
    record.dossier[stage] = { ...report, completedAt: record.dossier[stage] && record.dossier[stage].completedAt || new Date().toISOString(), finalizedAt: body.finalize ? record.dossier[stage] && record.dossier[stage].finalizedAt || new Date().toISOString() : record.dossier[stage] && record.dossier[stage].finalizedAt || null };
    record.status = body.finalize ? "finalized" : (record.status === "finalized" ? "finalized" : "draft"); await write(env, record); return reply({ inspection: record });
  }
  if (body.action === "update-signature-display-time") {
    const stage = safeMode(record.mode), role = body.role === "client" || body.role === "agence" ? body.role : null;
    const revision = Number(body.revision);
    if (Number.isInteger(revision)) {
      const current = getInspectionRevision(record, stage, record.dossier[stage], record.dossier.media && record.dossier.media[stage], record.createdBy, revision);
      const signature = current && current.snapshot && current.snapshot.signatures && current.snapshot.signatures[role];
      if (!signature || !signature.signedAt) return reply({ error: "Signature introuvable" }, 404);
      try { const displaySignedAt = displaySignatureTime(body.displaySignedAt); const snapshot = { ...current.snapshot, signatures: { ...current.snapshot.signatures, [role]: { ...signature, ...(displaySignedAt ? { displaySignedAt } : {}) } } }; if (!displaySignedAt) delete snapshot.signatures[role].displaySignedAt; const saved = updateInspectionRevisionDraft(record, stage, record.dossier[stage], record.dossier.media && record.dossier.media[stage], auth.session.operator, revision, snapshot); record.inspectionRevisions = saved.inspectionRevisions; await write(env, record); return reply({ inspection: record, revision: saved.revision }); } catch (error) { return reply({ error: error.message }, error.status || 409); }
    }
    const signature = stage && role && record.dossier[stage] && record.dossier[stage].signatures && record.dossier[stage].signatures[role];
    if (!signature || !signature.signedAt) return reply({ error: "Signature introuvable" }, 404);
    let displaySignedAt;
    try { displaySignedAt = displaySignatureTime(body.displaySignedAt); } catch (error) { return reply({ error: error.message }, 400); }
    const correctedAt = new Date().toISOString(), previousDisplaySignedAt = signature.displaySignedAt || null;
    const correction = { role, previousDisplaySignedAt, newDisplaySignedAt: displaySignedAt, correctedAt, correctedBy: auth.session.operator || null };
    const nextSignature = { ...signature }; if (displaySignedAt) nextSignature.displaySignedAt = displaySignedAt; else delete nextSignature.displaySignedAt;
    const current = record.dossier[stage];
    record.dossier[stage] = { ...current, signatures: { ...current.signatures, [role]: nextSignature }, signatureDisplayCorrections: [...(Array.isArray(current.signatureDisplayCorrections) ? current.signatureDisplayCorrections : []), correction].slice(-50) };
    await write(env, record);
    await recordAuditEvent(env, { actor: auth.session.operator, eventType: "inspection_signature_display_time_corrected", entityType: "standalone_inspection", entityId: record.id, metadata: correction });
    return reply({ inspection: record });
  }
  if (body.action === "associate") {
    const contract = body.linkedContractId ? await getReservation(env, text(body.linkedContractId, 100)) : null;
    if (body.linkedContractId && !contract) return reply({ error: "Contrat associé introuvable" }, 404);
    if (record.status === "finalized" && record.linkedContractId !== (contract && contract.id)) return reply({ error: "État des lieux finalisé : confirmez une correction dans le dossier avant de modifier l’association" }, 409);
    record.linkedContractId = contract && contract.id || null; record.linkedContractNumero = contract && contract.contractNumero || null; await write(env, record); return reply({ inspection: record });
  }
  if (body.action === "note") { record.internalNote = text(body.internalNote, 2000); await write(env, record); return reply({ inspection: record }); }
  return reply({ error: "Action inconnue" }, 400);
}
async function handleStandaloneInspections(request, env) {
  const id = request.method === "POST" ? requestId(request) : null;
  const startedAt = Date.now();
  if (id) await writeDiagnosticBreadcrumb(env, id, startedAt, "a", { bodyBytes: requestBodyBytes(request) });
  try { return await handleStandaloneInspectionsRequest(request, env, id); }
  catch (error) {
    const status = Number.isInteger(error && error.status) ? error.status : 500;
    console.error("standalone_inspections_error", { requestId: id, method: request.method, pathname: new URL(request.url).pathname, status, name: error && error.name || "Error" });
    return json({ error: status >= 500 ? "Erreur serveur lors du traitement de l’état des lieux" : error && error.message || "Requête invalide" }, status, id);
  }
}
module.exports = { handleStandaloneInspections, PREFIX, DIAGNOSTIC_PREFIX, readStandaloneInspection: read, writeStandaloneInspection: write };
