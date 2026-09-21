// src/api/agency-deposit-authorizations.js
//
// Empreinte bancaire Mollie (caution à préautorisation manuelle) — voir
// src/lib/deposit-authorizations.js pour toute la logique métier et les
// règles de sécurité (montant validé serveur, statut toujours revérifié
// auprès de Mollie). Ce fichier ne fait que : authentifier l'opérateur
// agence (comme agency-deposits.js), valider la forme de la requête, et
// traduire les erreurs en réponses HTTP claires.
//
// Contrairement à /api/create-payment (public), les détails d'une erreur
// Mollie (code HTTP, code erreur, message) SONT renvoyés ici tels quels à
// l'agence : endpoint authentifié réservé à l'équipe GET LOCATION, et le
// cahier des charges demande explicitement de ne jamais masquer la réponse
// Mollie en cas de problème (ex. "manual capture" non activé sur le
// compte).

const { requireAgencySession } = require("../lib/agency-auth.js");
const {
  isTestApiKey,
  isAuthorizationTerminal,
  listDepositAuthorizationsForRental,
  createDepositAuthorization,
  captureDepositAuthorization,
  releaseDepositAuthorization,
  refreshDepositAuthorization
} = require("../lib/deposit-authorizations.js");
const { getDepositSubject } = require("../lib/deposit-terms.js");
const { MollieApiError } = require("../lib/mollie-client.js");
const { recordAuditEvent } = require("../lib/audit-log.js");

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

// Origine de la requête entrante (site + API servis par le même Worker,
// voir create-payment.js#siteOrigin) — jamais une valeur inventée ou
// transmise par le navigateur.
function siteOrigin(request) {
  return new URL(request.url).origin;
}

const MAX_BODY_LEN = 2000;

function mollieErrorResponse(err, headers, fallbackMessage) {
  if (err instanceof MollieApiError) {
    // Voir cahier des charges §5 : afficher clairement la réponse Mollie
    // (code HTTP, détail) plutôt que de la masquer — jamais côté site
    // public, uniquement sur cet endpoint agence authentifié.
    return new Response(
      JSON.stringify({
        error: fallbackMessage,
        mollie: { statusCode: err.statusCode, detail: err.message, body: err.body || null }
      }),
      { status: 502, headers }
    );
  }
  return new Response(JSON.stringify({ error: err.message || fallbackMessage }), { status: 400, headers });
}

async function handleGet(request, env, headers) {
  const auth = await requireAgencySession(request, env);
  if (auth.error) return auth.error;

  const url = new URL(request.url);
  const configured = /^(test|live)_[^\s]+$/.test(env.MOLLIE_DEPOSIT_API_KEY || "");
  const mollieTestMode = isTestApiKey(env.MOLLIE_DEPOSIT_API_KEY);
  if (url.searchParams.get("configuration") === "1") {
    return new Response(JSON.stringify({ configured, mollieTestMode }), { status: 200, headers });
  }
  const rentalId = url.searchParams.get("rentalId");
  if (!rentalId) return new Response(JSON.stringify({ error: "Paramètre rentalId requis" }), { status: 400, headers });

  const subject = await getDepositSubject(env, rentalId);
  if (!subject) return new Response(JSON.stringify({ error: "Contrat introuvable" }), { status: 404, headers });
  const history = await listDepositAuthorizationsForRental(env, rentalId.slice(0, 100));
  const active = history.find((a) => !isAuthorizationTerminal(a)) || null;
  return new Response(
    JSON.stringify({ active, history, contractNumero: subject.contractNumero, depositAmount: subject.depositAmountCents == null ? null : subject.depositAmountCents / 100, configured, mollieTestMode }),
    { status: 200, headers }
  );
}

async function handlePost(request, env, headers) {
  const auth = await requireAgencySession(request, env, { requireCsrf: true, requireOrigin: true });
  if (auth.error) return auth.error;

  let body;
  try {
    const rawBody = await request.text();
    if (!rawBody || rawBody.length > MAX_BODY_LEN) throw new Error("corps de requête vide ou trop volumineux");
    body = JSON.parse(rawBody);
  } catch (e) {
    return new Response(JSON.stringify({ error: "Requête invalide" }), { status: 400, headers });
  }

  const operator = auth.session.operator;

  try {
    if (body.action === "create") {
      const rental = await getDepositSubject(env, body.rentalId);
      if (!rental) return new Response(JSON.stringify({ error: "Location introuvable" }), { status: 404, headers });
      // Aucun montant lu depuis body ici : createDepositAuthorization
      // détermine seule le montant, toujours depuis rental.depositAmountCents
      // (voir deposit-authorizations.js, cahier des charges §6).
      const authorization = await createDepositAuthorization(env, body.rentalId, operator, {
        origin: siteOrigin(request)
      });
      await recordAuditEvent(env, {
        actor: operator,
        eventType: "deposit_authorization_created",
        entityType: "deposit_authorization",
        entityId: authorization.id,
        metadata: { rentalId: authorization.rentalId, amountCents: authorization.authorizedAmountCents }
      });
      return new Response(JSON.stringify({ authorization }), { status: 200, headers });
    }

    if (body.action === "capture") {
      const authorization = await captureDepositAuthorization(env, body.id, body.amount, operator);
      if (!authorization) return new Response(JSON.stringify({ error: "Empreinte bancaire introuvable" }), { status: 404, headers });
      await recordAuditEvent(env, {
        actor: operator,
        eventType: "deposit_authorization_capture_requested",
        entityType: "deposit_authorization",
        entityId: authorization.id,
        metadata: { capturedAmountCents: authorization.capturedAmountCents, status: authorization.status }
      });
      return new Response(JSON.stringify({ authorization }), { status: 200, headers });
    }

    if (body.action === "release") {
      const authorization = await releaseDepositAuthorization(env, body.id, operator);
      if (!authorization) return new Response(JSON.stringify({ error: "Empreinte bancaire introuvable" }), { status: 404, headers });
      await recordAuditEvent(env, {
        actor: operator,
        eventType: "deposit_authorization_released",
        entityType: "deposit_authorization",
        entityId: authorization.id
      });
      return new Response(JSON.stringify({ authorization }), { status: 200, headers });
    }

    if (body.action === "refresh") {
      const authorization = await refreshDepositAuthorization(env, body.id, operator);
      if (!authorization) return new Response(JSON.stringify({ error: "Empreinte bancaire introuvable" }), { status: 404, headers });
      return new Response(JSON.stringify({ authorization }), { status: 200, headers });
    }

    return new Response(JSON.stringify({ error: "Action inconnue" }), { status: 400, headers });
  } catch (err) {
    console.error("[agency-deposit-authorizations] Erreur :", err && err.message);
    return mollieErrorResponse(err, headers, "L'action n'a pas pu être effectuée.");
  }
}

async function handleAgencyDepositAuthorizations(request, env) {
  const headers = corsHeaders(request, env);
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { ...headers, "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Agency-Csrf" }
    });
  }
  if (request.method !== "GET" && request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Méthode non autorisée" }), { status: 405, headers });
  }
  return request.method === "GET" ? handleGet(request, env, headers) : handlePost(request, env, headers);
}

module.exports = { handleAgencyDepositAuthorizations };
