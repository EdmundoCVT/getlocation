-- Classification pseudonymisée du trafic analytics.
-- Les événements historiques reçoivent la valeur par défaut "public" afin de
-- préserver les statistiques existantes sans stocker de donnée personnelle.

ALTER TABLE analytics_events ADD COLUMN traffic_type TEXT NOT NULL DEFAULT 'public';
ALTER TABLE analytics_events ADD COLUMN source TEXT;

CREATE INDEX IF NOT EXISTS idx_analytics_events_traffic_occurred_at
  ON analytics_events(traffic_type, occurred_at);
