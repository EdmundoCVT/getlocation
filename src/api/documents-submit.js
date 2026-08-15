const { resolveDocumentAccess } = require("./documents-access.js");
const { validateDocumentSubmission } = require("../lib/validate-document-upload.js");
const { generateDocumentObjectKey, putPrivateDocument, deletePrivateDocument } = require("../lib/document-store.js");
const { updateReservationDocuments } = require("../lib/reservation-store.js");
const { checkRateLimit } = require("../lib/rate-limiter.js");
const { sendDocumentsNotificationEmail } = require("../lib/send-documents-notification-email.js");

const MAX_REQUEST_BYTES = 52 * 1024 * 1024;

function responseHeaders() {
  return { "Content-Type": "application/json", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
}

function clientIp(request) {
  return request.headers.get("cf-connecting-ip") || (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
}

async function cleanup(env, keys) {
  await Promise.all(keys.map((key) => deletePrivateDocument(env, key).catch(() => undefined)));
}

async function handleDocumentsSubmit(request, env) {
  const headers = responseHeaders();
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { ...headers, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type" } });
  }
  if (request.method !== "POST") return new Response(JSON.stringify({ error: "Méthode non autorisée" }), { status: 405, headers });
  if (!env.DOCUMENTS_BUCKET) return new Response(JSON.stringify({ error: "Service documentaire indisponible" }), { status: 503, headers });

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return new Response(JSON.stringify({ error: "Envoi trop volumineux" }), { status: 413, headers });
  }
  if (!(request.headers.get("content-type") || "").toLowerCase().startsWith("multipart/form-data")) {
    return new Response(JSON.stringify({ error: "Format de requête invalide" }), { status: 415, headers });
  }

  const rate = await checkRateLimit(env, `documents-submit:${clientIp(request)}`, { windowMs: 10 * 60 * 1000, maxRequests: 8 });
  if (!rate.allowed) return new Response(JSON.stringify({ error: "Trop de tentatives. Réessayez plus tard." }), { status: 429, headers: { ...headers, "Retry-After": String(rate.retryAfterSeconds) } });

  const resolved = await resolveDocumentAccess(request, env);
  if (!resolved) return new Response(JSON.stringify({ error: "Lien invalide ou expiré" }), { status: 401, headers });

  let validated;
  try {
    validated = await validateDocumentSubmission(await request.formData(), resolved.reservation);
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || "Dossier invalide" }), { status: 400, headers });
  }

  const uploaded = [];
  try {
    for (const file of validated.files) {
      const key = generateDocumentObjectKey(resolved.reservation.id, file.fieldName);
      await putPrivateDocument(env, key, file.buffer, { documentType: file.fieldName, contentType: file.contentType });
      uploaded.push({ key, type: file.fieldName, contentType: file.contentType, size: file.size, uploadedAt: new Date().toISOString() });
    }

    const previousKeys = Array.isArray(resolved.reservation.documentFiles)
      ? resolved.reservation.documentFiles.map((file) => file.key).filter(Boolean)
      : [];
    const updated = await updateReservationDocuments(env, resolved.reservation.id, {
      documentsStatus: "submitted",
      documentsData: validated.data,
      documentFiles: uploaded,
      documentsSubmittedAt: new Date().toISOString()
    });
    if (!updated) throw new Error("Réservation non disponible");
    await cleanup(env, previousKeys);
    await sendDocumentsNotificationEmail(env, updated, uploaded.map((file) => file.type));
    return new Response(JSON.stringify({ received: true, documentsStatus: "submitted" }), { status: 200, headers });
  } catch (err) {
    await cleanup(env, uploaded.map((file) => file.key));
    console.error("[documents-submit] Échec de traitement pour la réservation", resolved.reservation.id, err && err.message);
    return new Response(JSON.stringify({ error: "Impossible d'enregistrer les documents" }), { status: 500, headers });
  }
}

module.exports = { handleDocumentsSubmit };
