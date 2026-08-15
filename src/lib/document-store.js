// Abstraction minimale du futur stockage documentaire R2 privé.
// Aucun bucket n'est créé ni déclaré à ce stade. Les objets sont toujours
// adressés par une clé générée côté serveur ; le nom original du fichier ne
// fait jamais partie de la clé et aucune URL publique n'est produite.

function requireDocumentsBucket(env) {
  if (!env || !env.DOCUMENTS_BUCKET) {
    throw new Error("Binding R2 DOCUMENTS_BUCKET non configuré");
  }
  return env.DOCUMENTS_BUCKET;
}

function generateDocumentObjectKey(reservationId, documentType) {
  if (!/^res_[a-f0-9]{32}$/.test(reservationId || "")) throw new Error("Réservation invalide");
  if (!/^[a-z0-9-]{2,40}$/.test(documentType || "")) throw new Error("Type de document invalide");
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const randomId = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `reservations/${reservationId}/${documentType}/${randomId}`;
}

async function putPrivateDocument(env, key, body, metadata = {}) {
  const bucket = requireDocumentsBucket(env);
  await bucket.put(key, body, { customMetadata: metadata });
  return { key };
}

async function getPrivateDocument(env, key) {
  return requireDocumentsBucket(env).get(key);
}

async function deletePrivateDocument(env, key) {
  await requireDocumentsBucket(env).delete(key);
}

module.exports = {
  generateDocumentObjectKey,
  putPrivateDocument,
  getPrivateDocument,
  deletePrivateDocument
};
