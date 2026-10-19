// src/api/contract-manual-link.js
//
// Lien COURT partagé par WhatsApp/SMS/copie pour un contrat MANUEL (bouton
// "Générer/Mettre à jour le contrat officiel" de contrat.html, vue AGENCE).
//
// Bug signalé le 12/09/2026 : le lien historique `?data=...` embarque tout
// le formulaire encodé en base64 (souvent plus de 1000 caractères, sans le
// moindre espace) — collé dans WhatsApp, seul le tout début de l'URL est
// reconnu comme cliquable, le reste restant du texte brut. Ce endpoint
// remplace ce lien géant par un jeton court (43 caractères), sur le même
// principe que le "dossier sécurisé" des réservations en ligne
// (contract-dossier-client.js) mais adapté aux contrats manuels, dont le
// format de données est différent (rawData du formulaire agence, pas un
// enregistrement de réservation payée).
//
// POST (session agence requise, voir agency-auth.js) : (ré)émet un jeton
// pour le contrat manuel { id } déjà enregistré (contracts-manual-create/
// update) et renvoie l'URL courte à partager. Peut être appelé autant de
// fois que nécessaire (ex. après chaque mise à jour du contrat) — un nouvel
// appel invalide implicitement l'ancien jeton (l'index KV précédent n'est
// jamais nettoyé activement, mais n'est plus référencé par le contrat une
// fois manualClientAccess remplacé ; il expire de toute façon avec son TTL).
//
// GET (public, jeton porteur en en-tête Authorization) : renvoie les
// données du contrat au même format que le paramètre `?data=` historique
// (decodeData), pour que contrat.html les passe telles quelles à
// initClientView() sans aucun changement de ce côté-là — seuls les champs
// internes au serveur (id, status, horodatages, auteur, jeton) sont retirés
// avant l'envoi, jamais exposés au client.

const { getReservation, saveContractManualClientAccessIndex, findReservationByContractManualClientTokenHash, setManualContractClientAccess, updateContractDossier, updateContractVersionSignature, finalizeContractVersion, contractVersionInfo, contractLanguage } = require("../lib/reservation-store.js");
const { getCglVersion } = require("../../js/data.js");
const { checkRateLimit } = require("../lib/rate-limiter.js");
const { requireAgencySession } = require("../lib/agency-auth.js");
const { hashContractManualClientToken, issueManualClientLinkAccess } = require("../lib/contract-dossier-token.js");
const { enqueueDriveSync } = require("../lib/google-drive-backup.js");
const { recordAuditEvent } = require("../lib/audit-log.js");

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

const ID_REGEX = /^res_[a-f0-9]{32}$/;
const MAX_BODY_LEN = 200;

function bearerToken(request) {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.get("authorization") || "");
  return match ? match[1] : null;
}

async function resolveManualClientAccess(request, env) {
  const token = bearerToken(request);
  if (!token || !env.DOCUMENT_TOKEN_PEPPER) return null;
  const tokenHash = await hashContractManualClientToken(token, env.DOCUMENT_TOKEN_PEPPER);
  const record = await findReservationByContractManualClientTokenHash(env, tokenHash);
  const access = record && record.manualClientAccess;
  const expired = !access || !access.expiresAt || new Date(access.expiresAt).getTime() <= Date.now();
  const invalid = !record || (record.status !== "manual_contract" && !(record.status === "contract_version" && record.contractSourceType === "manual")) || !access || access.tokenHash !== tokenHash || access.revokedAt || expired;
  return invalid ? null : { reservation: record };
}

// Champs internes au serveur, jamais transmis au navigateur du client.
const INTERNAL_FIELDS = ["id", "status", "createdAt", "createdBy", "updatedAt", "updatedBy", "manualClientAccess"];

function buildManualClientPayload(record) {
  const payload = { ...record };
  for (const key of INTERNAL_FIELDS) delete payload[key];
  payload.cglVersion = record.contractDossier && record.contractDossier.cglVersion || getCglVersion(contractLanguage(record));
  return payload;
}

async function handlePost(request, env, headers) {
  const auth = await requireAgencySession(request, env, { requireCsrf: true, requireOrigin: true });
  if (auth.error) return auth.error;

  const rate = await checkRateLimit(env, `contract-manual-link:${clientIp(request)}`, { windowMs: 60000, maxRequests: 30 });
  if (!rate.allowed) {
    return new Response(JSON.stringify({ error: "Trop de requêtes, veuillez réessayer dans un instant." }), {
      status: 429,
      headers: { ...headers, "Retry-After": String(rate.retryAfterSeconds) }
    });
  }

  let body;
  try {
    const rawBody = await request.text();
    if (!rawBody || rawBody.length > MAX_BODY_LEN) throw new Error("corps de requête vide ou trop volumineux");
    body = JSON.parse(rawBody);
  } catch (e) {
    return new Response(JSON.stringify({ error: "Requête invalide" }), { status: 400, headers });
  }

  if (!body || typeof body.id !== "string" || !ID_REGEX.test(body.id)) {
    return new Response(JSON.stringify({ error: "Identifiant de contrat manquant ou invalide" }), { status: 400, headers });
  }

  const record = await getReservation(env, body.id);
  if (!record || (record.status !== "manual_contract" && !(record.status === "contract_version" && record.contractSourceType === "manual"))) {
    return new Response(JSON.stringify({ error: "Contrat manuel introuvable" }), { status: 404, headers });
  }

  const access = await issueManualClientLinkAccess(env);
  if (!access) {
    return new Response(JSON.stringify({ error: "Lien indisponible pour le moment (configuration serveur)." }), { status: 503, headers });
  }
  const saved = await saveContractManualClientAccessIndex(env, body.id, access.stored.tokenHash, access.stored.expiresAt);
  if (!saved) {
    return new Response(JSON.stringify({ error: "Lien indisponible pour le moment." }), { status: 503, headers });
  }
  const updated = await setManualContractClientAccess(env, body.id, access.stored);
  if (!updated) {
    return new Response(JSON.stringify({ error: "Contrat manuel introuvable" }), { status: 404, headers });
  }

  const origin = env.SITE_URL || new URL(request.url).origin;
  // Jeton en FRAGMENT (#manualToken=), jamais en paramètre de requête — même
  // principe que #agencyToken=/#clientToken= (voir contract-dossier-token.js
  // et contrat.html) : un jeton porteur ne doit jamais transiter par une
  // partie d'URL que le navigateur enverrait au serveur.
  return new Response(JSON.stringify({ clientUrl: `${origin}/contrat.html#manualToken=${access.token}` }), { status: 200, headers });
}

function manualSignatureId() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

async function handleClientSignature(request, env, headers) {
  const resolved = await resolveManualClientAccess(request, env);
  if (!resolved) return new Response(JSON.stringify({ error: "Ce lien est invalide ou a expiré." }), { status: 401, headers });
  const record = resolved.reservation;
  let payload;
  try {
    const raw = await request.text();
    if (!raw || raw.length > 310000) throw new Error("Requête invalide");
    payload = JSON.parse(raw);
  } catch (error) {
    return new Response(JSON.stringify({ error: "Requête invalide" }), { status: 400, headers });
  }
  const imageDataUrl = typeof payload.signatureImage === "string" ? payload.signatureImage : "";
  if (!imageDataUrl.startsWith("data:image/png") || imageDataUrl.length < 100 || imageDataUrl.length > 300000 || payload.cglAccepted !== true) return new Response(JSON.stringify({ error: "Signature ou acceptation des CGL invalide" }), { status: 400, headers });
  const expectedCgl = record.contractDossier && record.contractDossier.cglVersion || getCglVersion(contractLanguage(record));
  if (payload.cglVersion !== expectedCgl) return new Response(JSON.stringify({ error: "Les conditions de location ont été mises à jour, merci de recharger la page et réessayer." }), { status: 409, headers });
  const displaySignedAt = typeof payload.displaySignedAt === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(payload.displaySignedAt) ? payload.displaySignedAt : null;
  if (payload.displaySignedAt && !displaySignedAt) return new Response(JSON.stringify({ error: "Date et heure affichées invalides" }), { status: 400, headers });
  try {
    const now = new Date().toISOString();
    const signatureId = manualSignatureId();
    const signedDraft = await updateContractVersionSignature(env, record.id, {
      imageDataUrl,
      signedAt: now,
      displaySignedAt,
      name: typeof payload.signatureName === "string" ? payload.signatureName.trim().slice(0, 150) : null,
      signatureId
    }, "client");
    await updateContractDossier(env, record.id, {
      contractDossier: {
        ...signedDraft.contractDossier,
        cglVersion: expectedCgl,
        cglAcceptedAt: now,
        contractLanguage: contractLanguage(record),
        updatedAt: now
      }
    });
    const finalized = await finalizeContractVersion(env, record.id, "client");
    enqueueDriveSync(env, record.id).catch(() => undefined);
    await recordAuditEvent(env, { eventType: "contract_signed", entityType: "contract", entityId: record.id, metadata: { version: contractVersionInfo(finalized).version, signatureId } });
    return new Response(JSON.stringify({ ok: true, reference: finalized.id, signatureId, signedAt: finalized.contractVersion.signedAt, contractVersion: contractVersionInfo(finalized), version: contractVersionInfo(finalized).version }), { status: 200, headers });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message || "Signature impossible" }), { status: 409, headers });
  }
}

async function handleGet(request, env, headers) {
  const rate = await checkRateLimit(env, `contract-manual-link-get:${clientIp(request)}`, { windowMs: 60000, maxRequests: 20 });
  if (!rate.allowed) {
    return new Response(JSON.stringify({ error: "Trop de requêtes, veuillez réessayer dans un instant." }), {
      status: 429,
      headers: { ...headers, "Retry-After": String(rate.retryAfterSeconds) }
    });
  }

  const resolved = await resolveManualClientAccess(request, env);
  if (!resolved) {
    return new Response(JSON.stringify({ error: "Ce lien est invalide ou a expiré." }), { status: 401, headers });
  }
  return new Response(JSON.stringify(buildManualClientPayload(resolved.reservation)), { status: 200, headers });
}

async function handleContractManualLink(request, env) {
  const headers = corsHeaders(request, env);

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { ...headers, "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Agency-Csrf" }
    });
  }
  if (request.method === "GET") return handleGet(request, env, headers);
  if (request.method === "POST") return request.headers.get("authorization") ? handleClientSignature(request, env, headers) : handlePost(request, env, headers);
  return new Response(JSON.stringify({ error: "Méthode non autorisée" }), { status: 405, headers });
}

module.exports = { handleContractManualLink, buildManualClientPayload, resolveManualClientAccess };
