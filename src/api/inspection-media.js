// src/api/inspection-media.js
// Photos privées d'état des lieux (départ/retour), stockées dans R2.
// Accès réservé au jeton agence du dossier contrat. Aucune URL R2 publique.
const { resolveContractAgencyAccess } = require("./contract-dossier-agency.js");
const { updateContractDossier } = require("../lib/reservation-store.js");
const { enqueueDriveSync } = require("../lib/google-drive-backup.js");
const { getRevisionMedia, setRevisionMedia, revisionMediaPrefix } = require("../lib/inspection-revisions.js");
const { storeInspectionMediaFiles, removeStoredFiles, mediaObjectKey } = require("../lib/inspection-media-files.js");

const SLOTS = new Set(["avant","arriere","gauche","droite","avant-gauche","avant-droit","arriere-gauche","arriere-droit","interieur","tableau-de-bord","jante","dommage","autre"]);

function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});}
function safeStage(v){return v==="depart"||v==="retour"?v:null;}
function safeSlot(v){return SLOTS.has(v)?v:null;}

// Date métier choisie par l'agence. Elle reste volontairement distincte de
// `createdAt`, qui est l'horodatage serveur de l'import et ne peut jamais être
// fourni ni modifié par le navigateur.
function safeCapturedAt(value){
  if(typeof value!=="string"||!value.trim())return null;
  const capturedAt=value.trim();
  const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(capturedAt);
  if(!match)throw new Error("Date/heure de prise de vue invalide");
  const [,year,month,day,hour,minute,second="0"]=match;
  const date=new Date(Number(year),Number(month)-1,Number(day),Number(hour),Number(minute),Number(second));
  if(date.getFullYear()!==Number(year)||date.getMonth()!==Number(month)-1||date.getDate()!==Number(day)||date.getHours()!==Number(hour)||date.getMinutes()!==Number(minute)||date.getSeconds()!==Number(second))throw new Error("Date/heure de prise de vue invalide");
  return capturedAt;
}

async function handleUpload(request,env,reservation){
  if(!env.DOCUMENTS_BUCKET)return json({error:"Stockage photo indisponible"},503);
  const form=await request.formData();
  const stage=safeStage(form.get("stage"));
  const revision=Number(form.get("revision"));
  const slot=safeSlot(form.get("slot"));
  const file=form.get("file");
  if(!stage||!Number.isInteger(revision)||revision<1||!slot||!file||typeof file.arrayBuffer!=="function")return json({error:"Photo, révision ou catégorie invalide"},400);
  const capturedAt=safeCapturedAt(form.get("capturedAt"));
  let stored;
  try { stored=await storeInspectionMediaFiles({env,prefix:revisionMediaPrefix(reservation.id,stage,revision,false),form,customMetadata:{reservationId:reservation.id,stage,revision,slot}}); }
  catch(error){return json({error:error.message},error.status||500);}
  const existing=reservation.contractDossier||{status:"draft",fields:null,depart:null,retour:null,observations:""};
  const item={...stored.item,slot,createdAt:new Date().toISOString(),...(capturedAt?{capturedAt}:{})};
  // 30 photos max par phase, suffisant pour une inspection détaillée.
  try { const media=getRevisionMedia(reservation,stage,existing[stage],existing.media&&existing.media[stage],null,revision); const saved=setRevisionMedia(reservation,stage,existing[stage],existing.media&&existing.media[stage],null,revision,[...(media||[]),item].slice(-30)); const updated={...reservation,inspectionRevisions:saved.inspectionRevisions,updatedAt:new Date().toISOString()}; await env.RESERVATIONS_KV.put(reservation.id,JSON.stringify(updated)); await enqueueDriveSync(env,updated.id).catch(()=>null); } catch(error) { await removeStoredFiles(env.DOCUMENTS_BUCKET,stored.keys); return json({error:error.message},error.status||409); }
  return json({ok:true,item});
}

async function handleCapturedAtUpdate(request,env,reservation){
  const body=await request.json().catch(()=>null);
  const key=body&&typeof body.key==="string"?body.key:"", revision=Number(body&&body.revision), stage=safeStage(body&&body.stage);
  const prefix=`inspection/${reservation.id}/`;
  if(!key.startsWith(prefix)||!stage||!Number.isInteger(revision))return json({error:"Photo ou révision invalide"},400);
  const capturedAt=safeCapturedAt(body&&body.capturedAt);
  if(!capturedAt)return json({error:"Date/heure de prise de vue requise"},400);
  const existing=reservation.contractDossier||{};
  const list=getRevisionMedia(reservation,stage,existing[stage],existing.media&&existing.media[stage],null,revision)||[];
  let updatedItem=null;
  const media=list.map((item)=>{
      if(!item||item.key!==key)return item;
      // Ne recopier que capturedAt : createdAt et les autres métadonnées de
      // l'upload restent strictement inchangées.
      updatedItem={...item,capturedAt};
      return updatedItem;
    });
  if(!updatedItem)return json({error:"Photo introuvable"},404);
  const saved=setRevisionMedia(reservation,stage,existing[stage],existing.media&&existing.media[stage],null,revision,media); await env.RESERVATIONS_KV.put(reservation.id,JSON.stringify({...reservation,inspectionRevisions:saved.inspectionRevisions,updatedAt:new Date().toISOString()})); await enqueueDriveSync(env,reservation.id).catch(()=>null);
  return json({ok:true,item:updatedItem});
}

async function handleRead(request,env,reservation){
  if(!env.DOCUMENTS_BUCKET)return new Response(null,{status:503});
  const url=new URL(request.url), key=url.searchParams.get("key")||"", variant=url.searchParams.get("variant")==="original"?"original":"optimized";
  const prefix=`inspection/${reservation.id}/`;
  if(!key.startsWith(prefix))return new Response(null,{status:403});
  const dossier=reservation.contractDossier||{}, objectKey=mediaObjectKey(reservation,key,variant,dossier.media);
  let obj=await env.DOCUMENTS_BUCKET.get(objectKey);
  if(!obj&&variant!=="original"&&objectKey!==key)obj=await env.DOCUMENTS_BUCKET.get(key);
  if(!obj)return new Response(null,{status:404});
  const headers=new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("Cache-Control","private, max-age=300");
  headers.set("X-Content-Type-Options","nosniff");
  return new Response(obj.body,{headers});
}

async function handleDelete(request,env,reservation){
  const body=await request.json().catch(()=>null);
  const key=body&&typeof body.key==="string"?body.key:"", revision=Number(body&&body.revision), stage=safeStage(body&&body.stage);
  const prefix=`inspection/${reservation.id}/`;
  if(!key.startsWith(prefix)||!stage||!Number.isInteger(revision))return json({error:"Photo ou révision invalide"},400);
  const existing=reservation.contractDossier||{};
  const media=getRevisionMedia(reservation,stage,existing[stage],existing.media&&existing.media[stage],null,revision)||[];
  const saved=setRevisionMedia(reservation,stage,existing[stage],existing.media&&existing.media[stage],null,revision,media.filter(x=>x&&x.key!==key));
  await env.RESERVATIONS_KV.put(reservation.id,JSON.stringify({...reservation,inspectionRevisions:saved.inspectionRevisions,updatedAt:new Date().toISOString()})); await enqueueDriveSync(env,reservation.id).catch(()=>null);
  return json({ok:true});
}

async function handleInspectionMedia(request,env){
  const resolved=await resolveContractAgencyAccess(request,env);
  if(!resolved)return json({error:"Accès invalide ou expiré"},401);
  try{
    if(request.method==="POST")return await handleUpload(request,env,resolved.reservation);
    if(request.method==="PATCH")return await handleCapturedAtUpdate(request,env,resolved.reservation);
    if(request.method==="GET")return await handleRead(request,env,resolved.reservation);
    if(request.method==="DELETE")return await handleDelete(request,env,resolved.reservation);
    return json({error:"Méthode non autorisée"},405);
  }catch(e){return json({error:e&&e.message?e.message:"Erreur lors du traitement de la photo"},e&&e.status||400);}
}
module.exports={handleInspectionMedia};
