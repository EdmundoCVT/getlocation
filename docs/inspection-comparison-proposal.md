# Comparatif départ / retour — proposition séparée

Le comparatif joint sert de référence fonctionnelle, mais n'est pas généré dans cette PR. Le PDF officiel d'une révision reste un document individuel et immuable.

## Sources et choix de versions

- Lire les deux constats finalisés via l'adaptateur `inspectionRevisions`, avec une révision de départ et une révision de retour **explicites**. Ne pas remplacer silencieusement une version absente par la dernière.
- Comparer uniquement les valeurs enregistrées : date, kilométrage, carburant/charge, propreté, clés, accessoires et dommages. Afficher « non renseigné » lorsque la valeur manque, distinct de zéro.
- Pour les dommages, distinguer les repères observés au départ et au retour sans déduire une responsabilité. Toute différence calculée doit être présentée comme factuelle.
- Garder les photos des deux étapes dans deux sections séparées, avec leur légende et date, à partir de leurs listes de médias respectives.

## Route et stockage à examiner dans une autre intervention

Une route agence authentifiée pourrait accepter `id`, `departRevision` et `retourRevision`, valider que les deux révisions appartiennent au même dossier et sont finalisées, puis produire un PDF comparatif à la demande. Si le comparatif doit être archivé, lui attribuer une clé R2 **distincte** contenant les deux numéros de révision, sans modifier `pdfKey` ni les PDF individuels. Décider séparément si l'archive est immuable et si Drive doit la sauvegarder.

Cette conception nécessite un cadrage de l'API, de l'authentification, du stockage, de la politique d'archivage et des tests avant implémentation. Aucune route, donnée ni clé R2 de comparatif n'est ajoutée ici.
