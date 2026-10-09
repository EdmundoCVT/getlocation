const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "..", "src", "api", "agency-drive-pdf.js"), "utf8");

test("archive PDF Drive : endpoint agence uniquement, PDF borné et signé immuable", () => {
  assert.match(source, /requireAgencySession/);
  assert.match(source, /application\/pdf/);
  assert.match(source, /MAX_BYTES/);
  assert.match(source, /ne peut pas être remplacé/);
  assert.match(source, /enqueueDriveSync/);
});
