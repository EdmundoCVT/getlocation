// src/lib/scheduled-tasks.js
//
// Orchestration des tâches quotidiennes déclenchées par le Cron Trigger
// Cloudflare (voir wrangler.jsonc, "0 6 * * *", et src/worker.js#scheduled).
//
// Ordre volontairement SÉQUENTIEL (jamais Promise.all) : plusieurs de ces
// tâches lisent puis réécrivent en entier le même enregistrement KV d'une
// réservation (voir reservation-store.js — pas de verrou ni de CAS sur ces
// écritures). Les exécuter en parallèle créait un risque réel de "dernier
// écrivain gagne" : une tâche pouvait écraser silencieusement le champ
// qu'une autre venait de poser sur LA MÊME réservation le même jour (ex. la
// purge documentaire et un rappel de prise en charge sur une réservation
// dont le départ est proche), provoquant des relances en double le
// lendemain — voir la revue de sécurité des PR #3-8 (finding "moyenne").
//
// La purge documentaire passe en premier : elle ne doit jamais être
// retardée par un incident sur les rappels, ni inversement — chaque étape
// est indépendante et son échec n'empêche pas les suivantes de s'exécuter
// (voir runScheduledTasks). Mais aucun échec n'est avalé en silence : à la
// fin, si une ou plusieurs étapes ont échoué, la promesse globale est
// rejetée, ce qui fait apparaître l'exécution comme en échec dans l'état du
// Cron Trigger Cloudflare (Workers & Pages > Cron > journal d'exécution).

const { runDocumentRetentionPurge } = require("./document-retention.js");
const { runDocumentReminders } = require("./document-reminders.js");
const { runPickupReminders } = require("./pickup-reminders.js");
const { runReturnReminders } = require("./return-reminders.js");
const { runAgencyDailySummary } = require("./agency-daily-summary.js");

const CRON_STEPS = [
  { name: "document-retention", run: runDocumentRetentionPurge },
  { name: "document-reminders", run: runDocumentReminders },
  { name: "pickup-reminders", run: runPickupReminders },
  { name: "return-reminders", run: runReturnReminders },
  { name: "agency-daily-summary", run: runAgencyDailySummary }
];

async function runScheduledTasks(env, steps = CRON_STEPS) {
  const failedSteps = [];
  for (const step of steps) {
    try {
      await step.run(env);
    } catch (err) {
      console.error(`[cron] Échec de l'étape "${step.name}" :`, err && err.message);
      failedSteps.push(step.name);
    }
  }
  if (failedSteps.length) {
    throw new Error(`Tâches planifiées en échec : ${failedSteps.join(", ")}`);
  }
}

module.exports = { CRON_STEPS, runScheduledTasks };
