-- Préautorisations de caution Mollie. Les captures sont immuables : chaque
-- ligne est une opération distincte, jamais un solde réécrit a posteriori.
ALTER TABLE deposits ADD COLUMN provider TEXT;
ALTER TABLE deposits ADD COLUMN mollie_payment_id TEXT;
ALTER TABLE deposits ADD COLUMN authorization_status TEXT;
ALTER TABLE deposits ADD COLUMN authorization_expires_at TEXT;
ALTER TABLE deposits ADD COLUMN authorized_at TEXT;
ALTER TABLE deposits ADD COLUMN released_at TEXT;
ALTER TABLE deposits ADD COLUMN customer_link_hash TEXT;
ALTER TABLE deposits ADD COLUMN customer_link_expires_at TEXT;
ALTER TABLE deposits ADD COLUMN release_requested_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_deposits_mollie_payment ON deposits(mollie_payment_id);

CREATE TABLE IF NOT EXISTS deposit_captures (
  id TEXT PRIMARY KEY,
  deposit_id TEXT NOT NULL REFERENCES deposits(id),
  mollie_capture_id TEXT UNIQUE,
  amount_cents INTEGER NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL,
  idempotency_key TEXT UNIQUE,
  requested_by TEXT,
  requested_at TEXT NOT NULL,
  completed_at TEXT,
  failure_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_deposit_captures_deposit ON deposit_captures(deposit_id, requested_at);
