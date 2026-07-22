// tests/seo-noindex.test.js
//
// Vérifie la cohérence de l'indexation des pages transactionnelles
// (réservation, paiement, confirmation, contrat) : balise noindex présente,
// absentes du sitemap, et non bloquées par robots.txt (pour que les
// moteurs de recherche puissent effectivement lire la balise noindex —
// voir la note dans robots.txt).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const TRANSACTIONAL_PAGES = ["reservation.html", "paiement.html", "confirmation.html", "contrat.html"];

test("chaque page transactionnelle contient une balise noindex, follow", () => {
  for (const page of TRANSACTIONAL_PAGES) {
    const content = fs.readFileSync(path.join(ROOT, page), "utf8");
    assert.match(
      content,
      /<meta name="robots" content="noindex, ?follow">/,
      `${page} devrait contenir <meta name="robots" content="noindex, follow">`
    );
  }
});

test("sitemap.xml ne référence aucune page transactionnelle", () => {
  const sitemap = fs.readFileSync(path.join(ROOT, "sitemap.xml"), "utf8");
  const forbidden = ["/reservation<", "/paiement<", "/confirmation<", "/contrat<"];
  for (const needle of forbidden) {
    assert.equal(sitemap.includes(needle), false, `sitemap.xml ne devrait pas contenir "${needle}"`);
  }
});

test("robots.txt ne bloque pas les pages transactionnelles (pour laisser noindex faire son travail)", () => {
  const robots = fs.readFileSync(path.join(ROOT, "robots.txt"), "utf8");
  for (const page of TRANSACTIONAL_PAGES) {
    assert.equal(robots.includes(`Disallow: /${page}`), false, `robots.txt ne devrait pas bloquer ${page}`);
  }
  assert.match(robots, /Sitemap: https:\/\/getlocation\.fr\/sitemap\.xml/);
});

test("netlify.toml active pretty_urls (cohérent avec les URL canoniques sans .html)", () => {
  const toml = fs.readFileSync(path.join(ROOT, "netlify.toml"), "utf8");
  assert.match(toml, /pretty_urls\s*=\s*true/);
});
