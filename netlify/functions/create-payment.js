// netlify/functions/create-payment.js
//
// Crée un paiement Mollie pour une réservation.
//
// RÈGLE DE SÉCURITÉ CENTRALE : le montant facturé n'est JAMAIS accepté
// depuis le client. Le client envoie uniquement des paramètres métier
// (véhicule, dates/heures, lieux, options, coordonnées du conducteur) ;
// le prix qui fait foi est recalculé ici via calculerPrixTotal() de
// js/data.js — la même fonction qui sert à l'affichage côté navigateur,
// afin qu'aucune divergence de prix ne soit possible (cf. AUDIT.md, P0).
//
// La clé API Mollie (MOLLIE_API_KEY) doit être configurée dans
// Netlify > Site configuration > Environment variables. Elle n'est jamais
// exposée au navigateur : seule cette fonction, exécutée côté serveur,
// l'utilise.
//
// Modèle Mollie (différent de Stripe) : pas de formulaire carte embarqué.
// Le client est redirigé vers une page de paiement hébergée par Mollie
// (_links.checkout.href), puis Mollie le renvoie vers `redirectUrl` à la
// fin. La confirmation qui fait foi arrive séparément via `mollie-webhook`
// (voir ce fichier pour le détail du modèle de vérification).
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

// Origine utilisée pour construire redirectUrl/webhookUrl : celle de la
// requête si elle est autorisée (cross-origin connu), sinon la valeur
// injectée par Netlify (déploiement courant) — jamais une valeur inventée.
function siteOrigin(event) {
  const allowed = getAllowedOrigins();
  const originHeader = event.headers && (event.headers.origin || event.headers.Origin);
  if (originHeader && allowed.has(originHeader)) return originHeader;
  return process.env.URL || process.env.DEPLOY_PRIME_URL || "https://getlocation.fr";
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

// Code de test interne (jamais présent dans js/data.js, donc jamais exposé
// au navigateur ni visible dans le code source public) : si le code promo
// saisi correspond exactement à TEST_DISCOUNT_CODE (secret configuré côté
// Netlify, jamais commité), le montant facturé est ramené à 0,99 € au lieu
// du tarif normal. Sert à valider en conditions réelles (Mollie live) le
// parcours complet paiement + email de confirmation sans payer le plein
// tarif à chaque test. Sans TEST_DISCOUNT_CODE configurée, cette fonction
// est un no-op strict : le montant normal est toujours renvoyé tel quel.
// Le détail du prix (sous-total, options, réduction promo classique...)
// enregistré dans la réservation reste celui du calcul normal — seul le
// montant effectivement facturé est réduit.
const TEST_DISCOUNT_CENTIMES = 99; // 0,99 €
function resolverMontantFacture(prix, codePromoBrut, testDiscountCode) {
  if (testDiscountCode && codePromoBrut && codePromoBrut.trim().toUpperCase() === testDiscountCode.trim().toUpperCase()) {
    return { totalCentimesFacture: TEST_DISCOUNT_CENTIMES, totalFacture: TEST_DISCOUNT_CENTIMES / 100 };
  }
  return { totalCentimesFacture: prix.totalCentimes, totalFacture: prix.total };
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
  const rate = await checkRateLimit(`create-payment:${clientIp(event)}`, {
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

  // Code de test interne (voir resolverMontantFacture ci-dessous) : permet
  // de valider en conditions réelles (Mollie live) le parcours complet
  // paiement + email de confirmation pour un montant minime, plutôt que le
  // tarif réel du véhicule.
  const { totalCentimesFacture, totalFacture } = resolverMontantFacture(prix, codePromo, process.env.TEST_DISCOUNT_CODE);

  // Mollie non configuré : réponse honnête (code dédié) plutôt qu'une
  // fausse promesse de paiement en ligne opérationnel. Le client (P0-6)
  // doit alors proposer un repli téléphone/WhatsApp.
  if (!process.env.MOLLIE_API_KEY) {
    return {
      statusCode: 503,
      headers,
      body: JSON.stringify({
        error: "Le paiement en ligne n'est pas encore configuré.",
        code: "mollie_not_configured"
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
    const { createMollieClient } = require("@mollie/api-client");
    const mollieClient = createMollieClient({ apiKey: process.env.MOLLIE_API_KEY });

    const origin = siteOrigin(event);

    const payment = await mollieClient.payments.create({
      amount: {
        currency: "EUR", // toujours EUR — jamais une valeur fournie par le client
        value: (totalCentimesFacture / 100).toFixed(2)
      },
      description: `Location ${vehicule.nom} — ${prix.jours} jour(s) — réservation ${reservation.id}`,
      redirectUrl: `${origin}/confirmation.html?reservation=${encodeURIComponent(reservation.id)}`,
      webhookUrl: `${origin}/.netlify/functions/mollie-webhook`,
      // Réutilise la clé générée une fois côté client (voir js/app.js,
      // initPaiementPage) : un double-clic/retry réseau avec la même clé
      // renvoie la réponse déjà enregistrée par Mollie au lieu de créer un
      // second paiement (cf. https://docs.mollie.com/reference/api-idempotency).
      idempotencyKey: payload.idempotencyKey,
      metadata: {
        reservationId: reservation.id,
        vehiculeId: vehicule.id,
        jours: String(prix.jours),
        options: prix.optionsSelectionnees.map((o) => o.id).join(",") || "aucune",
        codePromo: prix.codePromo ? prix.codePromo.code : "aucun"
      }
    });

    await updateReservationStatus(reservation.id, "pending_payment", {
      paymentId: payment.id
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ checkoutUrl: payment._links.checkout.href, reservationId: reservation.id })
    };
  } catch (err) {
    // Ne jamais renvoyer err.message brut au client (peut contenir des
    // détails internes) : on journalise côté serveur uniquement de quoi
    // diagnostiquer (jamais de données personnelles).
    console.error("[create-payment] Erreur Mollie :", err && err.message);
    await updateReservationStatus(reservation.id, "cancelled", { failureReason: "mollie_error" });
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Le paiement n'a pas pu être initialisé. Veuillez réessayer." })
    };
  }
};

// Exporté pour les tests unitaires (calcul du montant facturé sans passer
// par l'appel HTTP complet ni par Mollie).
exports.resolverMontantFacture = resolverMontantFacture;
