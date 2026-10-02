// Consultation des états des lieux historiques : lecture seule, réservée à
// une session agence. Les contrats manuels restent dans KV et les locations
// historiques dans D1 ; cet endpoint ne les migre ni ne les réécrit.

const { requireAgencySession } = require("../lib/agency-auth.js");
const { getReservation } = require("../lib/reservation-store.js");
const { getRentalById } = require("../lib/rentals.js");
const { getClientById } = require("../lib/clients.js");
const { getVehiculeParId } = require("../../js/data.js");

const LEGACY_ID = /^(?:res_[a-f0-9]{32}|rnt_[A-Za-z0-9_-]{1,100})$/;

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

function splitDateTime(value) {
  const match = /^(\d{4}-\d{2}-\d{2})(?:T|\s)(\d{2}:\d{2})/.exec(text(value));
  return match ? { date: match[1], heure: match[2] } : { date: "", heure: "" };
}

function stagePhotos(photos, mode) {
  if (!Array.isArray(photos)) return [];
  const modeLabel = mode === "depart" ? "départ" : "retour";
  return photos.filter((photo) => text(photo && photo.label).toLowerCase().includes(modeLabel));
}

function manualStage(record, mode) {
  const state = mode === "depart" ? record.etatDepart || {} : record.etatRetour || {};
  const km = mode === "depart" ? record.kmDepart : record.kmRetour;
  return {
    mode,
    dateHeure: text(state.dateHeure),
    km: km === undefined || km === null ? "" : String(km),
    carburant: state.carburant === undefined || state.carburant === null ? "" : String(state.carburant),
    proprete: text(state.proprete),
    accessoires: text(state.clesAccessoires || state.accessoires),
    remarques: text(state.observations || state.dommages),
    marques: Array.isArray(state.marks) ? state.marks : [],
    photos: stagePhotos(record.photosEtatDesLieux, mode)
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
    retour: manualStage(record, "retour")
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

module.exports = { handleLegacyInspectionAgency, manualView };
