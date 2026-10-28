const test = require("node:test");
const assert = require("node:assert/strict");

const { jobsForRecord, driveFolderPlan, inspectionManifest, getDriveRecord, enqueueDriveSync } = require("../src/lib/google-drive-backup.js");
const { createFakeKv } = require("./helpers/fake-kv.js");

function media(revision, count, inherited = []) {
  return [...inherited, ...Array.from({ length: count }, (_, index) => ({
    key: `inspection/res_demo/depart/v${revision}/original-${index + 1}.jpg`,
    optimizedKey: `inspection/res_demo/depart/v${revision}/original-${index + 1}-pdf.jpg`,
    originalName: `IMG_${revision}_${index + 1}.JPG`,
    slot: index % 2 ? "dommage" : "avant",
    capturedAt: `2026-10-${String(index + 1).padStart(2, "0")}T10:00`,
    createdAt: `2026-10-${String(index + 1).padStart(2, "0")}T10:01:00.000Z`,
    contentType: "image/jpeg",
    size: 1024 + index
  }))];
}

function realisticRecord({ standalone = false } = {}) {
  const v1Media = media(1, 12);
  const v2Media = media(2, 2, v1Media);
  return {
    id: standalone ? "edl_aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa" : "res_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ...(standalone ? { kind: "standalone-inspection", mode: "depart", client: { prenom: "Jeanne", nom: "Martin" }, vehicule: { nom: "Toyota Proace", immatriculation: "AA-123-AA" } } : { contractNumero: "GL-20261028-0001", contractVersion: { version: 1 }, conducteur: { prenom: "Jeanne", nom: "Martin" }, vehicule: { nom: "Toyota Proace", immatriculation: "AA-123-AA" } }),
    createdAt: "2026-10-28T10:00:00.000Z",
    inspectionRevisions: { depart: [
      { revision: 1, status: "finalized", snapshot: {}, media: v1Media, pdfKey: "inspection-pdf/res_demo/depart/v1.pdf", finalizedAt: "2026-10-28T11:00:00.000Z" },
      { revision: 2, status: "finalized", basedOnRevision: 1, snapshot: {}, media: v2Media, pdfKey: "inspection-pdf/res_demo/depart/v2.pdf", finalizedAt: "2026-10-28T12:00:00.000Z" }
    ] }
  };
}

test("Drive EDL réaliste : V1 archive 12 originaux et V2 archive les 12 hérités plus 2 nouveaux", () => {
  const record = realisticRecord();
  const jobs = jobsForRecord(record);
  const v1 = jobs.filter(job => job.targetFolder === "inspection:depart:v1:photos");
  const v2 = jobs.filter(job => job.targetFolder === "inspection:depart:v2:photos");
  assert.equal(v1.length, 12);
  assert.equal(v2.length, 14);
  assert.equal(jobs.filter(job => job.sourceKey.endsWith(":pdf")).length, 2);
  assert.equal(jobs.filter(job => job.jobType === "inspection-manifest").length, 2);
  assert.ok(v1.every(job => /\/original-\d+\.jpg$/.test(job.sourceR2Key)));
  assert.ok(v2.every(job => /\/original-\d+\.jpg$/.test(job.sourceR2Key)));
  assert.equal(jobs.some(job => String(job.sourceR2Key || "").includes("-pdf.jpg")), false, "optimizedKey ne devient jamais la source Drive");
  assert.equal(new Set(jobs.map(job => job.sourceKey)).size, jobs.length, "chaque version possède des sourceKey idempotentes et autonomes");
  assert.ok(v1.every(job => job.immutable === 1));
  assert.ok(v2.every(job => job.immutable === 1));
});

test("Drive EDL : ajouter V2 ne modifie ni les jobs ni le manifeste de V1", () => {
  const record = realisticRecord();
  const before = jobsForRecord({ ...record, inspectionRevisions: { depart: [record.inspectionRevisions.depart[0]] } }).filter(job => job.sourceKey.includes("edl-depart-r1"));
  const after = jobsForRecord(record).filter(job => job.sourceKey.includes("edl-depart-r1"));
  assert.deepEqual(after, before);
  const manifest = inspectionManifest(record, "depart", 1);
  assert.equal(manifest.photoCount, 12);
  assert.equal(manifest.photos[0].sourceR2Key, record.inspectionRevisions.depart[0].media[0].key);
  assert.equal(manifest.photos[0].originalName, "IMG_1_1.JPG");
  assert.equal(manifest.pdf.sourceR2Key, "inspection-pdf/res_demo/depart/v1.pdf");
  assert.equal(JSON.stringify(manifest).includes("optimizedKey"), false);
});

test("Drive EDL : V1, V2 et V3 utilisent des dossiers et sourceKey distincts", () => {
  const record = realisticRecord();
  const inherited = record.inspectionRevisions.depart[1].media;
  record.inspectionRevisions.depart.push({ revision: 3, status: "draft", basedOnRevision: 2, snapshot: {}, media: inherited, pdfKey: null });
  const jobs = jobsForRecord(record);
  assert.equal(jobs.filter(job => job.targetFolder === "inspection:depart:v3:photos").length, 14);
  assert.ok(jobs.some(job => job.targetFolder === "inspection:depart:v3" && job.jobType === "inspection-manifest" && job.immutable === 0));
  assert.equal(new Set(jobs.map(job => job.sourceKey)).size, jobs.length);
});

test("Drive EDL standalone : le record KV produit la même archive versionnée sans fausse réservation", async () => {
  const record = realisticRecord({ standalone: true });
  const kv = createFakeKv();
  await kv.put(`standalone-inspection:${record.id}`, JSON.stringify(record));
  const loaded = await getDriveRecord({ RESERVATIONS_KV: kv }, record.id);
  assert.equal(loaded.kind, "standalone-inspection");
  assert.equal(loaded.id, record.id);
  const jobs = jobsForRecord(loaded);
  assert.equal(jobs.filter(job => job.targetFolder === "inspection:depart:v1:photos").length, 12);
  assert.equal(jobs.filter(job => job.targetFolder === "inspection:depart:v2:photos").length, 14);
  const folders = driveFolderPlan(loaded);
  assert.deepEqual(folders.slice(0, 4).map(item => item[2]), ["EDL AUTONOMES", "2026", "10 - Octobre", "AA-123-AA - Martin Jeanne"]);
  assert.ok(folders.some(([key, parent, name]) => key === "inspection:depart:v2:photos" && parent === "inspection:depart:v2" && name === "Photos originales"));
  assert.ok(folders.some(([key, parent, name]) => key === "inspection:depart:v2:pdf" && parent === "inspection:depart:v2" && name === "PDF"));
});

test("Drive EDL ancien : les médias legacy item.key restent sauvegardables", () => {
  const jobs = jobsForRecord({ id: "res_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", contractVersion: { version: 1 }, contractDossier: { media: { depart: [{ key: "inspection/legacy/original.jpg", optimizedKey: "inspection/legacy/original-pdf.jpg", slot: "avant", contentType: "image/jpeg" }], retour: [] } } });
  const photo = jobs.find(job => job.sourceR2Key === "inspection/legacy/original.jpg");
  assert.ok(photo);
  assert.equal(photo.immutable, 1);
  assert.equal(jobs.some(job => job.sourceR2Key === "inspection/legacy/original-pdf.jpg"), false);
});

test("Drive EDL standalone ancien : dossier.media reste compatible sans inspectionRevisions", () => {
  const jobs = jobsForRecord({ id: "edl_bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb", kind: "standalone-inspection", mode: "retour", dossier: { media: { retour: [{ key: "inspection-standalone/legacy/original.jpg", slot: "arriere", contentType: "image/jpeg" }] } } });
  assert.ok(jobs.some(job => job.sourceR2Key === "inspection-standalone/legacy/original.jpg" && job.targetFolder === "inspections"));
});

test("Drive EDL : l’outbox existante reçoit un identifiant standalone sans appel Google", async () => {
  const queries = [];
  const env = { AGENCY_DB: { prepare(sql) { queries.push(sql); return { bind() { return { async run() { return { success: true }; } }; } }; } } };
  const id = "edl_aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
  assert.equal(await enqueueDriveSync(env, id), id);
  assert.equal(queries.length, 2);
  assert.match(queries[0], /INSERT INTO drive_sync_outbox/);
  assert.match(queries[1], /UPDATE drive_sync_jobs SET status='pending'.*immutable=0/);
  assert.equal(queries.some(sql => /googleapis|oauth/i.test(sql)), false);
});

