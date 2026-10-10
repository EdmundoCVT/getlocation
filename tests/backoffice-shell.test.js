const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const shell = fs.readFileSync(path.join(__dirname, "..", "js", "backoffice-shell.js"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "..", "css", "backoffice-shell.css"), "utf8");
const contracts = fs.readFileSync(path.join(__dirname, "..", "contrat.html"), "utf8");

test("coquille back-office : navigation unique, catégories complètes et barre mobile", () => {
  for (const label of ["ACTIVITÉ", "DOCUMENTS", "COMMERCIAL", "GESTION", "Tableau de bord", "Locations", "Planning", "Livraisons", "Contrats", "États des lieux", "Dépôts de garantie", "Devis express", "Véhicules", "Statistiques", "Paramètres"]) assert.match(shell, new RegExp(label));
  assert.match(shell, /bo-bottom-nav/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(shell, /getlocation:backoffice-navigate/);
});

test("contrats réutilise la coquille commune et ne conserve plus la navigation globale locale", () => {
  assert.match(contracts, /js\/backoffice-shell\.js/);
  assert.match(contracts, /GETLOCATION_BACKOFFICE\.initContracts/);
  assert.doesNotMatch(contracts, /aria-label="Navigation de l'espace GET LOCATION"/);
  assert.match(css, /\.bo-mobile-header/);
});
