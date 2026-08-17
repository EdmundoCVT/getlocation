// tests/worker-config.test.js
//
// Garde-fou pour wrangler.jsonc (Phase B de la migration Cloudflare, voir
// DEPLOIEMENT.md) : vérifie que le point d'entrée Worker et les bindings
// nécessaires au fonctionnement du site (assets statiques, KV) sont bien
// déclarés, dans le même esprit que tests/netlify-toml.test.js pour
// l'ancienne configuration Netlify.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

// wrangler.jsonc autorise des commentaires (JSONC) : JSON.parse() seul
// échouerait dessus. On retire les commentaires ligne par ligne (`//...`) —
// suffisant ici, ce fichier n'utilise pas de commentaires de bloc /* */ ni
// de "//" à l'intérieur d'une valeur de chaîne.
function parseJsonc(raw) {
  const sansCommentaires = raw
    .split("\n")
    .map((ligne) => ligne.replace(/(^|\s)\/\/.*$/, ""))
    .join("\n");
  return JSON.parse(sansCommentaires);
}

const raw = fs.readFileSync(path.join(__dirname, "..", "wrangler.jsonc"), "utf8");
const config = parseJsonc(raw);

test("main pointe vers le Worker qui route /api/* (voir src/worker.js)", () => {
  assert.equal(config.main, "src/worker.js");
});

test("assets.binding est déclaré (nécessaire pour env.ASSETS.fetch() dans src/worker.js)", () => {
  assert.equal(config.assets.binding, "ASSETS");
  assert.equal(config.assets.directory, ".");
});

test("html_handling sert les URL sans .html (équivalent du pretty_urls de netlify.toml)", () => {
  assert.equal(config.assets.html_handling, "auto-trailing-slash");
});

test("les espaces de noms KV attendus par src/lib/*.js sont déclarés", () => {
  const bindings = config.kv_namespaces.map((ns) => ns.binding);
  assert.ok(bindings.includes("RESERVATIONS_KV"), "RESERVATIONS_KV manquant (voir src/lib/reservation-store.js)");
  assert.ok(bindings.includes("RATE_LIMITS_KV"), "RATE_LIMITS_KV manquant (voir src/lib/rate-limiter.js)");
  assert.ok(bindings.includes("CONTRACTS_KV"), "CONTRACTS_KV manquant (voir src/lib/contract-store.js)");
  for (const ns of config.kv_namespaces) {
    assert.ok(typeof ns.id === "string" && ns.id.length > 0, `l'espace de noms KV "${ns.binding}" doit avoir un id`);
  }
});
