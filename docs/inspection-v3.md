# État des lieux V3

Interface autonome : `/etat-des-lieux.html?mode=depart` ou `mode=retour`,
ouverte avec le lien agence sécurisé déjà fourni par le back-office.
Les six liens de section font défiler le document sans remplacer son fragment
d’autorisation. Aucun secret supplémentaire, migration ou stockage métier créé.

## Composants

- `etat-des-lieux.html` et `css/inspection.css` : interface opérationnelle responsive.
- `js/inspection-page.js` : contrôleur, propretés, suivi des modifications,
  sauvegarde, comparaison et consultation historique en lecture seule.
- `js/inspection-sketch.js` : les cinq vues sont des recadrages directs du
  schéma véhicule de référence fourni pour GET LOCATION (profil conducteur,
  avant, profil passager, arrière, dessus). Les marques restent dans le même
  format compatible `{id, view, x, y, type, description?}`, avec coordonnées
  normalisées en pourcentage. Les champs `description` sont optionnels et ne
  demandent aucune migration des anciens dossiers.
- `js/inspection-media-view.js` : chargement authentifié, décodage et cache local
  des images, aperçus, galerie et lightbox.
- `js/inspection-signature.js` : deux signatures EDL indépendantes du contrat.
- `js/inspection-document.js` : document A4 séparé, calé sur la structure de
  référence (informations, propreté, dommages, remarques, schéma, galerie
  trois colonnes et signatures). Chargement/décodage de toutes
  les images avant impression. En cas de photo inaccessible, impression refusée
  avec un message explicite, pas de PDF silencieusement incomplet.

## Stockage et limites conservées

Les API `/api/contract-dossier-agency`, `/api/inspection-media` et les lecteurs
historiques restent compatibles. `contractDossier.depart/retour` et
`contractDossier.media.depart/retour` restent les seules données opérationnelles.
R2 reste privé. `createdAt` est fourni par le serveur et n’est jamais envoyé
par le front ; seul `capturedAt` passe par le PATCH existant.

Les mutations médias sont sérialisées et le front refuse de dépasser les
30 photos par phase, pour ne pas déclencher l’éviction historique du backend.
Les contrôles médias sont désactivés pendant une sauvegarde du relevé.
Les champs en cours de saisie ne sont pas reconstruits après une opération
photo ni après une sauvegarde : une modification faite pendant l’enregistrement
reste marquée « non enregistrée ».

Pour respecter l’interdiction de supprimer un ancien média, la suppression
n’est proposée que pour les photos nouvellement importées dans la session V3.
La liste de ces clés est conservée en `sessionStorage` après rechargement :
ce n’est pas un stockage d’inspection, ni une autorisation serveur. Les contrôles
d’accès serveur restent indispensables. Les photos historiques et celles
d’une session antérieure sont affichées sans bouton de suppression.

La finalisation appelle la sauvegarde existante, sans nouveau statut serveur
ni verrou irréversible. Les dates des signatures restent celles gérées par
l’API existante, qui les actualise lors de l’enregistrement.

La politique `img-src 'self' data:` interdit les URL `blob:` auparavant utilisées
par la galerie. Les réponses privées sont désormais décodées en data URLs
gardées en mémoire, également utilisables dans le document d’impression.
Aucun accès public aux médias n’a été ajouté. Les originaux ne sont pas
recompressés, modifiés ou déplacés. Les formats non décodables par le navigateur
(HEIC selon le navigateur) affichent une erreur explicite ; aucune conversion
ni date artificielle n’est produite.

Le document s’ouvre sur `about:blank`, sans token. Ses marges A4 sont réalisées
par un padding interne avec une marge de page nulle pour éviter les pieds de
page URL automatiques. Ne pas remplacer ces marges par celles du navigateur.
L’impression directe de l’interface indique d’utiliser le mode document et
retire temporairement le fragment sécurisé jusqu’à `afterprint`.

Les dossiers `source=legacy` restent en lecture seule avec le moteur historique.
Le lien de récupération des originaux Zvezdan est conservé ; aucun accès aux
données de production Zvezdan n’est effectué par les tests.

## Validation reproductible

```sh
node --test --test-isolation=none tests/etat-des-lieux-standalone.test.js tests/worker-inspection-media.test.js tests/worker-contract-dossier.test.js tests/worker-legacy-inspection-agency.test.js tests/validate-contract-dossier.test.js
node scripts/test-inspection-v3-browser.js
npm test
```

Le scénario navigateur demande Playwright, Chromium (`CHROMIUM_PATH` peut
indiquer le binaire) et Poppler (`pdftotext`, `pdfimages`). Ces outils de test
ne sont pas ajoutés comme dépendances du site. Il lance un serveur local,
réutilise les véritables handlers Worker avec KV/R2 simulés et applique la
restriction CSP sur les images. Aucun appel de production.

Il couvre : saisie, propretés indépendantes, marques stables sur les cinq vues,
suppression volontaire d'une marque, import multiple via photothèque et caméra,
modification de `capturedAt` sans changement de `createdAt`,
sauvegarde/rechargement, suppression d’une nouvelle photo, conservation d’un
ancien média, signatures/rechargement, départ et retour, comparaison,
refus d’un kilométrage incohérent, échec de sauvegarde sans perte de saisie,
refus d’impression si médias indisponibles, historique en lecture seule,
375/390/430/1280 px, PDF contenant les images réelles et aucun token/URL.
Les captures et PDF sont écrits dans un répertoire temporaire annoncé en sortie.

L’ouverture réelle de la caméra iOS/Android et le déploiement de production
nécessitent une vérification manuelle après publication.

## Résultats de la validation du 3 octobre 2026

- Tag avant refonte : `backup-before-inspection-v3-2026-10-03`,
  pointant sur `6eabf23a40fcef62a2239081bd1d5edd1e668d31`.
- 76/76 tests ciblés (V3, médias, dossiers, validation serveur, historique,
  back-office, liste agence et liens sécurisés).
- Scénario Chromium complet réussi, avec PDF inspectés par `pdftotext` et
  `pdfimages` ; aucun token ou URL dans les PDF, images réellement incorporées.
- Syntaxe des cinq scripts validée ; aucun marqueur de corruption retrouvé.
- Wrangler 4.59.2 `deploy --dry-run` réussi, sans déploiement ni nouvelle
  dépendance permanente. Avertissements i18n de clés dupliquées préexistants.
- Suite générale : 94/107 fichiers de tests passent. Les mêmes 13 fichiers
  échouent sur le commit de départ `6eabf23` dans une copie indépendante :
  `cgl-protections`, `contrat-apercu-fill`, `contrat-pdf-bugfixes`,
  `contrat-pdf-structure`, `contrat-tarif-manuel-kilometrage`, `data-pricing`,
  `date-bar`, `pricing-ui`, `regression-data-app-contract`, `tarifs-2026-09`,
  `tunnel-robustness`, `vehicle-grid-sync`, `xss-rendering`. Aucun de ces tests
  ni leur logique métier n’a été modifié dans la V3.
