// Consultation agence d'un PDF EDL exact : aucune clé R2 fournie par le client.
const { requireAgencySession } = require("../lib/agency-auth.js");
const { getReservation } = require("../lib/reservation-store.js");
const { getInspectionRevision } = require("../lib/inspection-revisions.js");
const ID = /^res_[a-f0-9]{32}$/;
function json(status, error) { return new Response(JSON.stringify({ error }), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }); }
async function handleAgencyInspectionPdf(request, env) {
  if (request.method !== "GET") return json(405,"Méthode non autorisée");
  const auth=await requireAgencySession(request,env); if(auth.error)return auth.error;
  if(!env.DOCUMENTS_BUCKET)return json(503,"Stockage documentaire indisponible");
  const url=new URL(request.url),id=url.searchParams.get("id")||"",stage=url.searchParams.get("stage"),revision=Number(url.searchParams.get("revision"));
  if(!ID.test(id)||!["depart","retour"].includes(stage)||!Number.isInteger(revision)||revision<1)return json(400,"Révision EDL invalide");
  const record=await getReservation(env,id);if(!record)return json(404,"PDF de cette révision introuvable");
  const dossier=record.contractDossier||{}, item=getInspectionRevision(record,stage,dossier[stage],dossier.media&&dossier.media[stage],null,revision);
  if(!item||!item.pdfKey)return json(404,"PDF de cette révision introuvable");
  const object=await env.DOCUMENTS_BUCKET.get(item.pdfKey);if(!object)return json(404,"PDF de cette révision introuvable");
  const name=`${String(record.contractNumero||record.id).replace(/[^A-Za-z0-9_-]/g,"_")}-EDL-${stage.toUpperCase()}-V${revision}.pdf`;
  return new Response(object.body,{headers:{"Content-Type":"application/pdf","Content-Disposition":`inline; filename="${name}"`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
}
module.exports={handleAgencyInspectionPdf};
