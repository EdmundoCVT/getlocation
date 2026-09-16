// src/lib/deposit-authorizations.js
//
// Empreinte bancaire / préautorisation de carte Mollie (captureMode
// "manual") pour le dépôt de garantie d'une location — voir CLAUDE.md.
//
// JAMAIS confondue avec la caution "classique" enregistrée à la main (voir
// src/lib/deposits.js, table `deposits`, modes carte physique/espèces/
// virement) : mécanisme séparé, table séparée (migrations/
// 0005_deposit_authorizations.sql), jamais les deux pour la même location.
//
// Principe central, comme pour un paiement de location (voir
// create-payment.js/mollie-webhook.js) : le serveur ne fait JAMAIS
// confiance à un statut ou un montant transmis par le navigateur ou par le
// corps d'un webhook. Toute mise à jour de statut passe par
// syncFromMolliePayment(), qui ne prend en entrée que la réponse de l'API
// Mollie elle-même (GET /v2/payments/:id, toujours rappelé après toute
// action — création, capture, libération, ou notification webhook).
//
// Montant : par défaut, celui du véhicule loué (VEHICULES[].caution, voir
// js/data.js — seule source de vérité, voir CLAUDE.md règle n°1). L'agence
// peut le surclasser explicitement (même logique que src/lib/deposits.js,
// qui laisse déjà l'agence saisir un montant libre pour une caution
// classique) ; le montant envoyé à Mollie est dans tous les cas recalculé
// et validé ici, jamais transmis tel quel depuis le corps de la requête à
// l'API Mollie sans passer par toCents()/defaultAmountCentsForRental().
//
// Clé Mollie utilisée : MOLLIE_DEPOSIT_API_KEY, secret Cloudflare Worker
// DISTINCT de MOLLIE_API_KEY (paiement de location, déjà en mode live en
// production) — voir DEPLOIEMENT.md et migrations/0005.

const { getVehiculeParId } = require("../../js/data.js");
const { generateId } = require("./id.js");
const { getRentalById } = require("./rentals.js");
const {
  createPayment: createMolliePayment,
  getPayment,
  cancelPayment,
  createCapture
} = require("./mollie-client.js");

// États "actifs" possibles avant l'un des états terminaux ci-dessous.
const STATUTS_INTERNES = [
  "lien_cree",
  "en_attente",
  "autorisee",
  "liberee",
  "capturee_partielle",
  "capturee",
  "expiree",
  "annulee",
  "echouee"
];

// États terminaux : plus aucune action Mollie possible sur cette ligne — une
// nouvelle demande de caution pour la même location crée une NOUVELLE ligne
// (voir getActiveDepositAuthorization, qui ignore les lignes terminales).
const STATUTS_TERMINAUX = ["liberee", "capturee", "expiree", "annulee", "echouee"];

// Actionnable par l'agence : "Débiter tout ou partie" reste possible tant
// que le montant autorisé n'est pas intégralement capturé.
const STATUTS_CAPTURABLES = ["autorisee", "capturee_partielle"];

function isTestApiKey(apiKey) {
  return typeof apiKey === "string" && apiKey.startsWith("test_");
}

function toCents(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) throw new Error("Montant invalide");
  return Math.round(n * 100);
}

// Lit un montant Mollie ({ currency, value }, value étant une chaîne du
// type "12.34") — renvoie null si le champ est absent, jamais une valeur
// devinée. Utilisé pour payment.amountCaptured, dont le nom exact n'a pas
// pu être vérifié en conditions réelles dans cet environnement (accès
// réseau sortant vers l'API Mollie bloqué ici, voir scripts/
// test-deposit-authorization.js) : si Mollie ne renvoie pas ce champ tel
// quel, le code se rabat sur son propre décompte (voir captureCents dans
// captureDepositAuthorization) plutôt que d'échouer.
function centsFromMollieAmount(amount) {
  if (!amount || typeof amount.value !== "string") return null;
  const n = Number(amount.value);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function defaultAmountCentsForRental(rental) {
  const vehicule = getVehiculeParId(rental.vehiculeId);
  if (!vehicule) throw new Error("Véhicule inconnu pour cette location");
  return Math.round(vehicule.caution * 100);
}

function rowToAuthorization(row) {
  if (!row) return null;
  return {
    id: row.id,
    rentalId: row.rental_id,
    molliePaymentId: row.mollie_payment_id || null,
    authorizedAmountCents: row.authorized_amount_cents,
    capturedAmountCents: row.captured_amount_cents,
    currency: row.currency,
    status: row.status,
    mollieStatus: row.mollie_status || null,
    checkoutUrl: row.checkout_url || null,
    captureBefore: row.capture_before || null,
    testMode: Boolean(row.test_mode),
    authorizedAt: row.authorized_at || null,
    releasedAt: row.released_at || null,
    capturedAt: row.captured_at || null,
    failureReason: row.failure_reason || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by
  };
}

async function getDepositAuthorizationById(env, id) {
  if (!id) return null;
  const row = await env.AGENCY_DB.prepare("SELECT * FROM deposit_authorizations WHERE id = ?").bind(id).first();
  return rowToAuthorization(row);
}

async function getDepositAuthorizationByMolliePaymentId(env, molliePaymentId) {
  if (!molliePaymentId) return null;
  const row = await env.AGENCY_DB.prepare("SELECT * FROM deposit_authorizations WHERE mollie_payment_id = ?").bind(molliePaymentId).first();
  return rowToAuthorization(row);
}

async function listDepositAuthorizationsForRental(env, rentalId) {
  if (!rentalId) return [];
  const res = await env.AGENCY_DB.prepare(
    "SELECT * FROM deposit_authorizations WHERE rental_id = ? ORDER BY created_at DESC"
  ).bind(rentalId).all();
  return (res.results || []).map(rowToAuthorization);
}

// La ligne "active" (au plus une par location) — celle que l'interface
// agence doit afficher/agir dessus. Les tentatives terminées (libérée,
// expirée, capturée, annulée, échouée) restent consultables via
// listDepositAuthorizationsForRental mais ne bloquent jamais une nouvelle
// demande.
async function getActiveDepositAuthorization(env, rentalId) {
  const rows = await listDepositAuthorizationsForRental(env, rentalId);
  return rows.find((r) => !STATUTS_TERMINAUX.includes(r.status)) || null;
}

// Traduit le statut Mollie BRUT (jamais inventé — uniquement open, pending,
// authorized, paid, canceled, expired, failed, les seuls statuts
// documentés par l'API Payments v2) en statut interne GET LOCATION.
//
// - "authorized" : distingue "autorisee" (rien encore débité) de
//   "capturee_partielle" (au moins une capture déjà effectuée, le solde
//   reste débitable) — Mollie garde le paiement en "authorized" tant que le
//   montant autorisé n'est pas intégralement capturé.
// - "paid" : atteint uniquement quand l'intégralité du montant autorisé a
//   été capturée (ce module ne crée jamais de paiement en capture
//   automatique) -> "capturee".
// - "canceled" : "liberee" si l'autorisation avait déjà eu lieu (action
//   agence "Libérer la caution", ou annulation bancaire), "annulee" sinon
//   (le client n'a pas terminé la saisie de sa carte).
function deriveInternalStatus(payment, existing) {
  const wasAuthorized = Boolean(existing && existing.authorizedAt);
  switch (payment.status) {
    case "open":
    case "pending":
      return "en_attente";
    case "authorized": {
      const capturedCents = centsFromMollieAmount(payment.amountCaptured);
      const effectiveCaptured = capturedCents !== null ? capturedCents : (existing ? existing.capturedAmountCents : 0);
      return effectiveCaptured > 0 ? "capturee_partielle" : "autorisee";
    }
    case "paid":
      return "capturee";
    case "canceled":
      return wasAuthorized ? "liberee" : "annulee";
    case "expired":
      return "expiree";
    case "failed":
      return "echouee";
    default:
      return existing ? existing.status : "en_attente";
  }
}

// Point d'entrée UNIQUE pour mettre à jour une ligne à partir d'une réponse
// Mollie authentique (jamais depuis un corps de webhook non revérifié, voir
// src/api/mollie-deposit-webhook.js). `hintCapturedCents` sert de repli
// quand payment.amountCaptured est absent de la réponse (voir
// centsFromMollieAmount) : GET LOCATION additionne alors lui-même le
// montant qu'il vient de faire capturer, sans jamais inventer une valeur
// venue d'ailleurs.
async function syncFromMolliePayment(env, existing, payment, operator, hintCapturedCents = null) {
  const capturedFromPayment = centsFromMollieAmount(payment.amountCaptured);
  const capturedAmountCents =
    capturedFromPayment !== null
      ? capturedFromPayment
      : hintCapturedCents !== null
        ? hintCapturedCents
        : existing.capturedAmountCents;
  // deriveInternalStatus lit existing.capturedAmountCents pour distinguer
  // "autorisee" de "capturee_partielle" (voir cas "authorized") : on lui
  // passe donc le montant déjà résolu ci-dessus (y compris hintCapturedCents
  // juste après une capture), jamais la valeur potentiellement obsolète de
  // `existing`.
  const status = deriveInternalStatus(payment, { ...existing, capturedAmountCents });

  const now = new Date().toISOString();
  const authorizedAt = status === "autorisee" || status === "capturee_partielle" || status === "capturee"
    ? existing.authorizedAt || now
    : existing.authorizedAt;
  // Champ non vérifié en conditions réelles dans cet environnement (voir
  // en-tête de fichier) : recopié tel quel s'il est présent, jamais une
  // valeur calculée localement.
  const captureBefore = payment.authorizationExpiresAt || existing.captureBefore || null;
  const releasedAt = status === "liberee" && !existing.releasedAt ? now : existing.releasedAt;
  const capturedAt = (status === "capturee" || status === "capturee_partielle") && !existing.capturedAt ? now : existing.capturedAt;
  const testMode = typeof payment.mode === "string" ? (payment.mode === "test" ? 1 : 0) : (existing.testMode ? 1 : 0);

  await env.AGENCY_DB.prepare(
    `UPDATE deposit_authorizations SET status = ?, mollie_status = ?, captured_amount_cents = ?, capture_before = ?, test_mode = ?, authorized_at = ?, released_at = ?, captured_at = ?, updated_at = ?, updated_by = ? WHERE id = ?`
  ).bind(
    status,
    payment.status,
    capturedAmountCents,
    captureBefore,
    testMode,
    authorizedAt,
    releasedAt,
    capturedAt,
    now,
    operator,
    existing.id
  ).run();

  return getDepositAuthorizationById(env, existing.id);
}

// Crée la demande d'empreinte bancaire : enregistre la ligne "lien_cree"
// AVANT d'appeler Mollie (même schéma que create-payment.js/
// createReservation), puis la complète avec l'id/l'URL de paiement Mollie.
// Si l'appel Mollie échoue, la ligne passe "echouee" et l'erreur Mollie
// d'origine (MollieApiError : statusCode, body, message) est propagée telle
// quelle à l'appelant — voir src/api/agency-deposit-authorizations.js, qui
// doit l'afficher clairement à l'agence (cahier des charges §5 : ne jamais
// masquer la réponse Mollie en cas d'échec de la préautorisation).
async function createDepositAuthorization(env, rentalId, data, operator, { origin }) {
  if (!rentalId || typeof rentalId !== "string") throw new Error("Location manquante");
  const rental = await getRentalById(env, rentalId);
  if (!rental) throw new Error("Location introuvable");

  if (!env.MOLLIE_DEPOSIT_API_KEY) {
    throw new Error("MOLLIE_DEPOSIT_API_KEY manquante : l'empreinte bancaire n'est pas configurée.");
  }

  const active = await getActiveDepositAuthorization(env, rentalId);
  if (active) throw new Error("Une empreinte bancaire est déjà en cours pour cette location.");

  const amountCents =
    data && data.amount !== undefined && data.amount !== null && data.amount !== ""
      ? toCents(data.amount)
      : defaultAmountCentsForRental(rental);

  const id = generateId("depauth");
  const now = new Date().toISOString();
  await env.AGENCY_DB.prepare(
    `INSERT INTO deposit_authorizations (id, rental_id, mollie_payment_id, authorized_amount_cents, captured_amount_cents, currency, status, mollie_status, checkout_url, capture_before, test_mode, authorized_at, released_at, captured_at, failure_reason, created_at, updated_at, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, rentalId, null, amountCents, 0, "EUR", "lien_cree", null, null, null,
    isTestApiKey(env.MOLLIE_DEPOSIT_API_KEY) ? 1 : 0, null, null, null, null,
    now, now, operator, operator
  ).run();

  try {
    const payment = await createMolliePayment(
      env.MOLLIE_DEPOSIT_API_KEY,
      {
        amount: { currency: "EUR", value: (amountCents / 100).toFixed(2) },
        method: "creditcard",
        captureMode: "manual",
        description: `Empreinte bancaire GET LOCATION — caution ${rental.contractNumero || rental.id}`,
        redirectUrl: `${origin}/caution-mollie-retour.html`,
        webhookUrl: `${origin}/api/mollie-deposit-webhook`,
        metadata: { depositAuthorizationId: id, rentalId }
      },
      crypto.randomUUID()
    );

    await env.AGENCY_DB.prepare(
      "UPDATE deposit_authorizations SET mollie_payment_id = ?, checkout_url = ?, mollie_status = ?, test_mode = ?, updated_at = ? WHERE id = ?"
    ).bind(
      payment.id,
      (payment._links && payment._links.checkout && payment._links.checkout.href) || null,
      payment.status,
      typeof payment.mode === "string" ? (payment.mode === "test" ? 1 : 0) : (isTestApiKey(env.MOLLIE_DEPOSIT_API_KEY) ? 1 : 0),
      now,
      id
    ).run();

    return getDepositAuthorizationById(env, id);
  } catch (err) {
    await env.AGENCY_DB.prepare(
      "UPDATE deposit_authorizations SET status = ?, failure_reason = ?, updated_at = ?, updated_by = ? WHERE id = ?"
    ).bind("echouee", (err && err.message) || "Erreur Mollie inconnue", new Date().toISOString(), operator, id).run();
    throw err;
  }
}

// Débite tout ou partie de l'empreinte — DÉCLENCHÉE UNIQUEMENT depuis
// l'espace agence (jamais automatiquement, voir cahier des charges §10).
// Le montant maximum capturable est TOUJOURS vérifié ici contre le solde
// réellement restant (authorizedAmountCents - capturedAmountCents), jamais
// laissé au client/à Mollie seul à trancher (cahier des charges §11).
async function captureDepositAuthorization(env, id, amount, operator) {
  const existing = await getDepositAuthorizationById(env, id);
  if (!existing) return null;
  if (!STATUTS_CAPTURABLES.includes(existing.status)) {
    throw new Error(`Cette caution ne peut pas être débitée dans son état actuel (${existing.status}).`);
  }
  const captureCents = toCents(amount);
  const remaining = existing.authorizedAmountCents - existing.capturedAmountCents;
  if (captureCents > remaining) {
    throw new Error(
      `Le montant à débiter (${(captureCents / 100).toFixed(2)} €) dépasse le montant restant disponible sur l'autorisation (${(remaining / 100).toFixed(2)} €).`
    );
  }
  if (!env.MOLLIE_DEPOSIT_API_KEY) throw new Error("MOLLIE_DEPOSIT_API_KEY manquante.");
  if (!existing.molliePaymentId) throw new Error("Aucune autorisation Mollie associée à cette caution.");

  await createCapture(
    env.MOLLIE_DEPOSIT_API_KEY,
    existing.molliePaymentId,
    { amount: { currency: "EUR", value: (captureCents / 100).toFixed(2) } },
    crypto.randomUUID()
  );

  // Revérifie toujours l'état réel auprès de Mollie après l'action — jamais
  // une simple addition locale sans confirmation (même principe que
  // mollie-webhook.js pour le paiement de location).
  const payment = await getPayment(env.MOLLIE_DEPOSIT_API_KEY, existing.molliePaymentId);
  return syncFromMolliePayment(env, existing, payment, operator, existing.capturedAmountCents + captureCents);
}

// Libère l'empreinte bancaire (mainlevée) — uniquement tant qu'aucune
// capture n'a encore eu lieu (voir cahier des charges §12 : mécanisme
// officiel Mollie, jamais une simple mise à jour locale du statut).
async function releaseDepositAuthorization(env, id, operator) {
  const existing = await getDepositAuthorizationById(env, id);
  if (!existing) return null;
  if (existing.status !== "autorisee") {
    throw new Error("Seule une caution intégralement autorisée et non encore débitée peut être libérée.");
  }
  if (!env.MOLLIE_DEPOSIT_API_KEY) throw new Error("MOLLIE_DEPOSIT_API_KEY manquante.");
  if (!existing.molliePaymentId) throw new Error("Aucune autorisation Mollie associée à cette caution.");

  await cancelPayment(env.MOLLIE_DEPOSIT_API_KEY, existing.molliePaymentId);
  const payment = await getPayment(env.MOLLIE_DEPOSIT_API_KEY, existing.molliePaymentId);
  return syncFromMolliePayment(env, existing, payment, operator);
}

// Re-synchronise à la demande (l'agence ouvre le dossier, ou avant toute
// action de capture/libération) : une préautorisation carte peut expirer
// silencieusement côté banque sans notification webhook garantie — ne
// jamais supposer qu'elle reste valable indéfiniment (cahier des charges
// §9).
async function refreshDepositAuthorization(env, id, operator) {
  const existing = await getDepositAuthorizationById(env, id);
  if (!existing) return null;
  if (!existing.molliePaymentId) return existing;
  if (!env.MOLLIE_DEPOSIT_API_KEY) throw new Error("MOLLIE_DEPOSIT_API_KEY manquante.");
  const payment = await getPayment(env.MOLLIE_DEPOSIT_API_KEY, existing.molliePaymentId);
  return syncFromMolliePayment(env, existing, payment, operator);
}

// Appelé par le webhook Mollie (voir src/api/mollie-deposit-webhook.js) une
// fois le statut RÉEL revérifié auprès de l'API — jamais depuis le corps du
// webhook lui-même. `updated_by` = "mollie" (acteur système, distinct des
// noms d'opérateur agence) : la colonne est NOT NULL, jamais un champ libre
// envoyé par le navigateur.
async function syncDepositAuthorizationFromWebhook(env, payment) {
  const existing = await getDepositAuthorizationByMolliePaymentId(env, payment.id);
  if (!existing) return null;
  return syncFromMolliePayment(env, existing, payment, "mollie");
}

module.exports = {
  STATUTS_INTERNES,
  STATUTS_TERMINAUX,
  STATUTS_CAPTURABLES,
  isTestApiKey,
  deriveInternalStatus,
  getDepositAuthorizationById,
  getDepositAuthorizationByMolliePaymentId,
  listDepositAuthorizationsForRental,
  getActiveDepositAuthorization,
  createDepositAuthorization,
  captureDepositAuthorization,
  releaseDepositAuthorization,
  refreshDepositAuthorization,
  syncDepositAuthorizationFromWebhook
};
