// functions/api/reservation-status.js
//
// Adaptateur Cloudflare Pages Functions de netlify/functions/
// reservation-status.js — voir ce fichier pour le contexte complet
// (pourquoi l'id de réservation fait office de preuve d'accès, quels
// champs sont volontairement omis de la vue publique). Ne fait que
// traduire Request/env ↔ la même logique métier partagée
// (lib/server/reservation-store-kv.js) ; le comportement/les décisions de
// sécurité sont identiques à la version Netlify.

const { getVehiculeParId } = require("../../js/data.js");
const { createReservationStore } = require("../../lib/server/reservation-store-kv.js");
const { createRateLimiter } = require("../../lib/server/rate-limiter-kv.js");
const { corsHeaders } = require("../../lib/server/http-cors.js");

function clientIp(request) {
  // cf-connecting-ip : en-tête fiable posé par Cloudflare lui-même (non
  // falsifiable par le client), équivalent du x-nf-client-connection-ip
  // côté Netlify.
  return request.headers.get("cf-connecting-ip") || "unknown";
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

async function onRequestOptions({ request, env }) {
  const headers = corsHeaders(request, env, {
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  return new Response("", { status: 204, headers });
}

async function onRequestGet({ request, env }) {
  const headers = corsHeaders(request, env, { "Cache-Control": "no-store" });

  let rateLimiter;
  let store;
  try {
    rateLimiter = createRateLimiter(env.RATE_LIMITS_KV);
    store = createReservationStore(env.RESERVATIONS_KV);
  } catch (err) {
    // Échec bruyant volontaire (pas de repli mémoire silencieux) — voir
    // lib/server/reservation-store-kv.js et l'incident Netlify Blobs du
    // 12/08/2026 documenté dans DEPLOIEMENT.md.
    console.error("[reservation-status] Binding KV manquant :", err && err.message);
    return new Response(JSON.stringify({ error: "Service temporairement indisponible" }), { status: 500, headers });
  }

  const rate = await rateLimiter.checkRateLimit(`reservation-status:${clientIp(request)}`, {
    windowMs: 60000,
    maxRequests: 30
  });
  if (!rate.allowed) {
    headers.set("Retry-After", String(rate.retryAfterSeconds));
    return new Response(JSON.stringify({ error: "Trop de requêtes, veuillez réessayer dans un instant." }), {
      status: 429,
      headers
    });
  }

  const id = new URL(request.url).searchParams.get("id");
  if (!id || !/^res_[a-f0-9]{32}$/.test(id)) {
    return new Response(JSON.stringify({ error: "Identifiant de réservation invalide" }), { status: 400, headers });
  }

  const reservation = await store.getReservation(id);
  if (!reservation) {
    return new Response(JSON.stringify({ error: "Réservation introuvable" }), { status: 404, headers });
  }

  return new Response(JSON.stringify(toSafePublicView(reservation)), { status: 200, headers });
}

// Cloudflare Pages Functions exige la syntaxe d'export ES modules pour les
// handlers onRequest* (le fichier est bundlé par esbuild via wrangler, qui
// gère l'interop avec les require() ci-dessus vers nos modules CommonJS
// partagés — voir https://developers.cloudflare.com/pages/functions/module-support/).
export { onRequestGet, onRequestOptions };
