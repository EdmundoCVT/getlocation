const { requireAgencySession } = require("../lib/agency-auth.js");
const { getReservation } = require("../lib/reservation-store.js");
const { readStandaloneInspection } = require("./standalone-inspections.js");
const { listInspectionRevisions } = require("../lib/inspection-revisions.js");
const { generateInspectionComparisonPdf } = require("../lib/inspection-comparison-pdf.js");
const { getVehiculeParId } = require("../../js/data.js");

function json(status, error) { return new Response(JSON.stringify({ error }), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }); }
function finalizedRevision(record, stage, requested) {
  const dossier = record.dossier || record.contractDossier || {};
  const revisions = listInspectionRevisions(record, stage, dossier[stage], dossier.media && dossier.media[stage], record.createdBy || null);
  if (requested !== null) return revisions.find(item => item.revision === requested && item.status === "finalized") || null;
  return revisions.slice().reverse().find(item => item.status === "finalized") || null;
}
function requestedRevision(url, name) {
  const raw = url.searchParams.get(name);
  if (raw === null || raw === "") return null;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : NaN;
}
function safeName(value) { return String(value || "EDL").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 100); }

async function handleAgencyInspectionComparison(request, env) {
  if (request.method !== "GET") return json(405, "Méthode non autorisée");
  const auth = await requireAgencySession(request, env); if (auth.error) return auth.error;
  if (!env.DOCUMENTS_BUCKET) return json(503, "Stockage documentaire indisponible");
  const url = new URL(request.url), source = url.searchParams.get("source") === "standalone" ? "standalone" : "linked";
  const departRequested = requestedRevision(url, "departRevision"), retourRequested = requestedRevision(url, "retourRevision");
  if (Number.isNaN(departRequested) || Number.isNaN(retourRequested)) return json(400, "Version de comparaison invalide");
  let departRecord, retourRecord, id, reference, vehicle, client;
  if (source === "standalone") {
    departRecord = await readStandaloneInspection(env, url.searchParams.get("departId") || "");
    retourRecord = await readStandaloneInspection(env, url.searchParams.get("retourId") || "");
    if (!departRecord || !retourRecord || departRecord.mode !== "depart" || retourRecord.mode !== "retour") return json(404, "Couple départ / retour introuvable");
    if (departRecord.pairedInspectionId !== retourRecord.id || retourRecord.pairedInspectionId !== departRecord.id) return json(409, "Ces états des lieux indépendants ne sont pas associés");
    id = `${departRecord.id}-${retourRecord.id}`;
    reference = `${departRecord.id} / ${retourRecord.id}`;
    vehicle = departRecord.vehicule || retourRecord.vehicule || {};
    client = departRecord.client || retourRecord.client || {};
  } else {
    const record = await getReservation(env, url.searchParams.get("id") || "");
    if (!record || !["paid", "manual_contract", "contract_version"].includes(record.status)) return json(404, "Dossier d’état des lieux introuvable");
    departRecord = retourRecord = record; id = record.id; reference = record.contractNumero || record.id;
    const catalogVehicle = record.vehiculeId ? getVehiculeParId(record.vehiculeId) : null;
    vehicle = { ...(catalogVehicle || {}), ...(record.vehicule && typeof record.vehicule === "object" ? record.vehicule : {}), immatriculation: record.immatriculation || record.immat || record.vehicule && record.vehicule.immatriculation || catalogVehicle && catalogVehicle.immatriculation || null };
    client = record.conducteur || record.client || { prenom: record.prenom, nom: record.nom };
  }
  const depart = finalizedRevision(departRecord, "depart", departRequested);
  const retour = finalizedRevision(retourRecord, "retour", retourRequested);
  if (!depart || !retour) return json(404, "Les deux versions finalisées demandées sont nécessaires");
  const bytes = await generateInspectionComparisonPdf({ env, id, reference, depart, retour, vehicle, rental: { reference, client } });
  const name = `${safeName(reference)}-COMPARATIF-DEPART-V${depart.revision}-RETOUR-V${retour.revision}.pdf`;
  return new Response(bytes, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${name}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "X-Inspection-Depart-Revision": String(depart.revision), "X-Inspection-Retour-Revision": String(retour.revision) } });
}

module.exports = { handleAgencyInspectionComparison };
