const { requireAgencySession } = require("../lib/agency-auth.js");
const { readStandaloneInspection, writeStandaloneInspection } = require("./standalone-inspections.js");
const { getRevisionPdf, setRevisionPdf, revisionPdfKey } = require("../lib/inspection-revisions.js");
const MAX = 12 * 1024 * 1024;
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});}
async function handleStandaloneInspectionPdf(request,env){
  const write=request.method === "POST"; const auth=await requireAgencySession(request,env,write?{requireCsrf:true,requireOrigin:true}:{});if(auth.error)return auth.error;
  if(!env.DOCUMENTS_BUCKET)return json({error:"Stockage indisponible"},503);
  if(request.method === "GET"){const url=new URL(request.url),id=url.searchParams.get("id")||"",revision=Number(url.searchParams.get("revision")),record=await readStandaloneInspection(env,id);const key=record&&Number.isInteger(revision)&&getRevisionPdf(record,record.mode,record.dossier[record.mode],record.dossier.media&&record.dossier.media[record.mode],record.createdBy,revision);if(!key)return json({error:"PDF non archivé"},404);const obj=await env.DOCUMENTS_BUCKET.get(key);if(!obj)return json({error:"PDF non archivé"},404);const h=new Headers({"Content-Type":"application/pdf","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"});return new Response(obj.body,{headers:h});}
  if(request.method!=="POST")return json({error:"Méthode non autorisée"},405);
  const form=await request.formData().catch(()=>null), id=form&&form.get("id"), revision=Number(form&&form.get("revision")), file=form&&form.get("file"), record=await readStandaloneInspection(env,id);if(!record)return json({error:"État des lieux introuvable"},404);if(!Number.isInteger(revision)||revision<1||!file||file.type!=="application/pdf"||typeof file.arrayBuffer!=="function"||file.size<=0||file.size>MAX)return json({error:"PDF ou révision invalide"},400);
  const key=revisionPdfKey(record.id,record.mode,revision,true);try { const saved=setRevisionPdf(record,record.mode,record.dossier[record.mode],record.dossier.media&&record.dossier.media[record.mode],record.createdBy,revision,key);await env.DOCUMENTS_BUCKET.put(key,await file.arrayBuffer(),{httpMetadata:{contentType:"application/pdf"},customMetadata:{standaloneInspectionId:record.id,kind:`edl-${record.mode}`,revision:String(revision)}});record.inspectionRevisions=saved.inspectionRevisions;await writeStandaloneInspection(env,record);return json({ok:true,pendingDrive:false,key},202); } catch(error) { return json({error:error.message},error.status||409); }
}
module.exports={handleStandaloneInspectionPdf};
