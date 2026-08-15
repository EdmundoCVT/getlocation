// tests/headers-file.test.js
//
// Équivalent de tests/netlify-toml.test.js pour `_headers` — le fichier
// RÉELLEMENT utilisé par le déploiement Cloudflare actif (voir
// wrangler.jsonc, binding ASSETS), contrairement à netlify.toml qui n'est
// plus qu'un filet de sécurité legacy. Avant ce fichier, seul netlify.toml
// était vérifié par les tests : c'est une partie de la raison pour
// laquelle une page HTML a pu rester en cache sur un téléphone après
// déploiement d'un correctif (voir _headers pour le détail de l'incident).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const HEADERS = fs.readFileSync(path.join(__dirname, "..", "_headers"), "utf8");

// Découpe _headers en blocs (chemin suivi de lignes "Clé: valeur") et
// retourne la valeur Cache-Control du bloc dont le chemin correspond
// exactement au motif donné.
function sectionFor(pathPattern) {
  const lines = HEADERS.split("\n");
  let current = null;
  const blocks = {};
  for (const line of lines) {
    if (/^#/.test(line) || line.trim() === "") continue;
    if (!/^\s/.test(line)) {
      current = line.trim();
      blocks[current] = blocks[current] || [];
    } else if (current) {
      blocks[current].push(line.trim());
    }
  }
  const block = blocks[pathPattern];
  if (!block) return null;
  const ccLine = block.find((l) => l.startsWith("Cache-Control:"));
  return ccLine ? ccLine.slice("Cache-Control:".length).trim() : null;
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

test("les pages HTML (/*) ne sont jamais mises en cache sans revalidation (pas de ?v=, contrairement à css/js)", () => {
  const cc = sectionFor("/*");
  assert.ok(cc, "règle de cache pour /* introuvable");
  assert.match(cc, /no-cache/);
  assert.equal(/immutable/.test(cc), false, "les pages HTML ne doivent jamais être immutable");
});

test("les en-têtes de sécurité globaux (/*) sont toujours présents", () => {
  assert.match(HEADERS, /X-Frame-Options: DENY/);
  assert.match(HEADERS, /X-Content-Type-Options: nosniff/);
  assert.match(HEADERS, /Strict-Transport-Security/);
  assert.match(HEADERS, /Content-Security-Policy/);
});
