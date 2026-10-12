const { requireAgencySession } = require("../lib/agency-auth.js");
const { readStandaloneInspection, writeStandaloneInspection } = require("./standalone-inspections.js");
const MAX = 12 * 1024 * 1024;
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});}
async function handleStandaloneInspectionPdf(request,env){
  const write=request.method === "POST"; const auth=await requireAgencySession(request,env,write?{requireCsrf:true,requireOrigin:true}:{});if(auth.error)return auth.error;
  if(!env.DOCUMENTS_BUCKET)return json({error:"Stockage indisponible"},503);
  if(request.method === "GET"){const id=new URL(request.url).searchParams.get("id")||"", record=await readStandaloneInspection(env,id);if(!record||!record.pdf||!record.pdf.key)return json({error:"PDF non archivé"},404);const obj=await env.DOCUMENTS_BUCKET.get(record.pdf.key);if(!obj)return json({error:"PDF non archivé"},404);const h=new Headers({"Content-Type":"application/pdf","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"});return new Response(obj.body,{headers:h});}
  if(request.method!=="POST")return json({error:"Méthode non autorisée"},405);
  const form=await request.formData().catch(()=>null), id=form&&form.get("id"), file=form&&form.get("file"), record=await readStandaloneInspection(env,id);if(!record)return json({error:"État des lieux introuvable"},404);if(!file||file.type!=="application/pdf"||typeof file.arrayBuffer!=="function"||file.size<=0||file.size>MAX)return json({error:"PDF invalide"},400);
  const key=`inspection-standalone-pdf/${record.id}/edl-${record.mode}.pdf`;await env.DOCUMENTS_BUCKET.put(key,await file.arrayBuffer(),{httpMetadata:{contentType:"application/pdf"},customMetadata:{standaloneInspectionId:record.id,kind:`edl-${record.mode}`}});record.pdf={key,kind:`edl-${record.mode}`,size:file.size,uploadedAt:new Date().toISOString()};await writeStandaloneInspection(env,record);return json({ok:true,pendingDrive:false},202);
}
module.exports={handleStandaloneInspectionPdf};
