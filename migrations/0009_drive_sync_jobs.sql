-- Travaux unitaires Drive : une invocation Worker ne traite jamais un
-- dossier entier. Les IDs de dossiers évitent de refaire l'arborescence.
ALTER TABLE drive_sync_outbox ADD COLUMN drive_folders_json TEXT;
CREATE TABLE IF NOT EXISTS drive_sync_jobs (
  reservation_id TEXT NOT NULL,
  source_key TEXT NOT NULL,
  job_type TEXT NOT NULL,
  source_r2_key TEXT,
  target_folder TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  immutable INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  synced_at TEXT,
  PRIMARY KEY (reservation_id, source_key)
);
CREATE INDEX IF NOT EXISTS idx_drive_sync_jobs_pending ON drive_sync_jobs(reservation_id, status, updated_at);
