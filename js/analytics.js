// Statistiques GETLOCATION : mesure minimale, pseudonymisée et non bloquante.
(function () {
  "use strict";
  if (/\/(?:back-office|contrat)(?:\.html)?\/?$/.test(window.location.pathname) || /\/agency-documents(?:\.html)?\/?$/.test(window.location.pathname)) return;
  const EVENT_TYPES = new Set(["page_view", "search_started", "vehicle_results_viewed", "vehicle_selected", "booking_started", "checkout_reached", "payment_started", "booking_confirmed"]);
  const storageKey = "getlocation.analytics.session";
  let sessionId = "";
  try {
    sessionId = sessionStorage.getItem(storageKey) || "";
    if (!/^[A-Za-z0-9_-]{20,120}$/.test(sessionId)) {
      sessionId = crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "") : `${Date.now()}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
      sessionStorage.setItem(storageKey, sessionId);
    }
  } catch (_) { sessionId = `anonymous${Date.now()}${Math.random().toString(36).slice(2)}`; }
  const queue = [];
  let timer = null;
  function language() { return window.location.pathname.indexOf("/en/") === 0 ? "en" : "fr"; }
  function send() {
    timer = null;
    if (!queue.length) return;
    const events = queue.splice(0, 10);
    const body = JSON.stringify({ events });
    try {
      if (navigator.sendBeacon && navigator.sendBeacon("/api/analytics-events", new Blob([body], { type: "application/json" }))) return;
    } catch (_) { /* repli fetch */ }
    fetch("/api/analytics-events", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => undefined);
  }
  function track(eventType, details) {
    if (!EVENT_TYPES.has(eventType)) return;
    const event = { sessionId, eventType, occurredAt: new Date().toISOString(), page: window.location.pathname || "/", language: language() };
    if (details && details.vehicleId) event.vehicleId = String(details.vehicleId).slice(0, 80);
    if (details && details.vehicleCategory) event.vehicleCategory = String(details.vehicleCategory).slice(0, 80);
    queue.push(event);
    if (!timer) timer = setTimeout(send, 250);
  }
  window.getlocationAnalytics = { track };
  document.addEventListener("DOMContentLoaded", function () {
    track("page_view");
    if (/\/vehicules(?:\.html)?\/?$/.test(window.location.pathname) || /\/en\/cars\/?$/.test(window.location.pathname)) track("vehicle_results_viewed");
    if (/\/paiement(?:\.html)?\/?$/.test(window.location.pathname) || /\/en\/payment\/?$/.test(window.location.pathname)) track("checkout_reached");
    if (/\/confirmation(?:\.html)?\/?$/.test(window.location.pathname) || /\/en\/confirmation\/?$/.test(window.location.pathname)) track("booking_confirmed");
    const search = document.getElementById("search-form");
    if (search) search.addEventListener("submit", function () { track("search_started"); });
    document.addEventListener("click", function (event) {
      const vehicleButton = event.target.closest(".vehicle-card button[data-id]");
      if (vehicleButton) {
        const card = vehicleButton.closest(".vehicle-card");
        const category = card && card.querySelector(".vehicle-category");
        track("vehicle_selected", { vehicleId: vehicleButton.dataset.id, vehicleCategory: category && category.textContent });
        track("booking_started");
      }
      if (event.target.closest("#continue-to-options, #continue-to-payment")) track("booking_started");
    });
    const payment = document.getElementById("payment-form");
    if (payment) payment.addEventListener("submit", function () { track("payment_started"); send(); });
  });
  window.addEventListener("pagehide", send);
})();
