// tests/cgl-protections.test.js
//
// Le tableau des niveaux de protection de cgl.html est écrit en HTML statique
// — un texte contractuel ne doit pas dépendre du JavaScript pour s'afficher,
// ni pour être imprimé ou archivé. Il duplique donc des valeurs qui vivent
// dans js/data.js (règle n°1 du CLAUDE.md), exactement comme les grilles
// véhicules recopiées dans les pages de destination
// (scripts/check-vehicle-grid-sync.js).
//
// Ce test joue le même rôle que ce script : il échoue dès qu'un prix, une
// franchise ou une garantie change dans js/data.js sans être reporté dans les
// CGL — c'est-à-dire dès que le site facturerait autre chose que ce que le
// contrat annonce.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const {
  PROTECTIONS,
  PROTECTION_GARANTIES,
  formatEUR,
  getProtectionParId
} = require("../js/data.js");

const cglHtml = fs.readFileSync(path.join(__dirname, "..", "cgl.html"), "utf8");
// Le HTML coupe les phrases en plusieurs lignes : les contrôles de texte
// portent sur une version aux blancs normalisés, sinon ils dépendraient de
// l'endroit où le paragraphe a été replié.
const cglTexte = cglHtml.replace(/\s+/g, " ");

function lignesDuTableau() {
  const dom = new JSDOM(cglHtml);
  const tableau = dom.window.document.getElementById("cglProtections");
  assert.ok(tableau, "tableau des niveaux de protection introuvable dans cgl.html");
  const lignes = [...tableau.querySelectorAll("tbody tr")].map((tr) => ({
    id: tr.dataset.protection,
    prix: tr.querySelector("[data-prix]").textContent.trim(),
    franchise: tr.querySelector("[data-franchise]").textContent.trim(),
    garanties: tr.querySelector("[data-garanties]").textContent.trim()
  }));
  dom.window.close();
  return lignes;
}

// Les montants des CGL s'écrivent avec une espace ordinaire là où formatEUR
// emploie une espace fine insécable : on compare sur la même base.
const memeMontant = (a, b) =>
  String(a).replace(/[  ]/g, " ") === String(b).replace(/[  ]/g, " ");

test("cgl.html : une ligne par niveau de protection, dans l'ordre de js/data.js", () => {
  const lignes = lignesDuTableau();
  assert.deepEqual(
    lignes.map((l) => l.id),
    PROTECTIONS.map((p) => p.id),
    "le tableau des CGL ne liste pas exactement les niveaux de PROTECTIONS (js/data.js)"
  );
});

test("cgl.html : prix et franchises identiques à js/data.js", () => {
  lignesDuTableau().forEach((ligne) => {
    const protection = getProtectionParId(ligne.id);
    const prixAttendu = protection.prixParJour > 0
      ? `${formatEUR(protection.prixParJour)} / jour`
      : "Inclus";
    assert.ok(
      memeMontant(ligne.prix, prixAttendu),
      `prix divergent pour ${ligne.id} : CGL « ${ligne.prix} », js/data.js « ${prixAttendu} »`
    );
    assert.ok(
      memeMontant(ligne.franchise, formatEUR(protection.franchise)),
      `franchise divergente pour ${ligne.id} : CGL « ${ligne.franchise} », js/data.js « ${formatEUR(protection.franchise)} »`
    );
  });
});

test("cgl.html : garanties couvertes identiques à js/data.js, dans le même ordre", () => {
  lignesDuTableau().forEach((ligne) => {
    const protection = getProtectionParId(ligne.id);
    const attendues = PROTECTION_GARANTIES
      .filter((g) => protection.garanties.includes(g.id))
      .map((g) => g.libelle.toLowerCase());
    const listees = ligne.garanties.split(";").map((t) => t.trim().toLowerCase());
    assert.deepEqual(
      listees,
      attendues,
      `garanties divergentes pour ${ligne.id} entre cgl.html et js/data.js`
    );
  });
});

test("cgl.html : le plafond de facturation annoncé correspond à prixMax", () => {
  const payantes = PROTECTIONS.filter((p) => p.prixParJour > 0);
  const joursMax = [...new Set(payantes.map((p) => p.joursFacturesMax))];
  assert.equal(joursMax.length, 1, "toutes les formules payantes doivent partager le même plafond");
  assert.match(
    cglTexte,
    new RegExp(`plafonné à ${joursMax[0]} jours de facturation`),
    "le nombre de jours facturés annoncé dans les CGL ne correspond plus à joursFacturesMax"
  );
  payantes.forEach((protection) => {
    assert.ok(
      cglTexte.replace(/[  ]/g, " ").includes(`${formatEUR(protection.prixMax).replace(/[  ]/g, " ")} (${protection.nom})`),
      `plafond « ${formatEUR(protection.prixMax)} (${protection.nom}) » absent des CGL`
    );
  });
});

test("cgl.html : les CGL décrivent bien les exclusions auxquelles renvoie le site", () => {
  // PROTECTION_MENTION (js/data.js) promet au client que les conditions et
  // exclusions figurent dans les CGL : ce paragraphe doit donc exister.
  assert.match(cglTexte, /Cas dans lesquels la protection ne s'applique pas/);
  // Et ne jamais promettre l'inverse de ce qu'annonce le site.
  assert.doesNotMatch(cglTexte, /franchise\s*(de)?\s*0\s*€/i, "aucune promesse de franchise nulle");
  assert.match(cglTexte, /Aucun niveau ne supprime la franchise/);
});

test("cgl.html : la version des CGL a été incrémentée après l'ajout des protections", () => {
  // La version acceptée est tracée sur chaque réservation : un texte
  // contractuel modifié sans changement de version rendrait cette trace
  // mensongère (deux textes différents sous le même identifiant).
  const { CGL_VERSION } = require("../js/data.js");
  assert.ok(CGL_VERSION >= "2026-09-16", `CGL_VERSION (${CGL_VERSION}) antérieure à l'ajout des niveaux de protection`);
});
