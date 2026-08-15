// src/api/contract-dossier-agency.js
//
// Accès AGENCE (lecture + écriture) au dossier contrat d'une réservation
// payée : champs du contrat non déjà connus (permis, adresse, second
// conducteur...), envoi du lien de signature au client, état des lieux
// départ/retour. Authentification par jeton porteur (Bearer), même schéma
// que src/api/agency-documents-access.js — voir
// src/lib/contract-dossier-token.js pour l'émission/le hachage du jeton.
//
// RÈGLE DE SÉCURITÉ CENTRALE (comme create-payment.js pour le prix) : le
// kilométrage parcouru et le dépassement facturé ne sont JAMAIS acceptés
// depuis le client — recalculés ici via calculerKilometrage() de
// js/data.js à partir des seuls relevés compteur bruts envoyés par
// l'agence, la même fonction que celle utilisée pour l'affichage.
//
// Véhicule, dates, lieu et coordonnées du locataire restent lus depuis la
// réservation elle-même (jamais réécrits ici) : ce ne sont pas des champs
// du dossier contrat, un contrat ne doit jamais pouvoir diverger de ce qui
// a réellement été payé.

const { getVehiculeParId, calculerKilometrage, joursFacturablesDepuisHeures, dureeEnHeures, KM_INCLUS_PAR_JOUR, SUPPLEMENT_KM_CENTIMES, CGL_VERSION } = require("../../js/data.js");
const {
  updateContractDossier,
  findReservationByContractAgencyTokenHash,
  saveContractClientAccessIndex
} = require("../lib/reservation-store.js");
const { checkRateLimit } = require("../lib/rate-limiter.js");
const { hashContractAgencyToken, issueContractClientAccess } = require("../lib/contract-dossier-token.js");
const { validateContractFields, champsManquantsAvantEnvoi, validateConditionReport } = require("../lib/validate-contract-dossier.js");

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

// Ne journalise jamais de donnée personnelle (nom, adresse, permis...) —
// uniquement l'id de réservation (déjà un identifiant opaque non sensible,
// même convention que mollie-webhook.js/documents-submit.js).
async function resolveContractAgencyAccess(request, env) {
  const token = bearerToken(request);
  if (!token || !env.DOCUMENT_TOKEN_PEPPER) return null;
  const tokenHash = await hashContractAgencyToken(token, env.DOCUMENT_TOKEN_PEPPER);
  const reservation = await findReservationByContractAgencyTokenHash(env, tokenHash);
  const access = reservation && reservation.contractAgencyAccess;
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

// Vue renvoyée à l'agence : uniquement ce qui est nécessaire à la
// préparation du contrat et à l'état des lieux — jamais les champs les plus
// sensibles hors de propos ici (cf. reservation-status.js, même principe de
// minimisation pour une vue "publique" côté client).
function buildDossierView(reservation) {
  const vehicule = getVehiculeParId(reservation.vehiculeId);
  const jours = joursReservation(reservation);
  const dossier = reservation.contractDossier || null;
  const depart = dossier && dossier.depart ? dossier.depart : null;
  const retour = dossier && dossier.retour ? dossier.retour : null;
  const kilometrage = depart && retour
    ? calculerKilometrage({ kmDepart: depart.km, kmRetour: retour.km, jours })
    : null;

  // Prefill "meilleur effort" depuis le dossier documentaire (documents.html,
  // déjà soumis ou non) : évite à l'agence de ressaisir des informations
  // déjà connues, sans jamais écraser ce que l'agence a explicitement
  // renseigné dans le dossier contrat lui-même (voir contrat.html).
  const documentsData = reservation.documentsData || null;

  return {
    reservation: {
      id: reservation.id,
      vehicule: vehicule ? { id: vehicule.id, nom: vehicule.nom, immatriculation: vehicule.immatriculation, caution: vehicule.caution, prixJour: vehicule.prixJour } : null,
      dateDebut: reservation.dateDebut,
      heureDebut: reservation.heureDebut,
      dateFin: reservation.dateFin,
      heureFin: reservation.heureFin,
      lieuPrise: reservation.lieuPrise,
      lieuRetour: reservation.lieuRetour,
      adressePrise: reservation.adressePrise,
      adresseRetour: reservation.adresseRetour,
      jours,
      total: reservation.total,
      options: Array.isArray(reservation.options) ? reservation.options : [],
      conducteur: reservation.conducteur
        ? { nom: reservation.conducteur.nom, prenom: reservation.conducteur.prenom, naissance: reservation.conducteur.naissance, telephone: reservation.conducteur.telephone, email: reservation.conducteur.email }
        : null,
      cglVersion: CGL_VERSION
    },
    kmInclusParJour: KM_INCLUS_PAR_JOUR,
    supplementKmCentimes: SUPPLEMENT_KM_CENTIMES,
    documentsPrefill: documentsData
      ? {
        adresse: documentsData.postalAddress || "",
        permisNumero: documentsData.permitNumber || "",
        permisDate: documentsData.permitDate || "",
        livraisonRue: documentsData.deliveryAddress || "",
        livraisonVille: reservation.adressePrise || "",
        secondConducteurNom: documentsData.secondDriver ? documentsData.secondDriver.lastName || "" : "",
        secondConducteurPrenom: documentsData.secondDriver ? documentsData.secondDriver.firstName || "" : "",
        secondConducteurPermisNumero: documentsData.secondDriver ? documentsData.secondDriver.permitNumber || "" : ""
      }
      : null,
    dossier: {
      status: dossier ? dossier.status : "draft",
      fields: dossier ? dossier.fields || null : null,
      cglAcceptedAt: dossier ? dossier.cglAcceptedAt || null : null,
      // L'agence a de toute façon un accès complet en lecture/écriture au
      // dossier (jeton agence) : contrairement à la vue CLIENT (jamais
      // d'écriture, jamais l'image tant que ce n'est pas elle qui vient de
      // signer), rien ne justifie de lui cacher l'image de signature une
      // fois le contrat signé — elle en a besoin pour le PDF définitif.
      signature: dossier && dossier.signature
        ? { signedAt: dossier.signature.signedAt, signatureId: dossier.signature.signatureId, imageDataUrl: dossier.signature.imageDataUrl }
        : null,
      depart,
      retour,
      kilometrage,
      observations: dossier ? dossier.observations || "" : ""
    }
  };
}

async function handleGet(request, env, headers) {
  const resolved = await resolveContractAgencyAccess(request, env);
  if (!resolved) return new Response(JSON.stringify({ error: "Lien invalide ou expiré" }), { status: 401, headers });
  return new Response(JSON.stringify(buildDossierView(resolved.reservation)), { status: 200, headers });
}

async function handlePost(request, env, headers) {
  const resolved = await resolveContractAgencyAccess(request, env);
  if (!resolved) return new Response(JSON.stringify({ error: "Lien invalide ou expiré" }), { status: 401, headers });
  const { reservation } = resolved;

  let payload;
  try {
    const rawBody = await request.text();
    if (!rawBody || rawBody.length > 20000) throw new Error("corps de requête vide ou trop volumineux");
    payload = JSON.parse(rawBody);
  } catch (e) {
    return new Response(JSON.stringify({ error: "Requête invalide" }), { status: 400, headers });
  }

  const existing = reservation.contractDossier || { status: "draft", fields: null, depart: null, retour: null, observations: "" };

  try {
    switch (payload.action) {
      case "update-fields": {
        const fields = validateContractFields(payload);
        const updated = await updateContractDossier(env, reservation.id, {
          contractDossier: { ...existing, fields, updatedAt: new Date().toISOString() }
        });
        if (!updated) return new Response(JSON.stringify({ error: "Réservation introuvable" }), { status: 404, headers });
        return new Response(JSON.stringify(buildDossierView(updated)), { status: 200, headers });
      }
      case "send-to-client": {
        const fields = existing.fields;
        const manquants = champsManquantsAvantEnvoi(fields);
        if (manquants.length) {
          return new Response(
            JSON.stringify({ error: "Informations obligatoires manquantes avant l'envoi", champsManquants: manquants }),
            { status: 400, headers }
          );
        }
        const clientAccess = await issueContractClientAccess(env);
        if (!clientAccess) {
          return new Response(JSON.stringify({ error: "Envoi indisponible pour le moment (configuration serveur)." }), { status: 503, headers });
        }
        const saved = await saveContractClientAccessIndex(env, reservation.id, clientAccess.stored.tokenHash, clientAccess.stored.expiresAt);
        if (!saved) {
          return new Response(JSON.stringify({ error: "Envoi indisponible pour le moment." }), { status: 503, headers });
        }
        const updated = await updateContractDossier(env, reservation.id, {
          contractDossier: { ...existing, status: "sent", sentAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
          contractClientAccess: clientAccess.stored
        });
        if (!updated) return new Response(JSON.stringify({ error: "Réservation introuvable" }), { status: 404, headers });
        const origin = env.SITE_URL || new URL(request.url).origin;
        // Jeton en FRAGMENT (#clientToken=), jamais en paramètre de requête
        // — voir send-contract-email.js pour le même principe côté agence.
        return new Response(
          JSON.stringify({ ...buildDossierView(updated), clientUrl: `${origin}/contrat.html#clientToken=${clientAccess.token}` }),
          { status: 200, headers }
        );
      }
      case "update-depart": {
        const depart = validateConditionReport(payload);
        const updated = await updateContractDossier(env, reservation.id, {
          contractDossier: { ...existing, depart, updatedAt: new Date().toISOString() }
        });
        if (!updated) return new Response(JSON.stringify({ error: "Réservation introuvable" }), { status: 404, headers });
        return new Response(JSON.stringify(buildDossierView(updated)), { status: 200, headers });
      }
      case "update-retour": {
        if (!existing.depart) {
          return new Response(JSON.stringify({ error: "La remise du véhicule doit être complétée avant la restitution" }), { status: 400, headers });
        }
        const retour = validateConditionReport(payload);
        const jours = joursReservation(reservation);
        const kilometrage = calculerKilometrage({ kmDepart: existing.depart.km, kmRetour: retour.km, jours });
        if (!kilometrage.valid) {
          return new Response(JSON.stringify({ error: kilometrage.error }), { status: 400, headers });
        }
        const updated = await updateContractDossier(env, reservation.id, {
          contractDossier: { ...existing, retour, updatedAt: new Date().toISOString() }
        });
        if (!updated) return new Response(JSON.stringify({ error: "Réservation introuvable" }), { status: 404, headers });
        return new Response(JSON.stringify(buildDossierView(updated)), { status: 200, headers });
      }
      case "update-observations": {
        const observations = typeof payload.observations === "string" ? payload.observations.trim().slice(0, 2000) : "";
        const updated = await updateContractDossier(env, reservation.id, {
          contractDossier: { ...existing, observations, updatedAt: new Date().toISOString() }
        });
        if (!updated) return new Response(JSON.stringify({ error: "Réservation introuvable" }), { status: 404, headers });
        return new Response(JSON.stringify(buildDossierView(updated)), { status: 200, headers });
      }
      default:
        return new Response(JSON.stringify({ error: "Action inconnue" }), { status: 400, headers });
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || "Requête invalide" }), { status: 400, headers });
  }
}

async function handleContractDossierAgency(request, env) {
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

  const rate = await checkRateLimit(env, `contract-dossier-agency:${clientIp(request)}`, { windowMs: 60000, maxRequests: 30 });
  if (!rate.allowed) {
    return new Response(JSON.stringify({ error: "Trop de requêtes, veuillez réessayer dans un instant." }), {
      status: 429,
      headers: { ...headers, "Retry-After": String(rate.retryAfterSeconds) }
    });
  }

  return request.method === "GET" ? handleGet(request, env, headers) : handlePost(request, env, headers);
}

module.exports = { handleContractDossierAgency, resolveContractAgencyAccess, buildDossierView };
