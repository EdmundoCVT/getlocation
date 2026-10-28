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
    objects,
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
  const stored = JSON.parse(await e.RESERVATIONS_KV.get(reservation.id));
  stored.contractDossier = { depart: {}, retour: {}, media: { depart: [], retour: [] } };
  stored.inspectionRevisions = { depart: [{ revision: 1, status: "draft", snapshot: {}, media: [], pdfKey: null }] };
  await e.RESERVATIONS_KV.put(reservation.id, JSON.stringify(stored));
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
  form.append("revision", "1");
  form.append("slot", "avant");
  form.append("capturedAt", "2026-10-01T09:45");
  form.append("file", new Blob(["image"], { type: "image/jpeg" }), "avant.jpg");
  const uploaded = await handleInspectionMedia(request("https://getlocation.fr/api/inspection-media", token, { method: "POST", body: form }), e);
  assert.equal(uploaded.status, 200);
  const created = (await uploaded.json()).item;
  assert.equal(created.capturedAt, "2026-10-01T09:45");
  assert.match(created.createdAt, /^\d{4}-\d{2}-\d{2}T/);

  const changed = await handleInspectionMedia(request("https://getlocation.fr/api/inspection-media", token, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: created.key, stage: "depart", revision: 1, capturedAt: "2026-10-01T10:05" })
  }), e);
  assert.equal(changed.status, 200);
  const updated = (await changed.json()).item;
  assert.equal(updated.createdAt, created.createdAt, "l'horodatage d'import serveur ne change jamais");
  assert.equal(updated.capturedAt, "2026-10-01T10:05");

  const stored = JSON.parse(await e.RESERVATIONS_KV.get(reservationId));
  assert.equal(stored.inspectionRevisions.depart[0].media[0].createdAt, created.createdAt);
  assert.equal(stored.inspectionRevisions.depart[0].media[0].capturedAt, "2026-10-01T10:05", "la date métier est conservée après rechargement");
});

test("photo inspection : conserve l’original, sert la copie optimisée et persiste leurs métadonnées", async () => {
  const e = env();
  const { reservationId, token } = await setup(e);
  const form = new FormData();
  form.set("stage", "depart"); form.set("revision", "1"); form.set("slot", "dommage");
  form.set("file", new File(["ORIGINAL-6MO"], "preuve.heic", { type: "image/heic" }));
  form.set("optimizedFile", new File(["JPEG-OPTIMISE"], "preuve-pdf.jpg", { type: "image/jpeg" }));
  form.set("originalWidth", "4032"); form.set("originalHeight", "3024"); form.set("optimizedWidth", "1920"); form.set("optimizedHeight", "1440");
  const response = await handleInspectionMedia(request("https://getlocation.fr/api/inspection-media", token, { method: "POST", body: form }), e);
  assert.equal(response.status, 200);
  const item = (await response.json()).item;
  assert.match(item.key, /\.heic$/); assert.match(item.optimizedKey, /-pdf\.jpg$/);
  assert.equal(item.size, 12); assert.equal(item.optimizedSize, 13);
  assert.deepEqual([item.originalWidth, item.originalHeight, item.optimizedWidth, item.optimizedHeight], [4032, 3024, 1920, 1440]);
  assert.ok(e.DOCUMENTS_BUCKET.objects.has(item.key)); assert.ok(e.DOCUMENTS_BUCKET.objects.has(item.optimizedKey));
  const preview = await handleInspectionMedia(request(`https://getlocation.fr/api/inspection-media?key=${encodeURIComponent(item.key)}`, token), e);
  assert.equal(await preview.text(), "JPEG-OPTIMISE", "l’aperçu privé choisit le dérivé");
  const original = await handleInspectionMedia(request(`https://getlocation.fr/api/inspection-media?key=${encodeURIComponent(item.key)}&variant=original`, token), e);
  assert.equal(await original.text(), "ORIGINAL-6MO", "l’original reste accessible avec authentification");
  const stored = JSON.parse(await e.RESERVATIONS_KV.get(reservationId));
  assert.equal(stored.inspectionRevisions.depart[0].media[0].optimizedKey, item.optimizedKey);
});

test("photo inspection : un média historique sans optimizedKey continue de servir son original", async () => {
  const e = env(); const { reservationId, token } = await setup(e);
  const key = `inspection/${reservationId}/depart/v1/legacy.jpg`;
  e.DOCUMENTS_BUCKET.objects.set(key, { body: new TextEncoder().encode("LEGACY"), options: { httpMetadata: { contentType: "image/jpeg" } } });
  const stored = JSON.parse(await e.RESERVATIONS_KV.get(reservationId)); stored.inspectionRevisions.depart[0].media = [{ key, slot: "avant", contentType: "image/jpeg" }]; await e.RESERVATIONS_KV.put(reservationId, JSON.stringify(stored));
  const response = await handleInspectionMedia(request(`https://getlocation.fr/api/inspection-media?key=${encodeURIComponent(key)}`, token), e);
  assert.equal(response.status, 200); assert.equal(await response.text(), "LEGACY");
});

test("photo inspection : une ancienne photo sans capturedAt reste compatible", async () => {
  const e = env();
  const { reservationId, token } = await setup(e);
  const stored = JSON.parse(await e.RESERVATIONS_KV.get(reservationId));
  delete stored.inspectionRevisions;
  stored.contractDossier = { depart: {}, media: { depart: [{ key: `inspection/${reservationId}/depart/legacy.jpg`, slot: "avant", contentType: "image/jpeg", size: 1, createdAt: "2026-09-01T08:00:00.000Z" }], retour: [] } };
  await e.RESERVATIONS_KV.put(reservationId, JSON.stringify(stored));

  const changed = await handleInspectionMedia(request("https://getlocation.fr/api/inspection-media", token, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: `inspection/${reservationId}/depart/legacy.jpg`, stage: "depart", revision: 1, capturedAt: "2026-09-01T07:55" })
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
  form.append("revision", "1");
  const response = await handleInspectionMedia(request("https://getlocation.fr/api/inspection-media", token, { method: "POST", body: form }), e);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).item.slot, "tableau-de-bord");
});

test("photo inspection : V2 draft est modifiable mais V1 finalisée renvoie 409", async () => {
  const e = env();
  const { reservationId, token } = await setup(e);
  const stored = JSON.parse(await e.RESERVATIONS_KV.get(reservationId));
  const v1 = { revision: 1, status: "finalized", snapshot: {}, media: [{ key: `inspection/${reservationId}/depart/v1.jpg`, slot: "avant", createdAt: "2026-10-01T09:00:00.000Z" }] };
  const v2 = { revision: 2, status: "draft", snapshot: {}, media: [{ key: `inspection/${reservationId}/depart/v2.jpg`, slot: "avant", createdAt: "2026-10-02T09:00:00.000Z" }] };
  stored.inspectionRevisions = { depart: [v1, v2] };
  await e.RESERVATIONS_KV.put(reservationId, JSON.stringify(stored));
  const finalized = await handleInspectionMedia(request("https://getlocation.fr/api/inspection-media", token, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: v1.media[0].key, stage: "depart", revision: 1, capturedAt: "2026-10-01T10:00" }) }), e);
  assert.equal(finalized.status, 409);
  const changed = await handleInspectionMedia(request("https://getlocation.fr/api/inspection-media", token, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: v2.media[0].key, stage: "depart", revision: 2, capturedAt: "2026-10-02T10:00" }) }), e);
  assert.equal(changed.status, 200);
  const persisted = JSON.parse(await e.RESERVATIONS_KV.get(reservationId));
  assert.equal(persisted.inspectionRevisions.depart[1].media[0].createdAt, v2.media[0].createdAt);
  assert.equal(persisted.inspectionRevisions.depart[1].media[0].capturedAt, "2026-10-02T10:00");
});

test("photo inspection liée : une photo V5 utilise la clé et les médias de V5 uniquement", async () => {
  const e = env();
  const { reservationId, token } = await setup(e);
  const stored = JSON.parse(await e.RESERVATIONS_KV.get(reservationId));
  stored.inspectionRevisions = { depart: [1, 2, 3, 4, 5].map((revision) => ({ revision, status: revision === 5 ? "draft" : "finalized", snapshot: {}, media: [{ key: `inspection/${reservationId}/depart/v${revision}/historique.jpg`, slot: "avant" }], pdfKey: revision === 5 ? null : `v${revision}.pdf` })) };
  await e.RESERVATIONS_KV.put(reservationId, JSON.stringify(stored));
  const form = new FormData(); form.set("stage", "depart"); form.set("revision", "5"); form.set("slot", "avant"); form.set("capturedAt", "2026-10-13T12:00"); form.set("file", new File(["image-v5"], "v5.jpg", { type: "image/jpeg" }));
  const response = await handleInspectionMedia(request("https://getlocation.fr/api/inspection-media", token, { method: "POST", body: form }), e);
  assert.equal(response.status, 200); assert.match(response.headers.get("content-type"), /application\/json/);
  const photo = (await response.json()).item; assert.match(photo.key, /\/depart\/v5\//);
  const changed = await handleInspectionMedia(request("https://getlocation.fr/api/inspection-media", token, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: photo.key, stage: "depart", revision: 5, capturedAt: "2026-10-13T12:30" }) }), e);
  assert.equal(changed.status, 200); assert.equal((await changed.json()).item.capturedAt, "2026-10-13T12:30");
  const inherited = `inspection/${reservationId}/depart/v5/historique.jpg`;
  const removed = await handleInspectionMedia(request("https://getlocation.fr/api/inspection-media", token, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: inherited, stage: "depart", revision: 5 }) }), e);
  assert.equal(removed.status, 200);
  const persisted = JSON.parse(await e.RESERVATIONS_KV.get(reservationId));
  assert.equal(persisted.inspectionRevisions.depart[3].media.length, 1, "V4 reste inchangée");
  assert.equal(persisted.inspectionRevisions.depart[4].media.length, 1, "V5 peut retirer son héritage sans toucher V4");
  assert.equal(persisted.inspectionRevisions.depart[4].media[0].capturedAt, "2026-10-13T12:30");
});

test("photo inspection liée : retirer un média partagé de V2 conserve V1, V3 et l'objet R2", async () => {
  const e = env();
  const { reservationId, token } = await setup(e);
  const sharedKey = `inspection/${reservationId}/depart/v1/shared.jpg`;
  await e.DOCUMENTS_BUCKET.put(sharedKey, new Uint8Array([1, 2, 3]), { httpMetadata: { contentType: "image/jpeg" } });
  const stored = JSON.parse(await e.RESERVATIONS_KV.get(reservationId));
  const shared = { key: sharedKey, slot: "avant", createdAt: "2026-10-01T09:00:00.000Z" };
  stored.inspectionRevisions = { depart: [
    { revision: 1, status: "finalized", snapshot: {}, media: [shared], pdfKey: "v1.pdf" },
    { revision: 2, status: "draft", snapshot: {}, media: [shared], pdfKey: null, basedOnRevision: 1 },
    { revision: 3, status: "draft", snapshot: {}, media: [shared], pdfKey: null, basedOnRevision: 1 }
  ] };
  await e.RESERVATIONS_KV.put(reservationId, JSON.stringify(stored));

  const removed = await handleInspectionMedia(request("https://getlocation.fr/api/inspection-media", token, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: sharedKey, stage: "depart", revision: 2 }) }), e);
  assert.equal(removed.status, 200);
  const persisted = JSON.parse(await e.RESERVATIONS_KV.get(reservationId));
  assert.deepEqual(persisted.inspectionRevisions.depart.map(item => item.media.map(media => media.key)), [[sharedKey], [], [sharedKey]]);
  assert.ok(e.DOCUMENTS_BUCKET.objects.has(sharedKey), "un retrait logique ne supprime jamais le blob partagé");
});

test("photo inspection liée : les uploads ciblent explicitement V2, V3, V4 et V5", async () => {
  for (const revision of [2, 3, 4, 5]) {
    const e = env(); const { reservationId, token } = await setup(e);
    const stored = JSON.parse(await e.RESERVATIONS_KV.get(reservationId));
    stored.inspectionRevisions = { depart: Array.from({ length: revision }, (_, index) => ({ revision: index + 1, status: index + 1 === revision ? "draft" : "finalized", snapshot: {}, media: [], pdfKey: index + 1 === revision ? null : `v${index + 1}.pdf` })) };
    await e.RESERVATIONS_KV.put(reservationId, JSON.stringify(stored));
    const form = new FormData(); form.set("stage", "depart"); form.set("revision", String(revision)); form.set("slot", "dommage"); form.set("file", new File([`v${revision}`], `v${revision}.jpg`, { type: "image/jpeg" }));
    const response = await handleInspectionMedia(request("https://getlocation.fr/api/inspection-media", token, { method: "POST", body: form }), e);
    assert.equal(response.status, 200, `upload lié V${revision}`);
    assert.match((await response.json()).item.key, new RegExp(`/depart/v${revision}/`));
  }
});
