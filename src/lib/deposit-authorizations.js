// Mollie deposit authorizations. Server-saved amounts only; separate deposit key.
// captureBefore and release-authorization follow the Mollie Payments API.
// A capture is counted only from the provider response, never from its request.
// Ambiguous failures remain locked for reconciliation (no automatic new payment).

const { getDepositSubject } = require("./deposit-terms.js");
const { generateId } = require("./id.js");
const {
  createPayment: createMolliePayment,
  getPayment,
  cancelPayment,
  releaseAuthorization,
  createCapture
} = require("./mollie-client.js");

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

const STATUTS_TERMINAUX = ["liberee", "capturee", "capturee_partielle", "expiree", "annulee", "echouee"];

function isAuthorizationTerminal(auth) {
  return auth.status === "capturee_partielle" ? auth.mollieStatus !== "authorized" : STATUTS_TERMINAUX.includes(auth.status);
}

const STATUTS_CAPTURABLES = ["autorisee"];

function isTestApiKey(apiKey) {
  return typeof apiKey === "string" && apiKey.startsWith("test_");
}

function toCents(amount) {
  const n = Number(amount);
  if (!["string", "number"].includes(typeof amount) || !Number.isFinite(n) || n <= 0 || !Number.isSafeInteger(Math.round(n * 100)) || Math.abs(n * 100 - Math.round(n * 100)) > 0.000001) throw new Error("Montant invalide");
  return Math.round(n * 100);
}

function centsFromMollieAmount(amount) {
  if (!amount || typeof amount.value !== "string") return null;
  const n = Number(amount.value);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function resolveDepositAmountCentsForRental(rental) {
  if (!Number.isSafeInteger(rental.depositAmountCents) || rental.depositAmountCents <= 0) {
    throw new Error("Montant de caution historique absent ou invalide : vérification agence requise.");
  }
  return rental.depositAmountCents;
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
    captureRequested: Boolean(row.capture_requested),
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

async function getActiveDepositAuthorization(env, rentalId) {
  const rows = await listDepositAuthorizationsForRental(env, rentalId);
  return rows.find((r) => !isAuthorizationTerminal(r)) || null;
}

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
      return existing && existing.capturedAmountCents > 0 && existing.capturedAmountCents < existing.authorizedAmountCents ? "capturee_partielle" : "capturee";
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

async function syncFromMolliePayment(env, existing, payment, operator) {
  if (!payment || payment.id !== existing.molliePaymentId) throw new Error("Identifiant Mollie incohérent.");
  if (payment.mode && (payment.mode === "test") !== existing.testMode) throw new Error("Mode Mollie incohérent.");
  if (payment.amount && (payment.amount.currency !== "EUR" || centsFromMollieAmount(payment.amount) !== existing.authorizedAmountCents)) throw new Error("Montant Mollie incohérent.");
  const capturedFromPayment = centsFromMollieAmount(payment.amountCaptured);
  if (capturedFromPayment !== null && (capturedFromPayment < 0 || capturedFromPayment > existing.authorizedAmountCents || payment.amountCaptured.currency !== "EUR")) throw new Error("Montant capturé Mollie incohérent.");
  const capturedAmountCents =
    capturedFromPayment !== null
      ? capturedFromPayment
      : existing.capturedAmountCents;
  const status = deriveInternalStatus(payment, { ...existing, capturedAmountCents });

  const now = new Date().toISOString();
  const authorizedAt = status === "autorisee" || status === "capturee_partielle" || status === "capturee"
    ? existing.authorizedAt || now
    : existing.authorizedAt;
  const captureBefore = payment.captureBefore || existing.captureBefore || null;
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

async function createDepositAuthorization(env, rentalId, operator, { origin }) {
  if (!rentalId || typeof rentalId !== "string") throw new Error("Location manquante");
  const rental = await getDepositSubject(env, rentalId);
  if (!rental) throw new Error("Location introuvable");

  if (!/^(test|live)_[^\s]+$/.test(env.MOLLIE_DEPOSIT_API_KEY || "")) {
    throw new Error("MOLLIE_DEPOSIT_API_KEY manquante : l'empreinte bancaire n'est pas configurée.");
  }

  const manual = await env.AGENCY_DB.prepare("SELECT * FROM deposits WHERE rental_id = ?").bind(rentalId).first();
  if (manual && ["attendue", "recue"].includes(manual.status)) throw new Error("Une caution manuelle existe déjà pour ce contrat.");
  const active = await getActiveDepositAuthorization(env, rentalId);
  if (active) throw new Error("Une empreinte bancaire est déjà en cours pour cette location.");

  const amountCents = resolveDepositAmountCentsForRental(rental);

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
      `deposit-create-${id}`
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
    const rejected = err && err.statusCode >= 400 && err.statusCode < 500 && err.statusCode !== 429;
    await env.AGENCY_DB.prepare(
      "UPDATE deposit_authorizations SET status = ?, failure_reason = ?, updated_at = ?, updated_by = ? WHERE id = ?"
    ).bind(rejected ? "echouee" : "lien_cree", (err && err.message) || "Erreur Mollie inconnue", new Date().toISOString(), operator, id).run();
    throw err;
  }
}

async function captureDepositAuthorization(env, id, amount, operator) {
  let existing = await getDepositAuthorizationById(env, id);
  if (!existing) return null;
  if (!STATUTS_CAPTURABLES.includes(existing.status)) {
    throw new Error(`Cette caution ne peut pas être débitée dans son état actuel (${existing.status}).`);
  }
  if (existing.captureBefore && Date.parse(existing.captureBefore) <= Date.now()) throw new Error("L'autorisation a expiré.");
  const captureCents = toCents(amount);
  const remaining = existing.authorizedAmountCents - existing.capturedAmountCents;
  if (captureCents > remaining) {
    throw new Error(
      `Le montant à débiter (${(captureCents / 100).toFixed(2)} €) dépasse le montant restant disponible sur l'autorisation (${(remaining / 100).toFixed(2)} €).`
    );
  }
  if (!env.MOLLIE_DEPOSIT_API_KEY) throw new Error("MOLLIE_DEPOSIT_API_KEY manquante.");
  if (!existing.molliePaymentId) throw new Error("Aucune autorisation Mollie associée à cette caution.");

  existing = await refreshDepositAuthorization(env, id, operator);
  if (existing.status !== "autorisee" || existing.capturedAmountCents > 0 || (existing.captureBefore && Date.parse(existing.captureBefore) <= Date.now())) throw new Error("L’autorisation n’est plus disponible.");
  const claim = await env.AGENCY_DB.prepare("UPDATE deposit_authorizations SET capture_requested = ?, action_lock = ? WHERE id = ? AND action_lock IS NULL RETURNING id").bind(1, "capture", id).first();
  if (!claim) throw new Error("Une capture a déjà été demandée. Actualisez le statut avant toute autre action.");
  await createCapture(
    env.MOLLIE_DEPOSIT_API_KEY,
    existing.molliePaymentId,
    { amount: { currency: "EUR", value: (captureCents / 100).toFixed(2) } },
    `deposit-capture-${id}`
  );

  const payment = await getPayment(env.MOLLIE_DEPOSIT_API_KEY, existing.molliePaymentId);
  return syncFromMolliePayment(env, existing, payment, operator);
}

async function releaseDepositAuthorization(env, id, operator) {
  let existing = await getDepositAuthorizationById(env, id);
  if (!existing) return null;
  if (!["autorisee", "en_attente", "lien_cree"].includes(existing.status) && !(existing.status === "capturee_partielle" && existing.mollieStatus === "authorized")) {
    throw new Error("Seule une caution intégralement autorisée et non encore débitée peut être libérée.");
  }
  if (!env.MOLLIE_DEPOSIT_API_KEY) throw new Error("MOLLIE_DEPOSIT_API_KEY manquante.");
  if (!existing.molliePaymentId) throw new Error("Aucune autorisation Mollie associée à cette caution.");

  if (existing.captureRequested && !existing.capturedAmountCents) throw new Error("Une capture a déjà été demandée : vérifiez son statut dans Mollie.");
  existing = await refreshDepositAuthorization(env, id, operator);
  if (!["autorisee", "en_attente", "lien_cree"].includes(existing.status) && !(existing.status === "capturee_partielle" && existing.mollieStatus === "authorized")) throw new Error("L’autorisation n’est plus libérable.");
  const claim = await env.AGENCY_DB.prepare("UPDATE deposit_authorizations SET action_lock = ? WHERE id = ? AND (action_lock IS NULL OR (action_lock = 'capture' AND captured_amount_cents > 0)) RETURNING id").bind("release", id).first();
  if (!claim) throw new Error("Une opération financière a déjà été demandée : actualisez le statut.");
  if (existing.mollieStatus === "authorized") await releaseAuthorization(env.MOLLIE_DEPOSIT_API_KEY, existing.molliePaymentId);
  else await cancelPayment(env.MOLLIE_DEPOSIT_API_KEY, existing.molliePaymentId);
  const payment = await getPayment(env.MOLLIE_DEPOSIT_API_KEY, existing.molliePaymentId);
  return syncFromMolliePayment(env, existing, payment, operator);
}

async function refreshDepositAuthorization(env, id, operator) {
  const existing = await getDepositAuthorizationById(env, id);
  if (!existing) return null;
  if (!existing.molliePaymentId) return existing;
  if (!env.MOLLIE_DEPOSIT_API_KEY) throw new Error("MOLLIE_DEPOSIT_API_KEY manquante.");
  if (existing.testMode !== isTestApiKey(env.MOLLIE_DEPOSIT_API_KEY)) throw new Error("Le mode de la clé caution ne correspond pas à cette empreinte (TEST/LIVE).");
  const payment = await getPayment(env.MOLLIE_DEPOSIT_API_KEY, existing.molliePaymentId);
  return syncFromMolliePayment(env, existing, payment, operator);
}

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
  isAuthorizationTerminal,
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
