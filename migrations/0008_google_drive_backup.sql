-- Sauvegarde secondaire Google Drive. Cloudflare KV/R2 restent la source
-- opérationnelle ; cette table ne stocke que l'état et les identifiants Drive.
CREATE TABLE IF NOT EXISTS drive_sync_outbox (
  reservation_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending',
  drive_folder_id TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,
  last_error TEXT,
  synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_drive_sync_outbox_status ON drive_sync_outbox(status);

CREATE TABLE IF NOT EXISTS drive_sync_files (
  reservation_id TEXT NOT NULL,
  source_key TEXT NOT NULL,
  drive_file_id TEXT NOT NULL,
  immutable INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (reservation_id, source_key)
);
