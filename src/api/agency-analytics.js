const { requireAgencySession } = require("../lib/agency-auth.js");
const { checkRateLimit } = require("../lib/rate-limiter.js");
function json(status, body) { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }); }
function trafficFilter(value) {
  if (value === "all") return { value: "all", clause: "1 = 1", params: [] };
  if (value === "internal") return { value: "internal", clause: "COALESCE(traffic_type, 'public') IN ('internal', 'automated')", params: [] };
  if (value === "automated") return { value: "automated", clause: "COALESCE(traffic_type, 'public') = ?", params: ["automated"] };
  return { value: "public", clause: "COALESCE(traffic_type, 'public') = ?", params: ["public"] };
}
function conversionRate(metrics) {
  return metrics && metrics.visitors ? Math.round(Number(metrics.booking_confirmed) / Number(metrics.visitors) * 1000) / 10 : 0;
}
async function handleAgencyAnalytics(request, env) {
  if (request.method !== "GET") return json(405, { error: "Méthode non autorisée" });
  const auth = await requireAgencySession(request, env);
  if (auth.error) return auth.error;
  const rate = await checkRateLimit(env, `agency-analytics:${auth.session.sessionId}`, { windowMs: 60000, maxRequests: 30 });
  if (!rate.allowed) return json(429, { error: "Trop de requêtes" });
  const requestedDays = Number(new URL(request.url).searchParams.get("days"));
  const days = [1, 7, 30].includes(requestedDays) ? requestedDays : 7;
  const traffic = trafficFilter(new URL(request.url).searchParams.get("traffic"));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  try {
    const metricsSql = "SELECT COUNT(CASE WHEN event_type = 'page_view' THEN 1 END) AS visits, COUNT(DISTINCT CASE WHEN event_type = 'page_view' THEN session_id END) AS visitors, COUNT(DISTINCT CASE WHEN event_type = 'search_started' THEN session_id END) AS search_started, COUNT(DISTINCT CASE WHEN event_type = 'vehicle_results_viewed' THEN session_id END) AS vehicle_results_viewed, COUNT(DISTINCT CASE WHEN event_type = 'vehicle_selected' THEN session_id END) AS vehicle_selected, COUNT(DISTINCT CASE WHEN event_type = 'booking_started' THEN session_id END) AS booking_started, COUNT(DISTINCT CASE WHEN event_type = 'checkout_reached' THEN session_id END) AS checkout_reached, COUNT(DISTINCT CASE WHEN event_type = 'payment_started' THEN session_id END) AS payment_started, COUNT(DISTINCT CASE WHEN event_type = 'booking_confirmed' THEN session_id END) AS booking_confirmed FROM analytics_events WHERE occurred_at >= ? AND " + traffic.clause;
    const countSql = "SELECT COUNT(CASE WHEN event_type = 'page_view' AND COALESCE(traffic_type, 'public') = 'public' THEN 1 END) AS prospect_visits, COUNT(CASE WHEN event_type = 'page_view' AND COALESCE(traffic_type, 'public') IN ('internal', 'automated') THEN 1 END) AS internal_visits, COUNT(CASE WHEN event_type = 'page_view' THEN 1 END) AS total_visits FROM analytics_events WHERE occurred_at >= ?";
    const rowsSql = "SELECT occurred_at, session_id, event_type, page, language, vehicle_id, vehicle_category, COALESCE(traffic_type, 'public') AS traffic_type, source FROM analytics_events WHERE occurred_at >= ? AND " + traffic.clause + " ORDER BY occurred_at DESC LIMIT 250";
    const [metrics, trafficCounts, rows] = await Promise.all([
      env.AGENCY_DB.prepare(metricsSql).bind(since, ...traffic.params).first(),
      env.AGENCY_DB.prepare(countSql).bind(since).first(),
      env.AGENCY_DB.prepare(rowsSql).bind(since, ...traffic.params).all()
    ]);
    const sessions = new Map();
    for (const event of rows.results || []) {
      if (!sessions.has(event.session_id)) sessions.set(event.session_id, { sessionId: event.session_id, trafficType: event.traffic_type || "public", source: event.source || null, events: [] });
      sessions.get(event.session_id).events.push({ occurredAt: event.occurred_at, eventType: event.event_type, page: event.page, language: event.language, vehicleId: event.vehicle_id, vehicleCategory: event.vehicle_category });
    }
    const recentSessions = [...sessions.values()].slice(0, 50).map(session => { const times = session.events.map(event => new Date(event.occurredAt).getTime()).filter(Number.isFinite); return { ...session, durationSeconds: times.length > 1 ? Math.max(0, Math.round((Math.max(...times) - Math.min(...times)) / 1000)) : 0, pageCount: new Set(session.events.map(event => event.page)).size }; });
    const safeMetrics = metrics || {};
    return json(200, { days, traffic: traffic.value, trafficCounts: trafficCounts || {}, metrics: { ...safeMetrics, conversionRate: conversionRate(safeMetrics) }, sessions: recentSessions });
  } catch (error) { console.error("[agency-analytics] lecture indisponible :", error && error.message); return json(503, { error: "Statistiques indisponibles — appliquez la migration D1 0006." }); }
}
module.exports = { handleAgencyAnalytics, trafficFilter, conversionRate };
