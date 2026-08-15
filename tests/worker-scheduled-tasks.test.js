// tests/worker-scheduled-tasks.test.js
//
// Orchestration du Cron Trigger (src/lib/scheduled-tasks.js) : exécution
// séquentielle (jamais en parallèle, pour éviter les écritures KV
// concurrentes sur une même réservation — voir la revue de sécurité des
// PR #3-8, finding "moyenne"), résilience individuelle des étapes, et
// visibilité des échecs dans l'état du Cron Trigger Cloudflare.

const test = require("node:test");
const assert = require("node:assert/strict");

const { runScheduledTasks, CRON_STEPS } = require("../src/lib/scheduled-tasks.js");

test("CRON_STEPS : ordre attendu (purge documentaire en premier)", () => {
  assert.deepEqual(
    CRON_STEPS.map((step) => step.name),
    ["document-retention", "document-reminders", "pickup-reminders", "return-reminders", "agency-daily-summary"]
  );
});

test("runScheduledTasks : exécute les étapes séquentiellement, jamais en parallèle", async () => {
  const order = [];
  const steps = [
    { name: "a", run: async () => { order.push("a-start"); await new Promise((r) => setTimeout(r, 5)); order.push("a-end"); } },
    { name: "b", run: async () => { order.push("b-start"); order.push("b-end"); } }
  ];
  await runScheduledTasks({}, steps);
  // Si l'exécution était parallèle, "b-start" apparaîtrait avant "a-end".
  assert.deepEqual(order, ["a-start", "a-end", "b-start", "b-end"]);
});

test("runScheduledTasks : aucune étape ne bloque les suivantes en cas d'échec", async () => {
  const ran = [];
  const steps = [
    { name: "purge", run: async () => { ran.push("purge"); throw new Error("échec simulé purge"); } },
    { name: "reminders", run: async () => { ran.push("reminders"); } },
    { name: "summary", run: async () => { ran.push("summary"); } }
  ];
  await assert.rejects(runScheduledTasks({}, steps));
  assert.deepEqual(ran, ["purge", "reminders", "summary"]);
});

test("runScheduledTasks : rejette (échec visible) si au moins une étape échoue", async () => {
  const steps = [
    { name: "ok", run: async () => {} },
    { name: "ko", run: async () => { throw new Error("échec simulé"); } }
  ];
  await assert.rejects(runScheduledTasks({}, steps), /ko/);
});

test("runScheduledTasks : ne rejette pas si toutes les étapes réussissent", async () => {
  const steps = [{ name: "a", run: async () => {} }, { name: "b", run: async () => {} }];
  await assert.doesNotReject(runScheduledTasks({}, steps));
});
