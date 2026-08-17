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
const { handleCreateContract } = require("./api/contracts-create.js");
const { handleListContracts } = require("./api/contracts-list.js");
const { handleUpdateContract } = require("./api/contracts-update.js");

const ROUTES = {
  "/api/create-payment": handleCreatePayment,
  "/api/mollie-webhook": handleMollieWebhook,
  "/api/reservation-status": handleReservationStatus,
  "/api/contracts-create": handleCreateContract,
  "/api/contracts-list": handleListContracts,
  "/api/contracts-update": handleUpdateContract
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const route = ROUTES[url.pathname];
    if (route) {
      return route(request, env, ctx);
    }
    return env.ASSETS.fetch(request);
  }
};
