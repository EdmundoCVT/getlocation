// src/api/agency-rentals.js
//
// Locations de l'agence (Lot 2, voir CLAUDE.md) : création, modification en
// place, consultation par id ou par client, génération du numéro de
// contrat. Protégé par session agence — CSRF + origine stricte sur les
// écritures. created_by/updated_by proviennent de la session, jamais du
// corps de la requête.

const { requireAgencySession } = require("../lib/agency-auth.js");
const { createRental, updateRental, getRentalById, generateRentalContract, listRentalsByClient, listRentalsForInspection } = require("../lib/rentals.js");
const { getClientById } = require("../lib/clients.js");
const { recordAuditEvent } = require("../lib/audit-log.js");
const { attemptSync, getSyncStatusForRental } = require("../lib/sheet-sync-outbox.js");
const { listReservations } = require("../lib/reservation-store.js");
const { getVehiculeParId } = require("../../js/data.js");

function corsHeaders(request, env) {
  const origins = new Set(["https://getlocation.fr", "https://www.getlocation.fr", new URL(request.url).origin]);
  if (env.ALLOWED_ORIGINS) {
    env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean).forEach((o) => origins.add(o));
  }
  const originHeader = request.headers.get("origin");
  const headers = { "Content-Type": "application/json", Vary: "Origin", "Cache-Control": "no-store" };
  if (originHeader && origins.has(originHeader)) headers["Access-Control-Allow-Origin"] = originHeader;
  return headers;
}

const MAX_BODY_LEN = 20000;

function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function hasInspectionValue(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.length > 0;
  return Object.keys(value).length > 0;
}

function hasLegacyInspectionValue(value) {
  if (!value || typeof value !== "object") return false;
  return (Array.isArray(value.marks) && value.marks.length > 0) || Boolean(asText(value.observations));
}

function hasMediaForMode(media, mode) {
  if (!media) return false;
  if (Array.isArray(media)) {
    return media.some((entry) => {
      const hint = `${entry && entry.mode || ""} ${entry && entry.stage || ""} ${entry && entry.label || ""}`.toLowerCase();
      return hint.includes(mode === "depart" ? "départ" : "retour") || hint.includes(mode);
    });
  }
  if (typeof media !== "object") return false;
  const stageMedia = media[mode];
  return Array.isArray(stageMedia) ? stageMedia.length > 0 : hasInspectionValue(stageMedia);
}

function splitDateTime(value) {
  const raw = asText(value);
  const match = /^(\d{4}-\d{2}-\d{2})(?:T|\s)(\d{2}:\d{2})/.exec(raw);
  return match ? { date: match[1], heure: match[2] } : { date: "", heure: "" };
}

function inspectionFlags({ depart, retour, media }) {
  const departDone = Boolean(depart) || hasMediaForMode(media, "depart");
  const retourDone = Boolean(retour) || hasMediaForMode(media, "retour");
  return { depart: departDone, retour: retourDone, retourAvailable: departDone || retourDone };
}

function reservationInspectionItem(reservation) {
  const vehicule = getVehiculeParId(reservation.vehiculeId);
  const dossier = reservation.contractDossier || {};
  const start = splitDateTime(reservation.periodeDebut);
  const end = splitDateTime(reservation.periodeFin);
  return {
    id: reservation.id,
    contractNumero: reservation.contractNumero || null,
    client: reservation.conducteur
      ? { prenom: reservation.conducteur.prenom || "", nom: reservation.conducteur.nom || "" }
      : null,
    vehiculeId: reservation.vehiculeId,
    vehicule: vehicule ? vehicule.nom : reservation.vehiculeId,
    immatriculation: reservation.immatriculation || (vehicule && vehicule.immatriculation) || "",
    dateDebut: reservation.dateDebut || start.date,
    heureDebut: reservation.heureDebut || start.heure,
    dateFin: reservation.dateFin || end.date,
    heureFin: reservation.heureFin || end.heure,
    // Seuls les dossiers de réservations payées utilisent déjà le jeton
    // agence de l'état des lieux indépendant. Les contrats manuels et les
    // locations D1 restent listés (historique intact), mais ne reçoivent
    // jamais un faux lien vers un dossier incompatible.
    inspection: inspectionFlags({
      depart: hasInspectionValue(dossier.depart),
      retour: hasInspectionValue(dossier.retour),
      media: dossier.media
    }),
    source: "reservation",
    openable: true,
    relatedIds: [reservation.rentalId, reservation.rental_id]
  };
}

function manualContractInspectionItem(contract) {
  const vehicule = getVehiculeParId(contract.vehiculeId);
  const start = splitDateTime(contract.depart);
  const end = splitDateTime(contract.retour);
  return {
    id: contract.id,
    contractNumero: contract.contractNumero || null,
    client: { prenom: contract.prenom || "", nom: contract.nom || "" },
    vehiculeId: contract.vehiculeId,
    vehicule: vehicule ? vehicule.nom : contract.vehiculeId,
    immatriculation: contract.immatriculation || contract.immat || (vehicule && vehicule.immatriculation) || "",
    dateDebut: start.date,
    heureDebut: start.heure,
    dateFin: end.date,
    heureFin: end.heure,
    inspection: inspectionFlags({
      depart: hasLegacyInspectionValue(contract.etatDepart) || contract.kmDepart !== undefined && contract.kmDepart !== "",
      retour: hasLegacyInspectionValue(contract.etatRetour) || contract.kmRetour !== undefined && contract.kmRetour !== "",
      media: contract.photosEtatDesLieux
    }),
    source: "manual_contract",
    openable: false,
    relatedIds: [contract.rentalId, contract.rental_id]
  };
}

function d1RentalInspectionItem(rental) {
  const vehicule = getVehiculeParId(rental.vehiculeId);
  return {
    id: rental.id,
    contractNumero: rental.contractNumero || null,
    client: rental.client || null,
    vehiculeId: rental.vehiculeId,
    vehicule: vehicule ? vehicule.nom : rental.vehiculeId,
    immatriculation: rental.immatriculation || (vehicule && vehicule.immatriculation) || "",
    dateDebut: rental.dateDebut,
    heureDebut: rental.heureDebut,
    dateFin: rental.dateFin,
    heureFin: rental.heureFin,
    inspection: inspectionFlags({ depart: rental.kmDepart !== null && rental.kmDepart !== undefined, retour: rental.kmRetour !== null && rental.kmRetour !== undefined }),
    source: "rental",
    openable: false,
    relatedIds: [rental.reservationId, rental.reservation_id]
  };
}

function candidateKeys(item) {
  const keys = [`id:${item.id}`];
  if (item.contractNumero) keys.push(`contract:${item.contractNumero}`);
  (item.relatedIds || []).filter(Boolean).forEach((id) => keys.push(`id:${id}`));
  return keys;
}

function mergeInspectionItems(previous, next) {
  // Préférence pour l'entrée réellement ouvrable, tout en conservant les
  // preuves historiques d'inspection trouvées dans l'autre source.
  const primary = next.openable && !previous.openable ? next : previous;
  const secondary = primary === previous ? next : previous;
  return {
    ...primary,
    contractNumero: primary.contractNumero || secondary.contractNumero || null,
    client: primary.client && (primary.client.prenom || primary.client.nom) ? primary.client : secondary.client,
    vehicule: primary.vehicule || secondary.vehicule,
    immatriculation: primary.immatriculation || secondary.immatriculation || "",
    inspection: inspectionFlags({
      depart: primary.inspection.depart || secondary.inspection.depart,
      retour: primary.inspection.retour || secondary.inspection.retour
    }),
    // Garder aussi les deux identifiants sources dans l'index de
    // déduplication : un troisième enregistrement relié à l'un d'eux doit
    // rejoindre la même carte, même s'il n'a pas de numéro de contrat.
    relatedIds: [...new Set([primary.id, secondary.id, ...(primary.relatedIds || []), ...(secondary.relatedIds || [])])]
  };
}

function deduplicateInspectionItems(items) {
  const byKey = new Map();
  const unique = [];
  items.forEach((item) => {
    const matching = candidateKeys(item).map((key) => byKey.get(key)).find(Boolean);
    if (matching) {
      const merged = mergeInspectionItems(matching, item);
      const position = unique.indexOf(matching);
      unique[position] = merged;
      candidateKeys(merged).forEach((key) => byKey.set(key, merged));
      return;
    }
    unique.push(item);
    candidateKeys(item).forEach((key) => byKey.set(key, item));
  });
  return unique;
}

function publicInspectionItem(item) {
  return {
    id: item.id,
    contractNumero: item.contractNumero,
    client: item.client,
    vehiculeId: item.vehiculeId,
    vehicule: item.vehicule,
    immatriculation: item.immatriculation,
    dateDebut: item.dateDebut,
    heureDebut: item.heureDebut,
    dateFin: item.dateFin,
    heureFin: item.heureFin,
    inspection: item.inspection,
    source: item.source,
    openable: item.openable
  };
}

async function handleGet(request, env, headers) {
  const auth = await requireAgencySession(request, env);
  if (auth.error) return auth.error;

  const url = new URL(request.url);
  if (url.searchParams.get("view") === "inspection") {
    // Historique unifié sans migration : réservations payées et contrats
    // manuels en KV, plus locations historiques/manualisées dans D1.
    const [reservations, d1Rentals] = await Promise.all([
      listReservations(env),
      listRentalsForInspection(env)
    ]);
    const items = deduplicateInspectionItems([
      ...reservations.filter((reservation) => reservation && reservation.status === "paid").map(reservationInspectionItem),
      ...reservations.filter((reservation) => reservation && reservation.status === "manual_contract").map(manualContractInspectionItem),
      ...d1Rentals.map(d1RentalInspectionItem)
    ])
      .map(publicInspectionItem)
      .sort((a, b) => `${b.dateDebut || ""} ${b.heureDebut || ""}`.localeCompare(`${a.dateDebut || ""} ${a.heureDebut || ""}`))
      .slice(0, 200);
    return new Response(JSON.stringify({ rentals: items }), { status: 200, headers });
  }
  const id = url.searchParams.get("id");
  if (id) {
    const rental = await getRentalById(env, id.slice(0, 100));
    if (!rental) return new Response(JSON.stringify({ error: "Location introuvable" }), { status: 404, headers });
    const syncStatus = await getSyncStatusForRental(env, rental.id);
    return new Response(JSON.stringify({ rental: { ...rental, syncStatus } }), { status: 200, headers });
  }
  const clientId = url.searchParams.get("clientId");
  if (clientId) {
    const rentals = await listRentalsByClient(env, clientId.slice(0, 100));
    const withSyncStatus = await Promise.all(rentals.map(async (r) => ({ ...r, syncStatus: await getSyncStatusForRental(env, r.id) })));
    return new Response(JSON.stringify({ rentals: withSyncStatus }), { status: 200, headers });
  }
  return new Response(JSON.stringify({ error: "Paramètre id ou clientId requis" }), { status: 400, headers });
}

async function handlePost(request, env, headers) {
  const auth = await requireAgencySession(request, env, { requireCsrf: true, requireOrigin: true });
  if (auth.error) return auth.error;

  let body;
  try {
    const rawBody = await request.text();
    if (!rawBody || rawBody.length > MAX_BODY_LEN) throw new Error("corps de requête vide ou trop volumineux");
    body = JSON.parse(rawBody);
  } catch (e) {
    return new Response(JSON.stringify({ error: "Requête invalide" }), { status: 400, headers });
  }

  try {
    if (body.action === "create") {
      const client = await getClientById(env, body.clientId);
      if (!client) return new Response(JSON.stringify({ error: "Client introuvable" }), { status: 404, headers });
      const rental = await createRental(env, body.clientId, body.data || {}, auth.session.operator);
      await recordAuditEvent(env, { actor: auth.session.operator, eventType: "rental_created", entityType: "rental", entityId: rental.id });
      await attemptSync(env, rental.id, auth.session.operator);
      const syncStatus = await getSyncStatusForRental(env, rental.id);
      return new Response(JSON.stringify({ rental: { ...rental, syncStatus } }), { status: 200, headers });
    }
    if (body.action === "update") {
      const rental = await updateRental(env, body.id, body.data || {}, auth.session.operator);
      if (!rental) return new Response(JSON.stringify({ error: "Location introuvable" }), { status: 404, headers });
      await recordAuditEvent(env, { actor: auth.session.operator, eventType: "rental_updated", entityType: "rental", entityId: rental.id });
      await attemptSync(env, rental.id, auth.session.operator);
      const syncStatus = await getSyncStatusForRental(env, rental.id);
      return new Response(JSON.stringify({ rental: { ...rental, syncStatus } }), { status: 200, headers });
    }
    if (body.action === "generate-contract") {
      const rental = await generateRentalContract(env, body.id, auth.session.operator);
      if (!rental) return new Response(JSON.stringify({ error: "Location introuvable" }), { status: 404, headers });
      await recordAuditEvent(env, {
        actor: auth.session.operator,
        eventType: "contract_generated",
        entityType: "rental",
        entityId: rental.id,
        metadata: { contractNumero: rental.contractNumero }
      });
      await attemptSync(env, rental.id, auth.session.operator);
      const syncStatus = await getSyncStatusForRental(env, rental.id);
      return new Response(JSON.stringify({ rental: { ...rental, syncStatus } }), { status: 200, headers });
    }
    if (body.action === "retry-sync") {
      const rental = await getRentalById(env, body.id);
      if (!rental) return new Response(JSON.stringify({ error: "Location introuvable" }), { status: 404, headers });
      await attemptSync(env, rental.id, auth.session.operator);
      const syncStatus = await getSyncStatusForRental(env, rental.id);
      return new Response(JSON.stringify({ rental: { ...rental, syncStatus } }), { status: 200, headers });
    }
    return new Response(JSON.stringify({ error: "Action inconnue" }), { status: 400, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || "Requête invalide" }), { status: 400, headers });
  }
}

async function handleAgencyRentals(request, env) {
  const headers = corsHeaders(request, env);
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { ...headers, "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Agency-Csrf" }
    });
  }
  if (request.method !== "GET" && request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Méthode non autorisée" }), { status: 405, headers });
  }
  return request.method === "GET" ? handleGet(request, env, headers) : handlePost(request, env, headers);
}

module.exports = { handleAgencyRentals };
