// src/worker.js
//
// Point d'entrée du Worker Cloudflare : sert le site statique (binding
// ASSETS, voir wrangler.jsonc) et route les endpoints /api/* vers les
// fonctions serveur (src/api/*) — Phase B de la migration Cloudflare.

const { handleCreatePayment } = require("./api/create-payment.js");
const { handleMollieWebhook } = require("./api/mollie-webhook.js");
const { handleReservationStatus } = require("./api/reservation-status.js");
const { handleValidatePromo } = require("./api/validate-promo.js");
const { handleDocumentsAccess } = require("./api/documents-access.js");
const { handleDocumentsSubmit } = require("./api/documents-submit.js");
const { handleAgencyDocumentsAccess } = require("./api/agency-documents-access.js");
const { handleAgencyDocumentFile } = require("./api/agency-document-file.js");
const { handleContractDossierAgency } = require("./api/contract-dossier-agency.js");
const { handleContractDossierClient } = require("./api/contract-dossier-client.js");
const { handleContractManualLink } = require("./api/contract-manual-link.js");
const { handleContractAgencyLink } = require("./api/contract-agency-link.js");
const { handleContractsManualCreate } = require("./api/contracts-manual-create.js");
const { handleContractsManualUpdate } = require("./api/contracts-manual-update.js");
const { handleContractsHistory } = require("./api/contracts-history.js");
const { handleContractsVersion } = require("./api/contracts-version.js");
const { handleAgencyLogin } = require("./api/agency-login.js");
const { handleAgencyLogout } = require("./api/agency-logout.js");
const { handleAgencySession } = require("./api/agency-session.js");
const { handleAgencyClients } = require("./api/agency-clients.js");
const { handleAgencyRentals } = require("./api/agency-rentals.js");
const { handleAgencyPayments } = require("./api/agency-payments.js");
const { handleAgencyDeposits } = require("./api/agency-deposits.js");
const { handleDepositCheckout } = require("./api/deposit-checkout.js");
const { handleAnalyticsEvents } = require("./api/analytics-events.js");
const { handleVehicleRequest } = require("./api/vehicle-request.js");
const { handleBusinessPartner } = require("./api/business-partner.js");
const { handleBusinessContact } = require("./api/business-contact.js");
const { handleAgencyAnalytics } = require("./api/agency-analytics.js");
const { handleAgencyGoogleSheets } = require("./api/agency-google-sheets.js");
const { handleAgencyDashboard } = require("./api/agency-dashboard.js");
const { handleInspectionMedia } = require("./api/inspection-media.js");
const { handleLegacyInspectionAgency, handleLegacyInspectionMedia, handleLegacyInspectionDiagnostic } = require("./api/legacy-inspection-agency.js");
const { handleZvezdanReturnMedia } = require("./api/zvezdan-return-media.js");
const { runScheduledTasks } = require("./lib/scheduled-tasks.js");
const { estCheminAnglais, servirPageAnglaise } = require("./lib/pages-en.js");

const ROUTES = {
  "/api/create-payment": handleCreatePayment,
  "/api/mollie-webhook": handleMollieWebhook,
  "/api/reservation-status": handleReservationStatus,
  "/api/validate-promo": handleValidatePromo,
  "/api/documents-access": handleDocumentsAccess,
  "/api/documents-submit": handleDocumentsSubmit,
  "/api/agency-documents-access": handleAgencyDocumentsAccess,
  "/api/agency-document-file": handleAgencyDocumentFile,
  "/api/contract-dossier-agency": handleContractDossierAgency,
  "/api/contract-dossier-client": handleContractDossierClient,
  "/api/contract-manual-link": handleContractManualLink,
  "/api/contract-agency-link": handleContractAgencyLink,
  "/api/contracts-manual-create": handleContractsManualCreate,
  "/api/contracts-manual-update": handleContractsManualUpdate,
  "/api/contracts-history": handleContractsHistory,
  "/api/contracts-version": handleContractsVersion,
  "/api/agency-login": handleAgencyLogin,
  "/api/agency-logout": handleAgencyLogout,
  "/api/agency-session": handleAgencySession,
  "/api/agency-clients": handleAgencyClients,
  "/api/agency-rentals": handleAgencyRentals,
  "/api/agency-payments": handleAgencyPayments,
  "/api/agency-deposits": handleAgencyDeposits,
  "/api/deposit-checkout": handleDepositCheckout,
  "/api/analytics-events": handleAnalyticsEvents,
  "/api/vehicle-request": handleVehicleRequest,
  "/api/business-partner": handleBusinessPartner,
  "/api/business-contact": handleBusinessContact,
  "/api/agency-analytics": handleAgencyAnalytics,
  "/api/agency-google-sheets": handleAgencyGoogleSheets,
  "/api/agency-dashboard": handleAgencyDashboard,
  "/api/inspection-media": handleInspectionMedia,
  "/api/legacy-inspection-agency": handleLegacyInspectionAgency,
  "/api/legacy-inspection-media": handleLegacyInspectionMedia,
  "/api/legacy-inspection-diagnostic": handleLegacyInspectionDiagnostic,
  "/api/zvezdan-return-media": handleZvezdanReturnMedia
};

function isVehicleResultsPath(pathname) {
  return /\/vehicules(?:\.html)?\/?$/.test(pathname) || /\/en\/cars\/?$/.test(pathname);
}

function hideCatalogBeforeSearch(html, pathname) {
  if (isVehicleResultsPath(pathname)) return html;

  html = html.replace(/<section\b[\s\S]*?<\/section>/gi, (section) => {
    return /class=["'][^"']*vehicle-grid[^"']*["']|class=["']vehicle-grid["']/i.test(section)
      ? ""
      : section;
  });

  html = html.replace(/\s*<a\b[^>]*class=["'][^"']*btn\s+btn-secondary[^"']*["'][^>]*>\s*(?:Voir(?: tous)? les véhicules|View(?: all)? vehicles|Trouver un véhicule|Find a vehicle)\s*<\/a>/gi, "");
  html = html.replace(/href=["'](?:\/?vehicules(?:\.html)?(?:\?[^"']*)?|\/en\/cars\/?)['"]/gi, 'href="#search-form"');
  html = html.replace(/>Véhicules<\/a>/gi, ">Réserver</a>");
  html = html.replace(/>Vehicles<\/a>/gi, ">Book</a>");

  return html;
}

async function withClientUX(response, pathname) {
  if (!response) return response;
  const type = response.headers.get("content-type") || "";
  if (!type.includes("text/html")) return response;

  let html = await response.text();
  html = hideCatalogBeforeSearch(html, pathname);

  // Catalogue complémentaire : chargé après data.js/app.js lors du parsing,
  // mais avant DOMContentLoaded. Les véhicules sur demande sont donc ajoutés
  // avant initVehiculesPage(), sans toucher au calcul de prix/paiement des
  // véhicules internes.
  if (!html.includes("/js/request-catalog.js")) {
    const requestCatalog = '<script src="/js/request-catalog.js?v=2"></script>';
    html = html.includes("</body>")
      ? html.replace("</body>", `${requestCatalog}\n</body>`)
      : `${html}\n${requestCatalog}`;
  }

  if (!html.includes("/js/deposit-ux.js")) {
    const script = '<script src="/js/deposit-ux.js?v=4"></script>';
    html = html.includes("</body>")
      ? html.replace("</body>", `${script}\n</body>`)
      : `${html}\n${script}`;
  } else {
    html = html.replace(/\/js\/deposit-ux\.js\?v=\d+/g, "/js/deposit-ux.js?v=4");
  }

  if (!html.includes("/js/analytics.js")) {
    const analytics = '<script src="/js/analytics.js?v=2"></script>';
    html = html.includes("</body>") ? html.replace("</body>", `${analytics}\n</body>`) : `${html}\n${analytics}`;
  }

  if (/\/contrat(?:\.html)?\/?$/.test(pathname) && !html.includes("/js/inspection-v2.js")) {
    const inspection = '<script src="/js/inspection-v2.js?v=1"></script>';
    html = html.includes("</body>") ? html.replace("</body>", `${inspection}\n</body>`) : `${html}\n${inspection}`;
  }

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("etag");
  headers.set("cache-control", "no-cache");

  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // L'ancien écran « Admin » n'était qu'un lanceur vers les outils
    // agence : il rejoint l'entrée interne unique. `/back-office` reste la
    // route technique de cette entrée pour éviter une boucle avec la
    // normalisation automatique des assets HTML par Cloudflare.
    if (["/admin", "/admin.html"].includes(url.pathname)) {
      return Response.redirect(new URL("/back-office", url), 302);
    }
    if (["/espace-get-location", "/espace-get-location/"].includes(url.pathname)) {
      const assetRequest = new Request(new URL("/back-office.html", url), request);
      return withClientUX(await env.ASSETS.fetch(assetRequest), url.pathname);
    }
    const route = ROUTES[url.pathname];
    if (route) return route(request, env, ctx);

    if (estCheminAnglais(url.pathname)) {
      const pageAnglaise = await servirPageAnglaise(request, env, url);
      if (pageAnglaise) return withClientUX(pageAnglaise, url.pathname);
    }
    return withClientUX(await env.ASSETS.fetch(request), url.pathname);
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runScheduledTasks(env));
  }
};
