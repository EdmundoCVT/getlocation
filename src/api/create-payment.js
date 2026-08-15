// src/api/create-payment.js
//
// Crée un paiement Mollie pour une réservation. Équivalent Cloudflare
// Worker de l'ancienne netlify/functions/create-payment.js (Phase A,
// conservée telle quelle pour référence/rollback tant que cette version
// n'est pas confirmée en production — voir DEPLOIEMENT.md, Phase B).
//
// RÈGLE DE SÉCURITÉ CENTRALE (inchangée) : le montant facturé n'est JAMAIS
// accepté depuis le client. Le client envoie uniquement des paramètres
// métier (véhicule, dates/heures, lieux, options, coordonnées du
// conducteur) ; le prix qui fait foi est recalculé ici via
// calculerPrixTotal() de js/data.js — la même fonction qui sert à
// l'affichage côté navigateur, afin qu'aucune divergence de prix ne soit
// possible (cf. AUDIT.md, P0).
//
// La clé API Mollie (MOLLIE_API_KEY) doit être configurée comme secret
// Cloudflare Worker (`wrangler secret put MOLLIE_API_KEY`). Elle n'est
// jamais exposée au navigateur : seule cette fonction, exécutée côté
// serveur, l'utilise.
//
// Depuis que le site et les fonctions serveur sont tous les deux servis par
// ce même Worker Cloudflare (Phase B), redirectUrl ET webhookUrl peuvent
// tous les deux utiliser l'origine de la requête entrante sans risque de
// pointer vers un domaine qui ne sert plus les fonctions (contrairement à
// la Phase A, où le site était déjà basculé sur Cloudflare mais les
// fonctions restaient sur Netlify — voir l'historique git de
// netlify/functions/create-payment.js pour le détail de ce problème,
// aujourd'hui résolu par la disparition même de la séparation de domaines).
//
// Limite connue (documentée, non résolue ici) : la vérification de
// disponibilité puis la création de la réservation ne sont pas atomiques.
// Deux requêtes strictement simultanées sur le même véhicule/mêmes dates
// pourraient toutes les deux passer la vérification avant qu'aucune des
// deux réservations ne soit enregistrée (fenêtre de course très étroite).
// Acceptable pour une petite flotte à faible volume ; à durcir (verrou
// distribué) si le volume de réservations augmente significativement.

const { calculerPrixTotal } = require("../../js/data.js");
const { validateReservationInput } = require("../lib/validate-reservation-input.js");
const {
  createReservation,
  updateReservationStatus,
  hasOverlappingReservation
} = require("../lib/reservation-store.js");
const { checkRateLimit } = require("../lib/rate-limiter.js");
const { createPayment: createMolliePayment } = require("../lib/mollie-client.js");

// Domaines autorisés à appeler cette fonction en cross-origin.
// - Production : toujours autorisée (getlocation.fr / www.getlocation.fr).
// - L'origine de la requête elle-même est toujours autorisée : comme le
//   site et l'API sont servis par le même Worker, ceci couvre nativement
//   les domaines de prévisualisation (*.workers.dev) sans variable
//   d'environnement à maintenir.
// - ALLOWED_ORIGINS (optionnel, secret Worker) : liste supplémentaire
//   séparée par des virgules, pour d'autres domaines de confiance.
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
  const headers = { "Content-Type": "application/json", Vary: "Origin" };
  if (originHeader && allowed.has(originHeader)) {
    headers["Access-Control-Allow-Origin"] = originHeader;
  }
  return headers;
}

// Origine utilisée pour construire redirectUrl et webhookUrl : celle de la
// requête si elle est autorisée (cross-origin connu), sinon l'origine du
// Worker lui-même — jamais une valeur inventée.
function siteOrigin(request, env) {
  const allowed = getAllowedOrigins(request, env);
  const originHeader = request.headers.get("origin");
  if (originHeader && allowed.has(originHeader)) return originHeader;
  return new URL(request.url).origin;
}

function clientIp(request) {
  return (
    request.headers.get("cf-connecting-ip") ||
    (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    "unknown"
  );
}

// Code de test interne (jamais présent dans js/data.js, donc jamais exposé
// au navigateur ni visible dans le code source public) : si le code promo
// saisi correspond exactement à TEST_DISCOUNT_CODE (secret Worker, jamais
// commité), le montant facturé est ramené à 0,10 € au lieu du tarif normal.
// Sert à valider en conditions réelles (Mollie live) le parcours complet
// paiement + email de confirmation sans payer le plein tarif à chaque test.
// Le contrôle de prix minimum plus haut (prix.totalCentimes < 50) porte sur
// le tarif RÉEL calculé avant remise de test, jamais sur ce montant réduit :
// descendre sous 50 centimes ici n'a donc pas besoin d'un cas particulier.
const TEST_DISCOUNT_CENTIMES = 10; // 0,10 €
function resolverMontantFacture(prix, codePromoBrut, testDiscountCode) {
  if (testDiscountCode && codePromoBrut && codePromoBrut.trim().toUpperCase() === testDiscountCode.trim().toUpperCase()) {
    return { totalCentimesFacture: TEST_DISCOUNT_CENTIMES, totalFacture: TEST_DISCOUNT_CENTIMES / 100 };
  }
  return { totalCentimesFacture: prix.totalCentimes, totalFacture: prix.total };
}

async function handleCreatePayment(request, env) {
  const headers = corsHeaders(request, env);

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { ...headers, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" }
    });
  }
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Méthode non autorisée" }), { status: 405, headers });
  }

  // Protection anti-abus basique (best effort, cf. lib/rate-limiter.js —
  // limites documentées dans ce fichier).
  const rate = await checkRateLimit(env, `create-payment:${clientIp(request)}`, { windowMs: 60000, maxRequests: 8 });
  if (!rate.allowed) {
    return new Response(JSON.stringify({ error: "Trop de requêtes, veuillez réessayer dans un instant." }), {
      status: 429,
      headers: { ...headers, "Retry-After": String(rate.retryAfterSeconds) }
    });
  }

  let payload;
  try {
    const rawBody = await request.text();
    if (!rawBody || rawBody.length > 20000) throw new Error("corps de requête vide ou trop volumineux");
    payload = JSON.parse(rawBody);
  } catch (e) {
    return new Response(JSON.stringify({ error: "Requête invalide" }), { status: 400, headers });
  }

  const { valid, errors, vehicule, options, codePromo } = validateReservationInput(payload);
  if (!valid) {
    return new Response(JSON.stringify({ error: "Requête invalide", details: errors }), { status: 400, headers });
  }

  // Le prix qui fait foi est recalculé uniquement à partir des champs déjà
  // validés/normalisés ci-dessus (options, codePromo) — jamais depuis
  // `payload.options`/`payload.codePromo` bruts, qui pourraient contenir des
  // valeurs non vérifiées.
  const prix = calculerPrixTotal({ ...payload, options, codePromo });
  if (!prix || !isFinite(prix.totalCentimes) || prix.totalCentimes < 50) {
    return new Response(JSON.stringify({ error: "Impossible de calculer le prix pour cette demande" }), { status: 400, headers });
  }

  const { totalCentimesFacture, totalFacture } = resolverMontantFacture(prix, codePromo, env.TEST_DISCOUNT_CODE);

  // Mollie non configuré : réponse honnête (code dédié) plutôt qu'une
  // fausse promesse de paiement en ligne opérationnel. Le client doit alors
  // proposer un repli téléphone/WhatsApp.
  if (!env.MOLLIE_API_KEY) {
    return new Response(
      JSON.stringify({ error: "Le paiement en ligne n'est pas encore configuré.", code: "mollie_not_configured" }),
      { status: 503, headers }
    );
  }

  const periodeDebut = new Date(`${payload.dateDebut}T${payload.heureDebut}:00`).toISOString();
  const periodeFin = new Date(`${payload.dateFin}T${payload.heureFin}:00`).toISOString();

  const overlap = await hasOverlappingReservation(env, vehicule.id, periodeDebut, periodeFin);
  if (overlap) {
    return new Response(
      JSON.stringify({ error: "Ce véhicule n'est plus disponible sur les dates sélectionnées.", code: "not_available" }),
      { status: 409, headers }
    );
  }

  const reservation = await createReservation(env, {
    vehiculeId: vehicule.id,
    dateDebut: payload.dateDebut,
    heureDebut: payload.heureDebut,
    dateFin: payload.dateFin,
    heureFin: payload.heureFin,
    periodeDebut,
    periodeFin,
    lieuPrise: payload.lieuPrise || null,
    lieuRetour: payload.lieuRetour || null,
    adressePrise: payload.adressePrise || null,
    adresseRetour: payload.adresseRetour || null,
    jours: prix.jours,
    sousTotalBrut: prix.sousTotalBrut,
    reductionDuree: prix.reductionDuree,
    options: prix.optionsSelectionnees,
    optionsMontant: prix.optionsMontant,
    codePromo: prix.codePromo,
    reductionPromoMontant: prix.reductionPromoMontant,
    total: totalFacture,
    cglVersion: payload.cglVersion,
    cglAcceptedAt: new Date().toISOString(),
    conducteur: {
      nom: payload.conducteur.nom.trim(),
      prenom: payload.conducteur.prenom.trim(),
      email: payload.conducteur.email.trim(),
      telephone: payload.conducteur.telephone.trim(),
      naissance: payload.conducteur.naissance
    }
  });

  try {
    const origin = siteOrigin(request, env);

    const payment = await createMolliePayment(
      env.MOLLIE_API_KEY,
      {
        amount: {
          currency: "EUR", // toujours EUR — jamais une valeur fournie par le client
          value: (totalCentimesFacture / 100).toFixed(2)
        },
        description: `Location ${vehicule.nom} — ${prix.jours} jour(s) — réservation ${reservation.id}`,
        redirectUrl: `${origin}/confirmation.html?reservation=${encodeURIComponent(reservation.id)}`,
        webhookUrl: `${origin}/api/mollie-webhook`,
        metadata: {
          reservationId: reservation.id,
          vehiculeId: vehicule.id,
          jours: String(prix.jours),
          options: prix.optionsSelectionnees.map((o) => o.id).join(",") || "aucune",
          codePromo: prix.codePromo ? prix.codePromo.code : "aucun"
        }
      },
      payload.idempotencyKey
    );

    await updateReservationStatus(env, reservation.id, "pending_payment", { paymentId: payment.id });

    return new Response(JSON.stringify({ checkoutUrl: payment._links.checkout.href, reservationId: reservation.id }), {
      status: 200,
      headers
    });
  } catch (err) {
    // Ne jamais renvoyer err.message brut au client (peut contenir des
    // détails internes) : on journalise côté serveur uniquement de quoi
    // diagnostiquer (jamais de données personnelles).
    console.error("[create-payment] Erreur Mollie :", err && err.message);
    await updateReservationStatus(env, reservation.id, "cancelled", { failureReason: "mollie_error" });
    return new Response(JSON.stringify({ error: "Le paiement n'a pas pu être initialisé. Veuillez réessayer." }), {
      status: 500,
      headers
    });
  }
}

module.exports = { handleCreatePayment, resolverMontantFacture };
