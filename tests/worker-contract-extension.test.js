const test = require("node:test");
const assert = require("node:assert/strict");
const { createFakeKv } = require("./helpers/fake-kv.js");
const { createFakeD1 } = require("./helpers/fake-d1.js");
const { createContractExtension, previewContractExtension } = require("../src/lib/contract-extension.js");
const { getReservation, updateReservationStatus } = require("../src/lib/reservation-store.js");
const { handleContractsExtension } = require("../src/api/contracts-extension.js");
const { handleAgencyLogin } = require("../src/api/agency-login.js");
const { buildDossierView } = require("../src/api/contract-dossier-agency.js");
const { buildClientView } = require("../src/api/contract-dossier-client.js");

function environment() {
  return {
    RESERVATIONS_KV: createFakeKv(),
    RATE_LIMITS_KV: createFakeKv(),
    AGENCY_DB: createFakeD1(),
    AGENCY_AUTH_PEPPER: "pepper",
    AGENCY_CODE_EDMUNDO: "code-edmundo-1234"
  };
}

function source(overrides = {}) {
  return {
    id: "res_" + "a".repeat(32),
    status: "manual_contract",
    contractSourceType: "manual",
    contractNumero: "GL-20261110-0042",
    vehiculeId: "peugeot-2008-hybrid",
    immatriculation: "AA-123-AA",
    dateDebut: "2026-11-10",
    heureDebut: "10:00",
    dateFin: "2026-11-13",
    heureFin: "10:00",
    depart: "2026-11-10T10:00",
    retour: "2026-11-13T10:00",
    periodeDebut: "2026-11-10T09:00:00.000Z",
    periodeFin: "2026-11-13T09:00:00.000Z",
    jours: 3,
    tarifJournalierContractuel: 65,
    total: 195,
    montantFinalConvenu: 195,
    paidAmount: 195,
    depotGarantie: 650,
    cautionContractuelle: 650,
    conducteur: { prenom: "Jean", nom: "Dupont", email: "j@example.test" },
    options: [],
    protection: { id: "essentiel", nom: "Protection Essentielle", prixParJour: 0, joursFactures: 0, montant: 0 },
    livraison: true,
    deliveryDistanceKm: 10,
    deliveryReferenceLabel: "Nice",
    contractMileage: { mode: "standard", kilometresInclusParJour: 200, kilometresInclusTotal: 600, supplementKmCentimes: 65, joursFactures: 3 },
    cglVersion: "2026-10-10-fr",
    observations: "Rayure déjà notée",
    contractDossier: {
      status: "signed",
      signature: { imageDataUrl: "data:image/png;base64," + "A".repeat(120), signedAt: "2026-11-10T09:30:00.000Z", signatureId: "SIG-V1" },
      depart: { km: 12000, observations: "Départ", media: [{ key: "edl/v1/depart.jpg" }] },
      retour: null
    },
    inspectionRevisions: { depart: [{ revision: 1, media: [{ key: "edl/v1/depart.jpg" }] }] },
    drivePdfFiles: [{ sourceKey: "contract-signed-v1", key: "pdf/v1.pdf", immutable: true }],
    financialHistory: { paymentId: "tr_initial", paidAt: "2026-11-10T09:00:00.000Z", paidAmount: 195 },
    paymentId: "tr_initial",
    paidAt: "2026-11-10T09:00:00.000Z",
    contractVersion: { contractId: "GL-20261110-0042", version: 1, isActive: true, status: "signed", signedAt: "2026-11-10T09:30:00.000Z" },
    createdAt: "2026-11-01T10:00:00.000Z",
    updatedAt: "2026-11-10T09:30:00.000Z",
    ...overrides
  };
}

async function store(env, record) {
  await env.RESERVATIONS_KV.put(record.id, JSON.stringify(record));
  return record;
}

test("prolongation principale : V2 brouillon, 5 jours, 1000 km, tarif 65 €, supplément 130 €, V1 immuable", async () => {
  const env = environment();
  const v1 = await store(env, source());
  const before = JSON.stringify(v1);
  const { version: v2, preview } = await createContractExtension(env, v1.id, { date: "2026-11-15", time: "10:00" }, "Edmundo");

  assert.equal(v2.contractNumero, v1.contractNumero);
  assert.equal(v2.contractVersion.contractId, v1.contractVersion.contractId);
  assert.equal(v2.contractVersion.version, 2);
  assert.equal(v2.contractVersion.supersedesVersion, 1);
  assert.equal(v2.contractVersion.status, "draft");
  assert.match(v2.contractVersion.versionReason, /Prolongation jusqu’au 15\/11\/2026 à 10:00/);
  assert.equal(v2.dateDebut, "2026-11-10");
  assert.equal(v2.heureDebut, "10:00");
  assert.equal(v2.dateFin, "2026-11-15");
  assert.equal(v2.heureFin, "10:00");
  assert.equal(v2.jours, 5);
  assert.equal(v2.tarifJournalierContractuel, 65);
  assert.equal(v2.total, 325);
  assert.equal(v2.additionalAmountDue, 130);
  assert.equal(v2.contractMileage.kilometresInclusTotal, 1000);
  assert.equal(preview.includedMileage, 1000);
  assert.equal(v2.cautionContractuelle, 650);
  assert.equal(v2.depotGarantie, 650);
  assert.equal(v2.deliveryDistanceKm, 10);
  assert.equal(v2.financialHistory.paymentId, "tr_initial");
  assert.equal(v2.financialHistory.paidAmount, 195);
  assert.equal(v2.financialHistory.extensions[0].additionalAmount, 130);
  const agencyView = buildDossierView(v2).reservation;
  const clientView = buildClientView(v2).reservation;
  assert.equal(agencyView.vehicule.prixJour, 65, "le PDF agence reçoit le tarif contractuel, pas le catalogue");
  assert.equal(clientView.vehicule.prixJour, 65, "le PDF client reçoit le tarif contractuel, pas le catalogue");
  assert.equal(agencyView.additionalAmountDue, 130);
  assert.equal(clientView.amountAlreadyPaid, 195);
  assert.equal(v2.montantRegle, 195);
  assert.equal(v2.soldeRegle, false);
  assert.deepEqual(v2.contractDossier.depart, v1.contractDossier.depart);
  assert.deepEqual(v2.contractDossier.signature, v1.contractDossier.signature);
  assert.equal(v2.drivePdfFiles, undefined, "V2 produira son propre PDF sans écraser celui de V1");
  assert.equal(JSON.stringify(await getReservation(env, v1.id)), before, "V1 reste strictement identique");
});

test("le catalogue courant ne remplace ni le tarif journalier ni la caution historiques", async () => {
  const env = environment();
  const v1 = await store(env, source({ tarifJournalierContractuel: 65, depotGarantie: 650, cautionContractuelle: 650 }));
  const { version } = await createContractExtension(env, v1.id, { date: "2026-11-15", time: "10:00" }, "Edmundo");
  assert.equal(version.tarifJournalierContractuel, 65);
  assert.equal(version.total, 325);
  assert.equal(version.depotGarantie, 650);
  assert.equal(version.cautionContractuelle, 650);
});

test("options journalières et protection sont prolongées, forfait et livraison restent uniques", async () => {
  const env = environment();
  const v1 = await store(env, source({
    total: 248,
    montantFinalConvenu: 248,
    paidAmount: 248,
    financialHistory: { paymentId: "tr_initial", paidAmount: 248 },
    options: [
      { id: "siege-enfant", nom: "Siège enfant", type: "jour", prix: 5, montant: 15 },
      { id: "livraison-adresse", nom: "Livraison", type: "forfait", montant: 20 }
    ],
    protection: { id: "confort", nom: "Protection Standard", prixParJour: 6, joursFactures: 3, prixMax: 42, montant: 18 }
  }));
  const { version } = await createContractExtension(env, v1.id, { date: "2026-11-15", time: "10:00" }, "Edmundo");
  assert.equal(version.options.find((item) => item.id === "siege-enfant").montant, 25);
  assert.equal(version.options.find((item) => item.id === "livraison-adresse").montant, 20);
  assert.equal(version.protection.montant, 30);
  assert.equal(version.total, 400);
  assert.equal(version.additionalAmountDue, 152);
});

test("une fin identique ou antérieure est refusée sans créer de V2", async () => {
  const env = environment();
  const v1 = await store(env, source());
  await assert.rejects(() => createContractExtension(env, v1.id, { date: "2026-11-13", time: "10:00" }, "Edmundo"), (error) => error.code === "extension_end_not_later");
  assert.equal((await env.RESERVATIONS_KV.list({ prefix: "res_" })).keys.length, 1);
});

test("conflit sur la seule période ajoutée : 14→18 bloque, 16→18 ne bloque pas une fin au 15", async () => {
  const blockedEnv = environment();
  const v1 = await store(blockedEnv, source());
  await store(blockedEnv, source({
    id: "res_" + "b".repeat(32), contractNumero: "GL-20261114-0043",
    contractVersion: { contractId: "GL-20261114-0043", version: 1, status: "signed" },
    dateDebut: "2026-11-14", heureDebut: "10:00", dateFin: "2026-11-18", heureFin: "10:00",
    periodeDebut: "2026-11-14T09:00:00.000Z", periodeFin: "2026-11-18T09:00:00.000Z"
  }));
  await assert.rejects(() => createContractExtension(blockedEnv, v1.id, { date: "2026-11-15", time: "10:00" }, "Edmundo"), (error) => error.code === "extension_vehicle_conflict" && error.details.reference === "GL-20261114-0043");
  assert.equal((await blockedEnv.RESERVATIONS_KV.list({ prefix: "res_" })).keys.length, 2, "aucune V2 en conflit");

  const freeEnv = environment();
  const freeV1 = await store(freeEnv, source());
  await store(freeEnv, source({
    id: "res_" + "c".repeat(32), contractNumero: "GL-20261116-0044",
    contractVersion: { contractId: "GL-20261116-0044", version: 1, status: "signed" },
    dateDebut: "2026-11-16", heureDebut: "10:00", dateFin: "2026-11-18", heureFin: "10:00",
    periodeDebut: "2026-11-16T09:00:00.000Z", periodeFin: "2026-11-18T09:00:00.000Z"
  }));
  const result = await createContractExtension(freeEnv, freeV1.id, { date: "2026-11-15", time: "10:00" }, "Edmundo");
  assert.equal(result.version.contractVersion.version, 2);
});

test("un brouillon existant empêche une nouvelle prolongation et indique V2", async () => {
  const env = environment();
  const v1 = await store(env, source());
  await store(env, source({ id: "res_" + "d".repeat(32), status: "manual_contract", contractVersion: { contractId: v1.contractNumero, version: 2, status: "draft" }, contractDossier: { status: "draft" } }));
  await assert.rejects(() => createContractExtension(env, v1.id, { date: "2026-11-15", time: "10:00" }, "Edmundo"), (error) => error.code === "contract_draft_exists" && error.draft.version === 2);
  assert.equal((await env.RESERVATIONS_KV.list({ prefix: "res_" })).keys.length, 2);
});

async function login(env) {
  const response = await handleAgencyLogin(new Request("https://getlocation.fr/api/agency-login", { method: "POST", headers: { origin: "https://getlocation.fr", "cf-connecting-ip": "198.51.100.7", "content-type": "application/json" }, body: JSON.stringify({ code: "code-edmundo-1234" }) }), env);
  const body = await response.json();
  return { cookie: /agency_session=([^;]+)/.exec(response.headers.get("set-cookie"))[1], csrf: body.csrfToken };
}

function apiRequest(session, body) {
  return new Request("https://getlocation.fr/api/contracts-extension", { method: "POST", headers: { origin: "https://getlocation.fr", cookie: `agency_session=${session.cookie}`, "x-agency-csrf": session.csrf, "content-type": "application/json" }, body: JSON.stringify(body) });
}

test("API : aperçu puis création, les montants falsifiés du navigateur sont ignorés et l'audit est écrit", async () => {
  const env = environment();
  const v1 = await store(env, source());
  const session = await login(env);
  const previewResponse = await handleContractsExtension(apiRequest(session, { id: v1.id, newEndDate: "2026-11-15", newEndTime: "10:00", preview: true, total: 1 }), env);
  assert.equal(previewResponse.status, 200);
  assert.equal((await previewResponse.json()).preview.newTotal, 325);
  const createResponse = await handleContractsExtension(apiRequest(session, { id: v1.id, newEndDate: "2026-11-15", newEndTime: "10:00", total: 1, tarifJournalierContractuel: 1, cautionContractuelle: 1 }), env);
  assert.equal(createResponse.status, 201);
  const body = await createResponse.json();
  const v2 = await getReservation(env, body.id);
  assert.equal(v2.total, 325);
  assert.equal(v2.tarifJournalierContractuel, 65);
  assert.equal(v2.cautionContractuelle, 650);
  assert.ok(env.AGENCY_DB._raw.auditLog.some((event) => event.event_type === "contract_extension_created"));
});

test("aperçu interdit depuis un brouillon", async () => {
  const env = environment();
  const draft = await store(env, source({ contractVersion: { contractId: "GL-20261110-0042", version: 1, status: "draft" }, contractDossier: { status: "draft" } }));
  await assert.rejects(() => previewContractExtension(env, draft.id, { date: "2026-11-15", time: "10:00" }), (error) => error.code === "source_not_finalized");
});

test("une prolongation issue d'une réservation payée étend le TTL KV sans modifier la valeur V1", async () => {
  const env = environment();
  const paid = source({ status: "paid", contractSourceType: "reservation" });
  await env.RESERVATIONS_KV.put(paid.id, JSON.stringify(paid), { expirationTtl: 7 * 24 * 60 * 60 });
  const serializedBefore = await env.RESERVATIONS_KV.get(paid.id);
  const expiryBefore = env.RESERVATIONS_KV._raw.get(paid.id).expiresAt;
  await createContractExtension(env, paid.id, { date: "2026-11-20", time: "10:00" }, "Edmundo");
  assert.equal(await env.RESERVATIONS_KV.get(paid.id), serializedBefore);
  const extendedExpiry = env.RESERVATIONS_KV._raw.get(paid.id).expiresAt;
  assert.ok(extendedExpiry > expiryBefore);
  await updateReservationStatus(env, paid.id, "paid", { documentsStatus: "submitted" });
  assert.ok(env.RESERVATIONS_KV._raw.get(paid.id).expiresAt >= extendedExpiry - 1000, "une écriture ultérieure ne raccourcit pas le TTL prolongé");
});
