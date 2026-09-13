// src/worker.js
//
// Point d'entrée du Worker Cloudflare : sert le site statique (binding
// ASSETS, voir wrangler.jsonc) et route les endpoints /api/* vers les
// fonctions serveur (src/api/*) — Phase B de la migration Cloudflare (voir
// DEPLOIEMENT.md). Remplace les fonctions Netlify de la Phase A, appelées
// jusqu'ici en cross-origin explicite depuis js/app.js.
//
// Ce fichier doit rester un module ES (export default) : c'est une
// contrainte du runtime Workers pour accéder aux bindings (env.ASSETS,
// env.RESERVATIONS_KV...). Le reste du code serveur (src/api, src/lib)
// reste en CommonJS, comme l'ancien code Netlify, pour rester testable
// directement sous Node (`require(...)`) sans étape de bundling — seul ce
// point d'entrée a besoin de require() pour les assembler.

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
const { handleContractsManualCreate } = require("./api/contracts-manual-create.js");
const { handleContractsManualUpdate } = require("./api/contracts-manual-update.js");
const { handleContractsHistory } = require("./api/contracts-history.js");
const { handleAgencyLogin } = require("./api/agency-login.js");
const { handleAgencyLogout } = require("./api/agency-logout.js");
const { handleAgencySession } = require("./api/agency-session.js");
const { handleAgencyClients } = require("./api/agency-clients.js");
const { handleAgencyRentals } = require("./api/agency-rentals.js");
const { handleAgencyPayments } = require("./api/agency-payments.js");
const { handleAgencyDeposits } = require("./api/agency-deposits.js");
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
  "/api/contracts-manual-create": handleContractsManualCreate,
  "/api/contracts-manual-update": handleContractsManualUpdate,
  "/api/contracts-history": handleContractsHistory,
  "/api/agency-login": handleAgencyLogin,
  "/api/agency-logout": handleAgencyLogout,
  "/api/agency-session": handleAgencySession,
  "/api/agency-clients": handleAgencyClients,
  "/api/agency-rentals": handleAgencyRentals,
  "/api/agency-payments": handleAgencyPayments,
  "/api/agency-deposits": handleAgencyDeposits
};

function isVehicleResultsPath(pathname) {
  return /\/vehicules(?:\.html)?\/?$/.test(pathname) || /\/en\/cars\/?$/.test(pathname);
}

function hideCatalogBeforeSearch(html, pathname) {
  if (isVehicleResultsPath(pathname)) return html;

  // Les catalogues historiques de l'accueil et des pages locales sont retirés
  // côté Worker : le client doit d'abord choisir ses dates dans le moteur de
  // recherche. La page de résultats reste intacte.
  html = html.replace(/<section\b[\s\S]*?<\/section>/gi, (section) => {
    return /class=["'][^"']*vehicle-grid[^"']*["']|class=["']vehicle-grid["']/i.test(section)
      ? ""
      : section;
  });

  // Les anciens liens directs vers le catalogue renvoient désormais vers le
  // moteur de recherche de la page courante.
  html = html.replace(/href=["'](?:\/?vehicules(?:\.html)?(?:\?[^"']*)?|\/en\/cars\/?)['"]/gi, 'href="#search-form"');
  html = html.replace(/>Véhicules<\/a>/gi, ">Réserver</a>");
  html = html.replace(/>Voir(?: tous)? les véhicules<\/a>/gi, ">Trouver un véhicule</a>");
  html = html.replace(/>Vehicles<\/a>/gi, ">Book</a>");
  html = html.replace(/>View(?: all)? vehicles<\/a>/gi, ">Find a vehicle</a>");

  return html;
}

async function withClientUX(response, pathname) {
  if (!response) return response;
  const type = response.headers.get("content-type") || "";
  if (!type.includes("text/html")) return response;

  let html = await response.text();
  html = hideCatalogBeforeSearch(html, pathname);

  if (!html.includes("/js/deposit-ux.js")) {
    const script = '<script src="/js/deposit-ux.js?v=2"></script>';
    html = html.includes("</body>")
      ? html.replace("</body>", `${script}\n</body>`)
      : `${html}\n${script}`;
  } else {
    html = html.replace(/\/js\/deposit-ux\.js\?v=\d+/g, "/js/deposit-ux.js?v=2");
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
    const route = ROUTES[url.pathname];
    if (route) {
      return route(request, env, ctx);
    }
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
