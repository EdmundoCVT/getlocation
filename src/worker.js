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
const { runScheduledTasks } = require("./lib/scheduled-tasks.js");

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
  "/api/contract-dossier-client": handleContractDossierClient
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const route = ROUTES[url.pathname];
    if (route) {
      return route(request, env, ctx);
    }
    return env.ASSETS.fetch(request);
  },
  // Orchestration détaillée (ordre, gestion des échecs) dans
  // lib/scheduled-tasks.js — ce point d'entrée reste un simple assembleur,
  // comme le reste de ce fichier (voir en-tête).
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runScheduledTasks(env));
  }
};
