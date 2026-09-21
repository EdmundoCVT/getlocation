// src/api/inspection-media.js
// Photos privées d'état des lieux (départ/retour), stockées dans R2.
// Accès réservé au jeton agence du dossier contrat. Aucune URL R2 publique.
const { resolveContractAgencyAccess } = require("./contract-dossier-agency.js");
const { updateContractDossier } = require("../lib/reservation-store.js");

const MAX_BYTES = 8 * 1024 * 1024;
const TYPES = new Set(["image/jpeg","image/png","image/webp","image/heic","image/heif"]);
const SLOTS = new Set(["avant","arriere","gauche","droite","avant-gauche","avant-droit","arriere-gauche","arriere-droit","interieur","jante","dommage","autre"]);

function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});}
function safeStage(v){return v==="depart"||v==="retour"?v:null;}
function safeSlot(v){return SLOTS.has(v)?v:null;}
function ext(type){if(type==="image/png")return"png";if(type==="image/webp")return"webp";if(type==="image/heic")return"heic";if(type==="image/heif")return"heif";return"jpg";}
function uid(){return crypto.randomUUID().replace(/-/g,"").slice(0,20);}

async function handleUpload(request,env,reservation){
  if(!env.DOCUMENTS_BUCKET)return json({error:"Stockage photo indisponible"},503);
  const form=await request.formData();
  const stage=safeStage(form.get("stage"));
  const slot=safeSlot(form.get("slot"));
  const file=form.get("file");
  if(!stage||!slot||!file||typeof file.arrayBuffer!=="function")return json({error:"Photo ou catégorie invalide"},400);
  if(!TYPES.has(file.type)||file.size<=0||file.size>MAX_BYTES)return json({error:"Format non accepté ou photo trop volumineuse (8 Mo max.)"},400);
  const key=`inspection/${reservation.id}/${stage}/${Date.now()}-${uid()}.${ext(file.type)}`;
  const bytes=await file.arrayBuffer();
  if(bytes.byteLength>MAX_BYTES)return json({error:"Photo trop volumineuse"},400);
  await env.DOCUMENTS_BUCKET.put(key,bytes,{httpMetadata:{contentType:file.type},customMetadata:{reservationId:reservation.id,stage,slot}});
  const existing=reservation.contractDossier||{status:"draft",fields:null,depart:null,retour:null,observations:""};
  const media=existing.media&&typeof existing.media==="object"?existing.media:{depart:[],retour:[]};
  const list=Array.isArray(media[stage])?media[stage].slice():[];
  const item={key,slot,contentType:file.type,size:bytes.byteLength,createdAt:new Date().toISOString()};
  list.push(item);
  // 30 photos max par phase, suffisant pour une inspection détaillée.
  media[stage]=list.slice(-30);
  const updated=await updateContractDossier(env,reservation.id,{contractDossier:{...existing,media,updatedAt:new Date().toISOString()}});
  if(!updated){await env.DOCUMENTS_BUCKET.delete(key);return json({error:"Réservation introuvable"},404);}
  return json({ok:true,item});
}

async function handleRead(request,env,reservation){
  if(!env.DOCUMENTS_BUCKET)return new Response(null,{status:503});
  const key=new URL(request.url).searchParams.get("key")||"";
  const prefix=`inspection/${reservation.id}/`;
  if(!key.startsWith(prefix))return new Response(null,{status:403});
  const obj=await env.DOCUMENTS_BUCKET.get(key);
  if(!obj)return new Response(null,{status:404});
  const headers=new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("Cache-Control","private, max-age=300");
  headers.set("X-Content-Type-Options","nosniff");
  return new Response(obj.body,{headers});
}

async function handleDelete(request,env,reservation){
  const body=await request.json().catch(()=>null);
  const key=body&&typeof body.key==="string"?body.key:"";
  const prefix=`inspection/${reservation.id}/`;
  if(!key.startsWith(prefix))return json({error:"Photo invalide"},400);
  const existing=reservation.contractDossier||{};
  const media=existing.media&&typeof existing.media==="object"?existing.media:{depart:[],retour:[]};
  for(const stage of ["depart","retour"]){
    media[stage]=(Array.isArray(media[stage])?media[stage]:[]).filter(x=>x&&x.key!==key);
  }
  await env.DOCUMENTS_BUCKET.delete(key);
  await updateContractDossier(env,reservation.id,{contractDossier:{...existing,media,updatedAt:new Date().toISOString()}});
  return json({ok:true});
}

async function handleInspectionMedia(request,env){
  const resolved=await resolveContractAgencyAccess(request,env);
  if(!resolved)return json({error:"Accès invalide ou expiré"},401);
  try{
    if(request.method==="POST")return handleUpload(request,env,resolved.reservation);
    if(request.method==="GET")return handleRead(request,env,resolved.reservation);
    if(request.method==="DELETE")return handleDelete(request,env,resolved.reservation);
    return json({error:"Méthode non autorisée"},405);
  }catch(e){return json({error:e&&e.message?e.message:"Erreur lors du traitement de la photo"},400);}
}
module.exports={handleInspectionMedia};
