-- Migration 0002 : clients, locations, paiements, cautions, traçabilité
-- (Lot 2 du mini-back-office agence — voir CLAUDE.md).
--
-- Montants monétaires stockés en CENTIMES (INTEGER), jamais en flottant —
-- évite tout écart d'arrondi sur un total encaissé/solde, même convention
-- que SUPPLEMENT_KM_CENTIMES dans js/data.js. Convertis en euros uniquement
-- à l'affichage (API/UI).
--
-- Dates enregistrées en ISO 8601 local (même convention que
-- src/lib/reservation-store.js : periodeDebut/periodeFin sans suffixe "Z",
-- heure de Paris implicite, affichées via les mêmes helpers que le reste du
-- site) — pas de nouvelle bibliothèque de fuseaux horaires.

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  -- Normalisés (recherche) ET valeurs saisies (affichage/contrat) : la
  -- normalisation ne doit jamais remplacer la valeur d'origine.
  phone_normalized TEXT,
  phone_raw TEXT,
  email_normalized TEXT,
  email_raw TEXT,
  birth_date TEXT,
  postal_address TEXT,
  permit_number TEXT,
  permit_date TEXT,
  -- Jamais activé par défaut (voir cahier des charges) — case à cocher
  -- explicite côté agence uniquement (Lot 4).
  marketing_consent INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

-- Recherche par téléphone/email normalisés : PAS de contrainte UNIQUE — on
-- signale les ressemblances sans jamais fusionner automatiquement (voir
-- cahier des charges), donc deux fiches peuvent légitimement partager un
-- téléphone (couple, entreprise) le temps qu'un humain tranche.
CREATE INDEX IF NOT EXISTS idx_clients_phone ON clients(phone_normalized);
CREATE INDEX IF NOT EXISTS idx_clients_email ON clients(email_normalized);
CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(last_name, first_name);

CREATE TABLE IF NOT EXISTS rentals (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  -- Numéro de contrat lisible GL-AAAAMMJJ-NNNN, attribué via
  -- src/lib/contract-numero.js (compteur D1 atomique, voir contract_counters
  -- ci-dessous) — NULL tant que le contrat n'a pas encore été généré
  -- (location en brouillon).
  contract_numero TEXT UNIQUE,
  vehicule_id TEXT NOT NULL,
  immatriculation TEXT,
  date_debut TEXT NOT NULL,
  heure_debut TEXT NOT NULL,
  date_fin TEXT NOT NULL,
  heure_fin TEXT NOT NULL,
  lieu_prise TEXT,
  lieu_retour TEXT,
  adresse_prise TEXT,
  adresse_retour TEXT,
  km_depart INTEGER,
  km_retour INTEGER,
  -- Montant total convenu pour la location, en centimes — saisi/ajusté par
  -- l'agence (même principe que le "tarif manuel" déjà existant sur la vue
  -- AGENCE historique de contrat.html) : la tarification automatique
  -- complète (options, codes promo, kilométrage inclus) reste celle de
  -- js/data.js et n'est pas dupliquée ici. Sert de base au calcul du solde
  -- (voir src/lib/payments.js, summarizePayments).
  price_total_cents INTEGER,
  -- 'brouillon' | 'contrat_genere' | 'en_cours' | 'terminee' | 'annulee'
  status TEXT NOT NULL DEFAULT 'brouillon',
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rentals_client ON rentals(client_id);
CREATE INDEX IF NOT EXISTS idx_rentals_status ON rentals(status);
CREATE INDEX IF NOT EXISTS idx_rentals_contract_numero ON rentals(contract_numero);

CREATE TABLE IF NOT EXISTS additional_drivers (
  id TEXT PRIMARY KEY,
  rental_id TEXT NOT NULL REFERENCES rentals(id),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  permit_number TEXT,
  permit_date TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_additional_drivers_rental ON additional_drivers(rental_id);

-- Une location peut contenir PLUSIEURS paiements (ex. 50€ carte + 190€
-- espèces) — jamais de suppression définitive : une correction/annulation
-- change `status` + `void_reason`, la ligne d'origine reste consultable.
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  rental_id TEXT NOT NULL REFERENCES rentals(id),
  amount_cents INTEGER NOT NULL,
  -- 'carte' | 'especes' | 'virement' — même vocabulaire que modeCaution
  -- dans contrat.html/validate-contract-dossier.js.
  method TEXT NOT NULL,
  reference TEXT,
  paid_at TEXT NOT NULL,
  -- 'valide' | 'annule'
  status TEXT NOT NULL DEFAULT 'valide',
  void_reason TEXT,
  operator TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_payments_rental ON payments(rental_id);

-- Caution : jamais confondue avec un paiement de location (table séparée).
-- Une ligne par location (au plus) — voir src/lib/deposits.js.
CREATE TABLE IF NOT EXISTS deposits (
  id TEXT PRIMARY KEY,
  rental_id TEXT NOT NULL UNIQUE REFERENCES rentals(id),
  amount_requested_cents INTEGER NOT NULL,
  method TEXT NOT NULL,
  -- 'attendue' | 'recue' | 'restituee' | 'retenue_partielle' | 'retenue_totale'
  status TEXT NOT NULL DEFAULT 'attendue',
  received_at TEXT,
  received_by TEXT,
  returned_at TEXT,
  returned_by TEXT,
  returned_amount_cents INTEGER,
  retained_amount_cents INTEGER,
  retained_reason TEXT,
  -- Description libre des justificatifs associés (photos, constat...) — le
  -- stockage effectif des fichiers (upload) est différé au Lot 4 : ce champ
  -- capture le besoin sans construire un mécanisme d'upload encore sans
  -- utilisateur (voir compte rendu de session).
  supporting_docs_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

-- Traçabilité (voir cahier des charges, "Traçabilité des opérateurs") :
-- connexions réussies/échouées (comble un manque du Lot 1, qui n'avait que
-- login_attempts — purgé après 24h, donc pas un vrai journal) + toutes les
-- opérations métier ci-dessous. `actor` vient TOUJOURS de la session
-- serveur vérifiée, jamais d'un champ envoyé par le navigateur. `metadata`
-- ne doit jamais contenir de donnée personnelle au-delà de ce qui est
-- strictement utile (ex. montant, pas d'adresse ni de permis).
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT,
  event_type TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);

-- Compteur atomique du numéro de contrat (GL-AAAAMMJJ-NNNN), partagé par
-- src/lib/contract-numero.js — utilisé à la fois par les nouvelles locations
-- (rentals) ET par les contrats manuels historiques de contrat.html (voir
-- src/lib/reservation-store.js, generateContractNumero) depuis ce Lot 2.
-- Remplace le compteur Cloudflare KV lecture-puis-écriture (non garanti
-- unique en cas de double écriture quasi simultanée — voir AUDIT.md) par un
-- UPSERT SQLite atomique (ON CONFLICT ... DO UPDATE ... RETURNING) : une
-- seule requête, aucune fenêtre de compétition possible.
CREATE TABLE IF NOT EXISTS contract_counters (
  date_part TEXT PRIMARY KEY,
  seq INTEGER NOT NULL
);
