// Médias R2 privés des EDL indépendants; l'accès requiert toujours la session agence.
const { requireAgencySession } = require("../lib/agency-auth.js");
const { readStandaloneInspection, writeStandaloneInspection } = require("./standalone-inspections.js");
const { getRevisionMedia, setRevisionMedia, revisionMediaPrefix } = require("../lib/inspection-revisions.js");
const { storeInspectionMediaFiles, removeStoredFiles, mediaObjectKey } = require("../lib/inspection-media-files.js");

const SLOTS = new Set(["avant","arriere","gauche","droite","avant-gauche","avant-droit","arriere-gauche","arriere-droit","interieur","tableau-de-bord","jante","dommage","autre"]);
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});}
function stage(value){return value === "depart" || value === "retour" ? value : null;}
function capturedAt(value){return typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(value) ? value : null;}

async function authRecord(request,env,write){
  const auth=await requireAgencySession(request,env,write?{requireCsrf:true,requireOrigin:true}:{});
  if(auth.error)return{error:auth.error};
  const id=new URL(request.url).searchParams.get("id") || "";
  const record=await readStandaloneInspection(env,id);
  return record?{record}:{error:json({error:"État des lieux introuvable"},404)};
}

async function handleRead(request,env,record,prefix){
  const url=new URL(request.url), requestedKey=url.searchParams.get("key")||"", variant=url.searchParams.get("variant")==="original"?"original":"optimized";
  if(!requestedKey.startsWith(prefix))return new Response(null,{status:403});
  const objectKey=mediaObjectKey(record,requestedKey,variant,record.dossier&&record.dossier.media);
  let object=await env.DOCUMENTS_BUCKET.get(objectKey);
  if(!object&&variant!=="original"&&objectKey!==requestedKey)object=await env.DOCUMENTS_BUCKET.get(requestedKey);
  if(!object)return new Response(null,{status:404});
  const headers=new Headers(); object.writeHttpMetadata(headers); headers.set("Cache-Control","private, max-age=300"); headers.set("X-Content-Type-Options","nosniff");
  return new Response(object.body,{headers});
}

async function handleUpload(request,env,record){
  const form=await request.formData(), currentStage=stage(form.get("stage")), revision=Number(form.get("revision")||1), slot=form.get("slot"), file=form.get("file");
  if(currentStage!==record.mode||!Number.isInteger(revision)||revision<1||!SLOTS.has(slot)||!file||typeof file.arrayBuffer!=="function")return json({error:"Photo, révision ou catégorie invalide"},400);
  const rawPhotoDate=form.get("capturedAt"), photoDate=capturedAt(rawPhotoDate);
  if(typeof rawPhotoDate==="string"&&rawPhotoDate&&!photoDate)return json({error:"Date/heure de prise de vue invalide"},400);
  let stored;
  try{stored=await storeInspectionMediaFiles({env,prefix:revisionMediaPrefix(record.id,currentStage,revision,true),form,customMetadata:{standaloneInspectionId:record.id,stage:currentStage,revision,slot}});}
  catch(error){if(error.status)return json({error:error.message},error.status);throw error;}
  const item={...stored.item,slot,createdAt:new Date().toISOString(),...(photoDate?{capturedAt:photoDate}:{})};
  try{
    const media=getRevisionMedia(record,currentStage,record.dossier[currentStage],record.dossier.media&&record.dossier.media[currentStage],record.createdBy,revision);
    const saved=setRevisionMedia(record,currentStage,record.dossier[currentStage],record.dossier.media&&record.dossier.media[currentStage],record.createdBy,revision,[...(media||[]),item].slice(-30));
    record.inspectionRevisions=saved.inspectionRevisions; await writeStandaloneInspection(env,record); return json({ok:true,item});
  }catch(error){await removeStoredFiles(env.DOCUMENTS_BUCKET,stored.keys);return json({error:error.message},error.status||409);}
}

async function handlePatch(request,env,record,prefix){
  const body=await request.json().catch(()=>null),key=body&&body.key||"",value=capturedAt(body&&body.capturedAt),currentStage=stage(body&&body.stage),revision=Number(body&&body.revision);
  if(currentStage!==record.mode||!key.startsWith(prefix)||!Number.isInteger(revision)||revision<1||!value)return json({error:"Date, photo ou révision invalide"},400);
  try{
    const media=getRevisionMedia(record,currentStage,record.dossier[currentStage],record.dossier.media&&record.dossier.media[currentStage],record.createdBy,revision)||[];
    let item=null; const updated=media.map(entry=>entry&&entry.key===key?(item={...entry,capturedAt:value},item):entry);
    if(!item)return json({error:"Photo introuvable"},404);
    const saved=setRevisionMedia(record,currentStage,record.dossier[currentStage],record.dossier.media&&record.dossier.media[currentStage],record.createdBy,revision,updated);
    record.inspectionRevisions=saved.inspectionRevisions; await writeStandaloneInspection(env,record); return json({ok:true,item});
  }catch(error){return json({error:error.message},error.status||409);}
}

async function handleDelete(request,env,record,prefix){
  const body=await request.json().catch(()=>null),key=body&&body.key||"",currentStage=stage(body&&body.stage),revision=Number(body&&body.revision);
  if(currentStage!==record.mode||!key.startsWith(prefix)||!Number.isInteger(revision))return json({error:"Photo ou révision invalide"},400);
  try{
    const media=getRevisionMedia(record,currentStage,record.dossier[currentStage],record.dossier.media&&record.dossier.media[currentStage],record.createdBy,revision)||[];
    const saved=setRevisionMedia(record,currentStage,record.dossier[currentStage],record.dossier.media&&record.dossier.media[currentStage],record.createdBy,revision,media.filter(item=>item.key!==key));
    record.inspectionRevisions=saved.inspectionRevisions; await writeStandaloneInspection(env,record); return json({ok:true});
  }catch(error){return json({error:error.message},error.status||409);}
}

async function handleStandaloneInspectionMediaRequest(request,env){
  if(!env.DOCUMENTS_BUCKET)return json({error:"Stockage photo indisponible"},503);
  const resolved=await authRecord(request,env,request.method!=="GET"); if(resolved.error)return resolved.error;
  const record=resolved.record,prefix=`inspection-standalone/${record.id}/`;
  if(request.method==="GET")return handleRead(request,env,record,prefix);
  if(request.method==="POST")return handleUpload(request,env,record);
  if(request.method==="PATCH")return handlePatch(request,env,record,prefix);
  if(request.method==="DELETE")return handleDelete(request,env,record,prefix);
  return json({error:"Méthode non autorisée"},405);
}

async function handleStandaloneInspectionMedia(request,env){
  try{return await handleStandaloneInspectionMediaRequest(request,env);}
  catch(error){
    const status=Number.isInteger(error&&error.status)?error.status:500;
    console.error("standalone_inspection_media_error",{method:request.method,pathname:new URL(request.url).pathname,status,name:error&&error.name||"Error"});
    return json({error:status>=500?"Erreur serveur lors du traitement de la photo":error&&error.message||"Photo invalide"},status);
  }
}
module.exports={handleStandaloneInspectionMedia};
