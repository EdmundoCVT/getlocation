# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- Clients particuliers, touristes, professionnels et clients longue durée qui réservent ou gèrent une location de véhicule.
- Équipe GET LOCATION en agence, qui utilise principalement le back-office, les contrats, les états des lieux, les dépôts de garantie, les devis express, le planning et les livraisons.

## Product Purpose

GET LOCATION est un service de location de véhicules dans les Alpes-Maritimes. Le produit réunit une interface client et un back-office agence. Côté client, il doit rendre immédiatement compréhensibles le véhicule, le prix, les dates, le lieu, la protection, le dépôt de garantie et les actions attendues. Côté équipe, il doit permettre d’exécuter rapidement les opérations quotidiennes avec une faible charge cognitive.

## Positioning

Le service associe la réservation de véhicules et les opérations d’agence dans une expérience cohérente, adaptée à un acteur local des Alpes-Maritimes et à des usages fréquents sur iPhone/Safari.

## Operating Context

- Parcours public de découverte et de réservation.
- Tunnel de réservation, paiement, dépôt de garantie et constitution du dossier client.
- Production et consultation de contrats et d’états des lieux.
- Opérations d’agence : devis express, planning, livraisons, réservations, véhicules et paramètres.
- Usage mobile important, notamment sur iPhone avec Safari, parfois dans un contexte opérationnel où la vitesse et la taille des zones tactiles sont déterminantes.

## Capabilities and Constraints

- Préserver la logique métier, les prix, les contrats, le versioning, la sécurité, les données et les API sauf demande explicite qui le nécessite.
- Ne supprimer aucune fonction métier pour améliorer l’apparence.
- Éviter les doublons de formulaires et les écrans sans valeur opérationnelle.
- Vérifier desktop et mobile, ainsi que les états vides, erreurs, chargements, boutons désactivés, textes longs et données existantes.
- Les formulaires, modales, tableaux, boutons, ouvertures dans un nouvel onglet et la navigation doivent rester utilisables sans zoom sur mobile.

## Brand Commitments

- Nom : GET LOCATION.
- Identité existante orange et bleu, fonds clairs, cartes simples, rayons modérés et typographie lisible.
- Expression professionnelle, moderne, rassurante et simple, sans esthétique de « startup générique ».
- Cohérence forte entre site public, tunnel de réservation, contrats, états des lieux et back-office.
- Éviter la multiplication des couleurs, les gradients inutiles, le glassmorphism, les ombres excessives, les micro-animations décoratives, les textes trop petits et l’accumulation de badges.

## Evidence on Hand

- Code source du site public, du tunnel client et du back-office dans ce dépôt.
- Images de véhicules et contenus métier existants dans le dépôt.
- Aucun témoignage, benchmark ou claim commercial supplémentaire ne doit être inventé.

## Product Principles

1. Rendre l’information métier essentielle compréhensible au premier regard.
2. Réduire le temps et l’effort nécessaires pour accomplir les opérations fréquentes.
3. Donner une hiérarchie visuelle forte sans surcharge ni décoration gratuite.
4. Concevoir d’abord pour la lisibilité et l’usage tactile sur mobile, puis assurer une excellente utilisation desktop.
5. Préserver la cohérence de marque et de comportement sur l’ensemble des surfaces.

## Accessibility & Inclusion

- Les interfaces doivent rester lisibles sans zoom et proposer des zones tactiles adaptées à un usage mobile.
- La hiérarchie, les libellés et les états ne doivent pas dépendre uniquement de la couleur.
- L’accessibilité doit être vérifiée sur les parcours client et les outils opérationnels, notamment pour la navigation, les formulaires, les erreurs et les états de chargement.
