const test = require("node:test");
const assert = require("node:assert/strict");
const { listInspectionRevisions, createInspectionRevision, updateInspectionRevisionDraft, setRevisionMedia, setRevisionPdf, finalizeInspectionRevision, revisionMediaPrefix, revisionPdfKey } = require("../src/lib/inspection-revisions.js");
const { jobsForRecord } = require("../src/lib/google-drive-backup.js");
const { finalizeRevisionWithPdf } = require("../src/lib/finalize-inspection-revision.js");

test("EDL historique finalisé est vu comme V1 et V2 conserve V1 immuable", () => {
  const stage = { completedAt: "2026-10-12T10:00:00Z", km: 12000, signatures: { client: { signedAt: "2026-10-12T10:00:00Z" } }, marks: [{ id: "a" }] };
  const revisions = listInspectionRevisions({}, "depart", stage, [{ key: "legacy/photo.jpg" }], "Edmundo");
  assert.equal(revisions[0].revision, 1); assert.equal(revisions[0].status, "finalized");
  const created = createInspectionRevision({ inspectionRevisions: { depart: revisions } }, "depart", stage, [], "Edmundo", 1);
  assert.equal(created.revision.revision, 2); assert.equal(created.revision.status, "draft");
  assert.equal(created.revision.snapshot.signatures.client, null, "une correction exige une nouvelle signature");
  created.revision.snapshot.km = 13000;
  assert.equal(revisions[0].snapshot.km, 12000);
  assert.equal(created.revision.media[0].key, "legacy/photo.jpg", "V2 peut référencer V1 sans copie R2");
});

test("clés média et PDF des nouvelles révisions sont versionnées", () => {
  assert.equal(revisionMediaPrefix("res_x", "depart", 2, false), "inspection/res_x/depart/v2/");
  assert.equal(revisionMediaPrefix("edl_x", "retour", 3, true), "inspection-standalone/edl_x/retour/v3/");
  assert.equal(revisionPdfKey("res_x", "depart", 2, false), "inspection-pdf/res_x/depart/v2.pdf");
});

test("V1 finalisée reste profondément inchangée pendant tout le cycle V2", () => {
  const v1 = { revision: 1, status: "finalized", snapshot: { km: 100, marks: [{ id: "a" }], signatures: { client: { name: "A", signedAt: "2026-01-01T10:00:00Z" }, agence: { name: "B", signedAt: "2026-01-01T10:01:00Z" } } }, media: [{ key: "legacy/A.jpg" }], pdfKey: "legacy/v1.pdf" };
  const document = { inspectionRevisions: { depart: [v1] } };
  const before = JSON.parse(JSON.stringify(v1));
  const created = createInspectionRevision(document, "depart", null, null, "agent", 1);
  const changed = updateInspectionRevisionDraft({ inspectionRevisions: created.inspectionRevisions }, "depart", null, null, "agent", 2, { ...created.revision.snapshot, km: 150, signatures: { client: { name: "C", signedAt: "2026-01-02T10:00:00Z" }, agence: { name: "D", signedAt: "2026-01-02T10:01:00Z" } } });
  const media = setRevisionMedia({ inspectionRevisions: changed.inspectionRevisions }, "depart", null, null, "agent", 2, [{ key: "inspection/x/depart/v2/B.jpg" }]);
  const pdf = setRevisionPdf({ inspectionRevisions: media.inspectionRevisions }, "depart", null, null, "agent", 2, "inspection-pdf/x/depart/v2.pdf");
  const finalized = finalizeInspectionRevision({ inspectionRevisions: pdf.inspectionRevisions }, "depart", null, null, "agent", 2);
  assert.equal(finalized.revision.status, "finalized");
  assert.deepEqual(finalized.inspectionRevisions.depart[0], before);
  assert.deepEqual(document.inspectionRevisions.depart[0], before);
});

test("Drive crée des sources et noms distincts pour chaque révision EDL", () => {
  const jobs = jobsForRecord({ id: "res_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", contractNumero: "GL-1", contractVersion: { version: 1 }, inspectionRevisions: { depart: [
    { revision: 1, status: "finalized", pdfKey: "inspection-pdf/x/depart/v1.pdf", media: [{ key: "legacy/a.jpg", slot: "avant", contentType: "image/jpeg" }] },
    { revision: 2, status: "finalized", pdfKey: "inspection-pdf/x/depart/v2.pdf", media: [{ key: "inspection/x/depart/v2/b.jpg", slot: "avant", contentType: "image/jpeg" }] }
  ] } });
  assert.ok(jobs.some(job => job.sourceKey.endsWith("edl-depart-r1:pdf") && /EDL-DEPART-V1/.test(job.filename)));
  assert.ok(jobs.some(job => job.sourceKey.endsWith("edl-depart-r2:pdf") && /EDL-DEPART-V2/.test(job.filename)));
  assert.equal(new Set(jobs.map(job => job.sourceKey)).size, jobs.length);
});

test("finalisation serveur archive le PDF avant de finaliser, sans toucher V1", async () => {
  const v1 = { revision: 1, status: "finalized", snapshot: { km: 1, signatures: { client: { signedAt: "a" }, agence: { signedAt: "b" } } }, media: [], pdfKey: "v1.pdf" }, v1Before = JSON.parse(JSON.stringify(v1));
  const v2 = { revision: 2, status: "draft", snapshot: { km: 2, signatures: { client: { name: "C", signedAt: "a" }, agence: { name: "A", signedAt: "b" } } }, media: [], pdfKey: null };
  const put = new Map(), env = { DOCUMENTS_BUCKET: { async put(key, value) { put.set(key, value); } } };
  const out = await finalizeRevisionWithPdf({ env, record: { id: "res_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", inspectionRevisions: { depart: [v1, v2] } }, stage: "depart", revision: 2, snapshot: v2.snapshot, fallbackSnapshot: null, fallbackMedia: [], standalone: false });
  assert.equal(out.revision.status, "finalized"); assert.ok(out.revision.pdfKey); assert.ok(put.has(out.revision.pdfKey)); assert.deepEqual(out.inspectionRevisions.depart[0], v1Before);
});

test("échec R2 conserve la révision au brouillon", async () => {
  const v2 = { revision: 2, status: "draft", snapshot: { signatures: { client: { signedAt: "a" }, agence: { signedAt: "b" } } }, media: [], pdfKey: null };
  await assert.rejects(() => finalizeRevisionWithPdf({ env: { DOCUMENTS_BUCKET: { async put() { throw new Error("R2 indisponible"); } } }, record: { id: "res_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", inspectionRevisions: { depart: [v2] } }, stage: "depart", revision: 2, snapshot: v2.snapshot, fallbackSnapshot: null, fallbackMedia: [], standalone: false }), /R2 indisponible/);
  assert.equal(v2.status, "draft"); assert.equal(v2.pdfKey, null);
});
