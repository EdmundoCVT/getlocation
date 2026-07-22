// tests/netlify-toml.test.js
//
// Vérifie quelques réglages clés de netlify.toml par une lecture simple du
// fichier (pas de parseur TOML dédié nécessaire pour ces assertions
// ciblées) : cache immutable sur les assets versionnés (css/js), en-têtes
// de sécurité toujours présents.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const TOML = fs.readFileSync(path.join(__dirname, "..", "netlify.toml"), "utf8");

// Découpe netlify.toml en blocs [[headers]] et retourne la valeur
// Cache-Control du bloc dont la ligne `for = "..."` correspond exactement
// au chemin donné (évite les soucis d'échappement regex avec les "*").
function sectionFor(pathPattern) {
  const blocks = TOML.split("[[headers]]").slice(1);
  for (const block of blocks) {
    const forMatch = block.match(/for\s*=\s*"([^"]+)"/);
    if (forMatch && forMatch[1] === pathPattern) {
      const ccMatch = block.match(/Cache-Control\s*=\s*"([^"]+)"/);
      return ccMatch ? ccMatch[1] : null;
    }
  }
  return null;
}

test("css/* a un cache long et immutable (assets versionnés via ?v=)", () => {
  const cc = sectionFor("/css/*");
  assert.ok(cc, "règle de cache pour /css/* introuvable");
  assert.match(cc, /immutable/);
  assert.match(cc, /max-age=31536000/);
});

test("js/* a un cache long et immutable (assets versionnés via ?v=)", () => {
  const cc = sectionFor("/js/*");
  assert.ok(cc, "règle de cache pour /js/* introuvable");
  assert.match(cc, /immutable/);
  assert.match(cc, /max-age=31536000/);
});

test("images/* garde un cache court (pas versionné, ne doit pas être immutable)", () => {
  const cc = sectionFor("/images/*");
  assert.ok(cc);
  assert.equal(/immutable/.test(cc), false, "les images ne sont pas versionnées : pas de cache immutable");
});

test("les en-têtes de sécurité globaux (/*) sont toujours présents", () => {
  assert.match(TOML, /X-Frame-Options = "DENY"/);
  assert.match(TOML, /X-Content-Type-Options = "nosniff"/);
  assert.match(TOML, /Strict-Transport-Security/);
  assert.match(TOML, /Content-Security-Policy/);
});
