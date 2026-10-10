-- Manifest et diagnostic compact : évitent de réécrire tous les jobs à
-- chaque cron tout en rendant la reprise observable depuis le back-office.
ALTER TABLE drive_sync_outbox ADD COLUMN drive_jobs_manifest TEXT;
ALTER TABLE drive_sync_outbox ADD COLUMN drive_last_run_json TEXT;
