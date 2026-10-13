# Comparatif départ / retour — document séparé

Le comparatif est généré uniquement à la demande depuis le back-office. Le PDF officiel d'une révision reste un document individuel et immuable : la génération du comparatif n'écrit aucune clé R2, ne modifie aucun `pdfKey` et ne remplace aucune archive.

## Sources et choix de versions

- Sans sélection explicite, lire la dernière version finalisée de chaque constat via l'adaptateur `inspectionRevisions`.
- Si `departRevision` et `retourRevision` sont fournis, exiger exactement ces versions finalisées. Ne jamais remplacer silencieusement une version absente.
- Comparer uniquement les valeurs enregistrées : date, kilométrage, carburant/charge, propreté, clés, accessoires et dommages. Afficher « non renseigné » lorsque la valeur manque, distinct de zéro.
- Pour les dommages, distinguer les repères observés au départ et au retour sans déduire une responsabilité. Toute différence calculée doit être présentée comme factuelle.
- Garder les photos des deux étapes dans deux sections séparées, avec leur légende et date, à partir de leurs listes de médias respectives.

## Route et stockage

La route agence authentifiée `GET /api/agency-inspection-comparison` produit le PDF à la demande :

- EDL liés : `source=linked&id=...` ; le départ et le retour sont ceux du même dossier.
- EDL indépendants : `source=standalone&departId=...&retourId=...` ; l'association bidirectionnelle enregistrée est obligatoire.
- Versions optionnelles : `departRevision=N&retourRevision=N`.

Le document affiche une synthèse factuelle en colonnes Départ / Retour / Différence puis deux sections de photos distinctes. Il ne déduit aucune responsabilité. Le stockage ou la sauvegarde Drive d'un comparatif pourra être décidé ultérieurement sans modifier les PDF individuels.
