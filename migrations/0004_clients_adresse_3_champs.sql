-- Migration 0004 : sépare l'adresse client en 3 champs (Lot 5, voir CLAUDE.md)
--
-- contrat.html attend l'adresse du locataire en 3 champs distincts (rue,
-- code postal, ville), alors que la fiche client agence n'avait jusqu'ici
-- qu'un unique champ libre "Adresse postale" — d'où un préremplissage
-- toujours incomplet lors de la génération du contrat (voir sheet-sync.js
-- pour un choix similaire fait sciemment sur une AUTRE colonne, ici on
-- corrige plutôt le modèle de données côté source).
--
-- `postal_address` (colonne existante) est CONSERVÉE et devient
-- exclusivement le numéro et nom de rue (elle contenait déjà ce type de
-- valeur en pratique côté fiches créées jusqu'ici) — pas de renommage, pour
-- rester une migration additive simple ; postal_code/city sont NOUVELLES,
-- vides par défaut (les fiches déjà créées n'ont pas cette information et
-- ne doivent jamais se voir attribuer une valeur inventée).
ALTER TABLE clients ADD COLUMN postal_code TEXT NOT NULL DEFAULT '';
ALTER TABLE clients ADD COLUMN city TEXT NOT NULL DEFAULT '';
