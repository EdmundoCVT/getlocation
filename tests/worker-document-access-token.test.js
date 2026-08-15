const test = require("node:test");
const assert = require("node:assert/strict");

const {
  generateDocumentToken,
  hashDocumentToken,
  documentTokenExpiresAt,
  issueDocumentAccess
} = require("../src/lib/document-access-token.js");

test("génère un jeton aléatoire de 256 bits au format URL-safe", () => {
  const first = generateDocumentToken();
  const second = generateDocumentToken();
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first, second);
});

test("stocke une empreinte HMAC et jamais le jeton brut", async () => {
  const issued = await issueDocumentAccess(
    { DOCUMENT_TOKEN_PEPPER: "pepper-de-test-long-et-distinct" },
    { periodeDebut: "2026-08-20T10:00:00.000Z" },
    "2026-08-15T10:00:00.000Z"
  );
  assert.ok(issued.token);
  assert.match(issued.stored.tokenHash, /^[a-f0-9]{64}$/);
  assert.notEqual(issued.stored.tokenHash, issued.token);
  assert.equal(JSON.stringify(issued.stored).includes(issued.token), false);
  assert.equal(issued.stored.revokedAt, null);
});

test("la même valeur produit la même empreinte seulement avec le même pepper", async () => {
  const token = generateDocumentToken();
  const first = await hashDocumentToken(token, "pepper-a");
  assert.equal(await hashDocumentToken(token, "pepper-a"), first);
  assert.notEqual(await hashDocumentToken(token, "pepper-b"), first);
});

test("l'expiration est la première échéance entre le départ et paiement + 14 jours", () => {
  const paidAt = "2026-08-15T10:00:00.000Z";
  assert.equal(
    documentTokenExpiresAt({ periodeDebut: "2026-08-20T10:00:00.000Z" }, paidAt),
    "2026-08-20T10:00:00.000Z"
  );
  assert.equal(
    documentTokenExpiresAt({ periodeDebut: "2026-09-20T10:00:00.000Z" }, paidAt),
    "2026-08-29T10:00:00.000Z"
  );
});

test("ne génère aucun jeton sans DOCUMENT_TOKEN_PEPPER", async () => {
  assert.equal(await issueDocumentAccess({}, {}, new Date().toISOString()), null);
});
