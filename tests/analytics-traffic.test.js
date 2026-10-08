const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const { createFakeKv } = require("./helpers/fake-kv.js");
const { handleAnalyticsEvents } = require("../src/api/analytics-events.js");
const { trafficFilter, conversionRate } = require("../src/api/agency-analytics.js");

function event(trafficType) {
  return { sessionId: "session_123456789012345", eventType: "page_view", occurredAt: new Date().toISOString(), page: "/", language: "fr", trafficType };
}

async function storedTrafficType(trafficType) {
  const bound = [];
  const env = {
    RATE_LIMITS_KV: createFakeKv(),
    AGENCY_DB: {
      prepare() { return { bind(...values) { bound.push(values); return { values }; } }; },
      async batch() { return []; }
    }
  };
  const response = await handleAnalyticsEvents(new Request("https://getlocation.fr/api/analytics-events", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "198.51.100.1" }, body: JSON.stringify({ events: [event(trafficType)] }) }), env);
  assert.equal(response.status, 202);
  return bound[0][8];
}

test("analytics : les visites publique, interne et automatisée sont classées explicitement", async () => {
  assert.equal(await storedTrafficType("public"), "public");
  assert.equal(await storedTrafficType("internal"), "internal");
  assert.equal(await storedTrafficType("automated"), "automated");
});

test("analytics : un type absent ou inconnu reste public", async () => {
  assert.equal(await storedTrafficType(undefined), "public");
  assert.equal(await storedTrafficType("invented"), "public");
});

test("statistiques : prospects par défaut, internes et automatisés regroupés", () => {
  assert.deepEqual(trafficFilter(null), { value: "public", clause: "COALESCE(traffic_type, 'public') = ?", params: ["public"] });
  assert.equal(trafficFilter("internal").clause.includes("'internal', 'automated'"), true);
  assert.equal(trafficFilter("all").clause, "1 = 1");
  assert.equal(conversionRate({ visitors: 4, booking_confirmed: 1 }), 25);
  assert.equal(conversionRate({ visitors: 0, booking_confirmed: 3 }), 0);
});

test("back-office : les filtres et badges de trafic sont présents", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "back-office.html"), "utf8");
  assert.match(source, /data-traffic="public">Prospects/);
  assert.match(source, /data-traffic="internal">Internes\/tests/);
  assert.match(source, /data-traffic="all">Tous/);
  assert.match(source, /Visites prospects/);
  assert.match(source, /Visites internes\/tests/);
  assert.match(source, /Test automatisé/);
});

test("client analytics : marqueur agence et signal automatisé sont prévus sans user-agent", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "js", "analytics.js"), "utf8");
  assert.match(source, /getlocation_internal/);
  assert.match(source, /getlocation\.analytics\.traffic_type/);
  assert.match(source, /__GETLOCATION_ANALYTICS_TRAFFIC_TYPE__/);
  assert.doesNotMatch(source, /userAgent/i);
});

async function clientTrafficType(setup) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://getlocation.fr/", runScripts: "outside-only" });
  const { window } = dom;
  const sent = [];
  window.fetch = async (_url, options) => { sent.push(JSON.parse(options.body)); return { ok: true }; };
  window.navigator.sendBeacon = undefined;
  setup(window);
  window.eval(fs.readFileSync(path.join(__dirname, "..", "js", "analytics.js"), "utf8"));
  window.document.dispatchEvent(new window.Event("DOMContentLoaded"));
  await new Promise((resolve) => setTimeout(resolve, 300));
  dom.window.close();
  return sent[0].events[0].trafficType;
}

test("client analytics : le marqueur navigateur sélectionne bien interne ou automatisé", async () => {
  assert.equal(await clientTrafficType(() => {}), "public");
  assert.equal(await clientTrafficType((window) => window.localStorage.setItem("getlocation_internal", "1")), "internal");
  assert.equal(await clientTrafficType((window) => window.localStorage.setItem("getlocation.analytics.traffic_type", "automated")), "automated");
});
