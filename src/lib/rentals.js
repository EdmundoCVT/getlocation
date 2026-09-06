// src/lib/rentals.js
//
// Locations du mini-back-office agence (Lot 2, voir CLAUDE.md). Une
// location appartient à un client existant (client_id immuable après
// création — pour corriger le client associé, annuler cette location et en
// créer une nouvelle plutôt que réassigner, afin de ne jamais mélanger
// paiements/cautions d'un client sur la fiche d'un autre). Le véhicule est
// toujours vérifié contre js/data.js (seule source de vérité), jamais
// confiance en un id inconnu. created_by/updated_by proviennent toujours de
// la session agence vérifiée, jamais du payload.

const { getVehiculeParId } = require("../../js/data.js");
const { generateId } = require("./id.js");
const { generateContractNumero } = require("./contract-numero.js");

const STATUTS_VALIDES = ["brouillon", "contrat_genere", "en_cours", "terminee", "annulee"];

function text(value, max = 300) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function isDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isHeure(value) {
  return typeof value === "string" && /^\d{2}:\d{2}$/.test(value);
}

function optionalKm(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error("Kilométrage invalide");
  return Math.round(n);
}

// Tarif total convenu, saisi/ajusté par l'agence (voir migrations/0002,
// price_total_cents) — pas un recalcul automatique (options/promo/km inclus
// restent la logique de js/data.js, hors périmètre du Lot 2).
function optionalPriceCents(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error("Montant total invalide");
  return Math.round(n * 100);
}

function rowToRental(row) {
  if (!row) return null;
  return {
    id: row.id,
    clientId: row.client_id,
    contractNumero: row.contract_numero || null,
    vehiculeId: row.vehicule_id,
    immatriculation: row.immatriculation || "",
    dateDebut: row.date_debut,
    heureDebut: row.heure_debut,
    dateFin: row.date_fin,
    heureFin: row.heure_fin,
    lieuPrise: row.lieu_prise || "",
    lieuRetour: row.lieu_retour || "",
    adressePrise: row.adresse_prise || "",
    adresseRetour: row.adresse_retour || "",
    kmDepart: row.km_depart,
    kmRetour: row.km_retour,
    priceTotalCents: row.price_total_cents,
    status: row.status,
    notes: row.notes || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by
  };
}

function buildRentalFields(data) {
  const vehiculeId = text(data.vehiculeId, 100);
  if (!vehiculeId || !getVehiculeParId(vehiculeId)) throw new Error("Véhicule inconnu");

  const dateDebut = text(data.dateDebut, 10);
  const heureDebut = text(data.heureDebut, 5);
  const dateFin = text(data.dateFin, 10);
  const heureFin = text(data.heureFin, 5);
  if (!isDate(dateDebut) || !isHeure(heureDebut) || !isDate(dateFin) || !isHeure(heureFin)) {
    throw new Error("Dates ou heures de location invalides");
  }
  const debutMs = new Date(`${dateDebut}T${heureDebut}:00`).getTime();
  const finMs = new Date(`${dateFin}T${heureFin}:00`).getTime();
  if (!Number.isFinite(debutMs) || !Number.isFinite(finMs) || finMs <= debutMs) {
    throw new Error("La date de retour doit être postérieure à la date de départ");
  }

  const status = STATUTS_VALIDES.includes(data.status) ? data.status : "brouillon";

  return {
    vehicule_id: vehiculeId,
    immatriculation: text(data.immatriculation, 20),
    date_debut: dateDebut,
    heure_debut: heureDebut,
    date_fin: dateFin,
    heure_fin: heureFin,
    lieu_prise: text(data.lieuPrise, 200),
    lieu_retour: text(data.lieuRetour, 200),
    adresse_prise: text(data.adressePrise, 300),
    adresse_retour: text(data.adresseRetour, 300),
    km_depart: optionalKm(data.kmDepart),
    km_retour: optionalKm(data.kmRetour),
    price_total_cents: optionalPriceCents(data.priceTotal),
    status,
    notes: text(data.notes, 2000)
  };
}

async function createRental(env, clientId, data, operator) {
  if (!clientId || typeof clientId !== "string") throw new Error("Client manquant");
  const fields = buildRentalFields(data);
  const id = generateId("rnt");
  const now = new Date().toISOString();
  await env.AGENCY_DB.prepare(
    `INSERT INTO rentals (id, client_id, contract_numero, vehicule_id, immatriculation, date_debut, heure_debut, date_fin, heure_fin, lieu_prise, lieu_retour, adresse_prise, adresse_retour, km_depart, km_retour, price_total_cents, status, notes, created_at, updated_at, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, clientId, null, fields.vehicule_id, fields.immatriculation, fields.date_debut, fields.heure_debut,
    fields.date_fin, fields.heure_fin, fields.lieu_prise, fields.lieu_retour, fields.adresse_prise,
    fields.adresse_retour, fields.km_depart, fields.km_retour, fields.price_total_cents, fields.status, fields.notes,
    now, now, operator, operator
  ).run();
  return getRentalById(env, id);
}

async function getRentalById(env, id) {
  if (!id) return null;
  const row = await env.AGENCY_DB.prepare("SELECT * FROM rentals WHERE id = ?").bind(id).first();
  return rowToRental(row);
}

// Corrige une location EN PLACE (même id, même client, même numéro de
// contrat éventuel) — jamais de doublon. Le véhicule/les dates/le statut
// peuvent changer ; le client associé et le numéro de contrat ne se
// modifient jamais ici (voir generateRentalContract pour l'attribution du
// numéro).
async function updateRental(env, id, data, operator) {
  const existing = await getRentalById(env, id);
  if (!existing) return null;
  const fields = buildRentalFields(data);
  const now = new Date().toISOString();
  await env.AGENCY_DB.prepare(
    `UPDATE rentals SET vehicule_id = ?, immatriculation = ?, date_debut = ?, heure_debut = ?, date_fin = ?, heure_fin = ?, lieu_prise = ?, lieu_retour = ?, adresse_prise = ?, adresse_retour = ?, km_depart = ?, km_retour = ?, price_total_cents = ?, status = ?, notes = ?, updated_at = ?, updated_by = ? WHERE id = ?`
  ).bind(
    fields.vehicule_id, fields.immatriculation, fields.date_debut, fields.heure_debut,
    fields.date_fin, fields.heure_fin, fields.lieu_prise, fields.lieu_retour, fields.adresse_prise,
    fields.adresse_retour, fields.km_depart, fields.km_retour, fields.price_total_cents, fields.status, fields.notes,
    now, operator, id
  ).run();
  return getRentalById(env, id);
}

// Attribue le numéro de contrat (compteur D1 atomique partagé, voir
// contract-numero.js) et fait passer la location en "contrat_genere" — ne
// s'exécute qu'une fois par location (numéro déjà présent = no-op, renvoie
// simplement l'état actuel, jamais un second numéro pour la même location).
async function generateRentalContract(env, id, operator) {
  const existing = await getRentalById(env, id);
  if (!existing) return null;
  if (existing.contractNumero) return existing;

  const numero = await generateContractNumero(env);
  const now = new Date().toISOString();
  await env.AGENCY_DB.prepare(
    "UPDATE rentals SET contract_numero = ?, status = ?, updated_at = ?, updated_by = ? WHERE id = ?"
  ).bind(numero, "contrat_genere", now, operator, id).run();
  return getRentalById(env, id);
}

async function listRentalsByClient(env, clientId) {
  if (!clientId) return [];
  const res = await env.AGENCY_DB.prepare("SELECT * FROM rentals WHERE client_id = ? ORDER BY created_at DESC").bind(clientId).all();
  return (res.results || []).map(rowToRental);
}

module.exports = { STATUTS_VALIDES, createRental, getRentalById, updateRental, generateRentalContract, listRentalsByClient };
