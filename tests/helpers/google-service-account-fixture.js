// tests/helpers/google-service-account-fixture.js
//
// Génère une vraie paire de clés RSA (Node crypto) pour simuler le contenu
// d'un fichier de clé de compte de service Google en test — permet de
// vérifier une signature JWT réellement valide (pas seulement que
// l'appel a été fait), sans dépendre d'une clé Google réelle.

const { generateKeyPairSync } = require("node:crypto");

function makeServiceAccountFixture() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" }
  });
  const key = {
    type: "service_account",
    project_id: "test-project",
    private_key_id: "test-key-id",
    private_key: privateKey,
    client_email: "getlocation-sync@test-project.iam.gserviceaccount.com",
    client_id: "123456789"
  };
  return { keyJson: JSON.stringify(key), publicKeyPem: publicKey, clientEmail: key.client_email };
}

module.exports = { makeServiceAccountFixture };
