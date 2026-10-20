const test = require("node:test");
const assert = require("node:assert/strict");
const { contractLanguage, createReservation, getReservation, updateReservationStatus, createContractVersion } = require("../src/lib/reservation-store.js");
const { createFakeKv } = require("./helpers/fake-kv.js");

test("langue contrat : anglais explicite conservé, anciens dossiers français par défaut", () => {
  assert.equal(contractLanguage({ contractLanguage: "en" }), "en");
  assert.equal(contractLanguage({ langueClient: "en" }), "en");
  assert.equal(contractLanguage({ langue: "en" }), "en");
  assert.equal(contractLanguage({}), "fr");
});

test("langue contrat : le choix de la version prévaut sur la langue historique de réservation", () => {
  assert.equal(contractLanguage({ contractLanguage: "fr", langue: "en" }), "fr");
  assert.equal(contractLanguage({ contractDossier: { contractLanguage: "en" }, langue: "fr" }), "en");
});

test("version V2 : reprend la langue de V1 signée tout en restant modifiable avant sa signature", async () => {
  const env = { RESERVATIONS_KV: createFakeKv() };
  const created = await createReservation(env, { vehiculeId: "opel-corsa", contractLanguage: "en" });
  await updateReservationStatus(env, created.id, "paid", {
    contractLanguage: "en",
    contractDossier: { status: "signed", contractLanguage: "en", cglVersion: "2026-10-10-en", signature: { signedAt: "2026-10-10T10:00:00.000Z" } },
    contractVersion: { contractId: created.id, version: 1, isActive: true, status: "signed" }
  });
  const v2 = await createContractVersion(env, created.id, "agency@example.test", "Correction de langue");
  assert.equal(v2.contractLanguage, "en");
  assert.equal(v2.contractDossier.status, "draft");
  assert.deepEqual(v2.contractDossier.signature, { signedAt: "2026-10-10T10:00:00.000Z" });
  assert.equal(v2.contractDossier.cglVersion, "2026-10-10-en", "la nouvelle version hérite d'abord du texte accepté par la version source");
  assert.equal(v2.contractVersion.version, 2);
  const v1 = await getReservation(env, created.id);
  assert.equal(v1.contractDossier.cglVersion, "2026-10-10-en", "la version CGL signée historique reste immuable");
});
