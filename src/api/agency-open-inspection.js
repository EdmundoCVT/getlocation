// Redirection de consultation d'un EDL lié. Le lien reste un vrai GET
// ouvrable dans un nouvel onglet, mais la session agence est vérifiée avant
// d'émettre le jeton éphémère, qui demeure uniquement dans le fragment URL.
const { requireAgencySession } = require("../lib/agency-auth.js");
const { getReservation, saveContractAgencyAccessIndex, setContractAgencyAccess } = require("../lib/reservation-store.js");
const { issueContractAgencyAccess } = require("../lib/contract-dossier-token.js");
const { getInspectionRevision } = require("../lib/inspection-revisions.js");
const ID = /^res_[a-f0-9]{32}$/;

async function handleAgencyOpenInspection(request, env) {
  if (request.method !== "GET") return new Response("Méthode non autorisée", { status: 405 });
  const auth = await requireAgencySession(request, env); if (auth.error) return auth.error;
  const url = new URL(request.url), id = url.searchParams.get("id") || "", stage = url.searchParams.get("stage"), revision = Number(url.searchParams.get("revision"));
  if (!ID.test(id) || !["depart", "retour"].includes(stage) || !Number.isInteger(revision) || revision < 1) return new Response("Révision EDL invalide", { status: 400 });
  const reservation = await getReservation(env, id);
  if (!reservation || !["paid", "manual_contract", "contract_version"].includes(reservation.status)) return new Response("État des lieux introuvable", { status: 404 });
  const dossier = reservation.contractDossier || {};
  if (!getInspectionRevision(reservation, stage, dossier[stage], dossier.media && dossier.media[stage], null, revision)) return new Response("Révision EDL introuvable", { status: 404 });
  const access = await issueContractAgencyAccess(env, reservation, reservation.status === "manual_contract" ? new Date().toISOString() : reservation.paidAt || reservation.createdAt);
  if (!access || !(await saveContractAgencyAccessIndex(env, id, access.stored.tokenHash, access.stored.expiresAt)) || !(await setContractAgencyAccess(env, id, access.stored, reservation.status === "manual_contract"))) return new Response("Lien agence indisponible", { status: 503 });
  const origin = env.SITE_URL || url.origin;
  return Response.redirect(`${origin}/etat-des-lieux.html?mode=${encodeURIComponent(stage)}&revision=${revision}#agencyToken=${access.token}`, 302);
}
module.exports = { handleAgencyOpenInspection };
