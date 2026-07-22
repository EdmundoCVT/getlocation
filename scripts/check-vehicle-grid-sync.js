#!/usr/bin/env node
// scripts/check-vehicle-grid-sync.js
//
// js/data.js est la SEULE source de vérité pour le catalogue véhicules
// (nom, catégorie, tarif/jour, places, transmission). Mais pour des raisons
// de performance (contenu visible dès le premier rendu, pas de dépendance
// JS pour le SEO) plusieurs pages recopient cette grille "en dur" dans leur
// HTML au lieu de la générer en JS comme le fait vehicules.html : la page
// d'accueil (index.html) et les 6 pages locales (location-voiture-*.html).
//
// Risque : si js/data.js change (nouveau tarif, véhicule renommé, etc.)
// sans que ces copies en dur soient mises à jour, le site affiche des
// informations incohérentes (et potentiellement un prix affiché différent
// du prix réellement facturé, recalculé côté serveur à partir de
// js/data.js — voir netlify/functions/create-payment-intent.js).
//
// Ce script compare chaque carte véhicule en dur à js/data.js et signale
// toute divergence : nom, catégorie affichée, prix/jour, places,
// transmission, véhicule manquant ou véhicule fantôme (retiré du catalogue
// mais oublié dans une page).
//
// Usage :
//   node scripts/check-vehicle-grid-sync.js
//   npm run check:vehicle-grid
//
// vehicules.html n'est volontairement PAS vérifié : sa grille est générée
// dynamiquement en JS à partir de VEHICULES (voir js/app.js), donc toujours
// à jour par construction — rien à comparer.

const fs = require("fs");
const path = require("path");
const { VEHICULES } = require("../js/data.js");

const ROOT = path.join(__dirname, "..");

const FILES_TO_CHECK = [
  "index.html",
  "location-voiture-nice.html",
  "location-voiture-cannes.html",
  "location-voiture-antibes.html",
  "location-voiture-grasse.html",
  "location-voiture-monaco.html",
  "location-voiture-aeroport-nice.html"
];

// La catégorie affichée ajoute "Hybride" au nom de catégorie brut de
// data.js quand le véhicule est hybride (ex. "SUV" -> "SUV Hybride").
function expectedFor(vehicule) {
  return {
    id: vehicule.id,
    nom: vehicule.nom,
    categorie: vehicule.categorie + (vehicule.hybride ? " Hybride" : ""),
    prix: `${vehicule.prixJour} €`,
    places: `${vehicule.places} places`,
    transmission: vehicule.transmission
  };
}

// Découpe le HTML en "cartes" en se basant sur data-gallery="<id>", qui
// marque de façon fiable le début de chaque carte véhicule en dur.
function extractCards(html) {
  const positions = [];
  const re = /data-gallery="([a-z0-9-]+)"/g;
  let match;
  while ((match = re.exec(html)) !== null) {
    positions.push({ id: match[1], index: match.index });
  }
  return positions.map((pos, i) => {
    const end = i + 1 < positions.length ? positions[i + 1].index : Math.min(html.length, pos.index + 3000);
    return { id: pos.id, block: html.slice(pos.index, end) };
  });
}

function fieldFrom(block, className) {
  const m = block.match(new RegExp(`class="${className}"[^>]*>([^<]*)<`));
  return m ? m[1].trim() : null;
}

function priceFrom(block) {
  const m = block.match(/class="price">.*?<\/span>([\d\s,.]+)\s*€/s);
  return m ? `${m[1].trim()} €` : null;
}

function specsFrom(block) {
  const m = block.match(/class="vehicle-specs">(.*?)<\/div>/s);
  if (!m) return [];
  return [...m[1].matchAll(/<span>([^<]*)<\/span>/g)].map((s) => s[1].trim());
}

// Retourne la liste des divergences trouvées (tableau de chaînes lisibles).
// Fonction pure, réutilisée par le CLI et par tests/vehicle-grid-sync.test.js.
function findDivergences() {
  const errors = [];
  const knownIds = new Set(VEHICULES.map((v) => v.id));

  for (const file of FILES_TO_CHECK) {
    const filePath = path.join(ROOT, file);
    if (!fs.existsSync(filePath)) {
      errors.push(`${file} : fichier introuvable`);
      continue;
    }
    const html = fs.readFileSync(filePath, "utf8");
    if (!html.includes('class="vehicle-grid"')) continue; // pas de grille sur cette page

    const cards = extractCards(html);
    if (cards.length === 0) continue; // grille générée en JS, rien à comparer

    for (const vehicule of VEHICULES) {
      const expected = expectedFor(vehicule);
      const card = cards.find((c) => c.id === vehicule.id);
      if (!card) {
        errors.push(`${file} : véhicule "${vehicule.id}" absent de la grille en dur`);
        continue;
      }

      const nom = fieldFrom(card.block, "vehicle-name");
      const categorie = fieldFrom(card.block, "vehicle-category");
      const prix = priceFrom(card.block);
      const specs = specsFrom(card.block);

      if (nom !== expected.nom) {
        errors.push(`${file} [${vehicule.id}] : nom "${nom}" ≠ data.js "${expected.nom}"`);
      }
      if (categorie !== expected.categorie) {
        errors.push(`${file} [${vehicule.id}] : catégorie "${categorie}" ≠ attendu "${expected.categorie}"`);
      }
      if (prix !== expected.prix) {
        errors.push(`${file} [${vehicule.id}] : prix "${prix}" ≠ data.js "${expected.prix}"`);
      }
      if (specs[0] !== expected.places) {
        errors.push(`${file} [${vehicule.id}] : places "${specs[0]}" ≠ data.js "${expected.places}"`);
      }
      if (specs[1] !== expected.transmission) {
        errors.push(`${file} [${vehicule.id}] : transmission "${specs[1]}" ≠ data.js "${expected.transmission}"`);
      }
    }

    for (const card of cards) {
      if (!knownIds.has(card.id)) {
        errors.push(`${file} : carte pour "${card.id}" ne correspond à aucun véhicule de js/data.js`);
      }
    }
  }

  return errors;
}

function main() {
  const errors = findDivergences();
  if (errors.length === 0) {
    console.log(`[check-vehicle-grid-sync] OK — grilles véhicules en dur synchronisées avec js/data.js (${FILES_TO_CHECK.length} pages vérifiées).`);
    process.exit(0);
  }
  console.error(`[check-vehicle-grid-sync] ÉCHEC — ${errors.length} divergence(s) détectée(s) :\n`);
  for (const e of errors) console.error(`  - ${e}`);
  console.error("\nMettez à jour les pages listées pour qu'elles reflètent js/data.js (source de vérité unique).");
  process.exit(1);
}

if (require.main === module) {
  main();
} else {
  module.exports = { findDivergences };
}
