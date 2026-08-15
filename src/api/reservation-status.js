// src/api/reservation-status.js
//
// Lecture publique (mais non énumérable) du statut d'une réservation, à
// partir de son identifiant. Équivalent Cloudflare Worker de l'ancienne
// netlify/functions/reservation-status.js (Phase A, conservée telle quelle
// pour référence/rollback — voir DEPLOIEMENT.md, Phase B). Utilisé par
// confirmation.html pour afficher un récapitulatif qui fait foi côté
// serveur, plutôt que de se fier uniquement à ce que le navigateur a
// stocké en localStorage.
//
// Sécurité : l'identifiant de réservation est un jeton aléatoire non
// devinable (128 bits, cf. generateReservationId dans reservation-store.js)
// — le connaître fait office de preuve d'accès, comme sur la plupart des
// pages de confirmation de commande en ligne. Par prudence supplémentaire,
// cette fonction NE renvoie PAS les champs les plus sensibles du dossier
// (numéro de permis, téléphone, âge) : uniquement ce qui est nécessaire à
// l'affichage d'une confirmation (véhicule, dates, lieux, prénom/nom,
// e-mail, montant, statut).

const { getVehiculeParId } = require("../../js/data.js");
const { getReservation } = require("../lib/reservation-store.js");
const { checkRateLimit } = require("../lib/rate-limiter.js");

function getAllowedOrigins(request, env) {
  const origins = new Set(["https://getlocation.fr", "https://www.getlocation.fr", new URL(request.url).origin]);
  if (env.ALLOWED_ORIGINS) {
    env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean).forEach((o) => origins.add(o));
  }
  return origins;
}

function corsHeaders(request, env) {
  const allowed = getAllowedOrigins(request, env);
  const originHeader = request.headers.get("origin");
  const headers = { "Content-Type": "application/json", Vary: "Origin", "Cache-Control": "no-store" };
  if (originHeader && allowed.has(originHeader)) {
    headers["Access-Control-Allow-Origin"] = originHeader;
  }
  return headers;
}

function clientIp(request) {
  return (
    request.headers.get("cf-connecting-ip") ||
    (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    "unknown"
  );
}

function toSafePublicView(reservation) {
  const vehicule = getVehiculeParId(reservation.vehiculeId);
  return {
    id: reservation.id,
    status: reservation.status,
    vehicule: vehicule
      ? { id: vehicule.id, nom: vehicule.nom, photo: vehicule.photo, photoCutout: vehicule.photoCutout }
      : null,
    dateDebut: reservation.dateDebut,
    heureDebut: reservation.heureDebut,
    dateFin: reservation.dateFin,
    heureFin: reservation.heureFin,
    lieuPrise: reservation.lieuPrise,
    lieuRetour: reservation.lieuRetour,
    adressePrise: reservation.adressePrise,
    adresseRetour: reservation.adresseRetour,
    assurance: !!reservation.assurance,
    jours: reservation.jours,
    sousTotalBrut: reservation.sousTotalBrut,
    reductionDuree: reservation.reductionDuree || null,
    assuranceMontant: reservation.assuranceMontant,
    options: Array.isArray(reservation.options) ? reservation.options : [],
    optionsMontant: reservation.optionsMontant,
    codePromo: reservation.codePromo || null,
    reductionPromoMontant: reservation.reductionPromoMontant,
    total: reservation.total,
    conducteur: reservation.conducteur
      ? { prenom: reservation.conducteur.prenom, nom: reservation.conducteur.nom, email: reservation.conducteur.email }
      : null,
    createdAt: reservation.createdAt
  };
}

async function handleReservationStatus(request, env) {
  const headers = corsHeaders(request, env);

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { ...headers, "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" }
    });
  }
  if (request.method !== "GET") {
    return new Response(JSON.stringify({ error: "Méthode non autorisée" }), { status: 405, headers });
  }

  const rate = await checkRateLimit(env, `reservation-status:${clientIp(request)}`, { windowMs: 60000, maxRequests: 30 });
  if (!rate.allowed) {
    return new Response(JSON.stringify({ error: "Trop de requêtes, veuillez réessayer dans un instant." }), {
      status: 429,
      headers: { ...headers, "Retry-After": String(rate.retryAfterSeconds) }
    });
  }

  const id = new URL(request.url).searchParams.get("id");
  if (!id || typeof id !== "string" || !/^res_[a-f0-9]{32}$/.test(id)) {
    return new Response(JSON.stringify({ error: "Identifiant de réservation invalide" }), { status: 400, headers });
  }

  const reservation = await getReservation(env, id);
  if (!reservation) {
    return new Response(JSON.stringify({ error: "Réservation introuvable" }), { status: 404, headers });
  }

  return new Response(JSON.stringify(toSafePublicView(reservation)), { status: 200, headers });
}

module.exports = { handleReservationStatus };
