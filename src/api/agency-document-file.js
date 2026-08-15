const { resolveAgencyDocumentAccess } = require("./agency-documents-access.js");
const { getPrivateDocument } = require("../lib/document-store.js");
const { checkRateLimit } = require("../lib/rate-limiter.js");

const EXTENSIONS = { "image/jpeg": "jpg", "image/png": "png", "application/pdf": "pdf" };

function safeType(value) {
  return String(value || "document").replace(/[^a-z0-9-]/g, "-").slice(0, 40) || "document";
}

async function handleAgencyDocumentFile(request, env) {
  const baseHeaders = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
  if (request.method !== "GET") return new Response("Méthode non autorisée", { status: 405, headers: baseHeaders });
  if (!env.DOCUMENTS_BUCKET) return new Response("Service indisponible", { status: 503, headers: baseHeaders });
  const ip = request.headers.get("cf-connecting-ip") || (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  const rate = await checkRateLimit(env, `agency-document-file:${ip}`, { windowMs: 60000, maxRequests: 60 });
  if (!rate.allowed) return new Response("Trop de téléchargements", { status: 429, headers: { ...baseHeaders, "Retry-After": String(rate.retryAfterSeconds) } });
  const resolved = await resolveAgencyDocumentAccess(request, env);
  if (!resolved) return new Response("Lien invalide ou expiré", { status: 401, headers: baseHeaders });
  const id = new URL(request.url).searchParams.get("file");
  if (!/^\d{1,2}$/.test(id || "")) return new Response("Document invalide", { status: 400, headers: baseHeaders });
  const file = Array.isArray(resolved.reservation.documentFiles) ? resolved.reservation.documentFiles[Number(id)] : null;
  if (!file || !file.key) return new Response("Document introuvable", { status: 404, headers: baseHeaders });
  const object = await getPrivateDocument(env, file.key);
  if (!object || !object.body) return new Response("Document introuvable", { status: 404, headers: baseHeaders });
  const contentType = EXTENSIONS[file.contentType] ? file.contentType : "application/octet-stream";
  const extension = EXTENSIONS[contentType] || "bin";
  const filename = `${safeType(file.type)}-${resolved.reservation.id.slice(-8)}.${extension}`;
  return new Response(object.body, {
    headers: { ...baseHeaders, "Content-Type": contentType, "Content-Disposition": `attachment; filename="${filename}"` }
  });
}

module.exports = { handleAgencyDocumentFile };
