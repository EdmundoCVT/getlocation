const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const contract = fs.readFileSync(path.join(__dirname, "..", "contrat.html"), "utf8");
const inspection = fs.readFileSync(path.join(__dirname, "..", "js", "inspection-page.js"), "utf8");

test("PDF contrat : le binaire signé immédiat est archivé, jamais une régénération client", () => {
  assert.match(contract, /driveArchiveKind: sigData \? 'contract-signed' : null/);
  assert.match(contract, /Object\.prototype\.hasOwnProperty\.call\(payload, 'driveArchiveKind'\) && !payload\.driveArchiveKind/);
});

test("PDF EDL : départ et retour sont envoyés vers l'archive sécurisée", () => {
  assert.match(inspection, /kind", mode === "retour" \? "edl-return" : "edl-depart"/);
  assert.match(inspection, /api\("\/api\/agency-drive-pdf", \{ method: "POST", body: form \}\)/);
  assert.match(inspection, /new Blob\(\[bytes\], \{ type: "application\/pdf" \}\)/);
});
