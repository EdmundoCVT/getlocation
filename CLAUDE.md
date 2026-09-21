# CLAUDE.md

Contexte de départ pour toute session Claude sur ce dépôt — à lire avant d'explorer le code, pour éviter de tout redécouvrir à chaque fois. Le détail technique complet vit dans `AUDIT.md` (P0/P1/P2) et `DEPLOIEMENT.md` (config/déploiement) : ce fichier-ci n'en est qu'un résumé pointeur, à garder à jour mais jamais dupliquer en détail (risque de divergence — voir règle n°1 ci-dessous).

## Le projet

GETLOCATION — site de location de véhicules à Grasse (Alpes-Maritimes). Site statique (HTML/CSS/JS, pas de framework front) + paiement en ligne Mollie + réservation avec contrat PDF pré-rempli envoyé à l'agence.

## Architecture (Phase B de la migration Cloudflare, terminée le 15/08/2026)

- **Hébergement** : Cloudflare Workers. `wrangler.jsonc` déclare `main: src/worker.js` (routeur) + `assets` (fichiers statiques du dépôt) + deux espaces KV (`RESERVATIONS_KV`, `RATE_LIMITS_KV`) — IDs réels déjà configurés en production.
- **Fonctions serveur** : `src/api/*.js` (create-payment, mollie-webhook, reservation-status), routées en same-origin (`/api/...`) par `src/worker.js`. Logique métier partagée dans `src/lib/*.js`.
- **Paiement** : Mollie, via `src/lib/mollie-client.js` (appels `fetch()` directs à l'API REST — pas le SDK `@mollie/api-client`, non garanti compatible Workers). Depuis le 16/09/2026, ce même client sert aussi à l'**empreinte bancaire du dépôt de garantie** (préautorisation carte, `captureMode: manual`, secret **distinct** `MOLLIE_DEPOSIT_API_KEY`) — voir `src/lib/deposit-authorizations.js` et `DEPLOIEMENT.md` §0.7 (interface `/contrat` reliée, tests simulés TEST/LIVE, migrations 0005–0007 requises).
- **Stockage** : Cloudflare KV (`src/lib/reservation-store.js`, `src/lib/rate-limiter.js`).
- **Email** : API HTTP Resend (`src/lib/resend-client.js`, `send-confirmation-email.js`, `send-contract-email.js`) — pas de SMTP (incompatible avec le runtime Workers).
- **`netlify.toml` et `netlify/functions/` sont legacy** : plus appelés par le site (l'ancien mécanisme cross-origin vers Netlify a été retiré de `js/app.js`), gardés temporairement comme filet de sécurité. **À supprimer** (+ dépendances `@netlify/blobs`, `@mollie/api-client`, `nodemailer` dans `package.json`) une fois la Phase B confirmée stable en production depuis un moment — demander confirmation avant de le faire.
- **Secrets Cloudflare Worker déjà configurés en production** (via `wrangler secret put`, jamais dans le dépôt) : `MOLLIE_API_KEY` (mode **live**), `RESEND_API_KEY`, `AGENCY_EMAIL`, `TEST_DISCOUNT_CODE`. Domaine `getlocation.fr` vérifié sur Resend.

## Bilingue FR / EN (depuis le 13/09/2026)

Le site client existe en français (URLs inchangées) et en anglais (`/en/`,
adresses lisibles : `/en/cars`, `/en/booking`, `/en/car-rental-nice`…).

- **Une seule page HTML par écran**, écrite en français : rien n'est dupliqué.
  `js/i18n.js` contient la traduction anglaise de chaque texte visible,
  **indexée par le texte français lui-même**, et l'applique au chargement
  quand l'URL commence par `/en/` (y compris sur le contenu ajouté ensuite
  par `js/app.js`, via un MutationObserver).
- **Conséquence à retenir** : modifier une phrase française sans mettre à
  jour `js/i18n.js` fait disparaître sa traduction. `npm test` le détecte
  (`tests/i18n-couverture.test.js` échoue en listant les textes manquants).
- Textes générés en JS : passer par `t("texte français", { variable })`
  (voir `MODELES` dans `js/i18n.js`), et par `allerVers("page.html")` pour
  toute navigation interne, sinon le visiteur anglais retombe en français.
- `src/lib/pages-en.js` (appelé par `src/worker.js`) sert le même fichier
  HTML sous `/en/…` avec titre, description, canonique et chemins traduits —
  indispensable au référencement, qui ne doit pas dépendre du JavaScript.
- Le corps des pages juridiques (CGL, mentions légales, confidentialité)
  reste **volontairement en français** : seule version faisant foi. Les pages
  anglaises affichent la mention correspondante.
- La langue choisie par le client est enregistrée sur la réservation
  (`langue: "fr" | "en"`) et pilote :
  - **les e-mails envoyés au client** (confirmation, rappels dossier / prise
    en charge / restitution) — dictionnaire serveur `src/lib/textes-email.js`,
    jamais chargé par le navigateur. Les e-mails destinés à l'AGENCE restent
    en français. Les liens qu'ils contiennent pointent vers la version du
    site correspondante (`/en/documents`…).
  - **la langue du contrat PDF** : `js/contrat-en.js` contient la traduction
    anglaise complète du contrat (intitulés, 6 articles, déclaration,
    annexe état des lieux). Le champ « Langue du client » de `contrat.html`
    est pré-rempli depuis la réservation et reste modifiable par l'agence.
    - **La version française reste la seule qui fasse foi.** Le contrat
      anglais porte en tête de ses conditions un avertissement qui le dit
      (version française prévalente, droit et tribunaux français, aucune
      obligation créée par une erreur de traduction). Ne jamais remplacer
      cet avertissement par une exclusion générale de responsabilité :
      inopposable à un consommateur, elle serait écartée.
    - **Les chiffres s'écrivent à l'identique dans les deux versions**
      (mêmes séparateurs) : un montant qui se lirait différemment sur deux
      documents censés dire la même chose est exactement le risque que
      l'avertissement écarte. Seules les dates suivent la langue.
    - Modifier un article français sans le reporter dans `js/contrat-en.js`
      fait échouer `npm test` (`tests/contrat-en.test.js` compare articles,
      emplacements de valeurs et nombre de pages).
    - Le texte libre saisi par l'agence (remarques particulières,
      observations d'état des lieux) n'est jamais traduit : il figure tel
      qu'il a été écrit.
- Textes affichés venus de `js/data.js` (options, lieux, filtres) : leur
  traduction vit aussi dans `js/i18n.js` et `npm test` la vérifie
  (`tests/i18n-couverture.test.js`) — ils n'apparaissent dans aucun fichier
  HTML, donc rien d'autre ne les couvre.
- Chemins d'images : `js/data.js` les écrit en relatif ; `cheminMedia()` de
  `js/app.js` les rend absolus à l'affichage, sinon ils pointent vers
  `/en/images/…` sous une adresse anglaise.

## Tarification (révision du 15/09/2026)

Tout vit dans `js/data.js` (règle n°1) — ne jamais recopier un montant ailleurs.

- **Remise longue durée** : `REDUCTIONS_DUREE` = **-5 €/jour dès 5 jours**,
  appliquée à toute la durée (5 j = -25 €, 9 j = -45 €). Elle abaisse aussi
  le « à partir de X €/jour » des cartes véhicules (`prixJourMinimum`) :
  changer ce montant oblige à mettre à jour les 7 grilles HTML en dur
  (`npm run check:vehicle-grid` le signale).
- **Options enfant** : deux seulement — `siege-enfant` (10 €/jour, demande
  l'âge et le poids via `saisies`) et `rehausseur` (5 €/jour). Le client ne
  choisit jamais une catégorie de siège : l'agence la déduit de l'âge et du
  poids, conservés sur la réservation (`enfantAge`, `enfantPoids`).
- **Supplément jeune conducteur** : `SUPPLEMENT_JEUNE_CONDUCTEUR`, +30 €/jour
  quand le permis a moins de 3 ans. Ce n'est **pas une option** : il est
  déduit de `conducteur.permisDate` (champ obligatoire du formulaire de
  paiement) et recalculé côté serveur comme le reste du prix. Sans date
  connue, aucun supplément — jamais de facturation au hasard.
- Les réservations et contrats déjà enregistrés gardent leur propre copie des
  montants : **rien n'est recalculé rétroactivement**.

## Niveaux de protection (depuis le 16/09/2026)

Quatre formules dans `PROTECTIONS` (`js/data.js`), **une seule retenue par
réservation**, jamais cumulables :

| Formule | Prix | Franchise |
|---|---|---|
| Essentiel | incluse | 2 000 € |
| Confort | 6 €/jour | 1 500 € |
| Sérénité (recommandée) | 12 €/jour | 750 € |
| Sérénité+ | 20 €/jour | 300 € |

- **`PROTECTION_PAR_DEFAUT = "essentiel"`** : retenue d'office, donc l'étape
  ne bloque jamais le tunnel. Elle est enregistrée dès l'affichage de l'étape.
- **Plafond** : les formules payantes sont facturées au maximum
  `joursFacturesMax` = 7 jours (42 / 84 / 140 €). **La protection court
  pendant toute la location** — ne jamais écrire au client qu'elle s'arrête
  après 7 jours : l'affichage dit « X € maximum par location ».
- `calculerProtection(id, jours)` produit l'instantané (`montant`,
  `franchise`, `plafonne`…) stocké avec la réservation puis repris tel quel
  par le contrat : un ancien dossier n'est jamais recalculé.
- Le serveur **refuse** un identifiant de protection inconnu
  (`validate-reservation-input.js`) au lieu de le corriger en silence ; en
  revanche l'absence de champ vaut « Essentiel » (anciennes réservations).
- L'ancienne option payante `assurance-passagers` n'existe plus : sa garantie
  fait partie de Sérénité+. `js/app.js` convertit une réservation en cours
  qui la contenait encore.
- **Ne jamais confondre trois choses distinctes**, sur le site comme sur le
  contrat : le *prix* de la protection, la *franchise* (ce qui reste à la
  charge du client), le *dépôt de garantie* (bloqué puis restitué). Le bloc
  PROTECTION ET GARANTIE du PDF les affiche en colonnes séparées.
- **Ne jamais annoncer** « franchise 0 € », une couverture illimitée, une
  couverture de tous les dommages ni un remboursement automatique, et ne pas
  inventer d'exclusions : `PROTECTION_MENTION` renvoie aux CGL.
- Traductions : noms de formules et garanties dans `js/i18n.js` (site) **et**
  dans `js/contrat-en.js` (contrat, y compris le libellé composé
  « Protection <nom> » de la ligne de prix). `tests/protections.test.js` et
  `tests/i18n-couverture.test.js` échouent si une formule ajoutée plus tard
  reste sans traduction.
- Le formulaire agence (`contrat.html`) a le même choix : un contrat établi
  au comptoir facture et affiche la franchise exactement comme une
  réservation en ligne.

## Contrat PDF — présentation financière

- Le contrat client affiche **prix de la location + options réellement
  retenues = TOTAL LOCATION**, puis acompte et reste à payer. Jamais de ligne
  « Remises », « Ajustement tarifaire » ni « Options » vide.
- Quand l'agence convient d'un tarif manuel, la ligne « Location » porte
  directement ce prix (`syntheseFinancierePdf`). Le détail interne (tarif
  théorique, remises, écart) reste dans les données pour l'administratif,
  jamais sur le document remis au client.
- Le dépôt de garantie garde son bloc séparé et n'est jamais additionné au
  prix de la location.
- **Typographie** : les paragraphes des articles sont écrits par suites de
  mots de même graisse, d'un seul tenant (`viderLigne`). Positionner chaque
  mot soi-même faisait accumuler l'écart entre la table de largeurs de jsPDF
  et les métriques du lecteur PDF, et l'espace suivant disparaissait
  (« GETLOCATION(TLST SAS) », « 600 €est »). Ne pas revenir à un rendu mot à
  mot.
- L'**aperçu** PDF ne doit jamais être bloqué par une information manquante :
  elle s'affiche « À compléter ». Ne pas y ajouter de validation.

## Règles critiques (ne jamais enfreindre)

1. **`js/data.js` est la SEULE source de vérité** pour véhicules, tarifs, règles de calcul de durée/prix, CGL_VERSION. Chargé tel quel côté navigateur (`<script>`) ET par le code serveur (`require`/`import` — voir `src/lib`, anciennement `netlify/functions/lib`). Ne jamais dupliquer une valeur ou une règle de calcul ailleurs — un script (`scripts/check-vehicle-grid-sync.js`) détecte les divergences avec les grilles véhicules recopiées en dur dans 7 pages HTML.
2. **Le serveur ne fait jamais confiance à un prix envoyé par le client.** `create-payment.js` recalcule toujours le total via `calculerPrixTotal()` de `js/data.js`, à partir des seuls champs validés (véhicule, dates, options, code promo) — jamais depuis `payload.total`/`payload.amount`.
3. **Le webhook Mollie ne fait jamais confiance à son propre corps.** Il ne reçoit qu'un id de paiement ; le statut réel est toujours revérifié auprès de l'API Mollie avant d'agir (voir `src/api/mollie-webhook.js`).
4. Emails et webhook sont **best effort** : un échec d'envoi ne doit jamais faire échouer ou annuler une confirmation de paiement déjà enregistrée.
5. Assets versionnés (`css/style.css?v=N`, `js/app.js?v=N`) : **toujours incrémenter `?v=`** dans TOUTES les pages HTML quand leur contenu change (cache `immutable` 1 an côté Cloudflare) — sinon les visiteurs déjà passés sur le site gardent l'ancienne version pendant un an.
6. **Avant tout push vers GitHub (`git push`), exécuter systématiquement la suite de tests de régression (`tests/regression-data-app-contract.test.js`) ainsi que tout autre test existant dans le projet.** Si un test échoue, NE PAS pousser le code : corriger le problème d'abord, ou avertir clairement l'utilisateur dans la réponse si la résolution seule n'est pas possible. Cette règle s'applique même en mode autonome / sans confirmation (voir section Utilisateur ci-dessous).

## Tests et scripts de contrôle

```
npm test                    # ~200 tests (node --test). Toujours faire passer avant de pousser.
npm run check:legal         # échoue tant que les 12 placeholders juridiques (LEGAL-TODO.md) ne sont pas comblés — normal pour l'instant
npm run check:vehicle-grid  # détecte une désynchro entre js/data.js et les grilles véhicules en dur
```

Les tests `netlify/functions` (legacy) et `src/` (Cloudflare) sont volontairement dupliqués en miroir tant que le nettoyage legacy n'est pas fait — ne pas s'étonner de voir deux suites tester la même logique.

## Déploiement

```
npx wrangler deploy                       # déploie manuellement (secrets déjà en place, pas besoin de les reconfigurer)
npx wrangler secret put NOM_SECRET        # met à jour un secret (ne jamais demander à l'utilisateur de coller une valeur de secret dans le chat)
```
Le dépôt est aussi connecté à un déploiement Git automatique Cloudflare (push → build → déploiement) ET à Netlify (legacy, preview only). Voir `DEPLOIEMENT.md` section 0 pour la procédure complète et les variables d'environnement.

## Chantiers ouverts connus

- Empreinte bancaire Mollie : interface `/contrat` et historique reliés ; `MOLLIE_DEPOSIT_API_KEY` accepte TEST/LIVE, séparée de `MOLLIE_API_KEY`. Migrations 0005–0007 et validation du profil Mollie requises avant usage réel (DEPLOIEMENT.md §0.7). Aucun appel financier réel pendant la reprise. Les erreurs réseau ambiguës restent verrouillées pour réconciliation manuelle.
- Suppression du code Netlify legacy (`netlify.toml`, `netlify/functions/`, dépendances associées) — en attente de confirmation utilisateur.
- 12 informations légales manquantes (SIRET, mentions légales...) — voir `LEGAL-TODO.md`.
- Retour utilisateur sur la présentation visuelle de `contrat.html` (pas de détail précis donné à ce jour — redemander si pertinent).
- Rotation de la clé `MOLLIE_API_KEY` : une clé live a été collée par erreur dans une conversation Claude le 15/08/2026 ; l'utilisateur a choisi de ne pas la révoquer. Rester factuel si le sujet revient, ne pas insister.

## Utilisateur / contexte business

Non-technique, découvre Git/Terminal/Cloudflare — expliquer étape par étape, en français, sans jargon non expliqué. Site en production réelle avec vrais paiements (compte Mollie live).

**Mode autonome (depuis le 17/08/2026)** : l'utilisateur travaille avec `--dangerously-skip-permissions` et a explicitement demandé de ne plus jamais être sollicité pour une confirmation avant d'agir, y compris pour les commits et les push GitHub (vers `main` inclus). Ne pas demander d'autorisation avant d'agir. En contrepartie, la règle critique n°6 ci-dessus (tests avant tout push) est non négociable et protège la production en l'absence de confirmation manuelle — signaler toujours clairement, dans le compte rendu final, ce qui a été poussé/déployé et le risque associé (site en production réelle), sans transformer ce signalement en question bloquante.
