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

test("PDF EDL : seul le PDF officiel finalisé est consulté, sans archive navigateur", () => {
  assert.match(inspection, /function officialPdfUrl\(\)/);
  assert.match(inspection, /\/api\/agency-inspection-pdf\?/);
  assert.match(inspection, /\/api\/standalone-inspection-pdf\?/);
  assert.match(inspection, /PDF officiel après finalisation/);
  assert.doesNotMatch(inspection, /archiverPdfInspection|agency-drive-pdf", \{ method: "POST"/);
});
