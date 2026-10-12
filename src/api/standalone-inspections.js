// États des lieux autonomes. Ils sont volontairement séparés des réservations:
// aucun faux contrat ni jeton client n'est créé pour une inspection agence.
const { requireAgencySession } = require("../lib/agency-auth.js");
const { listReservations, getReservation } = require("../lib/reservation-store.js");
const { validateConditionReport } = require("../lib/validate-contract-dossier.js");

const PREFIX = "standalone-inspection:";
const ID = /^edl_[a-f0-9-]{16,64}$/;
function json(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }); }
function text(value, max = 300) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
function safeMode(value) { return value === "retour" ? "retour" : value === "depart" ? "depart" : null; }
function publicItem(record) {
  return { id: record.id, mode: record.mode, client: record.client || {}, vehicule: record.vehicule || {}, linkedContractId: record.linkedContractId || null, linkedContractNumero: record.linkedContractNumero || null, dateHeure: record.dossier && record.dossier[record.mode] && record.dossier[record.mode].dateHeure || record.createdAt, status: record.status || "draft", pdf: record.pdf || null, updatedAt: record.updatedAt };
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
    if (id) { const inspection = await read(env, id); return inspection ? json({ inspection }) : json({ error: "État des lieux introuvable" }, 404); }
    const keys = await env.RESERVATIONS_KV.list({ prefix: PREFIX, limit: 200 });
    const inspections = (await Promise.all(keys.keys.map(k => env.RESERVATIONS_KV.get(k.name)))).filter(Boolean).map(JSON.parse).map(publicItem).sort((a,b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    return json({ inspections });
  }
  if (request.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);
  const body = await request.json().catch(() => null); if (!body || typeof body !== "object") return json({ error: "Requête invalide" }, 400);
  if (body.action === "create") {
    const mode = safeMode(body.mode); if (!mode) return json({ error: "Type d’état des lieux invalide" }, 400);
    const now = new Date().toISOString(), id = createId();
    const record = { id, kind: "standalone-inspection", mode, client: { prenom: text(body.client && body.client.prenom, 100), nom: text(body.client && body.client.nom, 100), telephone: text(body.client && body.client.telephone, 40) }, vehicule: { nom: text(body.vehicule && body.vehicule.nom, 150), immatriculation: text(body.vehicule && body.vehicule.immatriculation, 40), vehicleFamily: body.vehicule && body.vehicule.vehicleFamily === "utility" ? "utility" : "car" }, linkedContractId: null, linkedContractNumero: null, internalNote: text(body.internalNote, 2000), dossier: { status: "draft", depart: null, retour: null, media: { depart: [], retour: [] } }, status: "draft", createdAt: now, updatedAt: now, createdBy: auth.session.operator || null };
    if (body.linkedContractId) { const contract = await getReservation(env, text(body.linkedContractId, 100)); if (!contract) return json({ error: "Contrat associé introuvable" }, 404); record.linkedContractId = contract.id; record.linkedContractNumero = contract.contractNumero || null; }
    await write(env, record); return json({ inspection: record }, 201);
  }
  const record = await read(env, body.id); if (!record) return json({ error: "État des lieux introuvable" }, 404);
  if (body.action === "update-stage") {
    const stage = safeMode(record.mode), report = validateConditionReport(body.stage || {});
    record.dossier[stage] = { ...report, completedAt: record.dossier[stage] && record.dossier[stage].completedAt || new Date().toISOString() };
    record.status = body.finalize ? "finalized" : "draft"; await write(env, record); return json({ inspection: record });
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
