const test = require("node:test");
const assert = require("node:assert/strict");

const {
  generateDocumentObjectKey,
  putPrivateDocument,
  getPrivateDocument,
  deletePrivateDocument
} = require("../src/lib/document-store.js");

function fakeBucket() {
  const objects = new Map();
  return {
    async put(key, body, options) { objects.set(key, { body, options }); },
    async get(key) { return objects.get(key) || null; },
    async delete(key) { objects.delete(key); }
  };
}

test("génère une clé serveur sans nom de fichier client", () => {
  const reservationId = `res_${"a".repeat(32)}`;
  const key = generateDocumentObjectKey(reservationId, "permis-recto");
  assert.match(key, new RegExp(`^reservations/${reservationId}/permis-recto/[a-f0-9]{32}$`));
  assert.doesNotMatch(key, /\.jpg|client|upload/i);
});

test("écrit, lit et supprime uniquement via le binding R2 privé", async () => {
  const bucket = fakeBucket();
  const env = { DOCUMENTS_BUCKET: bucket };
  const key = generateDocumentObjectKey(`res_${"b".repeat(32)}`, "identite");
  assert.deepEqual(await putPrivateDocument(env, key, "contenu", { contentType: "image/jpeg" }), { key });
  assert.equal((await getPrivateDocument(env, key)).body, "contenu");
  await deletePrivateDocument(env, key);
  assert.equal(await getPrivateDocument(env, key), null);
});

test("refuse de fonctionner sans binding R2", async () => {
  await assert.rejects(putPrivateDocument({}, "cle", "contenu"), /DOCUMENTS_BUCKET/);
});
