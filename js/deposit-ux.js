// GETLOCATION — affichage de la caution uniquement à l'étape de paiement.
// La donnée de caution reste inchangée dans js/data.js pour les contrats,
// le back-office et les traitements métier.
(function () {
  "use strict";

  function isEnglish() {
    return /^\/en(\/|$)/.test(window.location.pathname || "");
  }

  function hideEarlyDepositAmounts(root) {
    var scope = root && root.querySelectorAll ? root : document;

    // Cartes véhicules : supprime uniquement le badge de caution.
    scope.querySelectorAll(".vehicle-specs span").forEach(function (span) {
      var text = (span.textContent || "").trim();
      if (/^Caution\s+[\d\s.,]+\s*€$/i.test(text) || /^€\s*[\d\s.,]+\s*deposit$/i.test(text)) {
        span.remove();
      }
    });

    // Étape Protection : conserve l'explication de couverture, mais ne
    // révèle plus le montant de caution avant l'étape de règlement.
    scope.querySelectorAll(".choice-details p").forEach(function (p) {
      var text = (p.textContent || "").trim();
      if (/caution\s+de\s+[\d\s.,]+\s*€/i.test(text) || /deposit\s+of\s+€?[\d\s.,]+/i.test(text)) {
        p.textContent = isEnglish()
          ? "No extra charge. The applicable security-deposit terms will be shown at the payment step."
          : "Aucun supplément. Les conditions du dépôt de garantie seront rappelées au moment du règlement.";
      }
    });

    // La FAQ ne doit plus affirmer que le montant apparaît sur chaque fiche.
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
    return /\/paiement(?:\.html)?$/.test(window.location.pathname) || /\/en\/payment\/?$/.test(window.location.pathname);
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

    // Harmonise la petite mention sous le bouton de paiement.
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

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { refresh(document); });
  } else {
    refresh(document);
  }

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
