# LEGAL-TODO — Informations juridiques et métier à fournir

Ce fichier catalogue toutes les informations juridiques ou métier encore
manquantes (marquées `[à compléter]`, `[à ajuster]` ou `[à préciser]`) dans
le site GETLOCATION. Aucune de ces informations n'a été inventée : ce
document liste précisément ce qu'il reste à fournir avant une mise en
production sérieuse.

Ne pas supprimer une ligne de ce fichier sans avoir réellement mis à jour
le contenu correspondant sur le site (et incrémenté `CGL_VERSION` dans
`js/data.js` si le texte des CGL ou de la politique de confidentialité
change).

## cgl.html — Conditions générales de location

| Ligne (approx.) | Placeholder | Ce qu'il faut fournir |
| --- | --- | --- |
| 134 | Âge minimum du conducteur (21 ans, [à ajuster]) | Confirmer l'âge minimum réellement appliqué par l'agence |
| 135 | Ancienneté de permis minimale (2 ans, [à ajuster]) | Confirmer l'ancienneté de permis réellement exigée |
| 157 | Frais de retard [à préciser : barème horaire/journalier] | Fournir le barème exact des pénalités de retard |
| ~194 | Montants de franchise en vigueur [à compléter] (article 4, dommages/vol/bris de glace) | Montants exacts des franchises d'assurance auprès d'Allianz Assurance — voir aussi `js/data.js`, `FRANCHISES` ci-dessous : un seul et même montant à renseigner aux deux endroits |
| 174 | Politique d'annulation [À compléter] | Fournir les conditions d'annulation/remboursement (délais, montants) |
| 193 | Juridiction compétente en cas de litige [à compléter — ressort du siège social] | Confirmer le tribunal compétent (dépend du siège social réel) |

## mentions-legales.html

| Ligne (approx.) | Placeholder | Ce qu'il faut fournir |
| --- | --- | --- |
| 139 | Capital social [à compléter] | Montant exact du capital social de TLST SAS |
| 141 | RCS — ville d'immatriculation [à compléter] | Ville du greffe d'immatriculation |
| 142 | N° TVA intracommunautaire [à compléter] | Numéro de TVA intracommunautaire |
| 143 | Directeur de la publication [à compléter] | Nom du représentant légal |
| 154 | Hébergeur [à compléter] | Nom, adresse et téléphone de l'hébergeur (Netlify Inc. si hébergement Netlify — à confirmer et formuler correctement) |
| 161 | Code NAF/APE [à compléter] | Code NAF/APE exact de l'activité |

## confidentialite.html — Politique de confidentialité

| Ligne (approx.) | Placeholder | Ce qu'il faut fournir |
| --- | --- | --- |
| 162 | Durée de conservation des données [à préciser] | Durées précises (ex. durée légale de conservation comptable/fiscale applicable) |

## contrat.html / js/data.js — contrat de location

| Emplacement | Placeholder | Ce qu'il faut fournir |
| --- | --- | --- |
| `js/data.js`, `FRANCHISES` | `dommages`/`vol`/`brisDeGlace` = `null` | Montants exacts des franchises d'assurance (distinctes du dépôt de garantie / caution) auprès d'Allianz Assurance, une fois pour toutes dans cet objet |
| `js/data.js`, `VEHICULES` → `toyota-proace-city` | `carburant: null` | Type de carburant réel (diesel/électrique/essence) d'après la carte grise — non déductible du seul nom du modèle, contrairement aux 3 autres véhicules |
| `js/data.js`, `AGENCE.rcs` | `null` | Ville du greffe d'immatriculation (même donnée que `mentions-legales.html`, à synchroniser) |
| `js/data.js`, `AGENCE.capitalSocial` | `null` | Montant exact du capital social de TLST SAS (même donnée que `mentions-legales.html`) |

## Point à valider — adresse du siège social simplifiée (mentions-legales.html)

Le 4 août 2026, à la demande du client, l'adresse complète du siège social
(rue et numéro) a été retirée de tout le contenu public du site, y compris
`mentions-legales.html` (ligne ~142, qui n'affiche plus que "Grasse
(06130)" au lieu de l'adresse complète). Décision assumée par le client
pour des raisons de confidentialité/sécurité.

**À valider** : l'article 6-III de la LCEN impose en principe la
publication de l'adresse du siège social dans les mentions légales d'un
site professionnel. Publier uniquement la ville pourrait ne pas satisfaire
cette obligation formelle. Ce fichier ne tranche pas la question — à faire
vérifier par un avocat/expert-comptable si une conformité stricte est
requise, faute de quoi la mention pourrait devoir être complétée par
l'adresse exacte à nouveau.

## Mécanisme de contrôle mis en place (P0-8)

Un mécanisme technique trace désormais, pour chaque réservation payée, la
version des CGL/politique de confidentialité acceptée par le client
(`CGL_VERSION` dans `js/data.js`, transmis par le client, revalidé et
enregistré côté serveur avec un horodatage — voir
`netlify/functions/create-payment-intent.js` et
`netlify/functions/lib/validate-reservation-input.js`).

Ce mécanisme garantit la traçabilité de l'acceptation, mais **ne garantit
pas à lui seul la validité juridique du texte accepté** tant que les
placeholders ci-dessus ne sont pas résolus. Un contrôle bloquant
supplémentaire (empêchant une mise en production tant que des placeholders
critiques subsistent) est prévu en P1 — voir AUDIT.md.
