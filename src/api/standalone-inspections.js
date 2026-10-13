// États des lieux autonomes. Ils sont volontairement séparés des réservations:
// aucun faux contrat ni jeton client n'est créé pour une inspection agence.
const { requireAgencySession } = require("../lib/agency-auth.js");
const { listReservations, getReservation } = require("../lib/reservation-store.js");
const { validateConditionReport } = require("../lib/validate-contract-dossier.js");
const { recordAuditEvent } = require("../lib/audit-log.js");
const { listInspectionRevisions, createInspectionRevision, updateInspectionRevisionDraft, finalizeInspectionRevision } = require("../lib/inspection-revisions.js");
const { finalizeRevisionWithPdf } = require("../lib/finalize-inspection-revision.js");

const PREFIX = "standalone-inspection:";
const ID = /^edl_[a-f0-9-]{16,64}$/;
function json(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }); }
function text(value, max = 300) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
function safeMode(value) { return value === "retour" ? "retour" : value === "depart" ? "depart" : null; }
function displaySignatureTime(value) { if (value === null || value === undefined || value === "") return null; if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) || Number.isNaN(new Date(value + ":00Z").getTime())) throw new Error("Date et heure affichées invalides"); return value; }
function preserveInspectionSignatures(report, previous) { ["client", "agence"].forEach(role => { const before = previous && previous.signatures && previous.signatures[role], next = report.signatures && report.signatures[role]; if (before && next && before.signedAt && before.imageDataUrl === next.imageDataUrl) report.signatures[role] = { ...next, signedAt: before.signedAt, ...(before.displaySignedAt ? { displaySignedAt: before.displaySignedAt } : {}) }; }); return report; }
function publicItem(record) {
  return { id: record.id, mode: record.mode, client: record.client || {}, vehicule: record.vehicule || {}, linkedContractId: record.linkedContractId || null, linkedContractNumero: record.linkedContractNumero || null, dateHeure: record.dossier && record.dossier[record.mode] && record.dossier[record.mode].dateHeure || record.createdAt, status: record.status || "draft", pdf: record.pdf || null, archivedAt: record.archivedAt || null, archivedBy: record.archivedBy || null, updatedAt: record.updatedAt };
}
async function read(env, id) { const raw = ID.test(id || "") && await env.RESERVATIONS_KV.get(PREFIX + id); return raw ? JSON.parse(raw) : null; }
async function write(env, record) { record.updatedAt = new Date().toISOString(); await env.RESERVATIONS_KV.put(PREFIX + record.id, JSON.stringify(record)); return record; }
function createId() { return "edl_" + crypto.randomUUID(); }
async function contracts(env, needle) {
  const q = text(needle, 100).toLocaleLowerCase("fr-FR");
  const records = await listReservations(env);
  return records.filter(r => r && ["paid", "manual_contract", "contract_version"].includes(r.status)).filter(r => !q || [r.contractNumero, r.id, r.nom, r.prenom, r.immat, r.immatriculation, r.conducteur && r.conducteur.nom, r.conducteur && r.conducteur.prenom].join(" ").toLocaleLowerCase("fr-FR").includes(q)).slice(0, 30).map(r => ({ id: r.id, contractNumero: r.contractNumero || null, client: r.conducteur ? { prenom: r.conducteur.prenom || "", nom: r.conducteur.nom || "" } : { prenom: r.prenom || "", nom: r.nom || "" }, vehiculeId: r.vehiculeId || "", immatriculation: r.immatriculation || r.immat || "" }));
}
async function handleStandaloneInspections(request, env) {
  const auth = await requireAgencySession(request, env, request.method === "GET" ? {} : { requireCsrf: true, requireOrigin: true });
  if (auth.error) return auth.error;
  const url = new URL(request.url);
  if (request.method === "GET") {
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
  const body = await request.json().catch(() => null); if (!body || typeof body !== "object") return json({ error: "Requête invalide" }, 400);
  if (body.action === "create") {
    const mode = safeMode(body.mode); if (!mode) return json({ error: "Type d’état des lieux invalide" }, 400);
    const now = new Date().toISOString(), id = createId();
    const record = { id, kind: "standalone-inspection", mode, client: { prenom: text(body.client && body.client.prenom, 100), nom: text(body.client && body.client.nom, 100), telephone: text(body.client && body.client.telephone, 40) }, vehicule: { nom: text(body.vehicule && body.vehicule.nom, 150), immatriculation: text(body.vehicule && body.vehicule.immatriculation, 40), vehicleFamily: body.vehicule && body.vehicule.vehicleFamily === "utility" ? "utility" : "car" }, linkedContractId: null, linkedContractNumero: null, internalNote: text(body.internalNote, 2000), dossier: { status: "draft", depart: null, retour: null, media: { depart: [], retour: [] } }, inspectionRevisions: { [mode]: [{ revision: 1, status: "draft", snapshot: null, media: [], pdfKey: null, finalizedAt: null, createdAt: now, createdBy: auth.session.operator || null, basedOnRevision: null }] }, status: "draft", createdAt: now, updatedAt: now, createdBy: auth.session.operator || null };
    if (body.linkedContractId) { const contract = await getReservation(env, text(body.linkedContractId, 100)); if (!contract) return json({ error: "Contrat associé introuvable" }, 404); record.linkedContractId = contract.id; record.linkedContractNumero = contract.contractNumero || null; }
    await write(env, record); return json({ inspection: record }, 201);
  }
  const record = await read(env, body.id); if (!record) return json({ error: "État des lieux introuvable" }, 404);
  if (body.action === "set-archived") {
    const archived = body.archived === true;
    const now = new Date().toISOString();
    if (archived) { record.archivedAt = now; record.archivedBy = auth.session.operator || null; }
    else { delete record.archivedAt; delete record.archivedBy; }
    await write(env, record);
    await recordAuditEvent(env, { actor: auth.session.operator, eventType: archived ? "inspection_archived" : "inspection_restored", entityType: "standalone_inspection", entityId: record.id, metadata: archived ? { archivedAt: now, archivedBy: auth.session.operator || null } : { restoredAt: now, restoredBy: auth.session.operator || null } });
    return json({ inspection: record, archived });
  }
  if (body.action === "create-revision") {
    const stage = safeMode(body.stage || record.mode); if (!stage) return json({ error: "Type d’état des lieux invalide" }, 400);
    try {
      const created = createInspectionRevision(record, stage, record.dossier && record.dossier[stage], record.dossier && record.dossier.media && record.dossier.media[stage], auth.session.operator, body.baseRevision);
      record.inspectionRevisions = { ...(record.inspectionRevisions || {}), [stage]: created.revisions };
      await write(env, record);
      await recordAuditEvent(env, { actor: auth.session.operator, eventType: "inspection_revision_created", entityType: "standalone_inspection", entityId: record.id, metadata: { stage, basedOnRevision: created.revision.basedOnRevision, revision: created.revision.revision } });
      return json({ inspection: record, revision: created.revision }, 201);
    } catch (error) { return json({ error: error.message || "Révision impossible" }, 409); }
  }
  if (body.action === "update-stage") {
    const stage = safeMode(record.mode), revision = Number(body.revision), previous = Number.isInteger(revision) ? listInspectionRevisions(record, stage, record.dossier[stage], record.dossier.media && record.dossier.media[stage], record.createdBy).find(item => item.revision === revision) : record.dossier[stage], report = preserveInspectionSignatures(validateConditionReport(body.stage || {}), previous && previous.snapshot || previous);
    if (Number.isInteger(revision)) {
      try {
        const result = body.finalize ? await finalizeRevisionWithPdf({ env, record, stage, revision, snapshot: report, fallbackSnapshot: record.dossier[stage], fallbackMedia: record.dossier.media && record.dossier.media[stage], actor: auth.session.operator, standalone: true }) : updateInspectionRevisionDraft(record, stage, record.dossier[stage], record.dossier.media && record.dossier.media[stage], auth.session.operator, revision, report);
        record.inspectionRevisions = result.inspectionRevisions; record.status = body.finalize ? "finalized" : record.status; await write(env, record);
        await recordAuditEvent(env, { actor: auth.session.operator, eventType: body.finalize ? "inspection_revision_finalized" : "inspection_revision_updated", entityType: "standalone_inspection", entityId: record.id, metadata: { stage, revision } });
        return json({ inspection: record, revision: result.revision });
      } catch (error) { return json({ error: error.message }, error.status || 409); }
    }
    record.dossier[stage] = { ...report, completedAt: record.dossier[stage] && record.dossier[stage].completedAt || new Date().toISOString(), finalizedAt: body.finalize ? record.dossier[stage] && record.dossier[stage].finalizedAt || new Date().toISOString() : record.dossier[stage] && record.dossier[stage].finalizedAt || null };
    record.status = body.finalize ? "finalized" : (record.status === "finalized" ? "finalized" : "draft"); await write(env, record); return json({ inspection: record });
  }
  if (body.action === "update-signature-display-time") {
    const stage = safeMode(record.mode), role = body.role === "client" || body.role === "agence" ? body.role : null;
    const revision = Number(body.revision);
    if (Number.isInteger(revision)) {
      const current = listInspectionRevisions(record, stage, record.dossier[stage], record.dossier.media && record.dossier.media[stage], record.createdBy).find(item => item.revision === revision);
      const signature = current && current.snapshot && current.snapshot.signatures && current.snapshot.signatures[role];
      if (!signature || !signature.signedAt) return json({ error: "Signature introuvable" }, 404);
      try { const displaySignedAt = displaySignatureTime(body.displaySignedAt); const snapshot = { ...current.snapshot, signatures: { ...current.snapshot.signatures, [role]: { ...signature, ...(displaySignedAt ? { displaySignedAt } : {}) } } }; if (!displaySignedAt) delete snapshot.signatures[role].displaySignedAt; const saved = updateInspectionRevisionDraft(record, stage, record.dossier[stage], record.dossier.media && record.dossier.media[stage], auth.session.operator, revision, snapshot); record.inspectionRevisions = saved.inspectionRevisions; await write(env, record); return json({ inspection: record, revision: saved.revision }); } catch (error) { return json({ error: error.message }, error.status || 409); }
    }
    const signature = stage && role && record.dossier[stage] && record.dossier[stage].signatures && record.dossier[stage].signatures[role];
    if (!signature || !signature.signedAt) return json({ error: "Signature introuvable" }, 404);
    let displaySignedAt;
    try { displaySignedAt = displaySignatureTime(body.displaySignedAt); } catch (error) { return json({ error: error.message }, 400); }
    const correctedAt = new Date().toISOString(), previousDisplaySignedAt = signature.displaySignedAt || null;
    const correction = { role, previousDisplaySignedAt, newDisplaySignedAt: displaySignedAt, correctedAt, correctedBy: auth.session.operator || null };
    const nextSignature = { ...signature }; if (displaySignedAt) nextSignature.displaySignedAt = displaySignedAt; else delete nextSignature.displaySignedAt;
    const current = record.dossier[stage];
    record.dossier[stage] = { ...current, signatures: { ...current.signatures, [role]: nextSignature }, signatureDisplayCorrections: [...(Array.isArray(current.signatureDisplayCorrections) ? current.signatureDisplayCorrections : []), correction].slice(-50) };
    await write(env, record);
    await recordAuditEvent(env, { actor: auth.session.operator, eventType: "inspection_signature_display_time_corrected", entityType: "standalone_inspection", entityId: record.id, metadata: correction });
    return json({ inspection: record });
  }
  if (body.action === "associate") {
    const contract = body.linkedContractId ? await getReservation(env, text(body.linkedContractId, 100)) : null;
    if (body.linkedContractId && !contract) return json({ error: "Contrat associé introuvable" }, 404);
    if (record.status === "finalized" && record.linkedContractId !== (contract && contract.id)) return json({ error: "État des lieux finalisé : confirmez une correction dans le dossier avant de modifier l’association" }, 409);
    record.linkedContractId = contract && contract.id || null; record.linkedContractNumero = contract && contract.contractNumero || null; await write(env, record); return json({ inspection: record });
  }
  if (body.action === "note") { record.internalNote = text(body.internalNote, 2000); await write(env, record); return json({ inspection: record }); }
  return json({ error: "Action inconnue" }, 400);
}
module.exports = { handleStandaloneInspections, PREFIX, readStandaloneInspection: read, writeStandaloneInspection: write };
