// tests/contract-dossier-token.test.js
//
// src/lib/contract-dossier-token.js — même schéma que
// worker-document-access-token.test.js, avec deux espaces de jetons
// distincts (agence / client) à vérifier séparés l'un de l'autre.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  generateContractDossierToken,
  hashContractAgencyToken,
  hashContractClientToken,
  contractAgencyTokenExpiresAt,
  issueContractAgencyAccess,
  issueContractClientAccess
} = require("../src/lib/contract-dossier-token.js");

const PEPPER = "pepper-de-test-dossier-contrat";

test("génère un jeton aléatoire de 256 bits au format URL-safe", () => {
  const first = generateContractDossierToken();
  const second = generateContractDossierToken();
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first, second);
});

test("un même jeton brut produit des empreintes différentes selon l'espace (agence vs client)", async () => {
  const token = generateContractDossierToken();
  const agencyHash = await hashContractAgencyToken(token, PEPPER);
  const clientHash = await hashContractClientToken(token, PEPPER);
  assert.match(agencyHash, /^[a-f0-9]{64}$/);
  assert.match(clientHash, /^[a-f0-9]{64}$/);
  assert.notEqual(agencyHash, clientHash, "un jeton agence ne doit jamais être confondu avec un jeton client de mêmes octets");
});

test("issueContractAgencyAccess : stocke une empreinte HMAC et jamais le jeton brut", async () => {
  const issued = await issueContractAgencyAccess(
    { DOCUMENT_TOKEN_PEPPER: PEPPER },
    { dateFin: "2026-08-20", heureFin: "10:00" },
    "2026-08-15T10:00:00.000Z"
  );
  assert.ok(issued.token);
  assert.match(issued.stored.tokenHash, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(issued.stored).includes(issued.token), false);
  assert.equal(issued.stored.revokedAt, null);
});

test("issueContractClientAccess : stocke une empreinte HMAC et jamais le jeton brut", async () => {
  const issued = await issueContractClientAccess({ DOCUMENT_TOKEN_PEPPER: PEPPER });
  assert.ok(issued.token);
  assert.match(issued.stored.tokenHash, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(issued.stored).includes(issued.token), false);
});

test("ne génère aucun jeton (agence ni client) sans DOCUMENT_TOKEN_PEPPER", async () => {
  assert.equal(await issueContractAgencyAccess({}, {}, new Date().toISOString()), null);
  assert.equal(await issueContractClientAccess({}), null);
});

test("expiration du jeton agence : après la restitution + 30 jours si la réservation est lointaine", () => {
  const paidAt = "2026-08-15T10:00:00.000Z";
  // Réservation dans longtemps (retour à +90 jours) : l'expiration doit
  // suivre le retour + 30 jours, pas un délai fixe depuis le paiement.
  const expiresLoin = contractAgencyTokenExpiresAt(
    { dateFin: "2026-11-13", heureFin: "10:00" },
    paidAt
  );
  assert.equal(expiresLoin, new Date(new Date("2026-11-13T10:00:00").getTime() + 30 * 24 * 60 * 60 * 1000).toISOString());
});

test("expiration du jeton agence : plancher de 60 jours depuis le paiement si le retour est proche", () => {
  const paidAt = "2026-08-15T10:00:00.000Z";
  const expiresProche = contractAgencyTokenExpiresAt(
    { dateFin: "2026-08-18", heureFin: "10:00" },
    paidAt
  );
  assert.equal(expiresProche, new Date(new Date(paidAt).getTime() + 60 * 24 * 60 * 60 * 1000).toISOString());
});
