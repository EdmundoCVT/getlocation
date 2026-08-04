# Audit croisé GETLOCATION — site, contrat et conformité

Date de vérification : 4 août 2026  
Dépôt : `EdmundoCVT/getlocation`, commit `82dc549` du 3 août 2026  
Portée : dépôt GitHub actuel, documents Google Drive liés, sources officielles françaises et comparaison fonctionnelle Europcar / SIXT / Hertz / Enterprise.

> Ce rapport distingue les obligations identifiées dans les sources officielles, les bonnes pratiques sectorielles et les choix commerciaux. Il ne remplace pas la validation d'un avocat ni celle de l'assureur de la flotte. Aucun tarif, délai, garantie ou identité manquante n'a été inventé.

## Conclusion exécutive

Le site ne doit pas être considéré comme prêt pour une réservation payante.

1. **Régression technique bloquante** : le commit `c4cee92` a réduit `js/data.js` à 87 lignes et supprimé les exports et fonctions utilisés par les fonctions Netlify. `OPTIONS` vaut `undefined`, `calculerPrixTotal` n'existe plus côté serveur et le paiement échoue avant même l'appel à Stripe (`js/data.js:1-87`, `netlify/functions/lib/validate-reservation-input.js:8-19`, `netlify/functions/create-payment-intent.js:25-26,107-118`).
2. **Tunnel client incohérent** : le navigateur envoie encore `amount`, `currency`, `description` et `receiptEmail` (`js/app.js:407-415`), alors que le serveur exige véhicule, dates, lieux, options, conducteur et acceptation versionnée des CGL (`netlify/functions/lib/validate-reservation-input.js:47-64,141-170`). Même après restauration de `data.js`, ces deux interfaces ne correspondent pas.
3. **Stripe non configuré dans le dépôt** : la clé publique est `pk_test_A_REMPLACER` (`js/stripe-config.js:1-6`) et la page désactive le paiement dans ce cas (`js/app.js:372-377`). Les clés secrètes et webhook ne peuvent naturellement être vérifiés dans GitHub.
4. **CGL juridiquement incomplètes** : âge/permis non décidés, pénalités de retard non chiffrées, politique d'annulation absente, tribunal laissé en placeholder (`cgl.html:137-142,158-162,177-180,194-198`). Le médiateur de la consommation et l'absence de droit de rétractation pour une location à date déterminée sont absents.
5. **Contrat web trop court et non aligné avec les CGL** : six articles seulement ; pas de montant exact de franchise, exclusions, assistance, procédure accident/vol, nettoyage, contraventions, territoire, prolongation, non-présentation, restitution hors horaires, frais administratifs ni détail du dépôt (`contrat.html:309-323`).
6. **Contrat transmis par URL non fiable/confidentiel** : toutes les données contractuelles, y compris identité, adresse, permis et immatriculation, sont encodées en Base64 dans le paramètre `?data=` (`contrat.html:403-416,532-558`). Base64 n'est pas du chiffrement : l'URL peut fuiter dans historique, journaux, captures et messageries. Le client peut également modifier les données avant signature.
7. **Signature électronique probatoirement faible** : la signature est envoyée par un simple formulaire Netlify avec horodatage du navigateur et identifiant généré côté client (`contrat.html:628-649,653-670,874-913`). Il n'y a ni authentification du signataire, ni scellement serveur du document, ni hash du PDF, ni journal de preuve, ni copie durable garantie aux deux parties.
8. **Mentions légales et RGPD inachevés** : capital, RCS, TVA, directeur de publication et hébergeur sont encore des placeholders (`mentions-legales.html:136-160`). Les durées de conservation ne sont pas définies (`confidentialite.html:163-168`), les destinataires/sous-traitants, transferts hors UE, sécurité, sort des données et détail de Stripe/Netlify manquent.
9. **Promesses commerciales non démontrées** : « aucun frais caché » (`index.html:340-345`) est incompatible avec les frais potentiels de carburant, dommages, retard, kilomètres, nettoyage et contraventions qui ne sont pas affichés de manière complète avant paiement.
10. **Dette de cohérence** : tarifs divergents (assurance affichée 15 €/jour dans `reservation.html:177-181`, mais constante navigateur à 8 €/jour dans `js/app.js:247-270`; conducteur additionnel 10 €/jour dans `contrat.html:249-250,377-378` mais absent du tunnel principal). Les lieux de prise en charge du contrat (`contrat.html:371-376`) ne reflètent pas nécessairement la politique de livraison du site.

## Documents examinés

### Dépôt

- Parcours : `index.html`, `vehicules.html`, `reservation.html`, `paiement.html`, `confirmation.html`, `js/app.js`, `js/data.js`, `js/stripe-config.js`.
- Backend : `netlify/functions/create-payment-intent.js`, `stripe-webhook.js`, `reservation-status.js`, `lib/validate-reservation-input.js`, `lib/reservation-store.js`, `lib/rate-limiter.js`.
- Juridique : `contrat.html`, `cgl.html`, `mentions-legales.html`, `confidentialite.html`, `LEGAL-TODO.md`.
- Technique : `netlify.toml`, `robots.txt`, `sitemap.xml`, `package.json`, tests et scripts de contrôle.

### Documents connectés

- Google Doc **contrat-location** : ancienne copie du contrat web, substantiellement dépassée par `contrat.html`.
- Google Doc **Contrat_Location_GETLOC06** : version plus complète (prix, caution, carburant, accident/vol, état contradictoire, infractions, RGPD), mais non synchronisée, avec champs non renseignés et clauses à corriger.
- Google Doc **LEGAL-TODO.md** : copie du registre de placeholders du dépôt.
- Un document de référence Getaround a été trouvé, mais Getaround est une plateforme d'autopartage et non un substitut juridique aux conditions propres de GETLOCATION.

## Référentiel juridique officiel vérifié

### Exigences légales ou réglementaires identifiées

- L'[arrêté du 17 mars 2015](https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000030375910) impose que les informations générales soient aisément accessibles en ligne, notamment depuis l'accueil et en un clic depuis chaque catégorie. Il exige notamment : conditions de permis, tous prix unitaires TTC, surcharges gare/aéroport, carburant, dépôt et restitution, avances, annulation, retard, dépassement kilométrique, assurances incluses/options/exclusions/franchises, annexes et assistance/remplacement.
- La [fiche DGCCRF location de véhicule](https://www.economie.gouv.fr/dgccrf/les-fiches-pratiques/location-de-vehicule-la-reglementation-applicable) insiste sur une information préalable claire et l'état contradictoire au départ et au retour.
- Pour une location de voiture fournie à une date/période déterminée, le droit de rétractation est exclu par l'[article L221-28, 12° du Code de la consommation](https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000044563170/2024-03-20). Le consommateur doit néanmoins être informé clairement de cette absence avant de payer.
- Le professionnel doit adhérer à un dispositif de médiation et afficher le nom, les coordonnées et le site de son médiateur sur le site, les conditions et les documents contractuels : [obligations du professionnel](https://www.economie.gouv.fr/mediation-conso/vous-etes-un-professionnel/vos-principales-obligations-0).
- La DGCCRF a relevé dans le secteur les risques liés aux frais post-location, dommages sans estimation contradictoire, restitution hors horaires, assurance imprécise et absence de médiateur/rétractation : [enquête location de véhicules](https://www.economie.gouv.fr/dgccrf/laction-de-la-dgccrf/les-enquetes/information-du-consommateur-louant-un-vehicule).

### Points à faire valider, sans inventer

- Identité sociale exacte, capital, RCS, TVA, représentant légal, APE et hébergeur.
- Garanties réellement accordées par l'assureur, franchises par catégorie et exclusions/déchéances.
- Droit de sous-louer chaque véhicule LLD et territoire assuré.
- Politique d'âge/permis par catégorie et documents acceptés (UE/hors UE/traduction).
- Tous barèmes TTC : retard, km, carburant/service, nettoyage, tabac, clé, pneu, erreur carburant, dépannage fautif, contraventions/péages, frais administratifs, immobilisation et dommages.
- Médiateur réellement choisi et conventionné.

## Audit par thème

Légende : **Légal** = obligation ou risque directement appuyé par les sources officielles ; **Secteur** = standard constaté chez les grands loueurs ; **Commercial** = décision propre à GETLOCATION à formaliser.

| Thème | État vérifié | Classification | Correction |
|---|---|---|---|
| Réservation | Dates/lieux/véhicule existent, mais backend et frontend incompatibles ; pas de verrou atomique de disponibilité (`create-payment-intent.js:17-23,135-150`). | Légal + technique | Restaurer la source tarifaire et le contrat d'API ; réserver temporairement le véhicule avec expiration et idempotence. |
| Prix/paiement | Affichage 15 €/j vs calcul 8 €/j ; serveur cassé ; Stripe placeholder. | Légal P0 | Source unique serveur/client, prix TTC détaillé avant bouton, reçu et confirmation durable. |
| Dépôt de garantie | 500 € dans `data.js:27-29,43-44,59-60,75-76`; contrat autorise carte ou espèces (`contrat.html:183-188`) et parle de caution « prélevée » (`contrat.html:315-316`) ; paiement dit « retrait sur place » (`paiement.html:246-247`). | Légal + commercial | Employer le terme exact (préautorisation, débit ou espèces), motifs de prélèvement, preuve, délai/modalité de libération et contestation. Éviter l'espèce si la traçabilité opérationnelle n'est pas robuste. |
| Annulation/no-show | Placeholder total (`cgl.html:177-180`), rien dans le contrat. | Légal P0 + commercial | Fixer délais, remboursement, modification, non-présentation, annulation loueur, force majeure et canal de demande. |
| Kilométrage | Contrat : 200 km/j et 0,25 €/km (`contrat.html:318-319`), absent des CGL et du tunnel principal. | Légal P0 + commercial | Afficher avant paiement, dans récapitulatif et contrat ; préciser calcul départ/retour et taxes. |
| Carburant | « plein/plein » dans CGL (`cgl.html:158-163`) mais « même niveau » dans contrat (`contrat.html:318-319`). | Légal P0 | Choisir une règle unique et publier prix/litre ou formule + frais de service. Prévoir électrique si flotte concernée. |
| Conducteur additionnel | 10 €/jour dans contrat, pas dans réservation ; seules identité/date/permis sont collectés (`contrat.html:249-264,377-378`). | Secteur + commercial | Ajouter au devis/réservation, vérifier mêmes critères, consentement/présence et responsabilité. |
| Âge/permis | 21 ans/2 ans affichés mais marqués « à ajuster » (`cgl.html:137-142`, `index.html:405`) ; UI paiement accepte `min=18` mais JS/serveur 21 (`paiement.html:212-215`, `js/app.js:311-320`, validation serveur `:151-154`). | Légal P0 | Décider par catégorie et aligner HTML, JS, serveur, CGL, contrat. Collecter date de délivrance plutôt que simple âge si ancienneté requise. |
| État des lieux | Mention textuelle, aucun formulaire structuré joint (`contrat.html:315-316`). | Légal/risque fort + secteur | Créer état départ/retour signé : photos horodatées, schéma dommages, km, carburant, propreté, accessoires, clés, observations et signatures. |
| Dommages | « facturée sur devis » sans méthode, usure normale, contradictoire, expertise ni contestation (`contrat.html:315-316`). | Risque légal + secteur | Politique dommages distincte : preuve avant/après, barème ou devis/facture, immobilisation justifiée, notification, délai de contestation, expertise indépendante possible. |
| Assurance/franchise | RC annoncée, option « tous risques » à franchise 0 sans détail ni preuve (`cgl.html:167-173`, `reservation.html:177-181`, `contrat.html:313-314`). | Légal P0 | Reprendre mot pour mot les garanties validées par assureur : montants, exclusions, pneus/vitres/bas de caisse/toit/clé/erreur carburant, vol, franchise par sinistre, conducteurs et territoires. Ne pas promettre « tous risques » ou zéro sans validation. |
| Assistance | Absente du site/contrat. | Légal (information sur engagements) + secteur | Numéro 24/7 ou horaires réels, panne/accident/crevaison, remorquage, remplacement, hébergement/rapatriement et exclusions. |
| Retard/prolongation | Frais non chiffrés (`cgl.html:160-162`; `contrat.html:320-321`). | Légal P0 | Grâce éventuelle, tarif heure/jour, autorisation préalable, assurance pendant prolongation, défaut de restitution et procédure. |
| Restitution | Lieu/date/heure seulement ; pas de retour hors horaires ni transfert de risque. | Secteur + risque | Procédure clés, photos, heure effective, inspection contradictoire, retour sans personnel, responsabilité jusqu'à inspection. |
| Contraventions/péages | Absents du contrat web. | Secteur + commercial | Responsabilité locataire, transmission aux autorités, justificatifs et frais administratifs TTC proportionnés. |
| Nettoyage/tabac/animaux | Absents. | Secteur + commercial | Définir état normal, nettoyage exceptionnel, preuves, barème TTC ; pas de frais arbitraires. |
| Territoire/usage | Absents. | Assurance + secteur | Pays autorisés/interdits, ferries, routes non carrossables, compétition, sous-location, transport rémunéré/dangereux, surcharge/remorquage. Aligner l'assureur. |
| Données personnelles | LocalStorage contient les coordonnées/permis (`js/app.js:5-10,50-61,299-306`), puis rendu par `innerHTML` (`js/app.js:352-364,477-490`). La politique prétend l'absence de transmission à des tiers malgré Stripe/Netlify (`confidentialite.html:183-188`). | RGPD + sécurité P0 | Minimisation, suppression rapide, destinataires/sous-traitants, transferts, durées par finalité, droits complets, sécurité, base légale par traitement. Ne jamais placer PII dans URL. |
| Mentions légales | Plusieurs placeholders (`mentions-legales.html:143-160`). | Légal P0 | Compléter uniquement depuis Kbis/INPI, TVA, dirigeant et contrat d'hébergement. |
| CGV/CGL/CGU | CGL trop courtes ; aucune vraie CGU distincte nécessairement indispensable pour ce site simple, mais règles d'usage web absentes. | Légal + choix | Priorité à des CGL complètes et conditions de réservation en ligne ; CGU séparées seulement si compte/service numérique le justifie. Versionner et archiver. |
| Médiation | Absente. | Légal P0 | Adhérer puis publier médiateur exact sur site, CGL, devis/commande et contrat. |
| Rétractation | Absente. | Légal P0 | Indiquer avant paiement : pas de droit de rétractation pour location à date déterminée, avec fondement ; ne pas confondre avec la politique commerciale d'annulation. |
| Cookies/traceurs | Pas de traceur marketing détecté ; Stripe est chargé sur paiement (`paiement.html:292-294`). | RGPD/ePrivacy | Faire un inventaire réel navigateur/réseau. Si seulement traceurs strictement nécessaires, expliquer sans bannière trompeuse ; recueillir consentement avant tout traceur non essentiel futur. |
| Accessibilité | Bons débuts ARIA/noindex ; contrat sans label accessible pour canvas, focus/signature à tester. Aucune déclaration d'accessibilité. | Bonne pratique et obligations selon champ légal | Audit WCAG/RGAA réel clavier/lecteur/contrastes/zoom/erreurs ; corriger avant d'affirmer la conformité. Vérifier avec conseil le champ d'application légal de l'entreprise. |
| SEO | Canoniques, sitemap et pages locales présents (`sitemap.xml:3-57`), mais `contrat.html` manque le `noindex` promis par robots/tests ; duplication de grilles. | Bonne pratique | Ajouter noindex au contrat, éviter données personnelles indexables, vérifier JSON-LD, 404/redirects, cohérence `.html`/URL propres et contenu local véridique. |
| Sécurité | En-têtes utiles (`netlify.toml:26-34`), mais CSP autorise `unsafe-inline`; PII dans URL/localStorage; repli mémoire Blobs/rate limit non fiable en production. | P0 technique | CSP nonce/hash, aucune PII URL, stockage serveur chiffré/TTL, autorisation contrat par jeton opaque, observabilité sans PII, secrets/environnements, dépendances et tests E2E. |
| Responsive/conversion | CSS responsive existant ; 19 Mo d'images ; tunnel cassé ; promesses/prix incomplets. | Bonne pratique/commercial | Tests 320/375/768/1440, WebP/AVIF/srcset, devis clair, disponibilité réelle, confiance légale, contact/repli, suivi abandon respectueux du consentement. |

## Comparaison grands loueurs : ce qu'il faut reprendre comme structure, pas copier

- **SIXT** détaille dans le dossier : référence, conducteur, prise/restitution, immatriculation/catégorie, km et carburant au départ, chaque ligne tarifaire, km supplémentaire, franchise, paiement/caution, dommages existants et pays autorisés : [guide de lecture du contrat SIXT](https://www.sixt.fr/help-center/articles/comment-lire-mon-contrat-de-location-sixt/).
- **Europcar** sépare clairement CGL, réservation en ligne, prépaiement, assurances/protections, dommages, dépôt, cookies, confidentialité et accessibilité : [informations légales Europcar](https://www.europcar.fr/fr-fr/p/informations-legales). Sa politique explique aussi préautorisation et délai bancaire de libération : [dépôt de garantie](https://www.europcar.fr/fr-fr/faq?question=quand-vais-je-recuperer-mon-depot-de-garantie).
- **Hertz** traite explicitement retours anticipés/tardifs, retour hors horaires, carburant, conducteur autorisé, nettoyage, péages, amendes et frais administratifs : [conditions Hertz](https://www.hertz.fr/rentacar/member/enrollment/displayTermsAndConditions).
- **Enterprise** publie critères d'âge/permis par catégorie, conducteur additionnel et caution/remboursement : [âge/permis](https://www.enterprise.fr/fr/location-de-voiture-faq/france-locataire-conditions/age-minimum-location-voiture.html), [conducteur supplémentaire](https://www.enterprise.fr/fr/location-de-voiture-faq/france-conditions-generales/conducteur-additionnel.html), [caution](https://www.enterprise.fr/fr/location-de-voiture-faq/france-cautions-et-paiements/montant-caution-location-voiture.html).

Le bon modèle pour GETLOCATION est une architecture documentaire modulaire : résumé précontractuel/devis + CGL + politique assurances/protections + politique dommages + politique confidentialité/cookies + contrat individuel + états des lieux. Il ne faut pas copier les clauses d'un grand loueur : tarifs, assurance, flotte et organisation diffèrent.

## Checklist priorisée

### P0 — Bloquer la mise en production payante

- [ ] Revenir sur la suppression de `js/data.js` en restaurant la dernière version fonctionnelle, puis réappliquer seulement les changements de flotte voulus.
- [ ] Aligner le payload `js/app.js` avec `validate-reservation-input.js`; aucun montant client ne doit faire foi.
- [ ] Réconcilier assurance 15 €/jour vs 8 €/jour, tarifs horaires/journaliers et tous extras.
- [ ] Faire passer 100 % des tests avec dépendances installées ; le run observé donne 25 succès / 32 échecs, dont certains dus aux dépendances absentes mais plusieurs dus au code réellement cassé.
- [ ] Configurer et tester Stripe test : clé publique, secrète, webhook, idempotence, succès/échec/3DS/remboursement.
- [ ] Compléter les informations obligatoires de l'arrêté du 17 mars 2015, accessibles en un clic depuis accueil et véhicules.
- [ ] Décider et faire valider par assureur : âge/permis, franchises, garanties, exclusions, assistance, territoires et usages.
- [ ] Définir tous les barèmes TTC, annulation/no-show, retard, km, carburant, dommages, nettoyage et frais administratifs.
- [ ] Adhérer à un médiateur et afficher ses coordonnées partout où requis.
- [ ] Informer clairement de l'absence de rétractation pour une location datée.
- [ ] Compléter les mentions légales depuis pièces officielles.
- [ ] Remplacer le lien Base64 du contrat par un identifiant opaque, court, expirant, à usage contrôlé ; stocker les données côté serveur.
- [ ] Mettre en place un dossier de preuve de signature et remettre automatiquement une copie durable identique au client et au loueur.
- [ ] Créer les états des lieux départ/retour signés et liés au contrat.
- [ ] Faire relire CGL, contrat, assurance et politique dommages par un avocat français/association professionnelle et l'assureur.

### P1 — Avant ouverture publique

- [ ] Politique RGPD complète, registre interne, sous-traitants, DPA, durées et procédure droits/incident.
- [ ] Politique cookies fondée sur un scan réel, consentement seulement si nécessaire.
- [ ] CSP sans `unsafe-inline`, validation XSS, aucun permis/adresse dans URL ou rendu `innerHTML`.
- [ ] Réservation atomique ou hold expirant ; emails transactionnels et rapprochement webhook.
- [ ] Tests E2E sur preview Netlify et mobile ; accessibilité RGAA/WCAG ; erreurs et reprise de parcours.
- [ ] `noindex` réel sur contrat/confirmation et URLs à jeton ; redirections canoniques.
- [ ] Optimiser images, charger seulement celles visibles et mesurer Lighthouse/Core Web Vitals.

### P2 — Amélioration commerciale

- [ ] Comparateur clair des protections et franchises sans jargon trompeur.
- [ ] Gestion modification/annulation en autonomie, statut de réservation et factures.
- [ ] Upsells utiles et transparents : conducteur, siège, livraison, km, protection.
- [ ] Réassurance factuelle : flotte réelle, disponibilité, horaires, assistance, avis vérifiés uniquement.
- [ ] Mesure de conversion avec consentement approprié et sans collecte excessive.

## Corrections recommandées par fichiers

- `js/data.js` : restaurer catalogue complet, `OPTIONS`, promotions si maintenues, constantes livraison/CGL, fonctions de calcul et exports CommonJS ; ajouter tests de contrat d'API.
- `js/app.js` : retirer l'ancien calcul parallèle et envoyer le schéma métier validé ; DOM sûr ; purge des PII ; statut serveur de confirmation.
- `cgl.html` : remplacer les 7 articles sommaires par une structure complète, version/date/archivage et liens vers annexes.
- `contrat.html` : contrat individuel fondé sur un enregistrement serveur immuable ; intégrer identifiants, détails tarifaires, franchise/protection, état des lieux et références aux versions acceptées.
- `mentions-legales.html` : compléter les données vérifiées et le médiateur.
- `confidentialite.html` : finalités/bases séparées, catégories, destinataires, transferts, durées, droits, contact, sécurité et cookies/Stripe/Netlify.
- `paiement.html` : résumé exhaustif TTC juste avant la commande, libellé non ambigu (« commande avec obligation de paiement »), rétractation/annulation distinctes, case CGL seule ; la politique de confidentialité doit être présentée/informée, pas « acceptée » comme un contrat.
- `netlify/functions/*` : stockage de production vérifié, hold atomique, TTL, auth par jeton, reçus, remboursement/annulation et logs minimisés.
- `netlify.toml` : CSP renforcée, no-store pour pages/API sensibles, redirections URL propres explicites.
- `tests/*` : tests unitaires + intégration + E2E pour prix, états, contrat, preuve, sécurité, légalité des placeholders et accessibilité.

## Limites de vérification

- Le dépôt a été audité à `82dc549`; un nouveau push peut rendre certains numéros de lignes obsolètes.
- Aucun déploiement public, tableau Netlify, compte Stripe, contrat d'assurance complet, Kbis ou convention de médiation n'a été fourni dans le dépôt.
- Les documents Drive retrouvés ne prouvent pas qu'ils sont approuvés, signés ou en vigueur.
- Les pratiques des grands loueurs sont des points de comparaison, pas des obligations applicables mot pour mot à GETLOCATION.
