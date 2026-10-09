const test = require("node:test");
const assert = require("node:assert/strict");
const { safeSnapshot, driveConfigured } = require("../src/lib/google-drive-backup.js");

test("sauvegarde Drive : le snapshot exclut les accès et données carte", () => {
  const snapshot = safeSnapshot({ id: "res_" + "a".repeat(32), contractNumero: "GL-20261009-0001", status: "paid", createdAt: "2026-10-09T10:00:00Z", conducteur: { prenom: "Amir", nom: "Fatkullin", cardNumber: "4111111111111111" }, contractAgencyAccess: { tokenHash: "secret" }, contractDossier: { status: "signed", signature: { imageDataUrl: "data:image/png;base64,x", signedAt: "2026-10-09" } } });
  const json = JSON.stringify(snapshot);
  assert.equal(json.includes("4111111111111111"), false);
  assert.equal(json.includes("tokenHash"), false);
  assert.equal(json.includes("imageDataUrl"), false);
  assert.equal(snapshot.contractDossier.signature.signedAt, "2026-10-09");
});

test("sauvegarde Drive : une configuration complète reste exclusivement serveur", () => {
  assert.equal(driveConfigured({ AGENCY_DB: {}, GOOGLE_DRIVE_ROOT_FOLDER_ID: "folder", GOOGLE_SERVICE_ACCOUNT_KEY: "{}" }), true);
  assert.equal(driveConfigured({ AGENCY_DB: {}, GOOGLE_SERVICE_ACCOUNT_KEY: "{}" }), false);
});
