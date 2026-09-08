// src/lib/sheet-sync-outbox.js
//
// File de reprise de la synchronisation Google Sheets (Lot 3, voir
// CLAUDE.md) : une panne de Google Sheets ne doit jamais faire échouer
// l'enregistrement déjà validé en D1 — enqueueSync() est appelée en
// best-effort juste après une écriture métier réussie (voir
// agency-rentals.js/agency-payments.js/agency-deposits.js), jamais dans le
// chemin qui pourrait faire échouer cette écriture. attemptSync() fait le
// travail réel et journalise le résultat (succès ou échec, jamais de donnée
// personnelle) dans audit_log.

const { generateId } = require("./id.js");
const { syncRentalToSheet } = require("./sheet-sync.js");
const { recordAuditEvent } = require("./audit-log.js");

// "pending" ou "error" : une entrée pas encore synchronisée avec succès,
// quelle que soit l'issue de sa dernière tentative — voir enqueueSync.
async function findActiveOutboxForRental(env, rentalId) {
  const res = await env.AGENCY_DB.prepare("SELECT * FROM sheet_sync_outbox WHERE rental_id = ?").bind(rentalId).all();
  return (res.results || []).find((row) => row.status === "pending" || row.status === "error") || null;
}

// Appelée après chaque déclencheur (création/modification de location,
// paiement, caution, génération du contrat...) — au plus une entrée non
// synchronisée par location : les déclencheurs rapprochés, ou une relance
// après échec, réutilisent la même entrée plutôt que d'en empiler une
// nouvelle (voir attemptSync, qui la fait aussi transiter vers "pending").
async function enqueueSync(env, rentalId) {
  if (!env.AGENCY_DB) return null;
  const existing = await findActiveOutboxForRental(env, rentalId);
  const now = new Date().toISOString();
  if (existing) {
    await env.AGENCY_DB.prepare("UPDATE sheet_sync_outbox SET status = ?, updated_at = ? WHERE id = ?").bind("pending", now, existing.id).run();
    return existing.id;
  }
  const id = generateId("shs");
  await env.AGENCY_DB.prepare(
    "INSERT INTO sheet_sync_outbox (id, rental_id, status, attempt_count, last_attempt_at, last_error, synced_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(id, rentalId, "pending", 0, null, null, null, now, now).run();
  return id;
}

// Tente réellement la synchronisation d'une location et met à jour SON
// entrée de file (créée si besoin, voir enqueueSync) — jamais ne lève : le
// résultat est dans le retour, jamais une exception qui remonterait
// jusqu'à l'appelant (l'écriture métier D1 est déjà faite et validée).
// `actor` : opérateur à l'origine du déclenchement (session agence), ou
// null pour une relance automatique (cron) sans acteur humain direct.
async function attemptSync(env, rentalId, actor = null) {
  if (!env.AGENCY_DB) return { ok: false, reason: "AGENCY_DB manquant" };
  const outboxId = await enqueueSync(env, rentalId);
  const now = new Date().toISOString();

  try {
    await syncRentalToSheet(env, rentalId);
    if (outboxId) {
      await env.AGENCY_DB.prepare(
        "UPDATE sheet_sync_outbox SET status = ?, attempt_count = attempt_count + 1, last_attempt_at = ?, last_error = ?, synced_at = ?, updated_at = ? WHERE id = ?"
      ).bind("synced", now, null, now, now, outboxId).run();
    }
    await recordAuditEvent(env, { actor, eventType: "sheet_sync_succeeded", entityType: "rental", entityId: rentalId });
    return { ok: true };
  } catch (err) {
    const message = (err && err.message) || "Erreur de synchronisation inconnue";
    if (outboxId) {
      // Nécessite de connaître attempt_count actuel pour l'incrémenter en
      // toute sécurité : l'UPSERT ci-dessus utilise `attempt_count + 1`
      // directement en SQL (pas de lecture-puis-écriture) pour rester
      // correct même si deux tentatives se chevauchaient.
      await env.AGENCY_DB.prepare(
        "UPDATE sheet_sync_outbox SET status = ?, attempt_count = attempt_count + 1, last_attempt_at = ?, last_error = ?, updated_at = ? WHERE id = ?"
      ).bind("error", now, message.slice(0, 500), now, outboxId).run();
    }
    await recordAuditEvent(env, { actor, eventType: "sheet_sync_failed", entityType: "rental", entityId: rentalId, metadata: { error: message.slice(0, 300) } });
    return { ok: false, reason: message };
  }
}

// Relance quotidienne (voir scheduled-tasks.js) : reprend toutes les
// entrées en attente ou en échec, une par une (jamais en parallèle, pour ne
// pas multiplier les jetons Google en même temps) — l'échec d'une location
// n'empêche jamais les suivantes.
async function retryPendingSheetSyncs(env) {
  if (!env.AGENCY_DB) return;
  const [pending, errored] = await Promise.all([
    env.AGENCY_DB.prepare("SELECT * FROM sheet_sync_outbox WHERE status = ?").bind("pending").all(),
    env.AGENCY_DB.prepare("SELECT * FROM sheet_sync_outbox WHERE status = ?").bind("error").all()
  ]);
  const rentalIds = [...pending.results || [], ...errored.results || []].map((row) => row.rental_id);
  for (const rentalId of rentalIds) {
    await attemptSync(env, rentalId, null);
  }
}

module.exports = { enqueueSync, attemptSync, retryPendingSheetSyncs };
