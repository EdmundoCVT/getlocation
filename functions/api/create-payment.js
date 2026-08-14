// functions/api/create-payment.js
//
// Adaptateur Cloudflare Pages Functions de netlify/functions/
// create-payment.js — voir ce fichier pour le contexte complet (règle de
// sécurité centrale : le prix qui fait foi est toujours recalculé
// serveur, jamais accepté du client ; modèle Mollie ; limite connue de
// non-atomicité vérification/réservation). Ne fait que traduire
// Request/env ↔ la même logique métier partagée (lib/server/) ; aucune
// décision de sécurité n'est dupliquée ou réinventée ici.

const { calculerPrixTotal } = require("../../js/data.js");
const { validateReservationInput } = require("../../lib/server/validate-reservation-input.js");
const { createReservationStore } = require("../../lib/server/reservation-store-kv.js");
const { createRateLimiter } = require("../../lib/server/rate-limiter-kv.js");
const { molliePaymentsCreate } = require("../../lib/server/mollie-client.js");
const { corsHeaders } = require("../../lib/server/http-cors.js");

function clientIp(request) {
  return request.headers.get("cf-connecting-ip") || "unknown";
}

// Voir create-payment.js (Netlify) : code de test interne, no-op strict
// sans TEST_DISCOUNT_CODE configurée.
const TEST_DISCOUNT_CENTIMES = 99; // 0,99 €
function resolverMontantFacture(prix, codePromoBrut, testDiscountCode) {
  if (testDiscountCode && codePromoBrut && codePromoBrut.trim().toUpperCase() === testDiscountCode.trim().toUpperCase()) {
    return { totalCentimesFacture: TEST_DISCOUNT_CENTIMES, totalFacture: TEST_DISCOUNT_CENTIMES / 100 };
  }
  return { totalCentimesFacture: prix.totalCentimes, totalFacture: prix.total };
}

async function onRequestOptions({ request, env }) {
  const headers = corsHeaders(request, env, {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  return new Response("", { status: 204, headers });
}

async function onRequestPost({ request, env }) {
  const headers = corsHeaders(request, env);

  let rateLimiter;
  let store;
  try {
    rateLimiter = createRateLimiter(env.RATE_LIMITS_KV);
    store = createReservationStore(env.RESERVATIONS_KV);
  } catch (err) {
    // Échec bruyant volontaire (pas de repli mémoire silencieux) — voir
    // lib/server/reservation-store-kv.js et l'incident Netlify Blobs du
    // 12/08/2026 documenté dans DEPLOIEMENT.md.
    console.error("[create-payment] Binding KV manquant :", err && err.message);
    return new Response(JSON.stringify({ error: "Service temporairement indisponible" }), { status: 500, headers });
  }

  const rate = await rateLimiter.checkRateLimit(`create-payment:${clientIp(request)}`, {
    windowMs: 60000,
    maxRequests: 8
  });
  if (!rate.allowed) {
    headers.set("Retry-After", String(rate.retryAfterSeconds));
    return new Response(JSON.stringify({ error: "Trop de requêtes, veuillez réessayer dans un instant." }), {
      status: 429,
      headers
    });
  }

  let payload;
  try {
    const raw = await request.text();
    if (!raw || raw.length > 20000) throw new Error("corps de requête vide ou trop volumineux");
    payload = JSON.parse(raw);
  } catch (e) {
    return new Response(JSON.stringify({ error: "Requête invalide" }), { status: 400, headers });
  }

  const { valid, errors, vehicule, options, codePromo } = validateReservationInput(payload);
  if (!valid) {
    return new Response(JSON.stringify({ error: "Requête invalide", details: errors }), { status: 400, headers });
  }

  // Le prix qui fait foi est recalculé uniquement à partir des champs déjà
  // validés/normalisés ci-dessus — jamais depuis payload.options/
  // payload.codePromo bruts.
  const prix = calculerPrixTotal({ ...payload, options, codePromo });
  if (!prix || !isFinite(prix.totalCentimes) || prix.totalCentimes < 50) {
    return new Response(JSON.stringify({ error: "Impossible de calculer le prix pour cette demande" }), {
      status: 400,
      headers
    });
  }

  const { totalCentimesFacture, totalFacture } = resolverMontantFacture(prix, codePromo, env.TEST_DISCOUNT_CODE);

  // Mollie non configuré : réponse honnête plutôt qu'une fausse promesse de
  // paiement en ligne opérationnel — voir create-payment.js (Netlify).
  if (!env.MOLLIE_API_KEY) {
    return new Response(
      JSON.stringify({ error: "Le paiement en ligne n'est pas encore configuré.", code: "mollie_not_configured" }),
      { status: 503, headers }
    );
  }

  const periodeDebut = new Date(`${payload.dateDebut}T${payload.heureDebut}:00`).toISOString();
  const periodeFin = new Date(`${payload.dateFin}T${payload.heureFin}:00`).toISOString();

  const overlap = await store.hasOverlappingReservation(vehicule.id, periodeDebut, periodeFin);
  if (overlap) {
    return new Response(
      JSON.stringify({ error: "Ce véhicule n'est plus disponible sur les dates sélectionnées.", code: "not_available" }),
      { status: 409, headers }
    );
  }

  const reservation = await store.createReservation({
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
    // Une fois la Phase B en production, front et fonctions sont sur le
    // même domaine (voir lib/server/http-cors.js) : contrairement à la
    // Phase A (voir create-payment.js Netlify, netlifyFunctionsOrigin()),
    // l'origine de CETTE requête est toujours celle qui a réellement
    // atteint cette fonction — pas de risque qu'un domaine personnalisé
    // "mente" comme process.env.URL côté Netlify. redirectUrl et
    // webhookUrl peuvent donc tous deux utiliser la même origine.
    const origin = new URL(request.url).origin;

    const payment = await molliePaymentsCreate(
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

    await store.updateReservationStatus(reservation.id, "pending_payment", { paymentId: payment.id });

    return new Response(
      JSON.stringify({ checkoutUrl: payment._links.checkout.href, reservationId: reservation.id }),
      { status: 200, headers }
    );
  } catch (err) {
    // Ne jamais renvoyer err.message brut au client — voir create-payment.js
    // (Netlify) pour la justification complète.
    console.error("[create-payment] Erreur Mollie :", err && err.message);
    await store.updateReservationStatus(reservation.id, "cancelled", { failureReason: "mollie_error" });
    return new Response(JSON.stringify({ error: "Le paiement n'a pas pu être initialisé. Veuillez réessayer." }), {
      status: 500,
      headers
    });
  }
}

export { onRequestPost, onRequestOptions };
