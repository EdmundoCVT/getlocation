const { requireAgencySession } = require("../lib/agency-auth.js");
const { readStandaloneInspection } = require("./standalone-inspections.js");
const { getRevisionPdf } = require("../lib/inspection-revisions.js");
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});}
async function handleStandaloneInspectionPdf(request,env){
  const write=request.method === "POST"; const auth=await requireAgencySession(request,env,write?{requireCsrf:true,requireOrigin:true}:{});if(auth.error)return auth.error;
  if(!env.DOCUMENTS_BUCKET)return json({error:"Stockage indisponible"},503);
  if(request.method === "GET"){const url=new URL(request.url),id=url.searchParams.get("id")||"",revision=Number(url.searchParams.get("revision")),record=await readStandaloneInspection(env,id);const key=record&&Number.isInteger(revision)&&getRevisionPdf(record,record.mode,record.dossier[record.mode],record.dossier.media&&record.dossier.media[record.mode],record.createdBy,revision);if(!key)return json({error:"PDF non archivé"},404);const obj=await env.DOCUMENTS_BUCKET.get(key);if(!obj)return json({error:"PDF non archivé"},404);const h=new Headers({"Content-Type":"application/pdf","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"});return new Response(obj.body,{headers:h});}
  if(request.method!=="POST")return json({error:"Méthode non autorisée"},405);
  return json({error:"Le PDF officiel des états des lieux est généré uniquement lors de la finalisation."},409);
}
module.exports={handleStandaloneInspectionPdf};
