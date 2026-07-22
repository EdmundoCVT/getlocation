#!/usr/bin/env node
// scripts/check-legal-placeholders.js
//
// Contrôle pré-déploiement : détecte les placeholders juridiques
// ([à compléter], [à ajuster], [à préciser]) encore présents dans les
// pages légales, et échoue (code de sortie 1) tant qu'ils n'ont pas été
// résolus. Objectif : ne jamais laisser une information juridique
// inventée ou manquante partir en production sans que ce soit un choix
// délibéré et visible.
//
// Usage :
//   node scripts/check-legal-placeholders.js
//   npm run check:legal
//
// Intégration recommandée (à activer explicitement, pas fait
// automatiquement par ce chantier) : dans netlify.toml,
//   [build]
//     command = "npm run check:legal"
// Tant que les placeholders listés dans LEGAL-TODO.md n'ont pas été
// résolus, ce script échouera intentionnellement si vous l'activez comme
// commande de build — c'est le comportement "bloquant" voulu. Ne
// l'activez que lorsque vous êtes prêt à ce que le déploiement soit
// refusé tant que ces informations manquent.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const LEGAL_PAGES = ["cgl.html", "mentions-legales.html", "confidentialite.html"];
// Le flag "s" (dotall) permet à "." de matcher les retours à la ligne : un
// placeholder peut s'étendre sur plusieurs lignes dans le HTML source (ex.
// cgl.html ligne 174-175), un simple traitement ligne par ligne le raterait.
const PLACEHOLDER_RE = /\[\s*(à compléter|à ajuster|à préciser)[^\]]*\]/gis;

function findPlaceholders(fileName) {
  const filePath = path.join(ROOT, fileName);
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, "utf8");
  const found = [];
  let match;
  const re = new RegExp(PLACEHOLDER_RE);
  while ((match = re.exec(content)) !== null) {
    const upTo = content.slice(0, match.index);
    const line = upTo.split("\n").length;
    found.push({ line, text: match[0].replace(/\s+/g, " ").trim() });
  }
  return found;
}

function main() {
  let total = 0;
  const report = [];

  for (const page of LEGAL_PAGES) {
    const placeholders = findPlaceholders(page);
    if (placeholders.length > 0) {
      report.push({ page, placeholders });
      total += placeholders.length;
    }
  }

  if (total === 0) {
    console.log("[check-legal-placeholders] OK — aucun placeholder juridique détecté.");
    process.exit(0);
  }

  console.error(`[check-legal-placeholders] ÉCHEC — ${total} placeholder(s) juridique(s) non résolu(s) :\n`);
  for (const { page, placeholders } of report) {
    console.error(`  ${page} :`);
    for (const p of placeholders) {
      console.error(`    - ligne ${p.line} : ${p.text}`);
    }
  }
  console.error(
    "\nCes informations doivent être fournies par l'agence (voir LEGAL-TODO.md) — " +
    "ne jamais les inventer. Ce script échoue intentionnellement tant qu'elles manquent."
  );
  process.exit(1);
}

main();
