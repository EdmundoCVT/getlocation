# Audit technique — GETLOCATION (getlocation.fr)

Date de l'audit : 22 juillet 2026
Périmètre : dépôt `EdmundoCVT/getlocation`, branche `main`.
Aucune modification de code n'a été faite pendant cet audit — lecture seule.

---

## 1. Vue d'ensemble du dépôt

Site statique (HTML/CSS/JS vanilla) + une fonction serverless Netlify pour Stripe. Pas de framework, pas de build step (`package.json` ne déclare que la dépendance `stripe`, aucun script `build`). Déployé sur Netlify en continuous deployment depuis GitHub.

### 1.1 Pages HTML (15 fichiers à la racine)

| Fichier | Rôle | Indexable | Remarque |
|---|---|---|---|
| `index.html` | Accueil | Oui | H1 unique, JSON-LD AutoRental + FAQPage |
| `vehicules.html` | Catalogue véhicules | Oui | Rendu JS depuis `js/data.js` ; JSON-LD ItemList (Car+Offer) |
| `reservation.html` | Étape 2 du tunnel (infos conducteur) | **Oui actuellement** (pas de noindex) | Collecte permis, âge, contact |
| `paiement.html` | Étape 3 du tunnel (paiement Stripe) | **Oui actuellement** (pas de noindex) | Charge Stripe.js + `stripe-config.js` |
| `confirmation.html` | Étape 4 (récap post-paiement) | **Oui actuellement** (pas de noindex) | Affiche la confirmation depuis `localStorage` uniquement |
| `contrat.html` | Contrat de location + signature électronique | Non (`noindex, nofollow`) | Page **totalement autonome** (CSS et JS inline), doublon complet de la logique tarifs/dates, signature = canvas + `Math.random()`, **aucune sauvegarde serveur** |
| `cgl.html` | Conditions générales de location | Oui | 5 placeholders juridiques |
| `confidentialite.html` | Politique de confidentialité | Oui | 1 placeholder (durée de conservation) |
| `mentions-legales.html` | Mentions légales | Oui | 5 placeholders juridiques |
| `location-voiture-nice.html` | Page SEO locale | Oui | |
| `location-voiture-cannes.html` | Page SEO locale | Oui | |
| `location-voiture-antibes.html` | Page SEO locale | Oui | |
| `location-voiture-grasse.html` | Page SEO locale | Oui | |
| `location-voiture-monaco.html` | Page SEO locale | Oui | |
| `location-voiture-aeroport-nice.html` | Page SEO locale | Oui | |

Les 6 pages locales sont des quasi-clones (même structure, même bloc "flotte" avec **4 véhicules recopiés en dur dans le HTML**, indépendamment de `js/data.js`). Un changement de tarif ou de photo dans `data.js` ne se répercute pas automatiquement sur ces pages ni sur `index.html` (qui a lui aussi sa propre grille codée en dur) — seul `vehicules.html` est généré dynamiquement depuis `data.js`.

Un dossier parasite **`Sans titre/`** contient une copie complète et périmée de tout le site (HTML, CSS, JS, images) à la racine du dépôt local. Il n'a jamais été commité sur GitHub (vérifié), mais il est présent dans le working directory local. À supprimer ou ajouter au `.gitignore` avant toute nouvelle opération Git pour éviter toute confusion (il a déjà causé une fausse alerte "0 changed files" dans GitHub Desktop lors d'une session précédente).

### 1.2 Parcours utilisateur

`index.html` (recherche) → `vehicules.html` (choix véhicule, filtré par catégorie) → `reservation.html` (infos conducteur) → `paiement.html` (Stripe Elements) → `confirmation.html`.

Tout l'état du tunnel (dates, lieux, véhicule choisi, **infos conducteur y compris n° de permis**, résultat de paiement) transite exclusivement par `localStorage` (clés `ct_recherche`, `ct_selection`, `ct_reservation`, `ct_confirmation` — préfixe `ct_` = reliquat du nom de projet précédent "Capver Tours", voir §5). Il n'existe **aucune notion de réservation côté serveur** : la page de confirmation affiche "réservation confirmée" uniquement parce qu'un objet existe dans le `localStorage` du navigateur, jamais vérifié contre Stripe ni contre une base de données.

`contrat.html` est un second tunnel, totalement déconnecté du premier : pas de lien automatique entre une réservation payée et un contrat signé, pas de pré-remplissage depuis les données de réservation existantes.

### 1.3 Données véhicules et tarifs (`js/data.js`)

Source unique des 4 véhicules (id, nom, immatriculation, tarif/jour, caution, photos). Utilisée par `vehicules.html`, `reservation.html`, `paiement.html`, `confirmation.html` et `contrat.html` côté client. **Jamais utilisée côté serveur** — la fonction Stripe ne la connaît pas du tout, voir §2.

### 1.4 Fonction Netlify Stripe (`netlify/functions/create-payment-intent.js`)

Fichier de 63 lignes. Constat : **confiance totale au client**. Voir détail en §2 (Priorité 0).

### 1.5 `netlify.toml`

- `publish = "."`, fonctions dans `netlify/functions`, bundler esbuild.
- Redirection `/api/*` → `/.netlify/functions/:splat`.
- En-têtes de sécurité globaux (`/*`) : `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` restrictive, `Strict-Transport-Security` avec `preload`, et un `Content-Security-Policy` qui contient **`'unsafe-inline'`** sur `script-src` et `style-src`. C'est ce `unsafe-inline` qui permet aujourd'hui à `contrat.html` de faire fonctionner son `<style>`/`<script>` inline — un retrait brutal casserait cette page.
- Cache `Cache-Control` : `/images/*` 1h, `/css/*` et `/js/*` 5 min (`must-revalidate`), pas de version `immutable`/`max-age` long sur les assets versionnés (`?v=4`, `?v=2`), alors que le versionnement par query string le permettrait sans risque de contenu périmé.
- Aucun fichier `_redirects`, aucune règle de réécriture d'URL propre (`/paiement` → `/paiement.html`) dans `netlify.toml`. Les canonical et le sitemap utilisent des URL sans extension (`https://getlocation.fr/paiement`) : **à vérifier en priorité** que ces URL "propres" résolvent bien en production (comportement par défaut de Netlify à confirmer, pas supposé).

### 1.6 SEO — sitemap, robots, structuré

- `robots.txt` : `Disallow: /paiement.html`, `/confirmation.html`, `/contrat.html` — mais **pas** `/reservation.html`, et les règles ciblent les variantes `.html` alors que les canonical/sitemap utilisent des URL sans extension. Incohérence à corriger dans les deux sens.
- `sitemap.xml` : liste `/reservation` avec priorité 0.5 — à retirer (page transactionnelle). Les 4 autres pages transactionnelles (paiement, confirmation, contrat) n'y sont déjà pas.
- Aucune page `vehicules/<id>` individuelle indexée (une seule page catalogue) — pas de fiche véhicule dédiée actuellement.
- JSON-LD présent sur (quasi) toutes les pages : `AutoRental` (identique partout), `BreadcrumbList` (par page), `ItemList`/`Car`/`Offer` sur `vehicules.html`, `FAQPage` sur `index.html` et chaque page locale. Pas de `Review`/`AggregateRating` détecté nulle part — conforme à l'exigence de ne pas inventer d'avis structurés.
- Chaque page a un H1 unique (certains en `sr-only` sur les pages de tunnel, ce qui est correct pour l'accessibilité).
- Canonical présent et cohérent sur toutes les pages vérifiées, y compris les pages transactionnelles (qui ne devraient pourtant pas être indexées).

### 1.7 Mentions légales / CGL / confidentialité — placeholders recensés

**`mentions-legales.html`** : Capital social, RCS (ville), n° TVA intracommunautaire, Directeur de la publication, nom/adresse/téléphone de l'hébergeur, code NAF/APE — 6 placeholders `[à compléter]`.

**`cgl.html`** : âge minimum (actuellement affiché 21 ans mais marqué "à ajuster"), ancienneté du permis (2 ans, "à ajuster"), barème des frais de retard, politique d'annulation complète (article 5 entièrement vide), ressort judiciaire compétent — 5 placeholders.

**`confidentialite.html`** : durée précise de conservation des données (comptable/fiscale) — 1 placeholder.

Soit **12 placeholders juridiques actifs en production**, plus une incohérence potentielle : le formulaire de réservation impose déjà "21 ans ou plus" côté validation JS (`js/app.js` ligne 523) alors que le texte CGL dit que ce chiffre est encore "à ajuster" — le code applique donc une règle métier que le texte légal ne confirme pas formellement.

### 1.8 Sécurité / XSS / données personnelles

- 8 usages d'`innerHTML` dans `js/app.js` (rendu de cartes véhicules, lightbox, résumé de réservation/paiement/confirmation, témoignages) + 1 dans `contrat.html` inline. Aucun n'insère aujourd'hui de champ texte libre saisi par l'utilisateur tel quel dans ces `innerHTML` (les noms/emails du conducteur ne sont interpolés que dans `reservation.html`/`paiement.html`/`confirmation.html` via des template strings passées à `innerHTML` — **c'est le point à corriger** : `data.conducteur.prenom`, `.nom`, `.email` sont des chaînes saisies librement par l'utilisateur et injectées sans échappement dans `innerHTML` à 3 endroits (`showGalleryIndex` n'est pas concerné, mais `render()` dans `initReservationPage`, `initPaiementPage`, `initConfirmationPage` le sont).
- Numéro de permis, nom, prénom, email, téléphone, âge : stockés en clair et sans expiration dans `localStorage` (clé `ct_reservation` puis `ct_confirmation`), donc persistants indéfiniment sur l'appareil du client tant qu'il ne vide pas son stockage — au-delà de la seule utilité temporaire du tunnel.
- Aucune donnée personnelle n'est actuellement envoyée à un serveur applicatif (à part Stripe via `receiptEmail`/`billing_details`), donc pas de fuite serveur — mais aussi aucune traçabilité serveur d'une réservation, ce qui est la faille métier de fond (§2).

### 1.9 Images réellement utilisées

97 fichiers image référencés (statiquement ou via construction dynamique de chemin `.jpg → .webp` dans `pictureVehicule()`), sur 110 fichiers présents dans `images/`. Fichiers **jamais référencés, ni statiquement ni dynamiquement** :

- `Opel Corsa Fond blanc.png`, `Peugeot 2008 fond blanc.png`, `Peugeot 3008 fond blanc.png` — photos sources brutes (noms avec espaces/majuscules), plusieurs Mo chacune, jamais utilisées par le site.
- `opel-corsa-cutout.png`, `peugeot-2008-hybrid-cutout.png`, `peugeot-3008-cutout-veh.png`, `peugeot-3008-cutout.png` — versions PNG sources des visuels détourés (seules les versions `.webp` correspondantes sont utilisées via `photoCutout`).
- `peugeot-3008-cutout.webp`, `peugeot-3008-cutout-700w.webp` — variantes non utilisées (seul `peugeot-3008-cutout-veh.webp` est référencé dans `data.js`).
- `images/LISEZ-MOI.txt` — note interne, pas une image, à sortir du dossier servi publiquement.

**Mise à jour (22/07/2026, P2-1)** : ces 9 fichiers ont été supprimés après re-vérification (zéro référence réelle en dehors de ce document et du dossier `Sans titre/` non commité). `images/` ne contient plus que des fichiers effectivement utilisés par le site.

---

## 2. PRIORITÉ 0 — Sécurité et intégrité des paiements (le cœur du problème)

### Faille actuelle, textuellement

Dans `netlify/functions/create-payment-intent.js` :

```js
const { amount, currency, description, receiptEmail } = payload;
const montant = Math.round(Number(amount));
...
const paymentIntent = await stripe.paymentIntents.create({
  amount: montant,
  currency: currency || "eur",
  description: description || "Réservation GETLOCATION",
  ...
});
```

Le navigateur envoie littéralement `amount` (calculé côté client dans `paiement.html`/`js/app.js` à partir de `data.jours * vehicule.prixJour + assurance`) et le serveur le prend tel quel. **N'importe qui peut ouvrir les DevTools, intercepter la requête `fetch("/.netlify/functions/create-payment-intent")` et modifier `amount` à `50` (0,50 €) avant envoi** — Stripe créera un PaymentIntent de 50 centimes pour une Peugeot 3008 sur 5 jours. Il n'y a aucune vérification d'identifiant véhicule, aucun recalcul serveur, aucune borne de cohérence.

C'est la vulnérabilité la plus grave du dépôt et le point de départ obligatoire de tout le reste — implémenté en premier, avant toute UX/SEO/perf.

### Plan de correction (détaillé en §4, plan P0)

1. Nouveau schéma d'entrée strict : le client n'envoie plus que `vehiculeId`, `dateDebut`, `heureDebut`, `dateFin`, `heureFin`, `lieuPrise`, `lieuRetour`, `assurance` (bool), et un identifiant de réservation.
2. Source de tarifs partagée : extraire `VEHICULES` de `js/data.js` vers un module Node (`netlify/functions/lib/catalogue.js` ou équivalent en CommonJS) importé à la fois par la fonction serverless et — via un petit adaptateur ou une génération de fichier — par le front, pour ne jamais dupliquer les prix à la main.
3. La fonction recalcule tout : durée en heures → jours facturables (même formule que `joursFacturablesDepuisHeures`), tarif × jours, + assurance si cochée (15 €/jour, valeur serveur elle aussi), impose `currency: "eur"`, rejette `vehiculeId` inconnu, rejette dates passées/invalides, borne la longueur des chaînes.
4. Notion de réservation serveur (abstraction ; pas de vraie base de données existante dans le dépôt → je ne vais pas inventer de credentials). Documentation précise de ce qu'il faut fournir (Netlify Blobs, FaunaDB, Supabase, etc. — au choix du client) + implémentation d'une interface claire (`reservations.create()`, `reservations.get()`, `reservations.markPaid()`) avec une implémentation de secours en mémoire clairement marquée "dev only, non persistante".
5. Webhook Stripe (`netlify/functions/stripe-webhook.js`) vérifiant la signature (`STRIPE_WEBHOOK_SECRET`), traitant `payment_intent.succeeded` de façon idempotente (clé = `paymentIntent.id`), confirmant la réservation côté serveur.
6. `confirmation.html` interroge un nouvel endpoint (`/api/reservation-status?ref=...`) au lieu de faire confiance au `localStorage` seul.

---

## 3. Constats classés par thème (hors P0)

### Juridique
12 placeholders actifs (§1.7) → à centraliser dans `LEGAL-TODO.md`, avec un script de contrôle qui empêche un déploiement "silencieux" tant que les placeholders critiques (mentions légales, CGL articles 1/5/7, confidentialité) sont présents.
Pas de case CGL/confidentialité à cocher avant paiement actuellement.
Pas de traçabilité de la version des CGL acceptée.

### Avis clients
`TEMOIGNAGES` dans `js/app.js` (3 témoignages statiques) est déjà commenté dans le code source comme "exemples de démonstration" — mais rien ne l'indique aux visiteurs du site public. Aucun balisage `Review`/`AggregateRating` (bien).

### Accessibilité / UX
Pas de bouton menu mobile — `.main-nav` est simplement masqué en `display:none` sous 640px (`css/style.css`), aucune alternative de navigation mobile actuellement.
Lightbox galerie (ajoutée récemment) : navigation clavier flèches/Échap déjà présente, mais pas de piège de focus ni de restauration du focus au ferme constaté dans le code actuel.
Pas de zone `aria-live` pour les erreurs de paiement.
Pas de `aria-describedby`/`aria-invalid` sur les champs de formulaire (`reservation.html`, `paiement.html`, `contrat.html`).
Pas de `prefers-reduced-motion` géré (carrousel témoignages en `setInterval` fixe, transitions CSS sans media query de réduction).

### SEO
Voir §1.6. Répétition de contenu notable entre "Pourquoi choisir GETLOCATION" (accueil), le contenu SEO de bas de page de l'accueil, et les 6 pages locales quasi identiques.

### Performance
Voir §1.9. Pas d'AVIF. `srcset`/`sizes` déjà en place sur les cartes véhicules et le hero (bon point existant à préserver). Cache court sur CSS/JS versionnés alors qu'un cache `immutable` serait possible et bénéfique vu le système de `?v=`.

### Maintenabilité
Duplication de la grille véhicules dans `index.html`, les 6 pages locales, et `vehicules.html` (seule version dynamique). Duplication complète de toute la logique dates/tarifs dans `contrat.html` (page 100% autonome). Résidu "Capver Tours" dans l'en-tête de commentaire de `js/app.js` (ligne 1) et dans les noms de clés `localStorage` (`ct_*`).

---

## 4. Plan P0 / P1 / P2

### P0 — Sécurité et intégrité (bloquant, à faire en premier, étapes vérifiables une par une)

1. Extraire le catalogue véhicules dans un module partageable serveur/client sans dupliquer les prix.
2. Réécrire `create-payment-intent.js` : validation stricte du schéma, recalcul serveur intégral, CORS restreint, rejet des montants/devises/imposés par le client, pas de fuite d'erreur interne.
3. Ajouter une abstraction de réservation serveur (`pending_payment` → `paid`/`cancelled`/`expired`), idempotente, avec mode dev sûr documenté.
4. Ajouter le webhook Stripe signé, idempotent, qui confirme la réservation.
5. Faire dépendre `confirmation.html` d'un appel serveur (avec repli honnête si l'API n'est pas encore configurée : ne pas mentir sur l'état du paiement).
6. Purger/limiter les données personnelles en `localStorage` (permis, etc.), remplacer les `innerHTML` avec données utilisateur par du DOM safe/`textContent`.
7. Ajouter la case obligatoire CGL/confidentialité avant paiement + trace serveur de la version acceptée.
8. Tests automatisés couvrant tout ce qui précède (voir méthode de livraison).

### P1 — Conformité, conversion, accessibilité

- `LEGAL-TODO.md` + script de contrôle anti-placeholder en pré-déploiement.
- Neutraliser les faux témoignages en production (retrait ou état neutre honnête).
- Menu mobile accessible (bouton, ARIA, focus trap, fermeture clavier).
- Robustesse du parcours : résumé stable, retour arrière sans perte, focus sur 1ʳᵉ erreur, `aria-live`, `aria-describedby`/`aria-invalid`.
- `noindex, follow` sur réservation/paiement/confirmation/contrat + retrait de `/reservation` du sitemap + cohérence robots.txt/URL propres (à vérifier d'abord).
- Réduction de la répétition de contenu accueil vs pages locales — **réévalué (22/07/2026) : le H1, le paragraphe d'accroche et la FAQ de chaque page locale (`location-voiture-*.html`) contiennent déjà des repères réellement distincts par ville (ex. Promenade des Anglais/gare SNCF pour Nice, Palais des Festivals/Croisette pour Cannes) — ce n'est pas du contenu dupliqué au sens SEO. La seule duplication réelle est structurelle : la grille de 4 véhicules est recopiée en dur dans `index.html` et les 6 pages locales. C'est un sujet de maintenabilité (source unique + script de génération), déplacé vers P2 ci-dessous plutôt que traité ici — réécrire les textes locaux sans information métier vérifiée aurait risqué d'inventer des affirmations locales non vérifiées.**

### P2 — Performance, maintenabilité, nettoyage

- Rationalisation des images (liste ci-dessus validée avant toute suppression), formats adaptés, cache `immutable` sur assets versionnés.
- Réduction de la duplication des 15 pages (source unique flotte/header/footer, script de génération des pages locales).
- Nettoyage résidus "Capver Tours", dossier `Sans titre/` local, `images/LISEZ-MOI.txt`.
- Mesures Lighthouse avant/après.

---

## 5. Ce que je ne vais pas faire sans confirmation

- Inventer une donnée juridique, un tarif, une politique d'annulation ou une info de société : tout ira dans `LEGAL-TODO.md`.
- Choisir une techno de base de données/réservation à la place du client : je documenterai les options et l'interface, sans configurer de service tiers ni de credentials.
- Supprimer un fichier image sans que la liste ci-dessus (§1.9) soit validée.
- Toucher aux tarifs, cautions, textes CGL/mentions légales existants.
- Refonte graphique : aucune dans ce chantier.

---

## 6. Prochaine étape proposée

Démarrer P0, étape 1 (extraction du catalogue véhicules en module partagé) puis étape 2 (réécriture de `create-payment-intent.js`), avec un test automatisé après chaque étape, en petits commits séparés du reste (conformément à la contrainte de ne pas mélanger sécurité paiement et refonte graphique).

---

## 7. État d'avancement — P0 terminé (22 juillet 2026)

Les 9 étapes P0 (priorité sécurité/paiement) sont implémentées et validées par 64 tests automatisés (`npm test`, tous verts). Résumé :

- **P0-1** — `js/data.js` est devenu la source unique de vérité tarifs/durées (`calculerPrixTotal`, `dureeEnHeures`, `joursFacturablesDepuisHeures`, `CGL_VERSION`), exportée en CommonJS pour être `require()`'d par les fonctions serveur, chargée telle quelle par le navigateur.
- **P0-2** — `netlify/functions/lib/reservation-store.js` : abstraction de réservation (create/get/updateStatus/findByPaymentIntent/hasOverlappingReservation), backend Netlify Blobs avec repli mémoire dev explicitement averti, id non devinable (128 bits), statuts `pending_payment`/`paid`/`cancelled`/`expired`.
- **P0-3** — `netlify/functions/create-payment-intent.js` réécrit : ne fait plus jamais confiance à un montant/devise/description client, recalcule tout via `calculerPrixTotal`, rejette véhicule inconnu/dates invalides/passées, CORS restreint, vérification de disponibilité (anti double-réservation), protection anti-abus (`lib/rate-limiter.js`, Blobs + repli mémoire), métadonnées Stripe utiles, aucune fuite d'erreur interne, réponse honnête `stripe_not_configured` si Stripe n'est pas configuré.
- **P0-4** — `netlify/functions/stripe-webhook.js` : vérifie la signature Stripe (`STRIPE_WEBHOOK_SECRET`), traite `payment_intent.succeeded`/`payment_failed`/`canceled` de façon idempotente, confirme la réservation uniquement côté serveur.
- **P0-5** — `netlify/functions/reservation-status.js` : lecture publique mais non énumérable (id 128 bits) d'une réservation, expose une vue réduite (jamais le permis/téléphone/âge). `confirmation.html` interroge désormais cet endpoint via `?reservation=res_xxx` au lieu de se fier à `localStorage`.
- **P0-6** — `paiement.html`/`initPaiementPage` envoient uniquement des paramètres métier, reçoivent `{clientSecret, reservationId}`, gèrent explicitement les cas `stripe_not_configured` (repli téléphone/WhatsApp), `not_available` (409) et `429`, et une clé d'idempotence Stripe est générée côté client.
- **P0-7** — Les 3 points d'injection XSS identifiés (résumé réservation, résumé paiement, détails confirmation) ont été réécrits en `createElement`/`textContent` (jamais `innerHTML` sur une donnée utilisateur). Les données conducteur en `localStorage` sont effacées dès la confirmation du paiement et purgées automatiquement après 2h d'abandon. Aucun log serveur ou client ne contient de donnée personnelle.
- **P0-8** — Case CGL/confidentialité obligatoire (non cochée par défaut) sur `paiement.html`, revalidée côté serveur (`cglAccepted === true` et `cglVersion` à jour), tracée avec horodatage dans la réservation. `LEGAL-TODO.md` créé pour cataloguer les placeholders juridiques restants (aucune information n'a été inventée).
- **P0-9** — 64 tests automatisés (`node:test`, aucune dépendance de test supplémentaire hormis `jsdom` en devDependency) : calcul de prix/durée, validation stricte des entrées, impossibilité de trafiquer le montant, disponibilité/anti-double-réservation, signature webhook valide/invalide, idempotence, pas de confirmation sans paiement, échappement XSS (via jsdom), case CGL, cohérence `LEGAL-TODO.md`.

**Fichiers créés** : `netlify/functions/lib/reservation-store.js`, `netlify/functions/lib/rate-limiter.js`, `netlify/functions/lib/validate-reservation-input.js`, `netlify/functions/stripe-webhook.js`, `netlify/functions/reservation-status.js`, `LEGAL-TODO.md`, `tests/*.test.js` (7 fichiers).
**Fichiers modifiés** : `js/data.js`, `js/app.js`, `netlify/functions/create-payment-intent.js`, `paiement.html`, `package.json` (+ `@netlify/blobs`, script `test`, devDependency `jsdom`).

**Non testé en conditions réelles ici** (pas d'accès à un déploiement Netlify ni à de vraies clés Stripe dans cet environnement) : l'appel réseau réel à Stripe (création de PaymentIntent, webhook signé en conditions réelles), le comportement de Netlify Blobs en production, l'exécution effective du repli anti-abus au niveau plateforme Netlify. À vérifier manuellement avant mise en production (procédure de test fournie séparément).

**P1/P2** : P1 terminé (voir §8 ci-dessous). P2 non commencé, en attente de confirmation avant de poursuivre.

---

## 8. État d'avancement — P1 terminé (22 juillet 2026)

Les 6 chantiers P1 (conformité, conversion, accessibilité) sont faits, validés par 79 tests automatisés au total (`npm test`, tous verts — 15 nouveaux tests P1 s'ajoutent aux 64 de P0).

- **P1-1** — `scripts/check-legal-placeholders.js` (+ `npm run check:legal`) détecte les 12 placeholders juridiques restants (y compris ceux qui s'étendent sur plusieurs lignes) et échoue intentionnellement tant qu'ils subsistent. **Non branché** sur `netlify.toml` comme commande de build (cela bloquerait tout déploiement dès maintenant) — à activer explicitement quand souhaité.
- **P1-2** — Faux témoignages retirés (`js/app.js`, `index.html`) : plus de fausses citations/notes 5 étoiles attribuées à un « Client GETLOCATION » inventé. État neutre honnête affiché à la place, aucun balisage Schema.org Review/AggregateRating.
- **P1-3** — Menu mobile accessible ajouté sur les 14 pages avec en-tête commun : bouton `.nav-toggle` (ARIA `aria-expanded`/`aria-controls`/`aria-label`, cible 44×44px), panneau `.main-nav` qui ne disparaît plus sans alternative sous 640px, fermeture au clavier (Échap), piège de focus simple (Tab boucle dans le menu), fermeture au clic extérieur ou sur un lien, focus restauré sur le bouton à la fermeture.
- **P1-4** — Formulaire conducteur pré-rempli si déjà saisi (retour arrière sans perte), `aria-invalid`/`aria-describedby` sur tous les champs de `reservation.html` et `paiement.html`, focus automatique sur le premier champ en erreur, `aria-live="polite"` sur les zones d'erreur et les résumés de commande (réservation/paiement/confirmation).
- **P1-5** — `noindex, follow` ajouté à `reservation.html`/`paiement.html`/`confirmation.html` (et `contrat.html` passé de `nofollow` à `follow`). `/reservation` retiré de `sitemap.xml`. `robots.txt` ne bloque plus ces pages (un blocage empêcherait Google de lire la balise noindex). **Découverte importante** : `netlify.toml` n'activait pas l'option Netlify « Pretty URLs », alors que tout le site utilise des URL canoniques sans `.html` (`/vehicules`, `/reservation`...) — sans ce réglage (actif seulement si activé manuellement dans le dashboard Netlify, invisible depuis le dépôt), ces URL canoniques risquaient de renvoyer une 404. Ajouté explicitement (`[build.processing.html] pretty_urls = true`) pour que ce soit garanti par la configuration versionnée.
- **P1-6** — Réévalué plutôt que modifié : le contenu des 6 pages locales (`location-voiture-*.html`) contient déjà des repères réellement distincts par ville (vérifié sur Nice et Cannes), ce n'est pas du contenu dupliqué au sens SEO. La duplication réelle (grille de véhicules recopiée en dur dans 7 fichiers) est un sujet de maintenabilité, déplacé vers P2. Aucune réécriture de texte n'a été faite pour éviter d'inventer des affirmations locales non vérifiées.

**Fichiers créés** : `scripts/check-legal-placeholders.js`, `tests/data-pricing.test.js`, `tests/xss-rendering.test.js`, `tests/legal-placeholders.test.js`, `tests/seo-noindex.test.js`, `tests/mobile-menu.test.js`, `tests/tunnel-robustness.test.js`.
**Fichiers modifiés** : `js/app.js`, `index.html`, `netlify.toml`, `sitemap.xml`, `robots.txt`, `contrat.html`, `reservation.html`, `paiement.html`, `confirmation.html`, `css/style.css`, les 6 `location-voiture-*.html`, `vehicules.html`, `mentions-legales.html`, `confidentialite.html`, `cgl.html` (bouton menu mobile + bump cache `?v=`), `package.json` (script `check:legal`).

**Non vérifié en conditions réelles ici** : le comportement effectif de `pretty_urls = true` et du panneau mobile sur un vrai déploiement Netlify/navigateur (uniquement testé via jsdom ici) — à confirmer visuellement après déploiement.

---

## 9. État d'avancement — P2 terminé (22 juillet 2026, hors P2-5)

Stripe (compte, tests de bout en bout) est reporté à la demande explicite du client — pas encore de compte Stripe. Les 4 autres chantiers P2 (performance/maintenabilité/nettoyage) sont faits, validés par 84 tests automatisés au total (`npm test`, tous verts — 5 nouveaux tests P2 s'ajoutent aux 79 de P1).

- **P2-1** — 9 fichiers image/texte confirmés orphelins (zéro référence réelle, hors auto-référence dans ce document et dans l'ex-dossier `Sans titre/`) supprimés : `images/Opel Corsa Fond blanc.png`, `images/Peugeot 2008 fond blanc.png`, `images/Peugeot 3008 fond blanc.png`, `images/opel-corsa-cutout.png`, `images/peugeot-2008-hybrid-cutout.png`, `images/peugeot-3008-cutout.png`, `images/peugeot-3008-cutout.webp`, `images/peugeot-3008-cutout-700w.webp`, `images/LISEZ-MOI.txt`.
- **P2-2** — `/css/*` et `/js/*` passent en cache long et immutable (`Cache-Control: public, max-age=31536000, immutable`) dans `netlify.toml`, justifié par le versionnement systématique `?v=N` de ces fichiers (déjà en place). `/images/*` reste en cache court (`max-age=3600, must-revalidate`) car non versionné. 4 tests dans `tests/netlify-toml.test.js` verrouillent ce comportement (immutable sur css/js, pas d'immutable sur images, en-têtes de sécurité globaux toujours présents).
- **P2-3** — `scripts/check-vehicle-grid-sync.js` (+ `npm run check:vehicle-grid`) compare les 7 grilles véhicules recopiées en dur (`index.html` + 6 `location-voiture-*.html`) à `js/data.js` (nom, catégorie affichée, prix/jour, places, transmission) et signale toute divergence, véhicule manquant ou véhicule fantôme. `vehicules.html` n'a pas besoin d'être vérifié : sa grille est générée dynamiquement en JS depuis `VEHICULES`, donc toujours à jour par construction. Vérifié par un test de non-régression (`tests/vehicle-grid-sync.test.js`) et par une injection manuelle d'erreur (le script détecte bien une divergence de prix volontairement introduite, puis repasse au vert une fois corrigée). **Non branché** sur `netlify.toml` comme commande de build — à activer explicitement si souhaité (mêmes réserves que P1-1/`check:legal`).
- **P2-4** — Résidu "Capver Tours" (ancien nom du projet) : déjà absent de tout fichier HTML/JS/CSS/config du site en dur (vérifié par recherche exhaustive) — les seules mentions restantes sont dans ce document (§5/§6, trace historique de l'audit initial, volontairement conservée). Le dossier `Sans titre/` (76 Mo, copie complète et périmée du site avec son propre `.git`, jamais suivie par le dépôt principal ni poussée sur GitHub) a été supprimé après confirmation explicite du client.
- **P2-5** — **Reporté**, hors de portée de cet environnement : la mesure Lighthouse avant/après nécessite un déploiement Netlify accessible publiquement. À faire manuellement après déploiement (voir procédure dans le résumé final).

**Fichiers créés** : `scripts/check-vehicle-grid-sync.js`, `tests/netlify-toml.test.js`, `tests/vehicle-grid-sync.test.js`.
**Fichiers modifiés** : `netlify.toml` (cache css/js), `package.json` (script `check:vehicle-grid`).
**Fichiers/dossiers supprimés** : 9 images/texte orphelins (P2-1), dossier `Sans titre/` (P2-4).
