// Archivage administratif des EDL liés : aucune ressource documentaire n'est
// supprimée. La propriété appartient à la phase (départ ou retour), pas à une
// révision PDF, afin de préserver l'historique complet.
const { requireAgencySession } = require("../lib/agency-auth.js");
const { getReservation, reservationTtlSeconds } = require("../lib/reservation-store.js");
const { recordAuditEvent } = require("../lib/audit-log.js");

function json(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }); }

async function handleAgencyInspectionArchive(request, env) {
  if (request.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);
  const auth = await requireAgencySession(request, env, { requireCsrf: true, requireOrigin: true });
  if (auth.error) return auth.error;
  const body = await request.json().catch(() => null);
  const id = body && typeof body.id === "string" ? body.id : "";
  const stage = body && body.stage;
  if (!id || !["depart", "retour"].includes(stage) || typeof (body && body.archived) !== "boolean") return json({ error: "État des lieux ou action invalide" }, 400);
  const record = await getReservation(env, id);
  const now = new Date().toISOString(), archived = body.archived;
  // Certaines entrées historiques proviennent uniquement de D1 et n'ont pas
  // de dossier KV de réservation. Un petit marqueur administratif séparé
  // permet de les masquer/restaurer sans tenter de réécrire leur historique.
  if (!record) {
    const key = `inspection-archive:${id}:${stage}`;
    if (archived) await env.RESERVATIONS_KV.put(key, JSON.stringify({ archivedAt: now, archivedBy: auth.session.operator || null }));
    else await env.RESERVATIONS_KV.delete(key);
    await recordAuditEvent(env, { actor: auth.session.operator, eventType: archived ? "inspection_archived" : "inspection_restored", entityType: "inspection_history", entityId: id, metadata: archived ? { stage, archivedAt: now, archivedBy: auth.session.operator || null } : { stage, restoredAt: now, restoredBy: auth.session.operator || null } });
    return json({ ok: true, archived, archive: archived ? { archivedAt: now, archivedBy: auth.session.operator || null } : null });
  }
  const inspectionArchives = { ...(record.inspectionArchives || {}) };
  if (archived) inspectionArchives[stage] = { archivedAt: now, archivedBy: auth.session.operator || null };
  else delete inspectionArchives[stage];
  const updated = { ...record, inspectionArchives, updatedAt: now };
  await env.RESERVATIONS_KV.put(record.id, JSON.stringify(updated), record.status === "paid" ? { expirationTtl: reservationTtlSeconds(updated) } : undefined);
  await recordAuditEvent(env, { actor: auth.session.operator, eventType: archived ? "inspection_archived" : "inspection_restored", entityType: "contract", entityId: record.id, metadata: archived ? { stage, archivedAt: now, archivedBy: auth.session.operator || null } : { stage, restoredAt: now, restoredBy: auth.session.operator || null } });
  return json({ ok: true, archived, archive: inspectionArchives[stage] || null });
}

module.exports = { handleAgencyInspectionArchive };
