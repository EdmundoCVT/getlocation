-- Migration 0005 : préautorisation bancaire Mollie pour le dépôt de
-- garantie (empreinte carte, captureMode manual) — voir CLAUDE.md.
--
-- JAMAIS confondue avec la caution "classique" enregistrée à la main (voir
-- src/lib/deposits.js, table deposits, modes carte physique/espèces/
-- virement) : une location choisit l'un OU l'autre mécanisme pour sa
-- caution, jamais les deux. Montants en CENTIMES (même convention que le
-- reste du Lot 2 — voir migrations/0002_clients_rentals.sql).
--
-- Clé Mollie utilisée : MOLLIE_DEPOSIT_API_KEY, secret Cloudflare DISTINCT
-- de MOLLIE_API_KEY (paiement de location, déjà en mode live en
-- production) — une clé de TEST ici ne doit jamais pouvoir interférer avec
-- les vrais paiements de location. Tant que ce secret contient un jeton
-- `test_...`, l'espace agence affiche "MOLLIE — MODE TEST" (voir
-- src/lib/deposit-authorizations.js).
--
-- Pas de contrainte UNIQUE sur rental_id : contrairement à `deposits`,
-- l'historique des tentatives (expirée, libérée, échouée...) est conservé
-- et une nouvelle demande peut suivre une tentative terminée. La logique
-- applicative garantit qu'une seule ligne reste "active" (non terminale) à
-- la fois par location — voir getActiveDepositAuthorization dans
-- src/lib/deposit-authorizations.js.
CREATE TABLE IF NOT EXISTS deposit_authorizations (
  id TEXT PRIMARY KEY,
  rental_id TEXT NOT NULL REFERENCES rentals(id),
  mollie_payment_id TEXT UNIQUE,
  authorized_amount_cents INTEGER NOT NULL,
  captured_amount_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'EUR',
  -- Statut interne GET LOCATION (voir deposit-authorizations.js pour le
  -- détail et la correspondance avec les statuts Mollie réels) :
  -- 'lien_cree' | 'en_attente' | 'autorisee' | 'liberee' |
  -- 'capturee_partielle' | 'capturee' | 'expiree' | 'annulee' | 'echouee'.
  status TEXT NOT NULL DEFAULT 'lien_cree',
  -- Dernier statut Mollie BRUT reçu tel quel (open/pending/authorized/paid/
  -- canceled/expired/failed) — jamais réinterprété ici, conservé pour le
  -- diagnostic uniquement (voir cahier des charges : afficher la réponse
  -- Mollie telle quelle en cas de problème).
  mollie_status TEXT,
  checkout_url TEXT,
  -- Reflète le champ documenté par Mollie pour la date limite de capture
  -- d'une autorisation carte manuelle, tel que reçu — NULL tant qu'inconnu,
  -- jamais une valeur calculée localement (voir mollie-client.js).
  capture_before TEXT,
  -- Reflète payment.mode ("live" | "test") tel que renvoyé par Mollie à la
  -- création, jamais déduit du préfixe de la clé — sert uniquement à
  -- l'affichage "MODE TEST" si un enregistrement plus ancien survivait à un
  -- changement de clé.
  test_mode INTEGER NOT NULL DEFAULT 1,
  authorized_at TEXT,
  released_at TEXT,
  captured_at TEXT,
  failure_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_deposit_auth_rental ON deposit_authorizations(rental_id);
CREATE INDEX IF NOT EXISTS idx_deposit_auth_mollie_payment ON deposit_authorizations(mollie_payment_id);
