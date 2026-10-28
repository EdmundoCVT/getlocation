const test = require("node:test");
const assert = require("node:assert/strict");
const { listInspectionRevisions, initializeInspectionRevision, createInspectionRevision, updateInspectionRevisionDraft, setRevisionMedia, setRevisionPdf, finalizeInspectionRevision, revisionMediaPrefix, revisionPdfKey } = require("../src/lib/inspection-revisions.js");
const { jobsForRecord } = require("../src/lib/google-drive-backup.js");
const { finalizeRevisionWithPdf } = require("../src/lib/finalize-inspection-revision.js");
const { build: inspectionModel } = require("../src/lib/inspection-document-model.js");
const { generateInspectionPdf } = require("../src/lib/inspection-pdf-server.js");

test("initialisation EDL : crée V1 une seule fois pour départ ou retour", () => {
  const first = initializeInspectionRevision({}, "retour", null, [], "Edmundo");
  assert.equal(first.created, true);
  assert.equal(first.revision.revision, 1);
  assert.equal(first.revision.status, "draft");
  const second = initializeInspectionRevision({ inspectionRevisions: first.inspectionRevisions }, "retour", null, [], "Edmundo");
  assert.equal(second.created, false);
  assert.equal(second.revisions.length, 1);
  assert.deepEqual(second.revision, first.revision);
});
const { PDFDocument } = require("pdf-lib");
const fs = require("node:fs");
const path = require("node:path");

test("EDL historique finalisé est vu comme V1 et V2 conserve V1 immuable", () => {
  const stage = { completedAt: "2026-10-12T10:00:00Z", km: 12000, signatures: { client: { signedAt: "2026-10-12T10:00:00Z" } }, marks: [{ id: "a" }] };
  const revisions = listInspectionRevisions({}, "depart", stage, [{ key: "legacy/photo.jpg" }], "Edmundo");
  assert.equal(revisions[0].revision, 1); assert.equal(revisions[0].status, "finalized");
  const created = createInspectionRevision({ inspectionRevisions: { depart: revisions } }, "depart", stage, [], "Edmundo", 1);
  assert.equal(created.revision.revision, 2); assert.equal(created.revision.status, "draft");
  assert.deepEqual(created.revision.snapshot.signatures, revisions[0].snapshot.signatures, "V2 reprend les signatures de V1");
  created.revision.snapshot.signatures.client.signedAt = "2026-10-12T11:00:00Z";
  assert.equal(revisions[0].snapshot.signatures.client.signedAt, "2026-10-12T10:00:00Z", "la signature V1 reste indépendante");
  created.revision.snapshot.km = 13000;
  assert.equal(revisions[0].snapshot.km, 12000);
  assert.equal(created.revision.media[0].key, "legacy/photo.jpg", "V2 peut référencer V1 sans copie R2");
});

test("une nouvelle révision conserve son motif interne sans modifier la source", () => {
  const v3 = { revision: 3, status: "finalized", snapshot: { km: 300 }, media: [], pdfKey: "v3.pdf" };
  const created = createInspectionRevision({ inspectionRevisions: { depart: [v3] } }, "depart", null, null, "Edmundo", 3, "  Ajout des photos manquantes  ");
  assert.equal(created.revision.revision, 4);
  assert.equal(created.revision.basedOnRevision, 3);
  assert.equal(created.revision.createdBy, "Edmundo");
  assert.equal(created.revision.revisionReason, "Ajout des photos manquantes");
  assert.equal(v3.revisionReason, undefined);
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

test("les sauvegardes successives d'un brouillon ne créent ni PDF ni archive", () => {
  const v1 = { revision: 1, status: "finalized", snapshot: { km: 100, signatures: { client: { signedAt: "a" }, agence: { signedAt: "b" } } }, media: [], pdfKey: "v1.pdf" };
  const first = createInspectionRevision({ inspectionRevisions: { depart: [v1] } }, "depart", null, null, "agent", 1);
  const second = updateInspectionRevisionDraft({ inspectionRevisions: first.inspectionRevisions }, "depart", null, null, "agent", 2, { ...first.revision.snapshot, km: 120 });
  const third = updateInspectionRevisionDraft({ inspectionRevisions: second.inspectionRevisions }, "depart", null, null, "agent", 2, { ...second.revision.snapshot, km: 130 });
  assert.equal(third.revision.status, "draft");
  assert.equal(third.revision.pdfKey, null);
  assert.equal(third.inspectionRevisions.depart.length, 2);
  assert.equal(third.inspectionRevisions.depart[0].pdfKey, "v1.pdf");
  assert.equal(third.revision.snapshot.km, 130);
});

test("plusieurs brouillons parallèles peuvent repartir de la même version finalisée sans se modifier", () => {
  const v1 = { revision: 1, status: "finalized", snapshot: { km: 100, signatures: { client: { signedAt: "a" }, agence: { signedAt: "b" } } }, media: [{ key: "v1.jpg" }], pdfKey: "v1.pdf" };
  const v2Created = createInspectionRevision({ inspectionRevisions: { depart: [v1] } }, "depart", null, null, "agent", 1, "Correction A");
  const v3Created = createInspectionRevision({ inspectionRevisions: v2Created.inspectionRevisions }, "depart", null, null, "agent", 1, "Correction B");
  const v4Created = createInspectionRevision({ inspectionRevisions: v3Created.inspectionRevisions }, "depart", null, null, "agent", 1, "Correction C");
  assert.deepEqual(v4Created.inspectionRevisions.depart.map(item => [item.revision, item.status, item.basedOnRevision]), [[1, "finalized", undefined], [2, "draft", 1], [3, "draft", 1], [4, "draft", 1]]);
  assert.deepEqual(v4Created.revision.media, [{ key: "v1.jpg" }]);
  assert.deepEqual(v4Created.revision.snapshot.signatures, v1.snapshot.signatures);

  const v2Saved = updateInspectionRevisionDraft({ inspectionRevisions: v4Created.inspectionRevisions }, "depart", null, null, "agent", 2, { km: 120, signatures: { client: { signedAt: "v2-client" }, agence: { signedAt: "v2-agence" } } });
  const v3Saved = updateInspectionRevisionDraft({ inspectionRevisions: v2Saved.inspectionRevisions }, "depart", null, null, "agent", 3, { km: 130, signatures: { client: { signedAt: "v3-client" }, agence: { signedAt: "v3-agence" } } });
  const v3Finalized = finalizeInspectionRevision({ inspectionRevisions: v3Saved.inspectionRevisions }, "depart", null, null, "agent", 3);
  const revisions = v3Finalized.inspectionRevisions.depart;
  assert.equal(revisions[0].snapshot.km, 100);
  assert.equal(revisions[0].snapshot.signatures.client.signedAt, "a");
  assert.equal(revisions[1].status, "draft");
  assert.equal(revisions[1].snapshot.km, 120);
  assert.equal(revisions[1].snapshot.signatures.client.signedAt, "v2-client");
  assert.equal(revisions[2].status, "finalized");
  assert.equal(revisions[2].snapshot.km, 130);
  assert.equal(revisions[3].status, "draft");
  assert.equal(revisions[3].snapshot.km, 100);
  assert.doesNotThrow(() => updateInspectionRevisionDraft({ inspectionRevisions: v3Finalized.inspectionRevisions }, "depart", null, null, "agent", 2, { km: 121, signatures: revisions[1].snapshot.signatures }));
  assert.throws(() => createInspectionRevision({ inspectionRevisions: v3Finalized.inspectionRevisions }, "depart", null, null, "agent", 2), /La version source doit être finalisée\./);
  assert.throws(() => createInspectionRevision({ inspectionRevisions: v3Finalized.inspectionRevisions }, "depart", null, null, "agent", 99), /La version source doit être finalisée\./);
});

test("copy-on-write : sauvegarder V3 ne sérialise ni ne clone V1/V2 et réutilise les chaînes de signature", () => {
  const imageDataUrl = "data:image/png;base64," + "A".repeat(200 * 1024);
  const snapshot = km => ({ km, dommages: "", signatures: { client: { name: "Client", imageDataUrl, signedAt: "a" }, agence: { name: "Agence", imageDataUrl, signedAt: "b" } } });
  const v1 = { revision: 1, status: "finalized", snapshot: snapshot(1), media: [{ key: "v1.jpg" }], pdfKey: "v1.pdf" };
  const v2 = { revision: 2, status: "draft", snapshot: snapshot(2), media: [{ key: "v1.jpg" }], pdfKey: null };
  const v3 = { revision: 3, status: "draft", snapshot: snapshot(3), media: [{ key: "v1.jpg" }], pdfKey: null };
  const v1Before = JSON.stringify(v1), v2Before = JSON.stringify(v2), incoming = snapshot(300);
  const stringify = JSON.stringify, parse = JSON.parse;
  let stringifyCalls = 0, parseCalls = 0;
  JSON.stringify = (...args) => { stringifyCalls++; return stringify(...args); };
  JSON.parse = (...args) => { parseCalls++; return parse(...args); };
  let saved;
  try { saved = updateInspectionRevisionDraft({ inspectionRevisions: { depart: [v1, v2, v3] } }, "depart", null, null, "agent", 3, incoming); }
  finally { JSON.stringify = stringify; JSON.parse = parse; }
  assert.equal(stringifyCalls, 0);
  assert.equal(parseCalls, 0);
  assert.strictEqual(saved.inspectionRevisions.depart[0], v1, "V1 est réutilisée sans copie");
  assert.strictEqual(saved.inspectionRevisions.depart[1], v2, "V2 est réutilisée sans copie");
  assert.notStrictEqual(saved.inspectionRevisions.depart[2], v3, "seule l'enveloppe V3 est remplacée");
  assert.notStrictEqual(saved.revision.snapshot.signatures.client, incoming.signatures.client, "l'objet signature V3 reste indépendant");
  assert.strictEqual(saved.revision.snapshot.signatures.client.imageDataUrl, imageDataUrl, "la chaîne base64 immutable est réutilisée");
  incoming.signatures.client.name = "Mutation tardive";
  assert.equal(saved.revision.snapshot.signatures.client.name, "Client");
  assert.equal(JSON.stringify(v1), v1Before);
  assert.equal(JSON.stringify(v2), v2Before);
});

test("charge copy-on-write : 10 sauvegardes à 50/100/200 Ko et V10 restent proportionnelles à la cible", () => {
  for (const signatureKb of [50, 100, 200]) {
    const imageDataUrl = "data:image/png;base64," + "A".repeat(signatureKb * 1024);
    const snapshot = km => ({ km, signatures: { client: { imageDataUrl, signedAt: "a" }, agence: { imageDataUrl, signedAt: "b" } } });
    let record = { inspectionRevisions: { depart: [1, 2, 3].map(revision => ({ revision, status: revision === 1 ? "finalized" : "draft", snapshot: snapshot(revision), media: [], pdfKey: revision === 1 ? "v1.pdf" : null })) } };
    const v1 = record.inspectionRevisions.depart[0], v2 = record.inspectionRevisions.depart[1];
    for (let pass = 0; pass < 10; pass++) record = { inspectionRevisions: updateInspectionRevisionDraft(record, "depart", null, null, "agent", 3, snapshot(300 + pass)).inspectionRevisions };
    assert.strictEqual(record.inspectionRevisions.depart[0], v1);
    assert.strictEqual(record.inspectionRevisions.depart[1], v2);
    assert.equal(record.inspectionRevisions.depart[2].snapshot.km, 309);
  }

  const imageDataUrl = "data:image/png;base64," + "B".repeat(200 * 1024);
  const snapshot = km => ({ km, signatures: { client: { imageDataUrl, signedAt: "a" }, agence: { imageDataUrl, signedAt: "b" } } });
  const revisions = Array.from({ length: 10 }, (_, index) => ({ revision: index + 1, status: index ? "draft" : "finalized", snapshot: snapshot(index + 1), media: [], pdfKey: index ? null : "v1.pdf" }));
  const historical = revisions.slice(0, 9);
  let record = { inspectionRevisions: { depart: revisions } };
  for (let pass = 0; pass < 10; pass++) record = { inspectionRevisions: updateInspectionRevisionDraft(record, "depart", null, null, "agent", 10, snapshot(1000 + pass)).inspectionRevisions };
  historical.forEach((revision, index) => assert.strictEqual(record.inspectionRevisions.depart[index], revision));
  assert.equal(record.inspectionRevisions.depart[9].snapshot.km, 1009);
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

test("finaliser V3 et son PDF laisse le brouillon V2 strictement indépendant", async () => {
  const v1 = { revision: 1, status: "finalized", snapshot: { km: 1, signatures: { client: { signedAt: "a" }, agence: { signedAt: "b" } } }, media: [{ key: "v1.jpg" }], pdfKey: "v1.pdf" };
  const v2 = { revision: 2, status: "draft", snapshot: { km: 2, signatures: { client: { signedAt: "c" }, agence: { signedAt: "d" } } }, media: [{ key: "v1.jpg" }], pdfKey: null, basedOnRevision: 1 };
  const v3 = { revision: 3, status: "draft", snapshot: { km: 3, signatures: { client: { signedAt: "e" }, agence: { signedAt: "f" } } }, media: [{ key: "v1.jpg" }], pdfKey: null, basedOnRevision: 1 };
  const v1Before = structuredClone(v1), v2Before = structuredClone(v2), written = [];
  const env = { DOCUMENTS_BUCKET: { async put(key) { written.push(key); } } };
  const out = await finalizeRevisionWithPdf({ env, record: { id: "res_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", inspectionRevisions: { depart: [v1, v2, v3] } }, stage: "depart", revision: 3, snapshot: v3.snapshot, fallbackSnapshot: null, fallbackMedia: [], standalone: false });
  assert.deepEqual(out.inspectionRevisions.depart[0], v1Before);
  assert.deepEqual(out.inspectionRevisions.depart[1], v2Before);
  assert.equal(out.inspectionRevisions.depart[2].status, "finalized");
  assert.equal(out.inspectionRevisions.depart[2].pdfKey, "inspection-pdf/res_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/depart/v3.pdf");
  assert.deepEqual(written, ["inspection-pdf/res_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/depart/v3.pdf"]);
});

test("finalisation remplace un ancien PDF navigateur sur un brouillon sans toucher V1", async () => {
  const v1 = { revision: 1, status: "finalized", snapshot: { signatures: { client: { signedAt: "a" }, agence: { signedAt: "b" } } }, media: [], pdfKey: "v1.pdf" };
  const v2 = { revision: 2, status: "draft", snapshot: { signatures: { client: { signedAt: "a" }, agence: { signedAt: "b" } } }, media: [], pdfKey: "inspection-pdf/res/depart/v2.pdf", pdfArchivedAt: "old" };
  const put = new Map(), env = { DOCUMENTS_BUCKET: { async put(key, value) { put.set(key, value); } } };
  const out = await finalizeRevisionWithPdf({ env, record: { id: "res_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", inspectionRevisions: { depart: [v1, v2] } }, stage: "depart", revision: 2, snapshot: v2.snapshot, fallbackSnapshot: null, fallbackMedia: [], standalone: false });
  assert.equal(out.revision.status, "finalized");
  assert.equal(out.revision.pdfKey, "inspection-pdf/res_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/depart/v2.pdf");
  assert.equal(out.inspectionRevisions.depart[0].pdfKey, "v1.pdf");
  assert.ok(put.has(out.revision.pdfKey));
});

test("échec R2 conserve la révision au brouillon", async () => {
  const v2 = { revision: 2, status: "draft", snapshot: { signatures: { client: { signedAt: "a" }, agence: { signedAt: "b" } } }, media: [], pdfKey: null };
  await assert.rejects(() => finalizeRevisionWithPdf({ env: { DOCUMENTS_BUCKET: { async put() { throw new Error("R2 indisponible"); } } }, record: { id: "res_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", inspectionRevisions: { depart: [v2] } }, stage: "depart", revision: 2, snapshot: v2.snapshot, fallbackSnapshot: null, fallbackMedia: [], standalone: false }), /R2 indisponible/);
  assert.equal(v2.status, "draft"); assert.equal(v2.pdfKey, null);
});

test("V5 utilise le nouveau rendu sans réécrire les PDF finalisés V1 à V4", async () => {
  const old = [1, 2, 3, 4].map(revision => ({ revision, status: "finalized", snapshot: { km: revision }, media: [], pdfKey: `archive/v${revision}.pdf` }));
  const oldCopy = JSON.parse(JSON.stringify(old));
  const draft = { revision: 5, status: "draft", snapshot: { km: 500, signatures: { client: { signedAt: "2026-10-13T10:00" }, agence: { signedAt: "2026-10-13T10:01" } } }, media: [], pdfKey: null };
  const written = [];
  const env = { DOCUMENTS_BUCKET: { async put(key, bytes) { written.push({ key, bytes }); } } };
  const out = await finalizeRevisionWithPdf({ env, record: { id: "edl_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", kind: "standalone-inspection", client: { prenom: "Jeanne", nom: "Martin" }, inspectionRevisions: { depart: [...old, draft] } }, stage: "depart", revision: 5, snapshot: draft.snapshot, standalone: true });
  assert.equal(out.revision.status, "finalized");
  assert.deepEqual(out.inspectionRevisions.depart.slice(0, 4), oldCopy);
  assert.deepEqual(written.map(item => item.key), ["inspection-pdf-standalone/edl_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/depart/v5.pdf"]);
  assert.ok((await PDFDocument.load(written[0].bytes)).getPageCount() >= 1);
});

test("modèle documentaire normalise les croquis, médias et dates de signature", () => {
  const model = inspectionModel({ id: "edl_1", stage: "depart", revision: 2, vehicleFamily: "utility", snapshot: { utilityMarks: [{ surface: "utility-exterior", view: "left", x: 25, y: 75 }], signatures: { client: { name: "A", signedAt: "technique", displaySignedAt: "affichée" } } }, media: [{ key: "legacy/photo.jpg", slot: "avant", capturedAt: "2026-09-04T23:34", createdAt: "2026-10-12T23:41:45" }] });
  assert.equal(model.sketches.length, 10); assert.equal(model.sketches[0].marks.length, 1); assert.equal(model.photos[0].key, "legacy/photo.jpg"); assert.equal(model.signatures[0].displayedAt, "affichée");
  assert.equal(model.photos[0].label, "Avant");
  assert.equal(model.photos[0].capturedAt, "2026-09-04T23:34");
  assert.equal(model.photos[0].createdAt, "2026-10-12T23:41:45");
});

test("grilles Worker : voiture une page croquis, utilitaire deux pages", async () => {
  const env = { ASSETS: { async fetch() { return new Response("", { status: 404 }); } }, DOCUMENTS_BUCKET: { async get() { return null; } } };
  const signatures = { client: { signedAt: "a" }, agence: { signedAt: "b" } };
  const car = await PDFDocument.load(await generateInspectionPdf({ env, id: "car", stage: "depart", revision: 2, snapshot: { marks: [], signatures }, media: [], vehicleFamily: "car" }));
  const utility = await PDFDocument.load(await generateInspectionPdf({ env, id: "van", stage: "depart", revision: 2, snapshot: { utilityMarks: [], signatures }, media: [], vehicleFamily: "utility" }));
  assert.equal(car.getPageCount(), 2, "signatures groupées sur la page d'informations quand elle est libre");
  assert.equal(utility.getPageCount(), 3, "les deux pages de croquis utilitaire sont conservées");
});

test("PDF officiel n'expose pas le numéro interne de révision et place les signatures après les photos", async () => {
  const env = { ASSETS: { async fetch() { return new Response("", { status: 404 }); } }, DOCUMENTS_BUCKET: { async get() { return null; } } };
  const bytes = await generateInspectionPdf({ env, id: "res_test", stage: "depart", revision: 3, snapshot: { signatures: { client: { signedAt: "a" }, agence: { signedAt: "b" } } }, media: [], vehicleFamily: "car" });
  assert.ok(bytes.length > 0);
  const source = require("node:fs").readFileSync(require.resolve("../src/lib/inspection-pdf-server.js"), "utf8");
  assert.doesNotMatch(source, /État des lieux \$\{stage === "retour" \? "retour" : "départ"\} — V\$\{revision\}/);
  assert.ok(source.indexOf("const photos = []") < source.indexOf("async function drawSignatures"));
  assert.match(source, /item\.capturedAt \|\| item\.createdAt/);
  assert.match(source, /SIGNATURES —/);
});

test("PDF Worker : numéros globaux et descriptions des dommages voiture correspondent", async () => {
  const assetRoot = path.join(__dirname, "..");
  const env = { ASSETS: { async fetch(request) { const file = path.join(assetRoot, new URL(request.url).pathname); return fs.existsSync(file) ? new Response(fs.readFileSync(file), { headers: { "content-type": "image/png" } }) : new Response(null, { status: 404 }); } }, DOCUMENTS_BUCKET: { async get() { return null; } } };
  const snapshot = { sketchVehicleType: "car", marks: [
    { id: "m1", view: "left", x: 20, y: 30, type: "rayure", description: "Rayure horizontale vingt centimètres" },
    { id: "m2", view: "front", x: 40, y: 50, type: "bosse", description: "Enfoncement pare-chocs avant" },
    { id: "m3", view: "right", x: 60, y: 70, type: "eclat", description: "Impact peinture porte droite" }
  ], signatures: { client: { signedAt: "a" }, agence: { signedAt: "b" } } };
  const model = inspectionModel({ id: "car", stage: "depart", revision: 4, snapshot });
  assert.deepEqual(model.damageMarks.map(mark => mark.number), [1, 2, 3]);
  assert.deepEqual(model.sketches.flatMap(view => view.marks.map(mark => mark.number)), [1, 2, 3]);
  const bytes = await generateInspectionPdf({ env, id: "car", stage: "depart", revision: 4, snapshot, media: [], vehicleFamily: "car" });
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 2, "les descriptions figurent en première page et les croquis restent sur une seule page");
  assert.ok(bytes.length > 0);
  const renderer = fs.readFileSync(require.resolve("../src/lib/inspection-pdf-server.js"), "utf8");
  assert.match(renderer, /Détails des dommages/);
  assert.match(renderer, /mark\.number/);
  assert.doesNotMatch(renderer, /revisionReason/, "le motif interne n'entre jamais dans le renderer client");
});

test("modèle PDF retour et utilitaire conserve statut, numéros et descriptions", () => {
  const model = inspectionModel({ id: "van", stage: "retour", revision: 5, vehicleFamily: "utility", snapshot: { sketchVehicleType: "utility", utilityMarks: [
    { id: "u1", surface: "utility-exterior", view: "left", x: 10, y: 20, type: "rayure", description: "Déjà relevée", presentAtDeparture: true },
    { id: "u2", surface: "utility-interior", view: "floor", x: 30, y: 40, type: "bosse", description: "Nouveau choc", isNew: true }
  ] } });
  assert.deepEqual(model.damageMarks.map(mark => [mark.number, mark.statusLabel, mark.zoneLabel, mark.description]), [
    [1, "Présent au départ", "Profil conducteur", "Déjà relevée"],
    [2, "Nouveau au retour", "Plancher", "Nouveau choc"]
  ]);
  assert.deepEqual(model.sketches.flatMap(view => view.marks.map(mark => mark.number)), [1, 2]);
});
