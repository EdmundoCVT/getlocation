const test = require("node:test");
const assert = require("node:assert/strict");
const { safeSnapshot, driveConfigured, driveConfigurationChecks, sharedDriveUrl, syncDriveBackup } = require("../src/lib/google-drive-backup.js");

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

test("sauvegarde Drive : un passage est volontairement borné", () => {
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "src", "lib", "google-drive-backup.js"), "utf8");
  assert.match(source, /const DRIVE_BATCH_SIZE = 3/);
  assert.match(source, /LIMIT \?/);
  assert.match(source, /const accessToken = await getAccessToken\(env, DRIVE_SCOPE\)/);
  assert.match(source, /plus quatre sous-requêtes externes/);
  assert.match(source, /drive_sync_outbox WHERE status IN \('pending','processing','error'\).*LIMIT 1/);
});

test("sauvegarde Drive : une configuration complète reste exclusivement serveur", () => {
  assert.equal(driveConfigured({ AGENCY_DB: {}, GOOGLE_DRIVE_ROOT_FOLDER_ID: "folder", GOOGLE_SERVICE_ACCOUNT_KEY: "{}" }), true);
  assert.equal(driveConfigured({ AGENCY_DB: {}, GOOGLE_SERVICE_ACCOUNT_KEY: "{}" }), false);
});

test("sauvegarde Drive : le diagnostic ne retourne que la présence des composants", () => {
  assert.deepEqual(driveConfigurationChecks({ AGENCY_DB: {}, GOOGLE_DRIVE_ROOT_FOLDER_ID: "folder", GOOGLE_SERVICE_ACCOUNT_KEY: "{}" }), { agencyDb: true, driveRootFolderId: true, googleServiceAccountKey: true });
  assert.deepEqual(driveConfigurationChecks({ AGENCY_DB: {} }), { agencyDb: true, driveRootFolderId: false, googleServiceAccountKey: false });
});

test("sauvegarde Drive : une configuration manquante transforme l'outbox en erreur", async () => {
  const queries = [];
  const env = { AGENCY_DB: { prepare(sql) { return { bind(...args) { return { run: async () => { queries.push({ sql, args }); } }; } }; } } };
  const result = await syncDriveBackup(env, "res_" + "a".repeat(32));
  assert.equal(result.ok, false);
  assert.match(result.reason, /GOOGLE_DRIVE_ROOT_FOLDER_ID/);
  assert.match(result.reason, /GOOGLE_SERVICE_ACCOUNT_KEY/);
  assert.ok(queries.some((query) => query.sql.includes("status='error'")));
});
