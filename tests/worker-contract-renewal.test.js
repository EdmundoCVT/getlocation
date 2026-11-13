const test = require("node:test");
const assert = require("node:assert/strict");
const { createFakeKv } = require("./helpers/fake-kv.js");
const { createFakeD1 } = require("./helpers/fake-d1.js");
const { renewContract, previewContractRenewal } = require("../src/lib/contract-renewal.js");
const { getReservation } = require("../src/lib/reservation-store.js");
const { handleContractsRenewal } = require("../src/api/contracts-renewal.js");
const { handleAgencyLogin } = require("../src/api/agency-login.js");

function environment() {
  return {
    RESERVATIONS_KV: createFakeKv(), RATE_LIMITS_KV: createFakeKv(), AGENCY_DB: createFakeD1(),
    AGENCY_AUTH_PEPPER: "pepper", AGENCY_CODE_EDMUNDO: "code-edmundo-1234"
  };
}

function source(overrides = {}) {
  return {
    id: "res_" + "a".repeat(32), status: "manual_contract", contractSourceType: "manual",
    contractNumero: "GL-20260803-0042", vehiculeId: "peugeot-2008-hybrid", immatriculation: "AA-123-AA",
    dateDebut: "2026-08-03", heureDebut: "10:00", dateFin: "2026-09-03", heureFin: "10:00",
    depart: "2026-08-03T10:00", retour: "2026-09-03T10:00",
    periodeDebut: "2026-08-03T08:00:00.000Z", periodeFin: "2026-09-03T08:00:00.000Z",
    jours: 31, tarifJournalierContractuel: 65, total: 2232, montantFinalConvenu: 2232,
    depotGarantie: 650, cautionContractuelle: 650,
    prenom: "Jean", nom: "Dupont", naissance: "01/02/1990", adresse: "1 rue Test", codePostal: "06130", ville: "Grasse",
    tel: "0601020304", email: "jean@example.test", permis: "P123", permisDate: "01/02/2010", permisPays: "France",
    conducteur: { prenom: "Jean", nom: "Dupont", naissance: "1990-02-01", telephone: "0601020304", email: "jean@example.test" },
    options: [
      { id: "siege-enfant", nom: "Siège enfant", type: "jour", prix: 5, montant: 155 },
      { id: "livraison-adresse", nom: "Livraison", type: "forfait", montant: 20 }
    ],
    protection: { id: "confort", nom: "Protection Standard", prixParJour: 6, joursFactures: 7, prixMax: 42, montant: 42 },
    livraison: true, livraisonRue: "2 rue Livraison", livraisonCP: "06000", livraisonVille: "Nice", deliveryDistanceKm: 10,
    contractMileage: { mode: "standard", kilometresInclusParJour: 200, kilometresInclusTotal: 6200, supplementKmCentimes: 65, joursFactures: 31 },
    contractLanguage: "fr", remarques: "Client mensuel", notes: "Prévenir avant livraison",
    paymentId: "tr_old", paidAt: "2026-08-03T08:00:00.000Z", paidAmount: 2232,
    paymentHistory: [{ id: "tr_old", amount: 2232 }], financialHistory: { paymentId: "tr_old", paidAmount: 2232 },
    depositOperations: [{ id: "auth_old" }], documentAccess: { tokenHash: "secret" }, agencyDocumentAccess: { tokenHash: "secret2" },
    contractAgencyAccess: { tokenHash: "secret3" }, contractClientAccess: { tokenHash: "secret4" }, manualClientAccess: { tokenHash: "secret5" },
    drivePdfFiles: [{ sourceKey: "contract-signed-v1", key: "pdf/v1.pdf" }], driveSync: { status: "done" },
    inspectionRevisions: { depart: [{ revision: 1 }] }, inspectionArchives: [{ id: "archive1" }],
    etatDepart: { observations: "Ancien départ" }, etatRetour: { observations: "Ancien retour" }, kmDepart: "12000", kmRetour: "13000",
    pricingSnapshot: { totalFinal: 2232, old: true }, contractExtensionPricing: { sourceVersion: 1 },
    contractDossier: {
      status: "signed", cglVersion: "2026-10-10-fr", contractLanguage: "fr", observations: "Remarque utile",
      fields: { permisNumero: "P123", adresse: "1 rue Test", livraisonRue: "2 rue Livraison" },
      signature: { imageDataUrl: "data:image/png;base64," + "A".repeat(120), signedAt: "2026-08-03T08:30:00.000Z" },
      depart: { km: 12000, media: [{ key: "edl/depart.jpg" }] }, retour: { km: 13000 }
    },
    contractVersion: { contractId: "GL-20260803-0042", version: 1, status: "signed", isActive: true, signedAt: "2026-08-03T08:30:00.000Z" },
    createdAt: "2026-08-01T10:00:00.000Z", updatedAt: "2026-08-03T08:30:00.000Z",
    ...overrides
  };
}

async function store(env, record) { await env.RESERVATIONS_KV.put(record.id, JSON.stringify(record)); return record; }
const monthlyPeriod = { start: { date: "2026-09-03", time: "10:00" }, end: { date: "2026-10-03", time: "10:00" } };

test("renouvellement mensuel : nouveau contrat V1 propre, conditions historiques reprises et source immuable", async () => {
  const env = environment();
  const original = await store(env, source());
  const before = JSON.stringify(original);
  const preview = await previewContractRenewal(env, original.id, monthlyPeriod);
  assert.equal(preview.days, 30);
  assert.equal(preview.contractDailyRate, 65);
  assert.equal(preview.estimatedTotal, 2162);
  const { contract: renewed } = await renewContract(env, original.id, monthlyPeriod, "Edmundo");
  assert.notEqual(renewed.id, original.id);
  assert.notEqual(renewed.contractNumero, original.contractNumero);
  assert.equal(renewed.contractVersion.contractId, renewed.contractNumero);
  assert.equal(renewed.contractVersion.version, 1);
  assert.equal(renewed.contractVersion.status, "draft");
  assert.equal(renewed.renewedFromContractId, original.contractVersion.contractId);
  assert.equal(renewed.renewedFromContractNumero, original.contractNumero);
  assert.equal(renewed.conducteur.email, original.conducteur.email);
  assert.equal(renewed.permis, original.permis);
  assert.equal(renewed.vehiculeId, original.vehiculeId);
  assert.equal(renewed.tarifJournalierContractuel, 65);
  assert.equal(renewed.cautionContractuelle, 650);
  assert.equal(renewed.options.find((item) => item.id === "siege-enfant").montant, 150);
  assert.equal(renewed.options.find((item) => item.id === "livraison-adresse").montant, 20);
  assert.equal(renewed.protection.montant, 42);
  assert.equal(renewed.total, 2162);
  assert.deepEqual(renewed.financialHistory, {});
  for (const key of ["paymentId", "paidAt", "paidAmount", "paymentHistory", "depositOperations", "documentAccess", "agencyDocumentAccess", "contractAgencyAccess", "contractClientAccess", "manualClientAccess", "drivePdfFiles", "driveSync", "inspectionRevisions", "inspectionArchives", "etatDepart", "etatRetour", "kmDepart", "kmRetour", "contractExtensionPricing"]) assert.equal(key in renewed, false, key);
  assert.equal(renewed.contractDossier.signature, null);
  assert.equal(renewed.contractDossier.depart, null);
  assert.equal(renewed.contractDossier.retour, null);
  assert.equal(renewed.contractDossier.fields.permisNumero, "P123");
  assert.equal(JSON.stringify(await getReservation(env, original.id)), before);
});

test("une période occupée est refusée sans créer de contrat", async () => {
  const env = environment();
  const original = await store(env, source());
  await store(env, source({ id: "res_" + "b".repeat(32), contractNumero: "GL-20260915-0043", contractVersion: { contractId: "GL-20260915-0043", version: 1, status: "signed" }, dateDebut: "2026-09-15", heureDebut: "10:00", dateFin: "2026-09-20", heureFin: "10:00" }));
  await assert.rejects(() => renewContract(env, original.id, monthlyPeriod, "Edmundo"), (error) => error.code === "renewal_vehicle_conflict" && /déjà réservé/.test(error.message));
  assert.equal((await env.RESERVATIONS_KV.list({ prefix: "res_" })).keys.length, 2);
});

test("chaîne de quatre mois : quatre contrats indépendants sans ressaisie client", async () => {
  const env = environment();
  let current = await store(env, source());
  const contracts = [current];
  for (const end of ["2026-10-03", "2026-11-03", "2026-12-03"]) {
    const start = current.dateFin;
    const result = await renewContract(env, current.id, { start: { date: start, time: "10:00" }, end: { date: end, time: "10:00" } }, "Edmundo");
    current = result.contract;
    contracts.push(current);
    current.contractVersion.status = "signed";
    current.contractDossier.status = "signed";
    await env.RESERVATIONS_KV.put(current.id, JSON.stringify(current));
  }
  assert.equal(new Set(contracts.map((item) => item.id)).size, 4);
  assert.equal(new Set(contracts.map((item) => item.contractNumero)).size, 4);
  assert.ok(contracts.every((item) => item.conducteur.email === "jean@example.test" && item.permis === "P123"));
  assert.equal(contracts[3].renewedFromContractNumero, contracts[2].contractNumero);
});

async function login(env) {
  const response = await handleAgencyLogin(new Request("https://getlocation.fr/api/agency-login", { method: "POST", headers: { origin: "https://getlocation.fr", "cf-connecting-ip": "198.51.100.7", "content-type": "application/json" }, body: JSON.stringify({ code: "code-edmundo-1234" }) }), env);
  const body = await response.json();
  return { cookie: /agency_session=([^;]+)/.exec(response.headers.get("set-cookie"))[1], csrf: body.csrfToken };
}

function apiRequest(session, body) {
  return new Request("https://getlocation.fr/api/contracts-renewal", { method: "POST", headers: { origin: "https://getlocation.fr", cookie: `agency_session=${session.cookie}`, "x-agency-csrf": session.csrf, "content-type": "application/json" }, body: JSON.stringify(body) });
}

test("API : le total navigateur est ignoré et l'audit contract_renewed est enregistré", async () => {
  const env = environment();
  const original = await store(env, source());
  const session = await login(env);
  const response = await handleContractsRenewal(apiRequest(session, { sourceId: original.id, startDate: "2026-09-03", startTime: "10:00", endDate: "2026-10-03", endTime: "10:00", total: 1 }), env);
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal((await getReservation(env, body.id)).total, 2162);
  const event = env.AGENCY_DB._raw.auditLog.find((item) => item.event_type === "contract_renewed");
  assert.ok(event);
  assert.equal(JSON.parse(event.metadata).sourceContractNumero, original.contractNumero);
});
