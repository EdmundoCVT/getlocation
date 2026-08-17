# CLAUDE.md

Contexte de départ pour toute session Claude sur ce dépôt — à lire avant d'explorer le code, pour éviter de tout redécouvrir à chaque fois. Le détail technique complet vit dans `AUDIT.md` (P0/P1/P2) et `DEPLOIEMENT.md` (config/déploiement) : ce fichier-ci n'en est qu'un résumé pointeur, à garder à jour mais jamais dupliquer en détail (risque de divergence — voir règle n°1 ci-dessous).

## Le projet

GETLOCATION — site de location de véhicules à Grasse (Alpes-Maritimes). Site statique (HTML/CSS/JS, pas de framework front) + paiement en ligne Mollie + réservation avec contrat PDF pré-rempli envoyé à l'agence.

## Architecture (Phase B de la migration Cloudflare, terminée le 15/08/2026)

- **Hébergement** : Cloudflare Workers. `wrangler.jsonc` déclare `main: src/worker.js` (routeur) + `assets` (fichiers statiques du dépôt) + deux espaces KV (`RESERVATIONS_KV`, `RATE_LIMITS_KV`) — IDs réels déjà configurés en production.
- **Fonctions serveur** : `src/api/*.js` (create-payment, mollie-webhook, reservation-status), routées en same-origin (`/api/...`) par `src/worker.js`. Logique métier partagée dans `src/lib/*.js`.
- **Paiement** : Mollie, via `src/lib/mollie-client.js` (appels `fetch()` directs à l'API REST — pas le SDK `@mollie/api-client`, non garanti compatible Workers).
- **Stockage** : Cloudflare KV (`src/lib/reservation-store.js`, `src/lib/rate-limiter.js`).
- **Email** : API HTTP Resend (`src/lib/resend-client.js`, `send-confirmation-email.js`, `send-contract-email.js`) — pas de SMTP (incompatible avec le runtime Workers).
- **`netlify.toml` et `netlify/functions/` sont legacy** : plus appelés par le site (l'ancien mécanisme cross-origin vers Netlify a été retiré de `js/app.js`), gardés temporairement comme filet de sécurité. **À supprimer** (+ dépendances `@netlify/blobs`, `@mollie/api-client`, `nodemailer` dans `package.json`) une fois la Phase B confirmée stable en production depuis un moment — demander confirmation avant de le faire.
- **Secrets Cloudflare Worker déjà configurés en production** (via `wrangler secret put`, jamais dans le dépôt) : `MOLLIE_API_KEY` (mode **live**), `RESEND_API_KEY`, `AGENCY_EMAIL`, `TEST_DISCOUNT_CODE`. Domaine `getlocation.fr` vérifié sur Resend.

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

- Suppression du code Netlify legacy (`netlify.toml`, `netlify/functions/`, dépendances associées) — en attente de confirmation utilisateur.
- 12 informations légales manquantes (SIRET, mentions légales...) — voir `LEGAL-TODO.md`.
- Retour utilisateur sur la présentation visuelle de `contrat.html` (pas de détail précis donné à ce jour — redemander si pertinent).
- Rotation de la clé `MOLLIE_API_KEY` : une clé live a été collée par erreur dans une conversation Claude le 15/08/2026 ; l'utilisateur a choisi de ne pas la révoquer. Rester factuel si le sujet revient, ne pas insister.

## Utilisateur / contexte business

Non-technique, découvre Git/Terminal/Cloudflare — expliquer étape par étape, en français, sans jargon non expliqué. Site en production réelle avec vrais paiements (compte Mollie live).

**Mode autonome (depuis le 17/08/2026)** : l'utilisateur travaille avec `--dangerously-skip-permissions` et a explicitement demandé de ne plus jamais être sollicité pour une confirmation avant d'agir, y compris pour les commits et les push GitHub (vers `main` inclus). Ne pas demander d'autorisation avant d'agir. En contrepartie, la règle critique n°6 ci-dessus (tests avant tout push) est non négociable et protège la production en l'absence de confirmation manuelle — signaler toujours clairement, dans le compte rendu final, ce qui a été poussé/déployé et le risque associé (site en production réelle), sans transformer ce signalement en question bloquante.
