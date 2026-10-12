const test = require("node:test");
const assert = require("node:assert/strict");
const { listInspectionRevisions, createInspectionRevision, revisionMediaPrefix, revisionPdfKey } = require("../src/lib/inspection-revisions.js");

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
