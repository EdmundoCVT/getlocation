// src/api/contract-dossier-client.js
//
// Accès CLIENT (lecture du récapitulatif + signature) au dossier contrat
// d'une réservation payée — jeton distinct du jeton AGENCE (voir
// contract-dossier-token.js), jamais de droit d'écriture sur les champs du
// contrat ni sur l'état des lieux départ/retour (uniquement
// contract-dossier-agency.js).
//
// Comme pour la signature papier, la version des CGL acceptée est tracée
// (cglVersion, même contrôle que validate-reservation-input.js côté
// réservation) : si le texte a changé depuis l'émission du lien, la
// signature est refusée tant que le client n'a pas rechargé la page.

const { getVehiculeParId, kmInclusPourJours, joursFacturablesDepuisHeures, dureeEnHeures, CGL_VERSION } = require("../../js/data.js");
const { updateContractDossier, findReservationByContractClientTokenHash } = require("../lib/reservation-store.js");
const { checkRateLimit } = require("../lib/rate-limiter.js");
const { hashContractClientToken } = require("../lib/contract-dossier-token.js");

const MAX_SIGNATURE_DATA_URL_LENGTH = 300000; // large marge pour un PNG 700x150 en base64

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

function clientIp(request) {
  return (
    request.headers.get("cf-connecting-ip") ||
    (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    "unknown"
  );
}

function bearerToken(request) {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.get("authorization") || "");
  return match ? match[1] : null;
}

async function resolveContractClientAccess(request, env) {
  const token = bearerToken(request);
  if (!token || !env.DOCUMENT_TOKEN_PEPPER) return null;
  const tokenHash = await hashContractClientToken(token, env.DOCUMENT_TOKEN_PEPPER);
  const reservation = await findReservationByContractClientTokenHash(env, tokenHash);
  const access = reservation && reservation.contractClientAccess;
  const expired = !access || !access.expiresAt || new Date(access.expiresAt).getTime() <= Date.now();
  const invalid = !reservation || reservation.status !== "paid" ||
    !access || access.tokenHash !== tokenHash || access.revokedAt || expired;
  return invalid ? null : { reservation };
}

function joursReservation(reservation) {
  const heures = reservation.periodeDebut && reservation.periodeFin
    ? (new Date(reservation.periodeFin) - new Date(reservation.periodeDebut)) / (1000 * 60 * 60)
    : dureeEnHeures(reservation.dateDebut, reservation.heureDebut, reservation.dateFin, reservation.heureFin);
  return joursFacturablesDepuisHeures(heures);
}

function buildClientView(reservation) {
  const vehicule = getVehiculeParId(reservation.vehiculeId);
  const jours = joursReservation(reservation);
  const dossier = reservation.contractDossier || { status: "draft", fields: null };
  const fields = dossier.fields || {};
  return {
    reservation: {
      numero: reservation.contractNumero || null,
      vehicule: vehicule ? { nom: vehicule.nom, caution: vehicule.caution, prixJour: vehicule.prixJour, carburant: vehicule.carburant || null, vin: vehicule.vin || null } : null,
      immatriculation: fields.immatriculation || "",
      dateDebut: reservation.dateDebut,
      heureDebut: reservation.heureDebut,
      dateFin: reservation.dateFin,
      heureFin: reservation.heureFin,
      lieuPrise: reservation.lieuPrise,
      lieuRetour: reservation.lieuRetour,
      jours,
      // Détail financier figé au paiement (voir contract-dossier-agency.js,
      // même principe) : le locataire a le droit de voir le détail complet
      // de son propre contrat avant de le signer.
      sousTotalBrut: reservation.sousTotalBrut,
      reductionDuree: reservation.reductionDuree || null,
      options: Array.isArray(reservation.options) ? reservation.options : [],
      optionsMontant: reservation.optionsMontant,
      codePromo: reservation.codePromo || null,
      reductionPromoMontant: reservation.reductionPromoMontant,
      total: reservation.total,
      conducteur: reservation.conducteur
        ? { nom: reservation.conducteur.nom, prenom: reservation.conducteur.prenom, naissance: reservation.conducteur.naissance, telephone: reservation.conducteur.telephone, email: reservation.conducteur.email }
        : null,
      cglVersion: CGL_VERSION
    },
    fields: {
      modeCaution: fields.modeCaution || "carte",
      adresse: fields.adresse || "",
      codePostal: fields.codePostal || "",
      ville: fields.ville || "",
      permisNumero: fields.permisNumero || "",
      permisPays: fields.permisPays || "",
      permisDate: fields.permisDate || "",
      permisValidite: fields.permisValidite || "",
      livraison: !!fields.livraison,
      livraisonRue: fields.livraisonRue || "",
      livraisonCP: fields.livraisonCP || "",
      livraisonVille: fields.livraisonVille || "",
      secondConducteur: !!fields.secondConducteur,
      secondConducteurNom: fields.secondConducteurNom || "",
      secondConducteurPrenom: fields.secondConducteurPrenom || "",
      secondConducteurPermisNumero: fields.secondConducteurPermisNumero || "",
      secondConducteurPermisPays: fields.secondConducteurPermisPays || "",
      secondConducteurPermisDate: fields.secondConducteurPermisDate || ""
    },
    kmInclus: kmInclusPourJours(jours),
    status: dossier.status,
    signedAt: dossier.signature ? dossier.signature.signedAt : null,
    signatureId: dossier.signature ? dossier.signature.signatureId : null
  };
}

function genererIdentifiantSignature() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

async function handleGet(request, env, headers) {
  const resolved = await resolveContractClientAccess(request, env);
  if (!resolved) return new Response(JSON.stringify({ error: "Ce lien est invalide ou a expiré." }), { status: 401, headers });
  return new Response(JSON.stringify(buildClientView(resolved.reservation)), { status: 200, headers });
}

async function handlePost(request, env, headers) {
  const resolved = await resolveContractClientAccess(request, env);
  if (!resolved) return new Response(JSON.stringify({ error: "Ce lien est invalide ou a expiré." }), { status: 401, headers });
  const { reservation } = resolved;

  let payload;
  try {
    const rawBody = await request.text();
    if (!rawBody || rawBody.length > MAX_SIGNATURE_DATA_URL_LENGTH + 5000) throw new Error("corps de requête vide ou trop volumineux");
    payload = JSON.parse(rawBody);
  } catch (e) {
    return new Response(JSON.stringify({ error: "Requête invalide" }), { status: 400, headers });
  }

  if (payload.cglAccepted !== true) {
    return new Response(JSON.stringify({ error: "Vous devez accepter les conditions de location avant de signer." }), { status: 400, headers });
  }
  if (payload.cglVersion !== CGL_VERSION) {
    return new Response(JSON.stringify({ error: "Les conditions de location ont été mises à jour, merci de recharger la page et réessayer." }), { status: 409, headers });
  }
  const signatureImage = typeof payload.signatureImage === "string" ? payload.signatureImage : "";
  if (!signatureImage.startsWith("data:image/png") || signatureImage.length > MAX_SIGNATURE_DATA_URL_LENGTH || signatureImage.length < 100) {
    return new Response(JSON.stringify({ error: "Signature manquante ou invalide." }), { status: 400, headers });
  }

  const existing = reservation.contractDossier || { status: "draft", fields: null, depart: null, retour: null, observations: "" };
  const signedAt = new Date().toISOString();
  const updated = await updateContractDossier(env, reservation.id, {
    contractDossier: {
      ...existing,
      status: "signed",
      cglAcceptedAt: signedAt,
      cglVersion: payload.cglVersion,
      signature: { imageDataUrl: signatureImage, signedAt, signatureId: genererIdentifiantSignature() },
      updatedAt: signedAt
    }
  });
  if (!updated) return new Response(JSON.stringify({ error: "Réservation introuvable" }), { status: 404, headers });
  return new Response(JSON.stringify(buildClientView(updated)), { status: 200, headers });
}

async function handleContractDossierClient(request, env) {
  const headers = corsHeaders(request, env);

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { ...headers, "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" }
    });
  }
  if (request.method !== "GET" && request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Méthode non autorisée" }), { status: 405, headers });
  }

  const rate = await checkRateLimit(env, `contract-dossier-client:${clientIp(request)}`, { windowMs: 60000, maxRequests: 20 });
  if (!rate.allowed) {
    return new Response(JSON.stringify({ error: "Trop de requêtes, veuillez réessayer dans un instant." }), {
      status: 429,
      headers: { ...headers, "Retry-After": String(rate.retryAfterSeconds) }
    });
  }

  return request.method === "GET" ? handleGet(request, env, headers) : handlePost(request, env, headers);
}

module.exports = { handleContractDossierClient, resolveContractClientAccess, buildClientView };
