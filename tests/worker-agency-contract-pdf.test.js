const test = require("node:test");
const assert = require("node:assert/strict");
const { createFakeKv } = require("./helpers/fake-kv.js");
const { createFakeD1 } = require("./helpers/fake-d1.js");
const { createReservation, updateReservationStatus, setDrivePdfFile } = require("../src/lib/reservation-store.js");
const { handleAgencyLogin } = require("../src/api/agency-login.js");
const { handleAgencyContractPdf } = require("../src/api/agency-contract-pdf.js");

function env() {
  const objects = new Map();
  return {
    RESERVATIONS_KV: createFakeKv(), RATE_LIMITS_KV: createFakeKv(), AGENCY_DB: createFakeD1(),
    AGENCY_AUTH_PEPPER: "agency-test-pepper", AGENCY_CODE_EDMUNDO: "edmundo-code", AGENCY_CODE_ANTONIO: "antonio-code",
    DOCUMENTS_BUCKET: {
      async get(key) { const value = objects.get(key); return value && { body: value }; },
      _objects: objects
    }
  };
}

async function session(e) {
  const response = await handleAgencyLogin(new Request("https://getlocation.fr/api/agency-login", { method: "POST", headers: { origin: "https://getlocation.fr", "content-type": "application/json", "cf-connecting-ip": "198.51.100.1" }, body: JSON.stringify({ code: "edmundo-code" }) }), e);
  assert.equal(response.status, 200);
  return /agency_session=([^;]+)/.exec(response.headers.get("set-cookie"))[1];
}

async function createPdfContract(e, signed) {
  const record = await createReservation(e, { vehiculeId: "opel-corsa" });
  await updateReservationStatus(e, record.id, "paid", { contractNumero: "GL-20261010-0001", contractDossier: { status: signed ? "signed" : "draft" } });
  const kind = signed ? "contract-signed" : "contract-draft";
  const key = `drive-pdf/${record.id}/${kind}-v1.pdf`;
  e.DOCUMENTS_BUCKET._objects.set(key, new Uint8Array([37, 80, 68, 70]));
  await setDrivePdfFile(e, record.id, { key, sourceKey: `${kind}-v1`, kind, version: 1, immutable: signed });
  return record.id;
}

test("PDF contrat agence : lit seulement le PDF R2 de la version demandée", async () => {
  const e = env(); const cookie = await session(e); const id = await createPdfContract(e, true);
  const response = await handleAgencyContractPdf(new Request(`https://getlocation.fr/api/agency-contract-pdf?id=${id}`, { headers: { cookie: `agency_session=${cookie}` } }), e);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.match(response.headers.get("content-disposition"), /GL-20261010-0001-V1-SIGNE\.pdf/);
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [37, 80, 68, 70]);
});

test("PDF contrat agence : exige une session et ne permet pas une clé R2 dans l'URL", async () => {
  const e = env(); const id = await createPdfContract(e, false);
  const anonymous = await handleAgencyContractPdf(new Request(`https://getlocation.fr/api/agency-contract-pdf?id=${id}`), e);
  assert.equal(anonymous.status, 401);
  const cookie = await session(e);
  const altered = await handleAgencyContractPdf(new Request(`https://getlocation.fr/api/agency-contract-pdf?id=${id}&key=drive-pdf/other.pdf`, { headers: { cookie: `agency_session=${cookie}` } }), e);
  assert.equal(altered.status, 200);
  assert.match(altered.headers.get("content-disposition"), /inline/);
});

test("PDF contrat agence : signale sans ambiguïté un PDF signé historique absent", async () => {
  const e = env(); const cookie = await session(e); const record = await createReservation(e, { vehiculeId: "opel-corsa" });
  await updateReservationStatus(e, record.id, "paid", { contractNumero: "GL-OLD", contractDossier: { status: "signed" } });
  const response = await handleAgencyContractPdf(new Request(`https://getlocation.fr/api/agency-contract-pdf?id=${record.id}`, { headers: { cookie: `agency_session=${cookie}` } }), e);
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, "PDF signé historique non archivé");
});
