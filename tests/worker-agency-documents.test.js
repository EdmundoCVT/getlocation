const test = require("node:test");
const assert = require("node:assert/strict");
const { createFakeKv } = require("./helpers/fake-kv.js");
const { createReservation, updateReservationStatus, saveAgencyDocumentAccessIndex } = require("../src/lib/reservation-store.js");
const { issueAgencyDocumentAccess, hashAgencyDocumentToken } = require("../src/lib/agency-document-token.js");
const { handleAgencyDocumentsAccess } = require("../src/api/agency-documents-access.js");
const { handleAgencyDocumentFile } = require("../src/api/agency-document-file.js");

const PEPPER = "agency-pepper-de-test";

function env() {
  const objects = new Map();
  return {
    RESERVATIONS_KV: createFakeKv(),
    RATE_LIMITS_KV: createFakeKv(),
    DOCUMENT_TOKEN_PEPPER: PEPPER,
    DOCUMENTS_BUCKET: {
      objects,
      async get(key) { return objects.get(key) || null; }
    }
  };
}

async function setup(e) {
  const reservation = await createReservation(e, { vehiculeId: "opel-corsa", periodeDebut: new Date(Date.now() + 86400000).toISOString(), periodeFin: new Date(Date.now() + 172800000).toISOString() });
  const issued = await issueAgencyDocumentAccess(e);
  const key = `reservations/${reservation.id}/identite/test`;
  e.DOCUMENTS_BUCKET.objects.set(key, { body: new Uint8Array([0xff, 0xd8, 0xff, 0x00]) });
  await updateReservationStatus(e, reservation.id, "paid", {
    documentsStatus: "submitted",
    documentsSubmittedAt: new Date().toISOString(),
    agencyDocumentAccess: issued.stored,
    documentFiles: [{ key, type: "identite", contentType: "image/jpeg", size: 4 }]
  });
  await saveAgencyDocumentAccessIndex(e, reservation.id, issued.stored.tokenHash, issued.stored.expiresAt);
  return issued.token;
}

function request(path, token) {
  return new Request(`https://getlocation.fr${path}`, { headers: { Authorization: `Bearer ${token}`, "cf-connecting-ip": "198.51.100.91" } });
}

test("le jeton agence est distinct et seule son empreinte est indexée", async () => {
  const e = env();
  const token = await setup(e);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  const hash = await hashAgencyDocumentToken(token, PEPPER);
  assert.equal(e.RESERVATIONS_KV._raw.has(`agency_doc_${hash}`), true);
  assert.equal([...e.RESERVATIONS_KV._raw.keys()].some((key) => key.includes(token)), false);
});

test("le lien agence expose seulement la liste minimale des pièces", async () => {
  const e = env();
  const token = await setup(e);
  const response = await handleAgencyDocumentsAccess(request("/api/agency-documents-access", token), e);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.files.length, 1);
  assert.deepEqual(body.files[0], { id: "0", type: "identite", contentType: "image/jpeg", size: 4 });
  assert.equal(JSON.stringify(body).includes("reservations/"), false);
});

test("le téléchargement diffuse uniquement le fichier autorisé", async () => {
  const e = env();
  const token = await setup(e);
  const response = await handleAgencyDocumentFile(request("/api/agency-document-file?file=0", token), e);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/jpeg");
  assert.match(response.headers.get("content-disposition"), /^attachment;/);
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [0xff, 0xd8, 0xff, 0x00]);
});

test("un jeton absent ou faux ne permet ni liste ni téléchargement", async () => {
  const e = env();
  await setup(e);
  const fake = "A".repeat(43);
  assert.equal((await handleAgencyDocumentsAccess(request("/api/agency-documents-access", fake), e)).status, 401);
  assert.equal((await handleAgencyDocumentFile(request("/api/agency-document-file?file=0", fake), e)).status, 401);
});
