const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "..", "src", "api", "agency-drive-backup.js"), "utf8");

test("diagnostic Drive : l'API agence expose les checks sans exposer de valeur", () => {
  assert.match(source, /checks: driveConfigurationChecks\(env\)/);
  assert.doesNotMatch(source, /GOOGLE_SERVICE_ACCOUNT_KEY:\s*env\./);
});
