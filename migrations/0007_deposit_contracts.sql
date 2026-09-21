-- No historical prices are recalculated. NULL means unknown, not today's tariff.
ALTER TABLE rentals ADD COLUMN default_deposit_amount_cents INTEGER;
CREATE TABLE deposit_subjects (
 id TEXT PRIMARY KEY,
 deposit_amount_cents INTEGER,
 default_deposit_amount_cents INTEGER,
 finalized INTEGER NOT NULL DEFAULT 0,
 contract_numero TEXT
);
INSERT INTO deposit_subjects (id, deposit_amount_cents, default_deposit_amount_cents, finalized, contract_numero)
 SELECT id, deposit_amount_cents, NULL, CASE WHEN status = 'brouillon' THEN 0 ELSE 1 END, contract_numero FROM rentals;
CREATE TABLE deposit_authorizations_new (
  id TEXT PRIMARY KEY,
  rental_id TEXT NOT NULL REFERENCES deposit_subjects(id),
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


INSERT INTO deposit_authorizations_new SELECT * FROM deposit_authorizations;
DROP TABLE deposit_authorizations;
ALTER TABLE deposit_authorizations_new RENAME TO deposit_authorizations;
ALTER TABLE deposit_authorizations ADD COLUMN capture_requested INTEGER NOT NULL DEFAULT 0;
ALTER TABLE deposit_authorizations ADD COLUMN action_lock TEXT;
CREATE INDEX idx_deposit_auth_rental ON deposit_authorizations(rental_id);
CREATE UNIQUE INDEX idx_deposit_one_active ON deposit_authorizations(rental_id)
 WHERE status IN ('lien_cree', 'en_attente', 'autorisee') OR (status = 'capturee_partielle' AND mollie_status = 'authorized');
CREATE TRIGGER deposit_amount_matches BEFORE INSERT ON deposit_authorizations
 WHEN NEW.authorized_amount_cents <= 0 OR NOT EXISTS (
 SELECT 1 FROM deposit_subjects WHERE id = NEW.rental_id AND deposit_amount_cents = NEW.authorized_amount_cents)
 BEGIN SELECT RAISE(ABORT, 'Montant de caution serveur incoherent'); END;
CREATE TRIGGER deposit_terms_locked BEFORE UPDATE OF deposit_amount_cents ON deposit_subjects
 WHEN NEW.deposit_amount_cents IS NOT OLD.deposit_amount_cents AND
 (OLD.finalized = 1 OR EXISTS (SELECT 1 FROM deposit_authorizations WHERE rental_id = OLD.id
 AND status NOT IN ('liberee', 'annulee', 'expiree', 'echouee')))
 BEGIN SELECT RAISE(ABORT, 'Montant verrouille : contrat finalise ou empreinte existante'); END;
CREATE TRIGGER rental_deposit_insert AFTER INSERT ON rentals BEGIN
 INSERT INTO deposit_subjects(id, deposit_amount_cents, default_deposit_amount_cents, finalized, contract_numero)
 VALUES(NEW.id, NEW.deposit_amount_cents, NEW.default_deposit_amount_cents, CASE WHEN NEW.status = 'brouillon' THEN 0 ELSE 1 END, NEW.contract_numero);
END;
CREATE TRIGGER rental_deposit_update AFTER UPDATE ON rentals BEGIN
 UPDATE deposit_subjects SET deposit_amount_cents = NEW.deposit_amount_cents,
 finalized = MAX(finalized, CASE WHEN NEW.status = 'brouillon' THEN 0 ELSE 1 END), contract_numero = NEW.contract_numero WHERE id = NEW.id;
END;
CREATE TRIGGER manual_deposit_exclusive BEFORE INSERT ON deposits
 WHEN EXISTS (SELECT 1 FROM deposit_authorizations WHERE rental_id = NEW.rental_id AND (status IN ('lien_cree','en_attente','autorisee') OR (status = 'capturee_partielle' AND mollie_status = 'authorized')))
 BEGIN SELECT RAISE(ABORT, 'Empreinte bancaire deja en cours'); END;
CREATE TRIGGER mollie_deposit_exclusive BEFORE INSERT ON deposit_authorizations
 WHEN EXISTS (SELECT 1 FROM deposits WHERE rental_id = NEW.rental_id AND status IN ('attendue','recue'))
 BEGIN SELECT RAISE(ABORT, 'Caution manuelle deja en cours'); END;
