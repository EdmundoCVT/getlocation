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
