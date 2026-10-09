const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "..", "contrat.html"), "utf8");

test("navigation contrats : la liste est la vue initiale et le formulaire est séparé", () => {
  assert.match(html, /id="contractsListTab"[^>]*>Contrats existants/);
  assert.match(html, /id="contractsNewTab"[^>]*>\+ Nouveau contrat/);
  assert.match(html, /id="existingContractsPanel"/);
  assert.match(html, /id="newContractPanel" class="hidden"/);
  assert.match(html, /id="contractsHistoryMount"/);
  assert.match(html, /mount\.appendChild\(historique\)/);
});

test("navigation contrats : les onglets conservent l'état dans l'URL et un pré-remplissage ouvre le formulaire", () => {
  assert.match(html, /url\.searchParams\.set\('view', nouvelle \? 'new' : 'list'\)/);
  assert.match(html, /params\.get\('view'\) === 'new'\) \|\| prefill \? 'new' : 'list'/);
});

test("historique contrats : recherche, statut, année, mois et tri restent disponibles", () => {
  ["historiqueRecherche", "historiqueFiltre", "historiqueAnnee", "historiqueMois", "historiqueTri"].forEach((id) => {
    assert.match(html, new RegExp(`id="${id}"`));
  });
  assert.match(html, /mettreAJourFiltresHistorique/);
});
