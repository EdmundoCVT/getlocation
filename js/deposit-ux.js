// GETLOCATION — UX client : caution + accès aux véhicules après recherche datée.
(function () {
  "use strict";

  function isEnglish() {
    return /^\/en(\/|$)/.test(window.location.pathname || "");
  }

  function isResultsPage() {
    var path = window.location.pathname || "";
    return /\/vehicules(?:\.html)?\/?$/.test(path) || /\/en\/cars\/?$/.test(path);
  }

  function hasValidSearch() {
    try {
      var raw = window.localStorage.getItem("gl_recherche");
      if (!raw) return false;
      var search = JSON.parse(raw);
      if (!search || !search.dateDebut || !search.dateFin || !search.heureDebut || !search.heureFin || !search.typeVehicule) return false;
      var start = new Date(search.dateDebut + "T" + search.heureDebut + ":00");
      var end = new Date(search.dateFin + "T" + search.heureFin + ":00");
      return Number.isFinite(start.getTime()) && Number.isFinite(end.getTime()) && end > start;
    } catch (e) {
      return false;
    }
  }

  function searchTarget() {
    if (document.getElementById("search-form")) return "#search-form";
    return isEnglish() ? "/en/#search-form" : "/#search-form";
  }

  function gateResultsPage() {
    if (!isResultsPage() || hasValidSearch()) return false;
    window.location.replace(searchTarget());
    return true;
  }

  function removePreSearchVehicleSections() {
    if (isResultsPage()) return;
    document.querySelectorAll(".vehicle-grid").forEach(function (grid) {
      var section = grid.closest("section");
      if (section) section.remove();
      else grid.remove();
    });
  }

  function rewriteDirectVehicleLinks() {
    if (isResultsPage()) return;
    document.querySelectorAll('a[href*="vehicules.html"], a[href="/vehicules"], a[href="/vehicules/"], a[href="/en/cars"], a[href="/en/cars/"]').forEach(function (link) {
      link.setAttribute("href", searchTarget());
      var text = (link.textContent || "").trim();
      if (/^Véhicules$/i.test(text) || /^Vehicles$/i.test(text)) {
        link.textContent = isEnglish() ? "Book" : "Réserver";
      } else if (/Voir les véhicules/i.test(text) || /View vehicles/i.test(text) || /Voir tous les véhicules/i.test(text) || /View all vehicles/i.test(text)) {
        link.textContent = isEnglish() ? "Find a vehicle" : "Trouver un véhicule";
      }
    });
  }

  function hideEarlyDepositAmounts(root) {
    var scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll(".vehicle-specs span").forEach(function (span) {
      var text = (span.textContent || "").trim();
      if (/^Caution\s+[\d\s.,]+\s*€$/i.test(text) || /^€\s*[\d\s.,]+\s*deposit$/i.test(text)) span.remove();
    });
    scope.querySelectorAll(".choice-details p").forEach(function (p) {
      var text = (p.textContent || "").trim();
      if (/caution\s+de\s+[\d\s.,]+\s*€/i.test(text) || /deposit\s+of\s+€?[\d\s.,]+/i.test(text)) {
        p.textContent = isEnglish()
          ? "No extra charge. The applicable security-deposit terms will be shown at the payment step."
          : "Aucun supplément. Les conditions du dépôt de garantie seront rappelées au moment du règlement.";
      }
    });
    scope.querySelectorAll(".faq-item p").forEach(function (p) {
      var text = (p.textContent || "").trim();
      if (text.indexOf("Son montant exact est affiché sur chaque fiche véhicule") !== -1) {
        p.textContent = "Oui, un dépôt de garantie est demandé selon le véhicule loué. Son montant exact est indiqué au moment du règlement, avant la confirmation de la réservation.";
      } else if (text.indexOf("The exact amount is shown on each vehicle page") !== -1) {
        p.textContent = "Yes, a security deposit is required depending on the vehicle. The exact amount is shown at the payment step, before the booking is confirmed.";
      }
    });
  }

  function reservationVehicle() {
    try {
      var raw = window.localStorage.getItem("gl_reservation");
      var stored = raw ? JSON.parse(raw) : null;
      if (!stored || !stored.vehiculeId || typeof getVehiculeParId !== "function") return null;
      return getVehiculeParId(stored.vehiculeId);
    } catch (e) {
      return null;
    }
  }

  function onPaymentPage() {
    var path = window.location.pathname || "";
    return /\/paiement(?:\.html)?\/?$/.test(path) || /\/en\/payment\/?$/.test(path);
  }

  function renderPaymentDepositDisclosure() {
    if (!onPaymentPage()) return;
    var summary = document.getElementById("payment-summary");
    if (!summary || document.getElementById("payment-deposit-disclosure")) return;
    var vehicle = reservationVehicle();
    if (!vehicle || !Number.isFinite(vehicle.caution)) return;

    var box = document.createElement("div");
    box.id = "payment-deposit-disclosure";
    box.setAttribute("role", "note");
    box.style.cssText = "margin-top:18px;padding:16px 18px;border:1px solid #e7e7e7;border-radius:14px;background:#fafafa;line-height:1.5";

    var title = document.createElement("strong");
    title.style.cssText = "display:block;margin-bottom:6px;font-size:1rem;color:#1f1f1f";
    title.textContent = isEnglish() ? "Security deposit" : "Caution";

    var amount = document.createElement("div");
    amount.style.cssText = "font-size:1.15rem;font-weight:700;margin-bottom:6px;color:#1f1f1f";
    amount.textContent = typeof formatEUR === "function" ? formatEUR(vehicle.caution) : vehicle.caution + " €";

    var text = document.createElement("p");
    text.style.cssText = "margin:0;color:#666";
    text.textContent = isEnglish()
      ? "This security deposit will be requested separately when the vehicle is handed over. It is not included in the amount paid today. Depending on the method used, it may be a card pre-authorisation or another deposit method provided for in the rental agreement."
      : "Cette caution sera demandée séparément le jour de la prise en charge du véhicule. Elle n'est pas comprise dans le montant payé aujourd'hui. Selon le mode utilisé, il pourra s'agir d'une empreinte bancaire (préautorisation) ou d'un autre moyen prévu au contrat.";

    box.append(title, amount, text);
    summary.appendChild(box);

    document.querySelectorAll(".pay-lock + .hint-text").forEach(function (hint) {
      hint.textContent = isEnglish()
        ? "The security deposit is handled separately when the vehicle is handed over."
        : "La caution est traitée séparément le jour de la prise en charge du véhicule.";
    });
  }

  function refresh(root) {
    hideEarlyDepositAmounts(root || document);
    renderPaymentDepositDisclosure();
  }

  function init() {
    if (gateResultsPage()) return;
    removePreSearchVehicleSections();
    rewriteDirectVehicleLinks();
    refresh(document);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  if (window.MutationObserver) {
    var observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (mutation) {
        mutation.addedNodes.forEach(function (node) {
          if (node.nodeType === 1) refresh(node);
        });
      });
      renderPaymentDepositDisclosure();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
