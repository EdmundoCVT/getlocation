const { checkRateLimit } = require("../lib/rate-limiter.js");
const { readBoundedBody, RequestTooLargeError } = require("../lib/read-bounded-body.js");

const EVENT_TYPES = new Set(["page_view", "search_started", "vehicle_results_viewed", "vehicle_selected", "booking_started", "checkout_reached", "payment_started", "booking_confirmed"]);
function json(status, body, extra = {}) { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra } }); }
function clientIp(request) { return request.headers.get("cf-connecting-ip") || "unknown"; }
function text(value, max = 160) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
function newId() { return `ae_${Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, "0")).join("")}`; }

async function handleAnalyticsEvents(request, env) {
  if (request.method === "OPTIONS") return json(204, null, { "Access-Control-Allow-Methods": "POST, OPTIONS" });
  if (request.method !== "POST") return json(405, { error: "Méthode non autorisée" });
  const rate = await checkRateLimit(env, `analytics:${clientIp(request)}`, { windowMs: 60000, maxRequests: 30 });
  if (!rate.allowed) return json(429, { error: "Trop de requêtes" }, { "Retry-After": String(rate.retryAfterSeconds) });
  let payload;
  try { const raw = await readBoundedBody(request, 12000); payload = JSON.parse(new TextDecoder().decode(raw)); }
  catch (error) { return json(error instanceof RequestTooLargeError ? 413 : 400, { error: "Événements invalides" }); }
  const events = Array.isArray(payload) ? payload : payload && Array.isArray(payload.events) ? payload.events : [];
  if (!events.length || events.length > 10) return json(400, { error: "Événements invalides" });
  const now = Date.now();
  const valid = events.map(event => {
    const sessionId = text(event && event.sessionId, 120), eventType = text(event && event.eventType, 40);
    if (!/^[A-Za-z0-9_-]{20,120}$/.test(sessionId) || !EVENT_TYPES.has(eventType)) return null;
    const occurredAt = new Date(event.occurredAt || now).getTime();
    if (!Number.isFinite(occurredAt) || Math.abs(occurredAt - now) > 24 * 60 * 60 * 1000) return null;
    return { id: newId(), occurredAt: new Date(occurredAt).toISOString(), sessionId, eventType, page: text(event.page, 120).replace(/[?#].*$/, "") || "/", language: text(event.language, 2) === "en" ? "en" : "fr", vehicleId: text(event.vehicleId, 80) || null, vehicleCategory: text(event.vehicleCategory, 80) || null };
  }).filter(Boolean);
  if (!valid.length) return json(400, { error: "Événements invalides" });
  try {
    await env.AGENCY_DB.batch(valid.map(event => env.AGENCY_DB.prepare("INSERT INTO analytics_events (id, occurred_at, session_id, event_type, page, language, vehicle_id, vehicle_category) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(event.id, event.occurredAt, event.sessionId, event.eventType, event.page, event.language, event.vehicleId, event.vehicleCategory)));
    return json(202, { accepted: valid.length });
  } catch (error) { console.error("[analytics-events] stockage indisponible :", error && error.message); return json(503, { error: "Statistiques temporairement indisponibles" }); }
}
module.exports = { handleAnalyticsEvents, EVENT_TYPES };
