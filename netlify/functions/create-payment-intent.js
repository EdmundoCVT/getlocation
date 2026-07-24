// netlify/functions/create-payment-intent.js
//
// Crée un PaymentIntent Stripe pour une réservation.
//
// RÈGLE DE SÉCURITÉ CENTRALE : le montant facturé n'est JAMAIS accepté
// depuis le client. Le client envoie uniquement des paramètres métier
// (véhicule, dates/heures, lieux, assurance, coordonnées du conducteur) ;
// le prix qui fait foi est recalculé ici via calculerPrixTotal() de
// js/data.js — la même fonction qui sert à l'affichage côté navigateur,
// afin qu'aucune divergence de prix ne soit possible (cf. AUDIT.md, P0).
//
// La clé secrète Stripe (STRIPE_SECRET_KEY) doit être configurée dans
// Netlify > Site configuration > Environment variables. Elle n'est jamais
// exposée au navigateur : seule cette fonction, exécutée côté serveur,
// l'utilise.
//
// Limite connue (documentée, non résolue ici) : la vérification de
// disponibilité puis la création de la réservation ne sont pas atomiques.
// Deux requêtes strictement simultanées sur le même véhicule/mêmes dates
// pourraient toutes les deux passer la vérification avant qu'aucune des
// deux réservations ne soit enregistrée (fenêtre de course très étroite).
// Acceptable pour une petite flotte à faible volume ; à durcir (verrou
// distribué) si le volume de réservations augmente significativement.

const { calculerPrixTotal } = require("../../js/data.js");
const { validateReservationInput } = require("./lib/validate-reservation-input.js");
const {
  createReservation,
  updateReservationStatus,
  hasOverlappingReservation
} = require("./lib/reservation-store.js");
const { checkRateLimit } = require("./lib/rate-limiter.js");

// Domaines autorisés à appeler cette fonction en cross-origin.
// - Production : toujours autorisée (getlocation.fr / www.getlocation.fr).
// - Déploiements Netlify (previews) : URL/DEPLOY_PRIME_URL sont injectées
//   automatiquement par Netlify au runtime (aucune valeur inventée ici).
// - ALLOWED_ORIGINS (optionnel) : liste supplémentaire séparée par des
//   virgules, à définir dans les variables d'environnement Netlify si
//   d'autres domaines de confiance doivent être ajoutés.
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
  const headers = { "Content-Type": "application/json", Vary: "Origin" };
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

exports.handler = async (event) => {
  const headers = corsHeaders(event);

  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: { ...headers, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" },
      body: ""
    };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Méthode non autorisée" }) };
  }

  // Protection anti-abus basique (best effort, cf. lib/rate-limiter.js —
  // limites documentées dans ce fichier).
  const rate = await checkRateLimit(`create-payment-intent:${clientIp(event)}`, {
    windowMs: 60000,
    maxRequests: 8
  });
  if (!rate.allowed) {
    return {
      statusCode: 429,
      headers: { ...headers, "Retry-After": String(rate.retryAfterSeconds) },
      body: JSON.stringify({ error: "Trop de requêtes, veuillez réessayer dans un instant." })
    };
  }

  let payload;
  try {
    if (!event.body || event.body.length > 20000) throw new Error("corps de requête vide ou trop volumineux");
    payload = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Requête invalide" }) };
  }

  const { valid, errors, vehicule, options, codePromo } = validateReservationInput(payload);
  if (!valid) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Requête invalide", details: errors }) };
  }

  // Le prix qui fait foi est recalculé uniquement à partir des champs déjà
  // validés/normalisés ci-dessus (options, codePromo) — jamais depuis
  // `payload.options`/`payload.codePromo` bruts, qui pourraient contenir des
  // valeurs non vérifiées.
  const prix = calculerPrixTotal({ ...payload, options, codePromo });
  if (!prix || !isFinite(prix.totalCentimes) || prix.totalCentimes < 50) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Impossible de calculer le prix pour cette demande" }) };
  }

  // Stripe non configuré : réponse honnête (code dédié) plutôt qu'une
  // fausse promesse de paiement en ligne opérationnel. Le client (P0-6)
  // doit alors proposer un repli téléphone/WhatsApp.
  if (!process.env.STRIPE_SECRET_KEY) {
    return {
      statusCode: 503,
      headers,
      body: JSON.stringify({
        error: "Le paiement en ligne n'est pas encore configuré.",
        code: "stripe_not_configured"
      })
    };
  }

  const periodeDebut = new Date(`${payload.dateDebut}T${payload.heureDebut}:00`).toISOString();
  const periodeFin = new Date(`${payload.dateFin}T${payload.heureFin}:00`).toISOString();

  const overlap = await hasOverlappingReservation(vehicule.id, periodeDebut, periodeFin);
  if (overlap) {
    return {
      statusCode: 409,
      headers,
      body: JSON.stringify({
        error: "Ce véhicule n'est plus disponible sur les dates sélectionnées.",
        code: "not_available"
      })
    };
  }

  const reservation = await createReservation({
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
    assurance: !!payload.assurance,
    jours: prix.jours,
    sousTotalBrut: prix.sousTotalBrut,
    reductionDuree: prix.reductionDuree,
    assuranceMontant: prix.assuranceMontant,
    options: prix.optionsSelectionnees,
    optionsMontant: prix.optionsMontant,
    codePromo: prix.codePromo,
    reductionPromoMontant: prix.reductionPromoMontant,
    total: prix.total,
    cglVersion: payload.cglVersion,
    cglAcceptedAt: new Date().toISOString(),
    conducteur: {
      nom: payload.conducteur.nom.trim(),
      prenom: payload.conducteur.prenom.trim(),
      email: payload.conducteur.email.trim(),
      telephone: payload.conducteur.telephone.trim(),
      permis: payload.conducteur.permis.trim(),
      age: Number(payload.conducteur.age)
    }
  });

  try {
    const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

    const requestOptions = {};
    if (payload.idempotencyKey) {
      // Préfixé pour éviter toute collision avec d'autres appels Stripe
      // utilisant potentiellement la même valeur brute pour un autre usage.
      requestOptions.idempotencyKey = `create-payment-intent_${payload.idempotencyKey}`;
    }

    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: prix.totalCentimes,
        currency: "eur", // toujours EUR — jamais une valeur fournie par le client
        description: `Location ${vehicule.nom} — ${prix.jours} jour(s) — réservation ${reservation.id}`,
        receipt_email: reservation.conducteur.email,
        automatic_payment_methods: { enabled: true },
        metadata: {
          reservationId: reservation.id,
          vehiculeId: vehicule.id,
          jours: String(prix.jours),
          assurance: String(!!payload.assurance),
          options: prix.optionsSelectionnees.map((o) => o.id).join(",") || "aucune",
          codePromo: prix.codePromo ? prix.codePromo.code : "aucun"
        }
      },
      requestOptions
    );

    await updateReservationStatus(reservation.id, "pending_payment", {
      paymentIntentId: paymentIntent.id
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ clientSecret: paymentIntent.client_secret, reservationId: reservation.id })
    };
  } catch (err) {
    // Ne jamais renvoyer err.message brut au client (peut contenir des
    // détails internes) : on journalise côté serveur uniquement le type et
    // le code d'erreur Stripe (jamais de données personnelles).
    console.error("[create-payment-intent] Erreur Stripe :", err && err.type, err && err.code);
    await updateReservationStatus(reservation.id, "cancelled", { failureReason: "stripe_error" });
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Le paiement n'a pas pu être initialisé. Veuillez réessayer." })
    };
  }
};
