// src/lib/clients.js
//
// Base clients du mini-back-office agence (Lot 2, voir CLAUDE.md). Recherche
// par téléphone/email normalisés (principale) et nom/prénom (secondaire) —
// JAMAIS de fusion automatique : searchClients() renvoie les ressemblances,
// à l'agence de confirmer qu'il s'agit ou non de la même personne (voir
// cahier des charges). created_by/updated_by proviennent toujours de la
// session agence vérifiée (voir src/lib/agency-auth.js), jamais du payload.
//
// consentement marketing : JAMAIS activé par défaut (voir
// createClient/updateClient, marketingConsent uniquement si explicitement
// `true` dans les données reçues).

const { generateId } = require("./id.js");

// Normalisation minimale, sans dépendance externe (pas de libphonenumber) :
// conserve le "+" international éventuel, retire tout le reste sauf les
// chiffres. Suffisant pour la déduplication/recherche interne — pas une
// validation de numéro de téléphone.
function normalizePhone(raw) {
  if (!raw || typeof raw !== "string") return "";
  const trimmed = raw.trim();
  const plus = trimmed.startsWith("+") ? "+" : "";
  return plus + trimmed.replace(/\D/g, "");
}

function normalizeEmail(raw) {
  if (!raw || typeof raw !== "string") return "";
  return raw.trim().toLowerCase();
}

function text(value, max = 300) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function rowToClient(row) {
  if (!row) return null;
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    phone: row.phone_raw,
    email: row.email_raw,
    birthDate: row.birth_date || "",
    postalAddress: row.postal_address || "",
    postalCode: row.postal_code || "",
    city: row.city || "",
    permitNumber: row.permit_number || "",
    permitDate: row.permit_date || "",
    marketingConsent: Boolean(row.marketing_consent),
    notes: row.notes || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by
  };
}

// Ne valide QUE ce qui est nécessaire à l'existence d'une fiche client
// (identité) — le reste (adresse, permis...) est complété au fil des
// locations, comme le fait déjà le formulaire agence de contrat.html.
function buildClientFields(data) {
  const firstName = text(data.firstName, 100);
  const lastName = text(data.lastName, 100);
  if (!firstName || !lastName) throw new Error("Prénom et nom sont obligatoires");
  const phoneRaw = text(data.phone, 40);
  const emailRaw = text(data.email, 200);
  return {
    first_name: firstName,
    last_name: lastName,
    phone_raw: phoneRaw,
    phone_normalized: normalizePhone(phoneRaw),
    email_raw: emailRaw,
    email_normalized: normalizeEmail(emailRaw),
    birth_date: text(data.birthDate, 10),
    postal_address: text(data.postalAddress, 300),
    postal_code: text(data.postalCode, 10),
    city: text(data.city, 100),
    permit_number: text(data.permitNumber, 50),
    permit_date: text(data.permitDate, 10),
    // Case à cocher explicite uniquement : toute valeur autre que `true`
    // stricte (absence, chaîne, 0...) reste un refus.
    marketing_consent: data.marketingConsent === true ? 1 : 0,
    notes: text(data.notes, 2000)
  };
}

async function createClient(env, data, operator) {
  const fields = buildClientFields(data);
  const id = generateId("clt");
  const now = new Date().toISOString();
  await env.AGENCY_DB.prepare(
    `INSERT INTO clients (id, first_name, last_name, phone_normalized, phone_raw, email_normalized, email_raw, birth_date, postal_address, postal_code, city, permit_number, permit_date, marketing_consent, notes, created_at, updated_at, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, fields.first_name, fields.last_name, fields.phone_normalized, fields.phone_raw,
    fields.email_normalized, fields.email_raw, fields.birth_date, fields.postal_address,
    fields.postal_code, fields.city, fields.permit_number, fields.permit_date, fields.marketing_consent, fields.notes,
    now, now, operator, operator
  ).run();
  return getClientById(env, id);
}

async function getClientById(env, id) {
  if (!id) return null;
  const row = await env.AGENCY_DB.prepare("SELECT * FROM clients WHERE id = ?").bind(id).first();
  return rowToClient(row);
}

// Remplace intégralement les champs métier (même convention que
// updateManualContract dans reservation-store.js : le formulaire renvoie
// toujours son état complet). Renvoie null si le client est introuvable.
async function updateClient(env, id, data, operator) {
  const existing = await env.AGENCY_DB.prepare("SELECT * FROM clients WHERE id = ?").bind(id).first();
  if (!existing) return null;
  const fields = buildClientFields(data);
  const now = new Date().toISOString();
  await env.AGENCY_DB.prepare(
    `UPDATE clients SET first_name = ?, last_name = ?, phone_normalized = ?, phone_raw = ?, email_normalized = ?, email_raw = ?, birth_date = ?, postal_address = ?, postal_code = ?, city = ?, permit_number = ?, permit_date = ?, marketing_consent = ?, notes = ?, updated_at = ?, updated_by = ? WHERE id = ?`
  ).bind(
    fields.first_name, fields.last_name, fields.phone_normalized, fields.phone_raw,
    fields.email_normalized, fields.email_raw, fields.birth_date, fields.postal_address,
    fields.postal_code, fields.city, fields.permit_number, fields.permit_date, fields.marketing_consent, fields.notes,
    now, operator, id
  ).run();
  return getClientById(env, id);
}

// Recherche : téléphone puis email (exacts, normalisés) en priorité : dès
// qu'une de ces deux pistes renvoie un résultat, on ne tombe PAS sur la
// recherche par nom (secondaire, plus bruitée) — sauf si l'appelant ne
// fournit ni téléphone ni email. Dédoublonne par id (un même client pourrait
// matcher plusieurs critères si plusieurs sont fournis à la fois).
async function searchClients(env, { phone, email, firstName, lastName } = {}) {
  const results = new Map();
  const add = (rows) => rows.forEach((row) => results.set(row.id, row));

  const phoneNormalized = normalizePhone(phone);
  const emailNormalized = normalizeEmail(email);

  if (phoneNormalized) {
    const res = await env.AGENCY_DB.prepare("SELECT * FROM clients WHERE phone_normalized = ?").bind(phoneNormalized).all();
    add(res.results || []);
  }
  if (emailNormalized) {
    const res = await env.AGENCY_DB.prepare("SELECT * FROM clients WHERE email_normalized = ?").bind(emailNormalized).all();
    add(res.results || []);
  }
  if (!phoneNormalized && !emailNormalized && (firstName || lastName)) {
    const res = await env.AGENCY_DB.prepare("SELECT * FROM clients WHERE last_name LIKE ? OR first_name LIKE ?")
      .bind(`%${text(lastName, 100)}%`, `%${text(firstName, 100)}%`)
      .all();
    add(res.results || []);
  }
  return [...results.values()].map(rowToClient);
}

module.exports = { normalizePhone, normalizeEmail, createClient, updateClient, getClientById, searchClients };
