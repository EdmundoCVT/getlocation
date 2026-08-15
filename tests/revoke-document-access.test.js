// tests/revoke-document-access.test.js
//
// Ne teste que la logique pure du script administratif (aucun appel
// wrangler/KV réel — voir scripts/revoke-document-access.js, seules
// validateReservationId et computeRevocationPatch sont exportées pour les
// tests). Ne touche jamais à une vraie réservation ni au binding réel.

const test = require("node:test");
const assert = require("node:assert/strict");

const { validateReservationId, computeRevocationPatch } = require("../scripts/revoke-document-access.js");

function reservation(overrides = {}) {
  return {
    id: `res_${"a".repeat(32)}`,
    status: "paid",
    documentAccess: { tokenHash: "c".repeat(64), createdAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-01-15T00:00:00.000Z", revokedAt: null },
    agencyDocumentAccess: { tokenHash: "d".repeat(64), createdAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-01-08T00:00:00.000Z", revokedAt: null },
    ...overrides
  };
}

test("validateReservationId : refuse un identifiant mal formé", () => {
  assert.equal(validateReservationId(`res_${"a".repeat(32)}`), true);
  assert.equal(validateReservationId("res_court"), false);
  assert.equal(validateReservationId("autre-chose"), false);
  assert.equal(validateReservationId(""), false);
  assert.equal(validateReservationId(undefined), false);
  assert.equal(validateReservationId("'; rm -rf /"), false);
});

test("computeRevocationPatch : révoque uniquement le lien client demandé", () => {
  const result = computeRevocationPatch(reservation(), "client", "2026-02-01T00:00:00.000Z");
  assert.deepEqual(result.revoked, ["client"]);
  assert.deepEqual(result.alreadyRevoked, []);
  assert.equal(result.changed, true);
  assert.equal(result.patch.documentAccess.revokedAt, "2026-02-01T00:00:00.000Z");
  assert.equal(result.patch.agencyDocumentAccess, undefined);
});

test("computeRevocationPatch : révoque les deux liens avec 'both'", () => {
  const result = computeRevocationPatch(reservation(), "both", "2026-02-01T00:00:00.000Z");
  assert.deepEqual(result.revoked.sort(), ["agency", "client"]);
  assert.equal(result.patch.documentAccess.revokedAt, "2026-02-01T00:00:00.000Z");
  assert.equal(result.patch.agencyDocumentAccess.revokedAt, "2026-02-01T00:00:00.000Z");
});

test("computeRevocationPatch : idempotent — un lien déjà révoqué n'est pas re-traité", () => {
  const already = reservation({
    documentAccess: { tokenHash: "c".repeat(64), revokedAt: "2026-01-10T00:00:00.000Z" }
  });
  const result = computeRevocationPatch(already, "client", "2026-02-01T00:00:00.000Z");
  assert.deepEqual(result.alreadyRevoked, ["client"]);
  assert.deepEqual(result.revoked, []);
  assert.equal(result.changed, false);
  assert.equal(result.patch.documentAccess, undefined);
});

test("computeRevocationPatch : signale un accès absent sans erreur", () => {
  const noAgency = reservation({ agencyDocumentAccess: null });
  const result = computeRevocationPatch(noAgency, "agency", "2026-02-01T00:00:00.000Z");
  assert.deepEqual(result.absent, ["agency"]);
  assert.equal(result.changed, false);
});

test("computeRevocationPatch : rejette une cible invalide", () => {
  assert.throws(() => computeRevocationPatch(reservation(), "admin"), /Cible invalide/);
});

test("computeRevocationPatch : rejette une réservation absente", () => {
  assert.throws(() => computeRevocationPatch(null, "client"), /introuvable/);
});

test("computeRevocationPatch : ne fait jamais fuiter le jeton — seuls revokedAt change, le hash reste intact", () => {
  const original = reservation();
  const result = computeRevocationPatch(original, "both", "2026-02-01T00:00:00.000Z");
  assert.equal(result.patch.documentAccess.tokenHash, original.documentAccess.tokenHash);
  assert.equal(result.patch.agencyDocumentAccess.tokenHash, original.agencyDocumentAccess.tokenHash);
});
