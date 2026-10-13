const test = require("node:test");
const assert = require("node:assert/strict");
const { createFakeKv } = require("./helpers/fake-kv.js");
const { makeAgencyEnv, loginAgency, agencyRequest } = require("./helpers/agency-session.js");
const { createReservation } = require("../src/lib/reservation-store.js");
const { handleAgencyInspectionArchive } = require("../src/api/agency-inspection-archive.js");
const { handleStandaloneInspections } = require("../src/api/standalone-inspections.js");

test("archivage EDL lié : isole une phase sans toucher aux révisions, puis restaure", async () => {
  const env = makeAgencyEnv({ RESERVATIONS_KV: createFakeKv() });
  const session = await loginAgency(env);
  const reservation = await createReservation(env, { vehiculeId: "opel-corsa", dateDebut: "2026-10-01", heureDebut: "10:00", dateFin: "2026-10-02", heureFin: "10:00", conducteur: { nom: "Test", prenom: "Archive" } });
  const stored = JSON.parse(await env.RESERVATIONS_KV.get(reservation.id));
  stored.inspectionRevisions = { depart: [{ revision: 1, status: "finalized", snapshot: {}, media: [], pdfKey: "inspection-pdf/test.pdf" }] };
  await env.RESERVATIONS_KV.put(reservation.id, JSON.stringify(stored));
  const archive = await handleAgencyInspectionArchive(agencyRequest("https://getlocation.fr/api/agency-inspection-archive", { method: "POST", session, body: { id: reservation.id, stage: "depart", archived: true } }), env);
  assert.equal(archive.status, 200);
  const archived = JSON.parse(await env.RESERVATIONS_KV.get(reservation.id));
  assert.ok(archived.inspectionArchives.depart.archivedAt);
  assert.equal(archived.inspectionRevisions.depart[0].pdfKey, "inspection-pdf/test.pdf");
  const restore = await handleAgencyInspectionArchive(agencyRequest("https://getlocation.fr/api/agency-inspection-archive", { method: "POST", session, body: { id: reservation.id, stage: "depart", archived: false } }), env);
  assert.equal(restore.status, 200);
  assert.equal(JSON.parse(await env.RESERVATIONS_KV.get(reservation.id)).inspectionArchives.depart, undefined);
});

test("archivage EDL indépendant : la liste expose puis retire uniquement l'état administratif", async () => {
  const env = makeAgencyEnv({ RESERVATIONS_KV: createFakeKv() });
  const session = await loginAgency(env);
  const created = await handleStandaloneInspections(agencyRequest("https://getlocation.fr/api/standalone-inspections", { method: "POST", session, body: { action: "create", mode: "depart", client: { prenom: "Archive", nom: "Test" }, vehicule: { nom: "Toyota Proace" } } }), env);
  const inspection = (await created.json()).inspection;
  const archive = await handleStandaloneInspections(agencyRequest("https://getlocation.fr/api/standalone-inspections", { method: "POST", session, body: { action: "set-archived", id: inspection.id, archived: true } }), env);
  assert.equal(archive.status, 200);
  const listed = await handleStandaloneInspections(agencyRequest("https://getlocation.fr/api/standalone-inspections", { session }), env);
  assert.ok((await listed.json()).inspections[0].archivedAt);
  const restore = await handleStandaloneInspections(agencyRequest("https://getlocation.fr/api/standalone-inspections", { method: "POST", session, body: { action: "set-archived", id: inspection.id, archived: false } }), env);
  assert.equal(restore.status, 200);
  const record = JSON.parse(await env.RESERVATIONS_KV.get("standalone-inspection:" + inspection.id));
  assert.equal(record.archivedAt, undefined);
  assert.equal(record.inspectionRevisions.depart[0].revision, 1);
});

test("archivage historique lié : conserve un marqueur séparé quand aucune réservation KV n'existe", async () => {
  const env = makeAgencyEnv({ RESERVATIONS_KV: createFakeKv() });
  const session = await loginAgency(env);
  const id = "rnt_historique_001";
  const archived = await handleAgencyInspectionArchive(agencyRequest("https://getlocation.fr/api/agency-inspection-archive", { method: "POST", session, body: { id, stage: "retour", archived: true } }), env);
  assert.equal(archived.status, 200);
  assert.ok(JSON.parse(await env.RESERVATIONS_KV.get(`inspection-archive:${id}:retour`)).archivedAt);
  const restored = await handleAgencyInspectionArchive(agencyRequest("https://getlocation.fr/api/agency-inspection-archive", { method: "POST", session, body: { id, stage: "retour", archived: false } }), env);
  assert.equal(restored.status, 200);
  assert.equal(await env.RESERVATIONS_KV.get(`inspection-archive:${id}:retour`), null);
});
