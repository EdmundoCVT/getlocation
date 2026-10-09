const test = require("node:test");
const assert = require("node:assert/strict");
const { safeSnapshot, driveConfigured, sharedDriveUrl } = require("../src/lib/google-drive-backup.js");

test("sauvegarde Drive : le snapshot exclut les accès et données carte", () => {
  const snapshot = safeSnapshot({ id: "res_" + "a".repeat(32), contractNumero: "GL-20261009-0001", status: "paid", createdAt: "2026-10-09T10:00:00Z", conducteur: { prenom: "Amir", nom: "Fatkullin", cardNumber: "4111111111111111" }, contractAgencyAccess: { tokenHash: "secret" }, contractDossier: { status: "signed", signature: { imageDataUrl: "data:image/png;base64,x", signedAt: "2026-10-09" } } });
  const json = JSON.stringify(snapshot);
  assert.equal(json.includes("4111111111111111"), false);
  assert.equal(json.includes("tokenHash"), false);
  assert.equal(json.includes("imageDataUrl"), false);
  assert.equal(snapshot.contractDossier.signature.signedAt, "2026-10-09");
});

test("sauvegarde Drive : chaque appel est compatible avec un Drive partagé", () => {
  const url = new URL(sharedDriveUrl("?q=test&fields=files(id)", undefined, true));
  assert.equal(url.searchParams.get("supportsAllDrives"), "true");
  assert.equal(url.searchParams.get("includeItemsFromAllDrives"), "true");
  assert.equal(url.searchParams.get("corpora"), "allDrives");
  assert.equal(url.searchParams.get("q"), "test");
});

test("sauvegarde Drive : les binaires utilisent l'endpoint d'upload Google", () => {
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "src", "lib", "google-drive-backup.js"), "utf8");
  assert.match(source, /https:\/\/www\.googleapis\.com\/upload\/drive\/v3\/files/);
  assert.match(source, /upload: true/);
});

test("sauvegarde Drive : une configuration complète reste exclusivement serveur", () => {
  assert.equal(driveConfigured({ AGENCY_DB: {}, GOOGLE_DRIVE_ROOT_FOLDER_ID: "folder", GOOGLE_SERVICE_ACCOUNT_KEY: "{}" }), true);
  assert.equal(driveConfigured({ AGENCY_DB: {}, GOOGLE_SERVICE_ACCOUNT_KEY: "{}" }), false);
});
