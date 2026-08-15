# GETLOCATION — Résumé final du chantier P0/P1/P2

Ce document réunit ce qu'il faut savoir pour déployer, tester et faire vivre le site après ce chantier. Le détail technique complet (fichier par fichier) reste dans `AUDIT.md` (§7 à §9). Ce fichier-ci est la synthèse orientée "que dois-je faire maintenant".

**⚠️ Mise à jour du 14/08/2026 — migration Cloudflare Phase B : lire la section 0 ci-dessous en premier.** Les sections 1 à 7 qui suivent décrivent l'état du chantier P0/P1/P2 tel que déployé sur Netlify (Phase A de la migration Cloudflare) ; elles restent exactes pour comprendre ce qui a été fait, mais **la configuration de production a changé** (les fonctions serveur ne tournent plus sur Netlify).

**Le prestataire de paiement est Mollie** (bascule décidée le 4 août 2026, à la place de Stripe initialement envisagé — compte Mollie déjà créé, choisi pour sa facilité d'intégration avec Qonto). Tant que `MOLLIE_API_KEY` n'est pas configurée (voir section 0), le site fonctionne et se déploie quand même (repli téléphone/WhatsApp automatique sur `paiement.html`), mais le paiement en ligne réel ne peut pas être testé.

## 0. Migration Cloudflare — Phase B : les fonctions serveur passent de Netlify à Cloudflare Workers

**Ce qui a changé dans ce commit.** La Phase A (voir section 1 et l'historique git) avait basculé uniquement le site statique sur Cloudflare Pages/Workers, en gardant les fonctions serveur (paiement Mollie, webhook, statut réservation, emails) sur Netlify, appelées en cross-origin explicite depuis `js/app.js`. Cette Phase B termine la migration : les fonctions serveur tournent maintenant sur le même Worker Cloudflare que le site (routes `/api/create-payment`, `/api/mollie-webhook`, `/api/reservation-status`, voir `src/worker.js` et `src/api/`), appelées en same-origin. Netlify Blobs est remplacé par **Cloudflare KV**, et nodemailer/SMTP Gmail (incompatible avec le runtime Workers) est remplacé par l'API HTTP de **Resend**.

**`netlify.toml` et `netlify/functions/` sont volontairement conservés dans le dépôt**, inchangés, comme filet de sécurité pendant la bascule : ce code n'est plus appelé par le site (`js/app.js` appelle désormais `/api/...` en same-origin), mais reste disponible pour comprendre l'historique ou revenir en arrière si besoin. **Une fois la Phase B confirmée en production (voir check-list plus bas), ils peuvent être supprimés** ainsi que les dépendances `@netlify/blobs`, `@mollie/api-client` et `nodemailer` dans `package.json` (uniquement utilisées par ce code legacy — le nouveau code sous `src/` n'a besoin d'aucune de ces trois dépendances, uniquement de `fetch`/`crypto` natifs).

### 0.1 Étapes obligatoires avant que le paiement en ligne ne fonctionne à nouveau

Le code est complet et testé (`npm test`), mais **rien de tout cela n'est déployable tel quel** : `wrangler.jsonc` contient des identifiants d'espace de noms KV placeholders (`REMPLACER_PAR_UN_VRAI_KV_NAMESPACE_ID`) qui font volontairement échouer `wrangler deploy` tant qu'ils ne sont pas remplacés — pour ne jamais déployer silencieusement contre un espace de noms inexistant. **Tant que ces étapes ne sont pas faites, `wrangler deploy` échouera à chaque push** (la dernière version fonctionnelle reste servie, mais aucun changement — y compris de simples changements de tarifs — ne pourra plus être déployé tant que ce n'est pas corrigé) :

1. **Créer les deux espaces de noms KV** (nécessite le CLI `wrangler` connecté à votre compte Cloudflare) :
   ```
   npx wrangler kv namespace create RESERVATIONS_KV
   npx wrangler kv namespace create RATE_LIMITS_KV
   ```
   Remplacer les deux `"id": "REMPLACER_PAR_UN_VRAI_KV_NAMESPACE_ID"` dans `wrangler.jsonc` par les identifiants retournés.

2. **Configurer les secrets du Worker** (équivalent Cloudflare des "Environment variables" de Netlify) :
   ```
   npx wrangler secret put MOLLIE_API_KEY
   npx wrangler secret put RESEND_API_KEY
   npx wrangler secret put AGENCY_EMAIL
   npx wrangler secret put TEST_DISCOUNT_CODE
   ```
   Voir le tableau détaillé section 0.2 pour le rôle de chacune (reprend celui de la section 2, adapté à Cloudflare).

3. **Créer un compte Resend** (https://resend.com) et **vérifier le domaine `getlocation.fr`** (enregistrements DNS SPF/DKIM à ajouter, voir la documentation Resend, section "Domains") — obligatoire pour pouvoir envoyer depuis `reservations@getlocation.fr` (ou toute autre adresse `RESEND_FROM` choisie). Sans domaine vérifié, Resend refuse l'envoi.

4. **Déployer** (`npx wrangler deploy`, ou laisser le déploiement automatique Cloudflare reprendre au prochain push une fois les étapes 1 à 3 faites).

5. **Vérifier** avec la procédure de test Mollie de la section 4 (inchangée dans son déroulé, seul l'endroit où les logs se consultent change : Cloudflare → Workers & Pages → getlocation → Logs, au lieu de Netlify → Functions).

### 0.2 Variables d'environnement (secrets Cloudflare Worker)

| Variable | Obligatoire | Rôle |
|---|---|---|
| `MOLLIE_API_KEY` | Oui, pour activer le paiement en ligne | Identique à l'ancienne variable Netlify (section 2) — jeton d'accès Mollie (`test_...` ou `live_...`). |
| `RESEND_API_KEY` | Oui, pour les emails (confirmation client + contrat agence) | Clé API Resend (remplace `GMAIL_USER`/`GMAIL_APP_PASSWORD`). Sans elle, le paiement fonctionne quand même, seuls les emails ne sont pas envoyés (comportement "best effort" inchangé). |
| `RESEND_FROM` | Optionnel | Adresse expéditrice, format `"Nom <adresse@domaine>"`. Doit appartenir à un domaine vérifié dans Resend (voir 0.1.3). Par défaut : `"GET LOCATION <reservations@getlocation.fr>"`. |
| `AGENCY_EMAIL` | Oui, pour recevoir le contrat pré-rempli et la copie cachée des confirmations | Remplace l'usage de `GMAIL_USER` comme adresse de réception (l'agence peut garder une adresse Gmail ordinaire ici — elle ne sert plus qu'en tant que destinataire, plus d'authentification SMTP). |
| `TEST_DISCOUNT_CODE` | Optionnel, usage interne uniquement | Identique à l'ancienne variable Netlify (section 2, point détaillé) — ramène le montant facturé à 0,10 € pour un code promo secret de votre choix. Sa validité est confirmée dès la saisie sur reservation.html (avant même la page de paiement) via `/api/validate-promo` (`src/api/validate-promo.js`), sans jamais exposer sa valeur au navigateur — voir §0.5 ci-dessous. |
| `ALLOWED_ORIGINS` | Optionnel | Liste d'origines CORS supplémentaires (séparées par des virgules). Moins utile qu'avant : site et API étant désormais same-origin, aucune valeur n'est nécessaire en usage normal — l'origine de chaque requête est de toute façon toujours auto-autorisée (voir `src/api/create-payment.js`). |
| `SITE_URL` | Optionnel | Utilisé uniquement par `send-contract-email.js` pour construire le lien vers `contrat.html`. Par défaut `https://getlocation.fr`. |
| `DOCUMENT_TOKEN_PEPPER` | Requis avant d'activer le parcours documentaire | Secret aléatoire long utilisé pour calculer l'empreinte HMAC des jetons d'accès aux documents. Le jeton brut n'est jamais stocké. |

Aucune de ces variables ne doit être ajoutée à `wrangler.jsonc` (fichier commité) : toutes se configurent via `wrangler secret put NOM` (ou dans le dashboard Cloudflare → Workers & Pages → getlocation → Settings → Variables), jamais en clair dans le dépôt.

### 0.3 Ce qui n'a pas pu être testé dans cet environnement

Comme pour la Phase A (voir section 6), cet environnement de développement n'a pas d'accès réseau sortant vers Mollie, Resend ou Cloudflare KV en conditions réelles : la logique métier est entièrement couverte par les tests unitaires (`npm test`, voir `tests/worker-*.test.js`), mais les appels réseau réels (création/vérification de paiement Mollie, envoi effectif d'un email Resend, lecture/écriture KV en production) n'ont pas pu être exercés ici. À vérifier manuellement après déploiement avec la procédure de la section 4.

Le paiement fonctionne par **redirection** : le client est envoyé vers une page de paiement hébergée par Mollie (carte, Apple Pay, etc.), puis renvoyé automatiquement vers `confirmation.html` — contrairement à un ancien projet de formulaire carte embarqué (Stripe Elements), abandonné avec le changement de prestataire.

### 0.4 Collecte documentaire post-paiement (R2, cron, rétention, révocation)

Ajoutée par les PR #3 à #8 (jetons documentaires, dépôt sécurisé, accès agence, rappels, planning quotidien), puis complétée par une revue de sécurité indépendante et ses correctifs (purge automatique, séquencement du cron, révocation manuelle, limite de taille réelle).

**Bucket R2 `getlocation-documents`.** Stocke uniquement les documents d'identité transmis après paiement (permis recto/verso, pièce d'identité, éventuellement ceux du second conducteur) — jamais dans KV, jamais dans les assets publics du site. Déclaré dans `wrangler.jsonc` :
```jsonc
"r2_buckets": [{ "binding": "DOCUMENTS_BUCKET", "bucket_name": "getlocation-documents" }]
```
**Strictement privé** : aucun domaine personnalisé ni accès public ne doit jamais être configuré sur ce bucket dans le dashboard Cloudflare (Workers & Pages → R2 → getlocation-documents → Settings) — le Worker y accède uniquement via le binding `DOCUMENTS_BUCKET`, jamais par URL directe. Si le bucket n'existe pas encore sur le compte cible, le créer avant déploiement :
```
npx wrangler r2 bucket create getlocation-documents
```

**Cron Trigger `0 6 * * *` (UTC)**, déclaré dans `wrangler.jsonc` (`triggers.crons`). Exécute chaque jour, **séquentiellement** (jamais en parallèle — voir `src/lib/scheduled-tasks.js`, correctif d'une revue de sécurité qui avait identifié un risque d'écrasement KV entre tâches concurrentes) :
1. purge documentaire (voir ci-dessous) ;
2. rappels de dossier incomplet ;
3. rappels de prise en charge ;
4. rappels de restitution ;
5. planning quotidien envoyé à l'agence.

Une étape en échec n'empêche pas les suivantes de s'exécuter, mais si une ou plusieurs échouent, l'exécution planifiée entière apparaît en échec dans Cloudflare → Workers & Pages → getlocation → Cron Triggers → journal d'exécution (à surveiller après déploiement).

**Politique de suppression automatique.** Les documents d'identité sont supprimés **30 jours après la date de restitution du véhicule** (`periodeFin`, ou à défaut `dateFin`+`heureFin`) — décision validée le 15/08/2026 à la suite d'un finding "haute" (absence totale de purge). Implémentation : `src/lib/document-retention.js`.
- Supprime chaque objet R2 référencé, vérifie le résultat de chaque suppression individuellement.
- Nettoie ensuite dans KV : `documentFiles`, `documentsData` (adresse postale, n° de permis, informations du second conducteur...), `documentAccess`, `agencyDocumentAccess`.
- Ne touche jamais au statut de paiement, au montant, à la référence de paiement, ni à l'identité du conducteur principal (preuve comptable/contractuelle).
- Pose uniquement un marqueur non sensible, `documentsPurgedAt` (horodatage) — jamais de token, jamais de nom de fichier.
- Idempotente : ne retraite jamais une réservation déjà marquée `documentsPurgedAt`.
- En cas d'échec de suppression d'un objet R2, la purge de cette réservation n'est **pas** marquée terminée : seuls les fichiers réellement supprimés sont retirés de la liste, les autres sont retentés automatiquement le lendemain (même déclencheur cron). Le TTL KV de la réservation (`reservation-store.js#reservationTtlSeconds`) inclut une marge technique de 5 jours au-delà des 30 jours réglementaires, pour que ces nouvelles tentatives restent possibles avant que la fiche ne disparaisse de KV.

**Vérifier que la purge fonctionne, sans jamais exposer de document réel :**
1. Repérer dans les logs Cloudflare (Workers & Pages → getlocation → Logs, filtrer sur `[document-retention]`) l'absence de ligne `Échec de suppression R2` après une exécution du cron — une ligne présente n'affiche jamais que la référence de réservation et le type de pièce (ex. `permis-recto`), jamais de donnée personnelle.
2. Sur une réservation de test dont la restitution est passée depuis plus de 30 jours, lire uniquement les **champs non sensibles** de l'enregistrement KV (jamais son contenu R2) :
   ```
   npx wrangler kv key get <reservationId> --binding=RESERVATIONS_KV --remote
   ```
   Vérifier que `documentsPurgedAt` est renseigné et que `documentFiles`/`documentsData`/`documentAccess`/`agencyDocumentAccess` sont bien vides ou `null`.
3. Ne jamais utiliser `npx wrangler r2 object get` sur un document réel pour "vérifier" la purge — la vérification doit toujours passer par l'absence de la clé, pas par une nouvelle consultation du contenu.

**Révocation manuelle d'un lien documentaire.** Sans back-office ni endpoint public : `scripts/revoke-document-access.js`, à utiliser en cas de fuite suspectée d'un lien (transfert d'e-mail, capture d'écran, boîte mail compromise).
```
node scripts/revoke-document-access.js res_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx client   # lien client uniquement
node scripts/revoke-document-access.js res_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx agency   # lien agence uniquement
node scripts/revoke-document-access.js res_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx both     # les deux
```
- Utilise uniquement l'outillage Cloudflare déjà en place (`npx wrangler kv key get/put --remote`) — aucun accès direct à l'API Cloudflare, aucune nouvelle dépendance.
- Refuse tout identifiant de réservation mal formé avant même de contacter KV.
- N'affiche jamais un jeton (brut ou empreinte) ni une donnée personnelle — uniquement la référence de réservation et l'état de chaque accès (à révoquer / déjà révoqué / absent).
- Idempotente : relancer la commande sur un lien déjà révoqué ne fait rien (aucune écriture).
- Demande une confirmation explicite (taper `CONFIRMER`) avant toute écriture — action sur des données de **production**.
- Effet : le lien concerné cesse de fonctionner immédiatement (le jeton, une fois `revokedAt` renseigné, est rejeté par `documents-access.js`/`agency-documents-access.js`) ; l'autre lien, si non ciblé, continue de fonctionner normalement.
- Remarque technique : l'écriture via `wrangler kv key put` sans `--expiration-ttl` explicite réinitialise la durée de vie technique de la clé dans KV — sans conséquence fonctionnelle, le prochain écrit normal effectué par le Worker (rappel, purge, nouveau paiement...) recalcule le TTL correct.

### 0.5 Validation immédiate du code promo de test (`/api/validate-promo`)

Les codes promo publics (`CODES_PROMO`, `js/data.js`) sont validés instantanément côté navigateur, sans appel serveur — le catalogue est chargé tel quel sur chaque page. `TEST_DISCOUNT_CODE` (§0.2) est volontairement absent de ce catalogue public pour ne jamais apparaître dans le code source visible du site : par construction, le navigateur ne peut donc pas le reconnaître seul.

Avant cet ajout, saisir ce code sur reservation.html affichait à tort "Code promo invalide" (le catalogue public ne le connaît pas), même quand il fonctionnait correctement côté paiement — obligeant à aller jusqu'à la page Mollie pour vérifier qu'il était bien pris en compte.

`src/api/validate-promo.js` (route `/api/validate-promo`, `src/worker.js`) comble cet écart : quand le code saisi n'est pas reconnu localement, `js/app.js` (`verifierCodeDeTest`) interroge ce endpoint, qui répond `{ valid: true/false }` (jamais la valeur du secret elle-même) en réutilisant `estCodeDeTestValide()` de `create-payment.js` — la même règle de comparaison que celle qui détermine réellement le montant facturé, sans la dupliquer. Rate-limité à 10 requêtes/minute par IP (nettement plus strict que `create-payment`, `checkRateLimit` dans `src/lib/rate-limiter.js`) pour limiter une éventuelle devinette par force brute du secret.

Le total affiché sur reservation.html reste volontairement le tarif normal (indicatif) même une fois le code de test confirmé : seul le serveur, au moment du paiement (`create-payment.js`), applique réellement la réduction — ce endpoint ne sert qu'à la confirmation visuelle, jamais de source de prix.

## 1. Ce qui a été fait

**P0 — sécurité et intégrité du paiement.** Le serveur ne fait plus jamais confiance à un montant envoyé par le navigateur : il recalcule toujours le prix depuis `js/data.js`. Une vraie réservation serveur existe (Netlify Blobs, id non devinable), le webhook Mollie revérifie systématiquement le statut réel auprès de l'API Mollie (il ne fait jamais confiance au contenu du webhook lui-même — voir `netlify/functions/mollie-webhook.js`) et traite chaque paiement de façon idempotente, la page de confirmation lit désormais le serveur au lieu du `localStorage`, 3 failles XSS ont été corrigées, et la case CGL est obligatoire et tracée.

**P1 — conformité et accessibilité.** Les faux témoignages ont été retirés (remplacés par un état honnête). Le menu mobile, jusque-là cassé, est maintenant accessible au clavier et au lecteur d'écran. Le formulaire de réservation se pré-remplit après un retour arrière et signale ses erreurs correctement. Les pages transactionnelles sont passées en `noindex`, et un bug de configuration qui aurait fait planter toutes les URL "propres" du site (`/vehicules`, `/reservation`...) en 404 a été découvert et corrigé.

**P2 — performance et maintenabilité.** Les assets versionnés (`css/js`) ont un cache d'un an, les 9 images/fichiers orphelins ont été supprimés, un script détecte automatiquement toute désynchronisation entre `js/data.js` et les grilles véhicules recopiées en dur dans 7 pages, et un dossier parasite de 76 Mo (copie périmée du site) a été supprimé après validation.

**Résultat : 121 tests automatisés, tous verts (`npm test`).**

## 2. Variables d'environnement à configurer sur Netlify

| Variable | Obligatoire | Rôle |
|---|---|---|
| `MOLLIE_API_KEY` | Oui, pour activer le paiement en ligne | Jeton d'accès Mollie (`test_...` ou `live_...`). Sans elle, le paiement en ligne répond honnêtement "indisponible" et affiche un repli téléphone/WhatsApp — le site reste utilisable. Aucun secret de signature de webhook séparé n'est nécessaire : le modèle de sécurité Mollie repose sur la revérification du statut via l'API (voir `netlify/functions/mollie-webhook.js`), pas sur une signature HMAC comme Stripe. |
| `ALLOWED_ORIGINS` | Optionnel | Liste d'origines CORS supplémentaires autorisées à appeler les fonctions (séparées par des virgules). Par défaut, seuls le domaine de production et l'URL de déploiement Netlify sont autorisés. |
| `URL` / `DEPLOY_PRIME_URL` | Auto | Injectées automatiquement par Netlify, pas besoin de les définir. |
| `GMAIL_USER` | Optionnel, pour l'email de confirmation | Adresse Gmail expéditrice de l'email de confirmation envoyé au client à chaque paiement confirmé (`getlocation.fr@gmail.com`). Reçoit aussi une copie cachée (BCC) de chaque confirmation envoyée. |
| `GMAIL_APP_PASSWORD` | Optionnel, pour l'email de confirmation | Mot de passe d'application Google associé à `GMAIL_USER` (16 caractères, généré sur https://myaccount.google.com/apppasswords — nécessite la validation en 2 étapes activée sur ce compte Google). Sans ces deux variables, la réservation est quand même confirmée normalement, seul l'email n'est pas envoyé (voir `netlify/functions/lib/send-confirmation-email.js`). |
| `TEST_DISCOUNT_CODE` | Optionnel, usage interne uniquement | Code secret de votre choix (ex. un mot de passe généré aléatoirement) qui, saisi dans le champ "code promo" lors d'une réservation réelle, ramène le montant facturé à 0,10 € au lieu du tarif normal. Sert à valider le parcours complet (paiement Mollie live + email de confirmation) sans payer le plein tarif à chaque test. **Ne jamais communiquer ce code publiquement** : contrairement aux codes promo classiques (`js/data.js`), il n'apparaît dans aucun fichier du dépôt — connaître le code suffit à l'utiliser, donc gardez-le aussi confidentiel qu'un mot de passe. Sans cette variable, saisir n'importe quoi dans le champ code promo n'a aucun effet particulier. |
| `NETLIFY_BLOBS_SITE_ID` | **Oui, indispensable** | Identifiant du projet Netlify (`64fa52f5-c62f-49ff-9f45-6db22598cb19` pour ce site — visible dans Project configuration → General → Project details → "Project ID / Also known as Site ID"). Voir incident du 12/08/2026 ci-dessous. |
| `NETLIFY_BLOBS_TOKEN` | **Oui, indispensable** | Jeton d'accès personnel Netlify (User settings → Applications → Personal access tokens → New access token), utilisé conjointement avec `NETLIFY_BLOBS_SITE_ID`. **Secret** : à cocher "Contains secret values". |

### Incident du 12/08/2026 — Netlify Blobs indisponible en configuration automatique

Constaté le jour-même : sur ce projet, la configuration automatique de Netlify Blobs (censée fonctionner sans aucune variable d'environnement une fois déployé, voir https://docs.netlify.com/blobs/overview/) échoue systématiquement en production avec `MissingBlobsEnvironmentError: The environment has not been configured to use Netlify Blobs`. Cause exacte côté plateforme Netlify non identifiée. Conséquence avant correctif : **aucune réservation n'était jamais retrouvée par `mollie-webhook`, donc jamais marquée "payée" côté serveur, donc aucun email de confirmation n'a jamais été envoyé**, quelle que soit la configuration Gmail — le rate-limiting anti-abus était également non fiable (repli mémoire non partagé entre fonctions).

Correctif appliqué : `reservation-store.js` et `rate-limiter.js` basculent désormais sur la configuration **manuelle** de Netlify Blobs (`getStore({ name, siteID, token })`) via `NETLIFY_BLOBS_SITE_ID`/`NETLIFY_BLOBS_TOKEN` ci-dessus, avec repli sur la configuration automatique si ces variables sont absentes (utile en local avec `netlify dev`, où elle a toujours fonctionné correctement). **Tant que ces deux variables ne sont pas configurées sur Netlify, le problème persiste intégralement** — c'est la priorité avant toute nouvelle réservation réelle.

Vérification après configuration : faire un test de paiement (voir §4 point 6, code `TEST_DISCOUNT_CODE`) puis, dans Netlify → Functions → `mollie-webhook` → logs, confirmer l'absence du message `Netlify Blobs indisponible`.

## 3. Procédure de déploiement

1. Pousser la branche sur GitHub (dépôt déjà lié à Netlify d'après le contexte initial du projet).
2. Dans Netlify → Project configuration → Environment variables, renseigner `MOLLIE_API_KEY` (peut être laissée vide pour l'instant — le site fonctionne quand même, en mode "paiement indisponible, contactez-nous").
3. Déclencher un déploiement (push ou "Trigger deploy" dans Netlify → onglet Deploys).
4. Vérifier après déploiement :
   - Les URL sans `.html` fonctionnent (`/vehicules`, `/reservation`...) — c'est le changement `pretty_urls = true` de P1 qui le garantit, mais à confirmer visuellement une fois en ligne.
   - Le menu mobile s'ouvre/se ferme correctement sur un vrai téléphone.
   - `paiement.html` affiche bien le message de repli (téléphone/WhatsApp) tant que Mollie n'est pas configuré.

## 4. Procédure de test Mollie (mode test)

Aucune configuration manuelle de webhook n'est nécessaire côté Mollie : `create-payment.js` transmet `webhookUrl` à chaque création de paiement.

1. Créer un jeton d'accès API **Standard** en mode **Test** sur le tableau de bord Mollie (Développeurs → Jetons d'accès API) → variable `MOLLIE_API_KEY`.
2. Test de bout en bout : réserver un véhicule, aller jusqu'au bouton "Payer maintenant", vérifier la redirection vers la page de paiement Mollie, payer avec un moyen de paiement de test (voir la documentation Mollie pour les identifiants de test du mode actif), vérifier le retour automatique vers `confirmation.html` avec la réservation confirmée (donnée lue depuis le serveur, pas depuis le navigateur).
3. Vérifier dans les logs Netlify Functions que `mollie-webhook` est bien appelé et que le statut est correctement revérifié auprès de l'API Mollie.
4. Tester un paiement refusé/annulé côté Mollie : la réservation doit rester en attente/échec, jamais confirmée.
5. Repasser sur un jeton **Live** uniquement après ces tests en mode test.
6. Pour un test en conditions réelles (vrai paiement live, montant minime) : définir `TEST_DISCOUNT_CODE` dans Netlify, puis saisir cette valeur dans le champ "code promo" lors d'une réservation — le montant facturé passe à 0,10 € au lieu du tarif normal (voir `netlify/functions/create-payment.js`). Permet de vérifier bout en bout un vrai paiement Mollie live et l'email de confirmation reçu par le client, sans payer 49 € à chaque test.

## 5. Ce qui reste juridiquement à fournir (non inventé, volontairement laissé en placeholder)

12 informations légales manquent dans `cgl.html`, `mentions-legales.html` et `confidentialite.html` (SIRET, forme juridique, représentant légal, hébergeur, code NAF, politique d'annulation, ressort du siège social, etc.) — liste complète et exploitable dans `LEGAL-TODO.md`. Une fois fournies par vous, `npm run check:legal` confirme qu'il n'en reste plus.

## 6. Limites connues / non testé dans cet environnement

- Aucun appel réseau réel à Mollie n'a pu être testé ici (pas de clé, pas d'accès réseau sortant dans cet environnement) — voir §4.
- Le comportement réel de Netlify Blobs en production (au-delà du repli mémoire utilisé en test) n'a pas pu être vérifié.
- Les mesures Lighthouse avant/après n'ont pas pu être faites : elles nécessitent un site déployé publiquement. À faire depuis Chrome DevTools (onglet Lighthouse) sur l'URL Netlify une fois en ligne.
- Le rendu réel du menu mobile et du cache `immutable` n'a été vérifié qu'en environnement de test (jsdom / lecture de fichier), pas dans un vrai navigateur déployé.

## 7. Check-list QA manuelle (à faire après déploiement)

**Desktop**
- Parcourir la page d'accueil, cliquer sur un véhicule, aller jusqu'à `paiement.html` sans Mollie configuré → le message de repli téléphone/WhatsApp doit s'afficher proprement.
- Vérifier que le prix affiché sur chaque page (accueil, pages locales, fiche véhicule) correspond bien au même tarif partout (`npm run check:vehicle-grid` le garantit côté code, mais un coup d'œil visuel confirme le rendu).
- Naviguer au clavier uniquement (Tab/Shift+Tab/Entrée/Échap) sur `reservation.html` et `paiement.html` : le focus doit toujours être visible et logique.

**Mobile (vrai téléphone ou émulateur)**
- Ouvrir/fermer le menu hamburger, vérifier qu'il ne bloque pas le défilement de la page en arrière-plan.
- Remplir le formulaire conducteur avec une erreur volontaire (ex. email invalide) : le message d'erreur et le focus doivent être clairs.
- Revenir en arrière depuis `paiement.html` vers `reservation.html` : les champs déjà saisis doivent être pré-remplis.

**Scripts de contrôle (avant tout déploiement futur)**
```
npm test                    # 121 tests, doivent tous passer
npm run check:legal         # échoue tant que les 12 placeholders juridiques (§5) ne sont pas comblés — normal pour l'instant
npm run check:vehicle-grid  # doit toujours passer ; échoue si js/data.js change sans mettre à jour les pages en dur
```
