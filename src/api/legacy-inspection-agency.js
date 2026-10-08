// Consultation des états des lieux historiques : lecture seule, réservée à
// une session agence. Les contrats manuels restent dans KV et les locations
// historiques dans D1 ; cet endpoint ne les migre ni ne les réécrit.

const { requireAgencySession } = require("../lib/agency-auth.js");
const { getReservation } = require("../lib/reservation-store.js");
const { getRentalById } = require("../lib/rentals.js");
const { getClientById } = require("../lib/clients.js");
const { getVehiculeParId } = require("../../js/data.js");

const LEGACY_ID = /^(?:res_[a-f0-9]{32}|rnt_[A-Za-z0-9_-]{1,100})$/;
// Investigation forensique temporaire, volontairement limitée au seul
// dossier demandé : cette route ne doit pas devenir une exportation générale
// de contrats manuels.
const ZVEZDAN_LEGACY_ID = "res_f0e1a8457204d89acdc4542491ffcb53";

function headers(request, env) {
  const origins = new Set(["https://getlocation.fr", "https://www.getlocation.fr", new URL(request.url).origin]);
  if (env.ALLOWED_ORIGINS) env.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean).forEach((origin) => origins.add(origin));
  const origin = request.headers.get("origin");
  const result = { "Content-Type": "application/json", "Cache-Control": "no-store", Vary: "Origin" };
  if (origin && origins.has(origin)) result["Access-Control-Allow-Origin"] = origin;
  return result;
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function firstText(...values) {
  const value = firstValue(...values);
  return value === undefined ? "" : text(value);
}

function firstArray(...values) {
  return values.find((value) => Array.isArray(value) && value.length) || [];
}

function splitDateTime(value) {
  const match = /^(\d{4}-\d{2}-\d{2})(?:T|\s)(\d{2}:\d{2})/.exec(text(value));
  return match ? { date: match[1], heure: match[2] } : { date: "", heure: "" };
}

function stagePhotos(photos, mode) {
  if (!Array.isArray(photos)) return [];
  const modeLabel = mode === "depart" ? "départ" : "retour";
  return photos.filter((photo) => text(photo && photo.label).toLowerCase().includes(modeLabel));
}

function legacyMedia(media, mode) {
  const list = media && Array.isArray(media[mode]) ? media[mode] : [];
  return list.filter((photo) => photo && typeof photo.key === "string").map((photo) => ({
    key: photo.key,
    slot: text(photo.slot),
    contentType: text(photo.contentType),
    size: Number.isFinite(photo.size) ? photo.size : null,
    createdAt: text(photo.createdAt),
    capturedAt: text(photo.capturedAt)
  }));
}

function combinePhotos(manualPhotos, mediaPhotos) {
  const seen = new Set();
  return [...manualPhotos, ...mediaPhotos].filter((photo) => {
    const identity = photo && (photo.key || photo.dataUrl || `${photo.label || ""}:${photo.createdAt || photo.capturedAt || ""}`);
    if (!identity || seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function manualStage(record, mode) {
  const state = mode === "depart" ? record.etatDepart || {} : record.etatRetour || {};
  const dossier = record.contractDossier && typeof record.contractDossier === "object" ? record.contractDossier : {};
  const dossierState = dossier[mode] && typeof dossier[mode] === "object" ? dossier[mode] : {};
  const km = mode === "depart" ? record.kmDepart : record.kmRetour;
  return {
    mode,
    dateHeure: firstText(state.dateHeure, dossierState.dateHeure),
    km: String(firstValue(state.km, dossierState.km, km) ?? ""),
    carburant: String(firstValue(state.carburant, dossierState.carburant) ?? ""),
    proprete: firstText(state.proprete, dossierState.proprete),
    cles: String(firstValue(state.cles, dossierState.cles) ?? ""),
    accessoires: firstText(state.clesAccessoires, state.accessoires, dossierState.clesAccessoires, dossierState.accessoires),
    remarques: firstText(state.observations, state.dommages, dossierState.observations, dossierState.dommages),
    agent: firstText(state.agent, dossierState.agent),
    clientSigne: firstText(state.clientSigne, dossierState.clientSigne),
    agenceSigne: firstText(state.agenceSigne, dossierState.agenceSigne),
    photosRef: firstText(state.photosRef, dossierState.photosRef),
    marques: firstArray(state.marks, dossierState.marks),
    photos: combinePhotos(stagePhotos(record.photosEtatDesLieux, mode), legacyMedia(dossier.media, mode))
  };
}

function manualView(record) {
  const vehicle = getVehiculeParId(record.vehiculeId);
  const start = splitDateTime(record.depart);
  const end = splitDateTime(record.retour);
  return {
    source: "manual-contract",
    id: record.id,
    contractNumero: record.contractNumero || "",
    client: { prenom: text(record.prenom), nom: text(record.nom) },
    vehicule: vehicle ? vehicle.nom : text(record.vehiculeId),
    immatriculation: text(record.immatriculation || record.immat || (vehicle && vehicle.immatriculation)),
    dateDebut: start.date,
    heureDebut: start.heure,
    dateFin: end.date,
    heureFin: end.heure,
    depart: manualStage(record, "depart"),
    retour: manualStage(record, "retour"),
    contractSignature: record.contractDossier && record.contractDossier.signature
      ? {
          signedAt: text(record.contractDossier.signature.signedAt),
          signatureId: text(record.contractDossier.signature.signatureId),
          imageDataUrl: text(record.contractDossier.signature.imageDataUrl)
        }
      : null
  };
}

async function d1View(env, rental) {
  const vehicle = getVehiculeParId(rental.vehiculeId);
  const client = await getClientById(env, rental.clientId);
  const stage = (mode) => ({
    mode,
    dateHeure: "",
    km: mode === "depart" ? rental.kmDepart ?? "" : rental.kmRetour ?? "",
    carburant: "",
    proprete: "",
    accessoires: "",
    remarques: mode === "retour" ? text(rental.notes) : "",
    marques: [],
    photos: []
  });
  return {
    source: "rental-record",
    id: rental.id,
    contractNumero: rental.contractNumero || "",
    client: client ? { prenom: text(client.firstName), nom: text(client.lastName) } : null,
    vehicule: vehicle ? vehicle.nom : text(rental.vehiculeId),
    immatriculation: text(rental.immatriculation || (vehicle && vehicle.immatriculation)),
    dateDebut: rental.dateDebut,
    heureDebut: rental.heureDebut,
    dateFin: rental.dateFin,
    heureFin: rental.heureFin,
    depart: stage("depart"),
    retour: stage("retour")
  };
}

async function handleLegacyInspectionAgency(request, env) {
  const responseHeaders = headers(request, env);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...responseHeaders, "Access-Control-Allow-Methods": "GET, OPTIONS" } });
  if (request.method !== "GET") return new Response(JSON.stringify({ error: "Méthode non autorisée" }), { status: 405, headers: responseHeaders });

  const auth = await requireAgencySession(request, env);
  if (auth.error) return auth.error;
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!LEGACY_ID.test(id)) return new Response(JSON.stringify({ error: "Identifiant historique invalide" }), { status: 400, headers: responseHeaders });

  if (id.startsWith("res_")) {
    const record = await getReservation(env, id);
    if (!record || record.status !== "manual_contract") return new Response(JSON.stringify({ error: "État des lieux historique introuvable" }), { status: 404, headers: responseHeaders });
    return new Response(JSON.stringify({ inspection: manualView(record) }), { status: 200, headers: responseHeaders });
  }

  const rental = await getRentalById(env, id);
  if (!rental) return new Response(JSON.stringify({ error: "Location historique introuvable" }), { status: 404, headers: responseHeaders });
  return new Response(JSON.stringify({ inspection: await d1View(env, rental) }), { status: 200, headers: responseHeaders });
}

async function handleLegacyInspectionMedia(request, env) {
  const responseHeaders = headers(request, env);
  if (request.method !== "GET") return new Response(null, { status: 405, headers: responseHeaders });
  const auth = await requireAgencySession(request, env);
  if (auth.error) return auth.error;
  const url = new URL(request.url);
  const id = url.searchParams.get("id") || "";
  const key = url.searchParams.get("key") || "";
  if (!LEGACY_ID.test(id) || !id.startsWith("res_")) return new Response(null, { status: 400, headers: responseHeaders });
  const record = await getReservation(env, id);
  if (!record || record.status !== "manual_contract" || !env.DOCUMENTS_BUCKET) return new Response(null, { status: 404, headers: responseHeaders });
  const prefix = `inspection/${id}/`;
  if (!(key.startsWith(`${prefix}depart/`) || key.startsWith(`${prefix}retour/`))) return new Response(null, { status: 403, headers: responseHeaders });
  const media = record.contractDossier && record.contractDossier.media;
  const listed = ["depart", "retour"].some((stage) => Array.isArray(media && media[stage]) && media[stage].some((item) => item && item.key === key));
  if (!listed) return new Response(null, { status: 403, headers: responseHeaders });
  const object = await env.DOCUMENTS_BUCKET.get(key);
  if (!object) return new Response(null, { status: 404, headers: responseHeaders });
  const objectHeaders = new Headers(responseHeaders);
  object.writeHttpMetadata(objectHeaders);
  objectHeaders.set("Cache-Control", "private, no-store");
  objectHeaders.set("X-Content-Type-Options", "nosniff");
  return new Response(object.body, { status: 200, headers: objectHeaders });
}

function diagnosticStage(value) {
  const stage = value && typeof value === "object" ? value : null;
  const field = (key) => stage && Object.prototype.hasOwnProperty.call(stage, key) ? stage[key] : null;
  return {
    present: Boolean(stage),
    keys: stage ? Object.keys(stage).sort() : [],
    values: {
      dateHeure: field("dateHeure"), km: field("km"), carburant: field("carburant"), proprete: field("proprete"),
      dommages: field("dommages"), observations: field("observations"), photosRef: field("photosRef"), cles: field("cles"),
      clesAccessoires: field("clesAccessoires"), agent: field("agent"), clientSigne: field("clientSigne"), agenceSigne: field("agenceSigne"),
      marks: Array.isArray(field("marks")) ? field("marks") : null
    }
  };
}

async function listR2Diagnostics(bucket, prefix) {
  if (!bucket) return { available: false, count: 0, objects: [] };
  const objects = [];
  let cursor;
  do {
    const page = await bucket.list({ prefix, cursor });
    (page.objects || []).forEach((object) => objects.push({
      key: object.key,
      size: Number.isFinite(object.size) ? object.size : null,
      uploaded: object.uploaded && typeof object.uploaded.toISOString === "function" ? object.uploaded.toISOString() : object.uploaded || null
    }));
    cursor = page.truncated ? page.cursor : null;
  } while (cursor);
  return { available: true, count: objects.length, objects };
}

async function handleLegacyInspectionDiagnostic(request, env) {
  const responseHeaders = headers(request, env);
  if (request.method !== "GET") return new Response(JSON.stringify({ error: "Méthode non autorisée" }), { status: 405, headers: responseHeaders });
  const auth = await requireAgencySession(request, env);
  if (auth.error) return auth.error;
  const record = await getReservation(env, ZVEZDAN_LEGACY_ID);
  if (!record || record.status !== "manual_contract") return new Response(JSON.stringify({ error: "Dossier historique introuvable" }), { status: 404, headers: responseHeaders });
  const dossier = record.contractDossier && typeof record.contractDossier === "object" ? record.contractDossier : null;
  const media = dossier && dossier.media && typeof dossier.media === "object" ? dossier.media : null;
  const photoList = Array.isArray(record.photosEtatDesLieux) ? record.photosEtatDesLieux : [];
  const retourPhotos = photoList.filter((photo) => text(photo && photo.label).toLowerCase().includes("retour"));
  const prefix = `inspection/${ZVEZDAN_LEGACY_ID}/retour/`;
  const r2 = await listR2Diagnostics(env.DOCUMENTS_BUCKET, prefix);
  const field = (key) => Object.prototype.hasOwnProperty.call(record, key) ? record[key] : null;
  const body = {
    id: ZVEZDAN_LEGACY_ID,
    etatDepart: { present: Boolean(record.etatDepart) },
    etatRetour: diagnosticStage(record.etatRetour),
    kmRetour: field("kmRetour"),
    photosEtatDesLieux: { present: Array.isArray(record.photosEtatDesLieux), retourCount: retourPhotos.length },
    contractDossier: {
      present: Boolean(dossier),
      retour: diagnosticStage(dossier && dossier.retour),
      mediaRetour: { present: Array.isArray(media && media.retour), count: Array.isArray(media && media.retour) ? media.retour.length : 0 },
      signaturePresent: Boolean(dossier && dossier.signature)
    },
    r2Retour: r2
  };
  return new Response(JSON.stringify(body), { status: 200, headers: responseHeaders });
}

module.exports = { handleLegacyInspectionAgency, handleLegacyInspectionMedia, handleLegacyInspectionDiagnostic, manualView, ZVEZDAN_LEGACY_ID };
