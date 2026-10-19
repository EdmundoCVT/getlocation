// tests/worker-contracts-numero-historique.test.js
//
// Tests des ajouts à src/lib/reservation-store.js pour la numérotation
// automatique des contrats (GL-AAAAMMJJ-NNNN) et l'historique unifié
// (contrats manuels + dossiers de réservations payées en ligne). Même
// style que tests/worker-reservation-store.test.js.

const test = require("node:test");
const assert = require("node:assert/strict");

const { createFakeKv } = require("./helpers/fake-kv.js");
const { createFakeD1 } = require("./helpers/fake-d1.js");
const {
  generateContractNumero,
  createManualContract,
  updateManualContract,
  listContractsHistory,
  createReservation,
  updateReservationStatus,
  updateContractDossier,
  createContractVersion,
  updateContractVersionData,
  updateContractVersionSignature,
  finalizeContractVersion,
  setContractArchived,
  getReservation
} = require("../src/lib/reservation-store.js");

function makeEnv() {
  // Depuis le Lot 2 : generateContractNumero() délègue à un compteur D1
  // atomique (voir src/lib/contract-numero.js) au lieu du compteur KV
  // lecture-puis-écriture.
  return { RESERVATIONS_KV: createFakeKv(), AGENCY_DB: createFakeD1() };
}

const rawDataValide = {
  vehiculeId: "opel-corsa",
  immat: "HJ-967-KQ",
  depart: "2026-08-13T10:00",
  retour: "2026-08-15T10:00",
  nom: "Benzaama",
  prenom: "Israa"
};

test("generateContractNumero : format GL-AAAAMMJJ-NNNN, incrémente séquentiellement, jamais réutilisé", async () => {
  const env = makeEnv();
  const n1 = await generateContractNumero(env);
  const n2 = await generateContractNumero(env);
  assert.match(n1, /^GL-\d{8}-0001$/);
  assert.match(n2, /^GL-\d{8}-0002$/);
  assert.notEqual(n1, n2);
});

test("createManualContract : assigne un numéro, statut manual_contract dédié, jamais confondu avec une réservation", async () => {
  const env = makeEnv();
  const record = await createManualContract(env, rawDataValide);
  assert.match(record.contractNumero, /^GL-\d{8}-\d{4}$/);
  assert.equal(record.status, "manual_contract");
  assert.match(record.id, /^res_[a-f0-9]{32}$/);
  assert.ok(record.createdAt);
});

test("createManualContract : stocké sans TTL (document commercial à conserver)", async () => {
  const env = makeEnv();
  const record = await createManualContract(env, rawDataValide);
  // La fausse KV lève une exception si expirationTtl est fourni et < 60s ;
  // ici on vérifie indirectement l'absence de TTL en inspectant le stockage
  // interne (voir tests/helpers/fake-kv.js, `_raw`).
  const entry = env.RESERVATIONS_KV._raw.get(record.id);
  assert.equal(entry.expiresAt, null);
});

test("updateManualContract : met à jour en place (même id, même numéro, même createdAt)", async () => {
  const env = makeEnv();
  const cree = await createManualContract(env, rawDataValide);
  const maj = await updateManualContract(env, cree.id, { ...rawDataValide, kmDepart: "42150", kmRetour: "42736" });

  assert.equal(maj.id, cree.id);
  assert.equal(maj.contractNumero, cree.contractNumero);
  assert.equal(maj.createdAt, cree.createdAt);
  assert.equal(maj.kmRetour, "42736");

  const historique = await listContractsHistory(env, 10);
  assert.equal(historique.length, 1, "la mise à jour ne doit jamais créer un second contrat");
});

test("updateManualContract : id introuvable renvoie null (pas de crash)", async () => {
  const env = makeEnv();
  const result = await updateManualContract(env, "res_" + "0".repeat(32), rawDataValide);
  assert.equal(result, null);
});

test("updateManualContract : refuse de modifier une réservation en ligne (mauvais statut)", async () => {
  const env = makeEnv();
  const reservation = await createReservation(env, { vehiculeId: "opel-corsa" });
  const result = await updateManualContract(env, reservation.id, rawDataValide);
  assert.equal(result, null);
});

test("versionnement : V1 reste intacte et sa signature est copiée indépendamment dans V2", async () => {
  const env = makeEnv();
  const v1 = await createManualContract(env, rawDataValide, "Edmundo");
  const signedAt = "2026-10-09T10:00:00.000Z";
  await updateContractDossier(env, v1.id, {
    contractDossier: { status: "signed", signature: { imageDataUrl: "data:image/png;base64,signee", signedAt } },
    contractVersion: { contractId: v1.contractNumero, version: 1, isActive: true, status: "signed", createdAt: v1.createdAt, signedAt }
  });

  await assert.rejects(() => updateManualContract(env, v1.id, { ...rawDataValide, nom: "Modifié" }), /Version signée/);
  const v1Avant = await getReservation(env, v1.id);
  const v2 = await createContractVersion(env, v1.id, "Edmundo", "Correction client");
  const v1Apres = await getReservation(env, v1.id);

  assert.deepEqual(v1Apres, v1Avant, "créer V2 ne doit jamais réécrire V1");
  assert.equal(v2.contractVersion.version, 2);
  assert.equal(v2.contractVersion.isActive, true);
  assert.equal(v2.contractVersion.supersedesVersion, 1);
  assert.equal(v2.contractVersion.versionReason, "Correction client");
  assert.equal(v2.contractNumero, v1.contractNumero);
  assert.equal(v2.contractVersion.contractId, v1.contractNumero);
  assert.equal(v2.contractDossier.status, "draft");
  assert.deepEqual(v2.contractDossier.signature, v1Avant.contractDossier.signature);
  assert.notStrictEqual(v2.contractDossier.signature, v1Avant.contractDossier.signature);
  assert.notEqual(v2.id, v1.id);
});

test("listContractsHistory : ignore les réservations sans contractNumero (jamais payées)", async () => {
  const env = makeEnv();
  await createReservation(env, { vehiculeId: "opel-corsa" }); // pending_payment, pas de numéro
  const historique = await listContractsHistory(env, 10);
  assert.deepEqual(historique, []);
});

test("listContractsHistory : contrat manuel — vue complète (rawData) pour Ouvrir/Dupliquer", async () => {
  const env = makeEnv();
  const cree = await createManualContract(env, rawDataValide);
  const historique = await listContractsHistory(env, 10);

  assert.equal(historique.length, 1);
  assert.equal(historique[0].origine, "manuel");
  assert.equal(historique[0].numero, cree.contractNumero);
  assert.equal(historique[0].rawData.nom, "Benzaama");
});

test("listContractsHistory : réservation payée — vue minimale seulement (jamais permis/naissance/téléphone/adresse)", async () => {
  const env = makeEnv();
  const reservation = await createReservation(env, {
    vehiculeId: "peugeot-3008",
    dateDebut: "2026-08-01",
    heureDebut: "10:00",
    conducteur: { nom: "Dupont", prenom: "Jean", telephone: "0601020304", naissance: "1990-01-01", email: "jean@example.com" }
  });
  const numero = await generateContractNumero(env);
  await updateReservationStatus(env, reservation.id, "paid", { contractNumero: numero });

  const historique = await listContractsHistory(env, 10);
  assert.equal(historique.length, 1);
  const entry = historique[0];
  assert.equal(entry.origine, "reservation");
  assert.equal(entry.numero, numero);
  assert.equal(entry.resume.nom, "Dupont");
  assert.equal(entry.resume.prenom, "Jean");
  assert.equal(entry.resume.vehiculeId, "peugeot-3008");

  // Aucune donnée sensible au-delà du nom : ni dans `resume`, ni ailleurs
  // dans l'entrée renvoyée par l'historique.
  assert.equal("rawData" in entry, false);
  const serialise = JSON.stringify(entry);
  assert.equal(serialise.includes("0601020304"), false);
  assert.equal(serialise.includes("1990-01-01"), false);
  assert.equal(serialise.includes("jean@example.com"), false);
});

test("listContractsHistory : historique unifié, tri par numéro décroissant, contrats manuels et en ligne mélangés", async () => {
  const env = makeEnv();
  const manuel = await createManualContract(env, { ...rawDataValide, nom: "Manuel" });
  const reservation = await createReservation(env, { vehiculeId: "opel-corsa", conducteur: { nom: "EnLigne", prenom: "Client" } });
  const numeroReservation = await generateContractNumero(env);
  await updateReservationStatus(env, reservation.id, "paid", { contractNumero: numeroReservation });

  const historique = await listContractsHistory(env, 10);
  assert.equal(historique.length, 2);
  // Le plus récent (numéro le plus élevé) en premier.
  assert.equal(historique[0].numero, numeroReservation);
  assert.equal(historique[1].numero, manuel.contractNumero);
});

test("listContractsHistory : respecte la limite", async () => {
  const env = makeEnv();
  for (let i = 0; i < 5; i++) {
    await createManualContract(env, { ...rawDataValide, nom: `Client ${i}` });
  }
  const historique = await listContractsHistory(env, 3);
  assert.equal(historique.length, 3);
});

test("versionnement complet V1 → V2 : copie profonde, signature modifiable et historiques financiers immuables", async () => {
  const env = makeEnv();
  const v1 = await createManualContract(env, {
    ...rawDataValide,
    nom: "Dupont",
    total: 1000,
    options: [{ id: "siege-enfant", montant: 20 }],
    protection: { id: "confort", montant: 12 },
    depotGarantie: 1500,
    paymentId: "tr_300",
    paidAmount: 300,
    paymentHistory: [{ id: "tr_300", amount: 300, status: "paid" }],
    depositOperations: [{ id: "auth_1500", amount: 1500, status: "authorized" }],
    drivePdfFiles: [{ sourceKey: "contract-signed-v1", key: "pdf-v1", immutable: true }]
  }, "Edmundo");
  const signedAt = "2026-10-10T10:00:00.000Z";
  await updateContractDossier(env, v1.id, {
    contractDossier: {
      status: "signed",
      cglVersion: "2026-10-10-fr",
      cglAcceptedAt: signedAt,
      fields: { observations: ["départ", "retour"] },
      signature: { imageDataUrl: "data:image/png;base64," + "A".repeat(120), name: "Jean Dupont", signedAt, displaySignedAt: "2026-10-10T12:00", signatureId: "SIG-A" }
    },
    contractVersion: { contractId: v1.contractNumero, version: 1, isActive: true, status: "signed", createdAt: v1.createdAt, signedAt }
  });
  const sourceBefore = await getReservation(env, v1.id);
  const v2 = await createContractVersion(env, v1.id, "Edmundo", "Changement véhicule");

  assert.equal(v2.contractNumero, sourceBefore.contractNumero);
  assert.equal(v2.contractVersion.contractId, sourceBefore.contractVersion.contractId);
  assert.equal(v2.contractVersion.version, 2);
  assert.equal(v2.contractVersion.supersedesVersion, 1);
  assert.equal(v2.contractVersion.versionReason, "Changement véhicule");
  assert.deepEqual(v2.options, sourceBefore.options);
  assert.deepEqual(v2.protection, sourceBefore.protection);
  assert.deepEqual(v2.contractDossier.signature, sourceBefore.contractDossier.signature);
  assert.notStrictEqual(v2.options, sourceBefore.options);
  assert.notStrictEqual(v2.contractDossier.signature, sourceBefore.contractDossier.signature);
  assert.equal(v2.drivePdfFiles, undefined, "V2 doit produire son propre PDF");

  await updateContractVersionData(env, v2.id, { total: 1200, depotGarantie: 2000, vehiculeId: "peugeot-3008", nom: "Durand" }, "Edmundo");
  await updateContractVersionSignature(env, v2.id, { imageDataUrl: "data:image/png;base64," + "B".repeat(120), name: "Jean Durand", signedAt: "2026-10-11T10:00:00.000Z", displaySignedAt: "2026-10-11T12:00", signatureId: "SIG-B" }, "Edmundo");
  const v2Modified = await getReservation(env, v2.id);
  assert.equal(v2Modified.total, 1200);
  assert.equal(v2Modified.depotGarantie, 2000);
  assert.equal(v2Modified.financialHistory.paidAmount, 300);
  assert.deepEqual(v2Modified.paymentHistory, sourceBefore.paymentHistory);
  assert.deepEqual(v2Modified.depositOperations, sourceBefore.depositOperations);
  assert.equal(v2Modified.contractDossier.signature.signatureId, "SIG-B");
  assert.deepEqual(await getReservation(env, v1.id), sourceBefore, "toutes les modifications V2 laissent V1 intacte");
});

test("versionnement V1/V2/V3/V4 : un seul brouillon et départ possible depuis une ancienne version", async () => {
  const env = makeEnv();
  const v1 = await createManualContract(env, rawDataValide, "Edmundo");
  const signature = { imageDataUrl: "data:image/png;base64," + "A".repeat(120), signedAt: "2026-10-10T10:00:00.000Z", signatureId: "SIG-A" };
  await updateContractDossier(env, v1.id, { contractDossier: { status: "signed", signature }, contractVersion: { contractId: v1.contractNumero, version: 1, isActive: true, status: "signed", signedAt: signature.signedAt } });
  const v2 = await createContractVersion(env, v1.id, "Edmundo", "V2");
  await assert.rejects(() => createContractVersion(env, v1.id, "Edmundo", "V3 trop tôt"), (error) => error.code === "contract_draft_exists" && error.draft.version === 2);
  await finalizeContractVersion(env, v2.id, "Edmundo");
  const v3 = await createContractVersion(env, v2.id, "Edmundo", "V3");
  await finalizeContractVersion(env, v3.id, "Edmundo");
  const v2BeforeV4 = await getReservation(env, v2.id);
  const v3BeforeV4 = await getReservation(env, v3.id);
  const v4 = await createContractVersion(env, v1.id, "Edmundo", "Retour aux données V1");
  assert.equal(v4.contractVersion.version, 4);
  assert.equal(v4.contractVersion.supersedesVersion, 1);
  assert.equal(v4.contractNumero, v1.contractNumero);
  assert.equal(v4.contractVersion.contractId, v1.contractNumero);
  assert.deepEqual(await getReservation(env, v2.id), v2BeforeV4);
  assert.deepEqual(await getReservation(env, v3.id), v3BeforeV4);
  const cards = await listContractsHistory(env, 10);
  assert.equal(cards.length, 1, "une seule carte logique par numéro de contrat");
  assert.equal(cards[0].version.version, 4);
  assert.equal(cards[0].versions.length, 4);
  await setContractArchived(env, v4.id, true, "Edmundo");
  const archivedCards = await listContractsHistory(env, 10);
  assert.equal(archivedCards[0].archived, true);
  assert.equal(archivedCards[0].versions.length, 4, "l’archivage logique conserve toutes les versions");
  await setContractArchived(env, v4.id, false, "Edmundo");
  assert.equal((await listContractsHistory(env, 10))[0].archived, false);
});
