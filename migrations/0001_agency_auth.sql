-- Migration 0001 : authentification agence (Lot 1 du mini-back-office).
--
-- Sessions opaques et tentatives de connexion pour les deux opérateurs
-- (Edmundo, Antonio) dont les codes personnels vivent EXCLUSIVEMENT dans des
-- secrets Cloudflare (AGENCY_CODE_EDMUNDO, AGENCY_CODE_ANTONIO) — jamais en
-- clair ici, jamais dans le dépôt. Voir src/lib/agency-auth.js pour la
-- logique de vérification/émission.
--
-- Pas de table "operators" : avec seulement deux personnes fixes, les
-- secrets Cloudflare sont déjà la représentation sécurisée demandée par le
-- cahier des charges ("operators ou une représentation sécurisée
-- équivalente, sans code en clair") — une table dédiée n'ajouterait qu'une
-- duplication sans bénéfice concret pour ce cas précis.

CREATE TABLE IF NOT EXISTS sessions (
  -- Empreinte HMAC-SHA-256 du jeton de session opaque — le jeton brut
  -- (celui posé dans le cookie HttpOnly) n'est JAMAIS stocké, seule son
  -- empreinte, comme les jetons par réservation de contract-dossier-token.js.
  id TEXT PRIMARY KEY,
  -- 'Edmundo' ou 'Antonio' — déterminé côté serveur au moment de la
  -- connexion, jamais reçu ou fait confiance depuis le navigateur ensuite.
  operator TEXT NOT NULL,
  -- Empreinte HMAC-SHA-256 du code de l'opérateur AU MOMENT de la connexion.
  -- Recalculée à chaque requête depuis le secret Cloudflare courant :
  -- si elles ne correspondent plus, le code a été remplacé entre-temps et la
  -- session est révoquée immédiatement (voir resolveAgencySession).
  code_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  -- Expiration ABSOLUE (30 jours depuis la création) : jamais prolongée par
  -- l'usage, jamais de renouvellement silencieux.
  expires_at TEXT NOT NULL,
  -- NULL tant que la session est active ; posé à la déconnexion ou lors
  -- d'une rotation de code détectée.
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Empreinte HMAC-SHA-256 de l'adresse IP — jamais l'IP en clair.
  ip_hash TEXT NOT NULL,
  attempted_at TEXT NOT NULL,
  -- 0 (échec) ou 1 (succès). Jamais le code saisi, dans aucun des deux cas.
  success INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_lookup ON login_attempts(ip_hash, success, attempted_at);
