-- Migration 0005 : statistiques internes pseudonymisées du parcours client.
-- Aucun nom, email, téléphone, adresse, IP ou donnée de formulaire n'est stocké.

CREATE TABLE IF NOT EXISTS analytics_events (
  id TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL,
  session_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  page TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'fr',
  vehicle_id TEXT,
  vehicle_category TEXT
);

CREATE INDEX IF NOT EXISTS idx_analytics_events_occurred_at ON analytics_events(occurred_at);
CREATE INDEX IF NOT EXISTS idx_analytics_events_session ON analytics_events(session_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_analytics_events_type ON analytics_events(event_type, occurred_at);
