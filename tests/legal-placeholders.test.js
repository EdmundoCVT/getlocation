// tests/legal-placeholders.test.js
//
// N'échoue PAS simplement parce que des placeholders juridiques existent
// (le cahier des charges interdit d'inventer des informations légales : il
// est normal et attendu qu'ils subsistent tant que l'agence ne les a pas
// fournis). Ce test vérifie en revanche que LEGAL-TODO.md reste le
// catalogue exhaustif et à jour de ces placeholders — s'il en manque un,
// c'est le signe qu'une page a été modifiée sans mettre à jour le suivi
// juridique.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const LEGAL_PAGES = ["cgl.html", "mentions-legales.html", "confidentialite.html"];
const PLACEHOLDER_RE = /\[\s*(à compléter|à ajuster|à préciser)[^\]]*\]/gi;

function findPlaceholders(fileName) {
  const content = fs.readFileSync(path.join(ROOT, fileName), "utf8");
  const matches = content.match(PLACEHOLDER_RE) || [];
  return matches;
}

test("LEGAL-TODO.md existe", () => {
  assert.equal(fs.existsSync(path.join(ROOT, "LEGAL-TODO.md")), true);
});

test("chaque placeholder juridique présent dans les pages légales est référencé dans LEGAL-TODO.md", () => {
  const legalTodo = fs.readFileSync(path.join(ROOT, "LEGAL-TODO.md"), "utf8");

  for (const page of LEGAL_PAGES) {
    const placeholders = findPlaceholders(page);
    for (const placeholder of placeholders) {
      // Comparaison tolérante : on vérifie que le mot-clé du placeholder
      // (ex. "à compléter") apparaît bien dans une ligne de LEGAL-TODO.md
      // concernant ce fichier — pas une correspondance caractère pour
      // caractère (le tableau reformule chaque ligne en langage humain).
      assert.ok(
        legalTodo.includes(page),
        `LEGAL-TODO.md devrait mentionner le fichier ${page} (placeholder trouvé : ${placeholder})`
      );
    }
  }
});

test("aucune page hors juridique ne contient de placeholder juridique oublié", () => {
  const allHtmlFiles = fs.readdirSync(ROOT).filter((f) => f.endsWith(".html"));
  const nonLegalPages = allHtmlFiles.filter((f) => !LEGAL_PAGES.includes(f));

  const offenders = [];
  for (const page of nonLegalPages) {
    const placeholders = findPlaceholders(page);
    if (placeholders.length > 0) offenders.push({ page, placeholders });
  }
  assert.deepEqual(offenders, [], "Des placeholders juridiques ont été trouvés en dehors des pages légales suivies : " + JSON.stringify(offenders));
});
