// src/api/agency-clients.js
//
// Base clients de l'agence (Lot 2, voir CLAUDE.md) : recherche (téléphone,
// email, nom/prénom secondaire) et création/mise à jour. Protégé par
// session agence (voir src/lib/agency-auth.js) — CSRF + origine stricte sur
// les écritures. created_by/updated_by proviennent de la session, jamais du
// corps de la requête.

const { requireAgencySession } = require("../lib/agency-auth.js");
const { createClient, updateClient, getClientById, searchClients } = require("../lib/clients.js");
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

const MAX_BODY_LEN = 20000;

async function handleGet(request, env, headers) {
  const auth = await requireAgencySession(request, env);
  if (auth.error) return auth.error;

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (id) {
    const client = await getClientById(env, id.slice(0, 100));
    if (!client) return new Response(JSON.stringify({ error: "Client introuvable" }), { status: 404, headers });
    return new Response(JSON.stringify({ client }), { status: 200, headers });
  }

  const results = await searchClients(env, {
    phone: url.searchParams.get("phone") || "",
    email: url.searchParams.get("email") || "",
    firstName: url.searchParams.get("firstName") || "",
    lastName: url.searchParams.get("lastName") || ""
  });
  return new Response(JSON.stringify({ clients: results }), { status: 200, headers });
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

  try {
    if (body.action === "create") {
      const client = await createClient(env, body.data || {}, auth.session.operator);
      await recordAuditEvent(env, { actor: auth.session.operator, eventType: "client_created", entityType: "client", entityId: client.id });
      return new Response(JSON.stringify({ client }), { status: 200, headers });
    }
    if (body.action === "update") {
      const client = await updateClient(env, body.id, body.data || {}, auth.session.operator);
      if (!client) return new Response(JSON.stringify({ error: "Client introuvable" }), { status: 404, headers });
      await recordAuditEvent(env, { actor: auth.session.operator, eventType: "client_updated", entityType: "client", entityId: client.id });
      return new Response(JSON.stringify({ client }), { status: 200, headers });
    }
    return new Response(JSON.stringify({ error: "Action inconnue" }), { status: 400, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || "Requête invalide" }), { status: 400, headers });
  }
}

async function handleAgencyClients(request, env) {
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

module.exports = { handleAgencyClients };
