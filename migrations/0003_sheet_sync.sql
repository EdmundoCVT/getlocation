-- Migration 0003 : file de reprise de la synchronisation Google Sheets
-- (Lot 3, voir CLAUDE.md). Une panne de Google Sheets ne doit jamais faire
-- échouer l'enregistrement dans la base interne (D1 reste la source
-- fiable) — cette table permet de retenter une synchronisation échouée sans
-- jamais dupliquer une ligne (voir src/lib/sheet-sync.js, clé
-- d'idempotence = "N° résa").
--
-- Au plus une entrée "pending" par location à la fois (voir
-- src/lib/sheet-sync-outbox.js, enqueueSync) : plusieurs déclencheurs
-- rapprochés sur la même location (ex. création puis paiement immédiat) ne
-- doivent pas empiler des tentatives redondantes.

CREATE TABLE IF NOT EXISTS sheet_sync_outbox (
  id TEXT PRIMARY KEY,
  rental_id TEXT NOT NULL,
  -- 'pending' | 'synced' | 'error'
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,
  -- Message d'erreur technique (jamais de donnée personnelle) pour
  -- diagnostic — voir cahier des charges : "journaliser le résultat sans
  -- données personnelles inutiles".
  last_error TEXT,
  synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sheet_sync_outbox_rental ON sheet_sync_outbox(rental_id);
CREATE INDEX IF NOT EXISTS idx_sheet_sync_outbox_status ON sheet_sync_outbox(status);
