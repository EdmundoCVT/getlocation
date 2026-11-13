const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "..", "contrat.html"), "utf8");

test("l'historique distingue Prolonger de la création générique de version", () => {
  assert.match(html, /extendBtn\.textContent='Prolonger'/);
  assert.match(html, /Prolonger depuis V/);
  assert.match(html, /Créer une nouvelle version à partir de V/);
});

test("le panneau simplifié ne demande que la nouvelle date et la nouvelle heure", () => {
  assert.match(html, /title\.textContent='Prolonger le contrat'/);
  assert.match(html, /dateLabel\.textContent='Nouvelle date de retour'/);
  assert.match(html, /timeLabel\.textContent='Nouvelle heure de retour'/);
  assert.doesNotMatch(html, /extension-reason|reasonLabel\.textContent='Motif/);
  assert.match(html, /fetch\('\/api\/contracts-extension'.*preview:true/);
});

test("le contexte et l'aperçu affichent toutes les informations utiles sans champ calculé", () => {
  for (const label of ["Contrat", "Client", "Véhicule", "Retour actuel", "Nouveau retour", "Nouvelle durée", "Nouveau total", "Déjà payé", "Kilométrage inclus", "Supplément restant à payer"]) {
    assert.match(html, new RegExp(label));
  }
  assert.match(html, /create\.textContent='Prolonger le contrat'/);
  assert.match(html, /Montants et disponibilité vérifiés par le serveur/);
});

test("la création reste dans le panneau et propose l'éditeur complet seulement en action secondaire", () => {
  assert.match(html, /Contrat prolongé — V/);
  assert.match(html, /view\.textContent='Voir la nouvelle version'/);
  assert.match(html, /edit\.textContent='Modifier d’autres informations'/);
  assert.doesNotMatch(html, /\.then\(function\(body\)\{window\.location\.href='\/contrat\.html\?editVersionId=/);
});

test("un conflit affiche directement la date de réservation bloquante", () => {
  assert.match(html, /Impossible de prolonger : ce véhicule est déjà réservé/);
  assert.match(html, /error\.details\.startsAt/);
});

test("la liste propose Prolonger sur un brouillon et Renouveler sur un contrat finalisé", () => {
  assert.match(html, /\(\(estSigne&&!estTermine\)\|\|estBrouillon\)/);
  assert.match(html, /renewBtn\.textContent='Renouveler'/);
  assert.match(html, /estTermine = estSigne && contratEstTermine/);
});

test("le renouvellement demande quatre champs, utilise l'API serveur et confirme sans redirection", () => {
  for (const label of ["Nouvelle date de début", "Nouvelle heure de début", "Nouvelle date de fin", "Nouvelle heure de fin"]) assert.match(html, new RegExp(label));
  assert.match(html, /fetch\('\/api\/contracts-renewal'/);
  assert.match(html, /title\.textContent='Nouveau contrat créé'/);
  assert.match(html, /open\.textContent='Ouvrir le nouveau contrat'/);
  assert.match(html, /edit\.textContent='Modifier d’autres informations'/);
  assert.match(html, /Contrat renouvelé depuis/);
});

test("le panneau mobile utilise des contrôles tactiles d'au moins 44 px sans tableau horizontal", () => {
  assert.match(html, /extension-fields input\{[^}]*min-height:46px/);
  assert.match(html, /sheet-actions \.btn\{[^}]*min-height:45px/);
  assert.match(html, /\.extension-summary,\.extension-fields\{grid-template-columns:1fr;/);
  assert.doesNotMatch(html, /extension-(?:summary|fields)[^\n]*<table/i);
});

test("le brouillon existant est ouvert au lieu de créer une version supplémentaire", () => {
  assert.match(html, /error\.code==='contract_draft_exists'/);
  assert.match(html, /Un brouillon V/);
  assert.match(html, /open\.textContent='Ouvrir V'/);
});
