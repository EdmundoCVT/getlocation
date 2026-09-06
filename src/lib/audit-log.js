// src/lib/audit-log.js
//
// Journal d'audit des opérateurs (voir CLAUDE.md, cahier des charges
// "Traçabilité des opérateurs") : connexions réussies/échouées, création et
// modification de clients/locations, paiements, cautions, état des lieux.
// `actor` doit TOUJOURS provenir d'une session agence déjà vérifiée (voir
// src/lib/agency-auth.js) ou être `null` pour un événement pré-session
// (échec de connexion) — jamais un nom envoyé librement par le navigateur.
// `metadata` reste minimal : jamais de donnée personnelle au-delà de ce qui
// est strictement utile (voir appelants).

async function recordAuditEvent(env, { actor = null, eventType, entityType = null, entityId = null, metadata = null }) {
  if (!env.AGENCY_DB || !eventType) return;
  await env.AGENCY_DB.prepare(
    "INSERT INTO audit_log (actor, event_type, entity_type, entity_id, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(actor, eventType, entityType, entityId, metadata ? JSON.stringify(metadata) : null, new Date().toISOString()).run();
}

module.exports = { recordAuditEvent };
