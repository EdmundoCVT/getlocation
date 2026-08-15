// tests/worker-documents-submit-size-limit.test.js
//
// Vérifie que la limite de taille de requête (documents-submit.js) est
// réellement appliquée par comptage d'octets en flux (read-bounded-body.js)
// et non uniquement via l'en-tête Content-Length, qui peut être absent ou
// mensonger (Transfer-Encoding: chunked) — voir la revue de sécurité des
// PR #3-8 (finding "faible").

const test = require("node:test");
const assert = require("node:assert/strict");
const { createFakeKv } = require("./helpers/fake-kv.js");
const { handleDocumentsSubmit } = require("../src/api/documents-submit.js");
const { createReservation, updateReservationStatus, saveDocumentAccessIndex } = require("../src/lib/reservation-store.js");
const { issueDocumentAccess } = require("../src/lib/document-access-token.js");

const PEPPER = "size-limit-pepper-de-test";
const MAX_REQUEST_BYTES = 52 * 1024 * 1024;

function bucket() {
  const objects = new Map();
  return {
    objects,
    async put(k, b, o) { objects.set(k, { b, o }); },
    async get(k) { return objects.get(k) || null; },
    async delete(k) { objects.delete(k); }
  };
}
function env() {
  return { RESERVATIONS_KV: createFakeKv(), RATE_LIMITS_KV: createFakeKv(), DOCUMENT_TOKEN_PEPPER: PEPPER, DOCUMENTS_BUCKET: bucket() };
}
function jpeg() {
  return new File([new Uint8Array([0xff, 0xd8, 0xff, 0x00])], "permis.jpg", { type: "image/jpeg" });
}
function validForm() {
  const data = new FormData();
  data.set("birthDate", "1990-01-01");
  data.set("postalAddress", "12 rue Test, Grasse");
  data.set("permitNumber", "AB12345");
  data.set("permitDate", "2015-01-01");
  data.set("permis-recto", jpeg());
  data.set("permis-verso", jpeg());
  data.set("identite", jpeg());
  return data;
}
async function setup(e) {
  const start = new Date(Date.now() + 5 * 86400000);
  const end = new Date(Date.now() + 6 * 86400000);
  const reservation = await createReservation(e, {
    vehiculeId: "opel-corsa",
    periodeDebut: start.toISOString(),
    periodeFin: end.toISOString(),
    conducteur: { naissance: "1990-01-01" },
    options: []
  });
  const issued = await issueDocumentAccess(e, reservation, new Date().toISOString());
  const paid = await updateReservationStatus(e, reservation.id, "paid", { documentsStatus: "pending", documentAccess: issued.stored });
  await saveDocumentAccessIndex(e, paid.id, issued.stored.tokenHash, issued.stored.expiresAt);
  return { paid, token: issued.token };
}

test("requête sans Content-Length mais de taille légitime : traitée normalement", async () => {
  const e = env();
  const { token } = await setup(e);
  const request = new Request("https://getlocation.fr/api/documents-submit", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "cf-connecting-ip": "198.51.100.10" },
    body: validForm()
  });
  // Sanity check : on vérifie bien qu'on teste le cas "sans Content-Length"
  // et pas un artefact d'implémentation du runtime de test.
  assert.equal(request.headers.get("content-length"), null);

  const response = await handleDocumentsSubmit(request, e);
  assert.equal(response.status, 200);
  assert.equal(e.DOCUMENTS_BUCKET.objects.size, 3);
});

test("requête sans Content-Length et réellement trop volumineuse : rejetée, aucune écriture R2", async () => {
  const e = env();
  const { token } = await setup(e);
  const oversized = new Uint8Array(MAX_REQUEST_BYTES + 1024 * 1024); // +1 Mo au-delà de la limite
  const request = new Request("https://getlocation.fr/api/documents-submit", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "cf-connecting-ip": "198.51.100.11",
      "content-type": "multipart/form-data; boundary=----test"
    },
    body: oversized
  });
  assert.equal(request.headers.get("content-length"), null);

  const response = await handleDocumentsSubmit(request, e);
  assert.equal(response.status, 413);
  assert.equal(e.DOCUMENTS_BUCKET.objects.size, 0);
});

test("Content-Length mensonger (annonce un corps petit, corps réellement trop volumineux) : rejetée, aucune écriture R2", async () => {
  const e = env();
  const { token } = await setup(e);
  const oversized = new Uint8Array(MAX_REQUEST_BYTES + 1024 * 1024);
  const request = new Request("https://getlocation.fr/api/documents-submit", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "cf-connecting-ip": "198.51.100.12",
      "content-type": "multipart/form-data; boundary=----test",
      "content-length": "10"
    },
    body: oversized
  });

  const response = await handleDocumentsSubmit(request, e);
  assert.equal(response.status, 413);
  assert.equal(e.DOCUMENTS_BUCKET.objects.size, 0);
});

test("Content-Length correct et réellement trop volumineux : rejetée par le filtre rapide, aucune écriture R2", async () => {
  const e = env();
  const { token } = await setup(e);
  const size = MAX_REQUEST_BYTES + 1024 * 1024;
  const oversized = new Uint8Array(size);
  const request = new Request("https://getlocation.fr/api/documents-submit", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "cf-connecting-ip": "198.51.100.13",
      "content-type": "multipart/form-data; boundary=----test",
      "content-length": String(size)
    },
    body: oversized
  });

  const response = await handleDocumentsSubmit(request, e);
  assert.equal(response.status, 413);
  assert.equal(e.DOCUMENTS_BUCKET.objects.size, 0);
});
