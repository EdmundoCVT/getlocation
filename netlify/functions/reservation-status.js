// netlify/functions/reservation-status.js
//
// Lecture publique (mais non énumérable) du statut d'une réservation, à
// partir de son identifiant. Utilisé par confirmation.html pour afficher un
// récapitulatif qui fait foi côté serveur, plutôt que de se fier uniquement
// à ce que le navigateur a stocké en localStorage (qui peut être modifié
// par l'utilisateur ou absent après un rechargement/partage de lien).
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
const { getReservation } = require("./lib/reservation-store.js");
const { checkRateLimit } = require("./lib/rate-limiter.js");

function getAllowedOrigins() {
  const origins = new Set(["https://getlocation.fr", "https://www.getlocation.fr"]);
  if (process.env.DEPLOY_PRIME_URL) origins.add(process.env.DEPLOY_PRIME_URL);
  if (process.env.URL) origins.add(process.env.URL);
  if (process.env.ALLOWED_ORIGINS) {
    process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean).forEach((o) => origins.add(o));
  }
  return origins;
}

function corsHeaders(event) {
  const allowed = getAllowedOrigins();
  const originHeader = event.headers && (event.headers.origin || event.headers.Origin);
  const headers = { "Content-Type": "application/json", Vary: "Origin", "Cache-Control": "no-store" };
  if (originHeader && allowed.has(originHeader)) {
    headers["Access-Control-Allow-Origin"] = originHeader;
  }
  return headers;
}

function clientIp(event) {
  const h = event.headers || {};
  return (
    h["x-nf-client-connection-ip"] ||
    h["client-ip"] ||
    (h["x-forwarded-for"] && h["x-forwarded-for"].split(",")[0].trim()) ||
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
    total: reservation.total,
    conducteur: reservation.conducteur
      ? { prenom: reservation.conducteur.prenom, nom: reservation.conducteur.nom, email: reservation.conducteur.email }
      : null,
    createdAt: reservation.createdAt
  };
}

exports.handler = async (event) => {
  const headers = corsHeaders(event);

  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: { ...headers, "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" },
      body: ""
    };
  }
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Méthode non autorisée" }) };
  }

  const rate = await checkRateLimit(`reservation-status:${clientIp(event)}`, { windowMs: 60000, maxRequests: 30 });
  if (!rate.allowed) {
    return {
      statusCode: 429,
      headers: { ...headers, "Retry-After": String(rate.retryAfterSeconds) },
      body: JSON.stringify({ error: "Trop de requêtes, veuillez réessayer dans un instant." })
    };
  }

  const id = event.queryStringParameters && event.queryStringParameters.id;
  if (!id || typeof id !== "string" || !/^res_[a-f0-9]{32}$/.test(id)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Identifiant de réservation invalide" }) };
  }

  const reservation = await getReservation(id);
  if (!reservation) {
    return { statusCode: 404, headers, body: JSON.stringify({ error: "Réservation introuvable" }) };
  }

  return { statusCode: 200, headers, body: JSON.stringify(toSafePublicView(reservation)) };
};
