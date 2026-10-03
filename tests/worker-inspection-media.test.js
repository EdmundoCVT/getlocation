const test = require("node:test");
const assert = require("node:assert/strict");

const { createFakeKv } = require("./helpers/fake-kv.js");
const { createReservation, updateReservationStatus, saveContractAgencyAccessIndex } = require("../src/lib/reservation-store.js");
const { issueContractAgencyAccess } = require("../src/lib/contract-dossier-token.js");
const { handleInspectionMedia } = require("../src/api/inspection-media.js");

const PEPPER = "pepper-test-inspection-media";
let ip = 20;

function fakeBucket() {
  const objects = new Map();
  return {
    async put(key, body, options = {}) { objects.set(key, { body, options }); },
    async get(key) {
      const value = objects.get(key);
      if (!value) return null;
      return { body: new Blob([value.body]).stream(), writeHttpMetadata(headers) { headers.set("content-type", value.options.httpMetadata.contentType); } };
    },
    async delete(key) { objects.delete(key); }
  };
}

function env() {
  return { RESERVATIONS_KV: createFakeKv(), RATE_LIMITS_KV: createFakeKv(), DOCUMENT_TOKEN_PEPPER: PEPPER, DOCUMENTS_BUCKET: fakeBucket() };
}

async function setup(e) {
  const reservation = await createReservation(e, {
    vehiculeId: "opel-corsa", dateDebut: "2026-10-01", heureDebut: "10:00", dateFin: "2026-10-03", heureFin: "10:00", total: 90,
    conducteur: { nom: "Zvezdan", prenom: "Test", email: "z@example.com", telephone: "0600000000" }
  });
  const issued = await issueContractAgencyAccess(e, reservation, new Date().toISOString());
  await updateReservationStatus(e, reservation.id, "paid", { contractAgencyAccess: issued.stored });
  await saveContractAgencyAccessIndex(e, reservation.id, issued.stored.tokenHash, issued.stored.expiresAt);
  return { reservationId: reservation.id, token: issued.token };
}

function request(url, token, options = {}) {
  ip += 1;
  return new Request(url, { ...options, headers: { Authorization: `Bearer ${token}`, "cf-connecting-ip": `198.51.100.${ip}`, ...(options.headers || {}) } });
}

test("photo inspection : createdAt reste immuable et capturedAt est modifiable puis persistant", async () => {
  const e = env();
  const { reservationId, token } = await setup(e);
  const form = new FormData();
  form.append("stage", "depart");
  form.append("slot", "avant");
  form.append("capturedAt", "2026-10-01T09:45");
  form.append("file", new Blob(["image"], { type: "image/jpeg" }), "avant.jpg");
  const uploaded = await handleInspectionMedia(request("https://getlocation.fr/api/inspection-media", token, { method: "POST", body: form }), e);
  assert.equal(uploaded.status, 200);
  const created = (await uploaded.json()).item;
  assert.equal(created.capturedAt, "2026-10-01T09:45");
  assert.match(created.createdAt, /^\d{4}-\d{2}-\d{2}T/);

  const changed = await handleInspectionMedia(request("https://getlocation.fr/api/inspection-media", token, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: created.key, capturedAt: "2026-10-01T10:05" })
  }), e);
  assert.equal(changed.status, 200);
  const updated = (await changed.json()).item;
  assert.equal(updated.createdAt, created.createdAt, "l'horodatage d'import serveur ne change jamais");
  assert.equal(updated.capturedAt, "2026-10-01T10:05");

  const stored = JSON.parse(await e.RESERVATIONS_KV.get(reservationId));
  assert.equal(stored.contractDossier.media.depart[0].createdAt, created.createdAt);
  assert.equal(stored.contractDossier.media.depart[0].capturedAt, "2026-10-01T10:05", "la date métier est conservée après rechargement");
});

test("photo inspection : une ancienne photo sans capturedAt reste compatible", async () => {
  const e = env();
  const { reservationId, token } = await setup(e);
  const stored = JSON.parse(await e.RESERVATIONS_KV.get(reservationId));
  stored.contractDossier = { media: { depart: [{ key: `inspection/${reservationId}/depart/legacy.jpg`, slot: "avant", contentType: "image/jpeg", size: 1, createdAt: "2026-09-01T08:00:00.000Z" }], retour: [] } };
  await e.RESERVATIONS_KV.put(reservationId, JSON.stringify(stored));

  const changed = await handleInspectionMedia(request("https://getlocation.fr/api/inspection-media", token, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: `inspection/${reservationId}/depart/legacy.jpg`, capturedAt: "2026-09-01T07:55" })
  }), e);
  assert.equal(changed.status, 200);
  const updated = (await changed.json()).item;
  assert.equal(updated.createdAt, "2026-09-01T08:00:00.000Z");
  assert.equal(updated.capturedAt, "2026-09-01T07:55");
});

test("photo inspection : le tableau de bord est un emplacement compatible avec les médias existants", async () => {
  const e = env();
  const { token } = await setup(e);
  const form = new FormData();
  form.append("stage", "depart"); form.append("slot", "tableau-de-bord"); form.append("capturedAt", "2026-10-01T09:45"); form.append("file", new Blob(["image"], { type: "image/jpeg" }), "dashboard.jpg");
  const response = await handleInspectionMedia(request("https://getlocation.fr/api/inspection-media", token, { method: "POST", body: form }), e);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).item.slot, "tableau-de-bord");
});
