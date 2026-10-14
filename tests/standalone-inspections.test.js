const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { handleStandaloneInspections } = require("../src/api/standalone-inspections.js");
const { handleStandaloneInspectionMedia } = require("../src/api/standalone-inspection-media.js");
const { makeAgencyEnv, loginAgency, agencyRequest } = require("./helpers/agency-session.js");
const { createFakeKv } = require("./helpers/fake-kv.js");

function bucket(){const map=new Map();return{objects:map,async put(key,value,meta){map.set(key,{value,meta});},async get(key){const x=map.get(key);return x&&{body:x.value,httpMetadata:x.meta&&x.meta.httpMetadata,async arrayBuffer(){if(x.value instanceof ArrayBuffer)return x.value;if(ArrayBuffer.isView(x.value))return x.value.buffer.slice(x.value.byteOffset,x.value.byteOffset+x.value.byteLength);return new Uint8Array(x.value).buffer;},writeHttpMetadata(h){h.set("Content-Type",x.meta.httpMetadata.contentType);}}},async delete(key){map.delete(key);}};}
const signaturePng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
function report(km) { return { dateHeure: "2026-10-13T18:00", km, carburant: 80, propreteExterieure: 4, propreteInterieure: 4, cles: 2, clesAccessoires: "Deux clés", agent: "Edmundo", dommages: "", sketchVehicleType: "car", marks: [], utilityMarks: [], signatures: { client: { name: "Client", imageDataUrl: signaturePng }, agence: { name: "Agence", imageDataUrl: signaturePng } } }; }

test("EDL retour autonome : V1/V2 complètes sans départ, médias, signatures et PDF immuables", async () => {
  const storage = bucket(), env = makeAgencyEnv({ DOCUMENTS_BUCKET: storage, RESERVATIONS_KV: createFakeKv() }), session = await loginAgency(env);
  const created = await handleStandaloneInspections(agencyRequest("https://getlocation.fr/api/standalone-inspections", { method: "POST", session, body: { action: "create", mode: "retour", client: { prenom: "Retour", nom: "Autonome" }, vehicule: { nom: "Toyota Proace", immatriculation: "AA-123-AA" } } }), env);
  assert.equal(created.status, 201);
  const inspection = (await created.json()).inspection;
  assert.equal(inspection.mode, "retour");
  assert.equal(inspection.dossier.depart, null);
  assert.equal(inspection.inspectionRevisions.retour[0].status, "draft");
  const upload = async (revision, name) => {
    const form = new FormData(); form.set("stage", "retour"); form.set("revision", String(revision)); form.set("slot", "dommage"); form.set("capturedAt", "2026-10-13T17:30"); form.set("file", new File([name], name + ".jpg", { type: "image/jpeg" }));
    return handleStandaloneInspectionMedia(new Request("https://getlocation.fr/api/standalone-inspection-media?id=" + inspection.id, { method: "POST", headers: { origin: "https://getlocation.fr", cookie: "agency_session=" + session.cookie, "x-agency-csrf": session.csrfToken }, body: form }), env);
  };
  assert.equal((await upload(1, "retour-v1")).status, 200);
  const finalized = await handleStandaloneInspections(agencyRequest("https://getlocation.fr/api/standalone-inspections", { method: "POST", session, body: { action: "update-stage", id: inspection.id, revision: 1, stage: report(42500), finalize: true } }), env);
  assert.equal(finalized.status, 200);
  assert.match(finalized.headers.get("content-type"), /application\/json/);
  const v1 = (await finalized.json()).revision;
  assert.equal(v1.status, "finalized");
  assert.match(v1.pdfKey, new RegExp(`inspection-pdf-standalone/${inspection.id}/retour/v1\\.pdf$`));
  const v1Before = structuredClone(v1);
  const correction = await handleStandaloneInspections(agencyRequest("https://getlocation.fr/api/standalone-inspections", { method: "POST", session, body: { action: "create-revision", id: inspection.id, stage: "retour", baseRevision: 1, revisionReason: "Correction retour autonome" } }), env);
  assert.equal(correction.status, 201);
  assert.equal((await correction.json()).revision.revision, 2);
  assert.equal((await upload(2, "retour-v2")).status, 200);
  const v2Report = report(42510); v2Report.carburant = 60; v2Report.propreteExterieure = 3; v2Report.propreteInterieure = 2;
  const saved = await handleStandaloneInspections(agencyRequest("https://getlocation.fr/api/standalone-inspections", { method: "POST", session, body: { action: "update-stage", id: inspection.id, revision: 2, stage: v2Report, finalize: false } }), env);
  assert.equal(saved.status, 200);
  assert.match(saved.headers.get("content-type"), /application\/json/);
  let stored = JSON.parse(await env.RESERVATIONS_KV.get("standalone-inspection:" + inspection.id));
  assert.equal(stored.dossier.depart, null);
  assert.deepEqual(stored.inspectionRevisions.retour[0], v1Before);
  assert.equal(stored.inspectionRevisions.retour[1].snapshot.km, 42510);
  assert.equal(stored.inspectionRevisions.retour[1].snapshot.carburant, 60);
  assert.equal(stored.inspectionRevisions.retour[1].media.length, 2, "V2 conserve la photo héritée et ajoute sa propre photo");
  assert.equal(stored.inspectionRevisions.retour[1].pdfKey, null);
  const finalizedV2 = await handleStandaloneInspections(agencyRequest("https://getlocation.fr/api/standalone-inspections", { method: "POST", session, body: { action: "update-stage", id: inspection.id, revision: 2, stage: v2Report, finalize: true } }), env);
  assert.equal(finalizedV2.status, 200);
  assert.match(finalizedV2.headers.get("content-type"), /application\/json/);
  const v2 = (await finalizedV2.json()).revision;
  assert.equal(v2.status, "finalized");
  assert.notEqual(v2.pdfKey, v1.pdfKey);
  assert.ok(storage.objects.has(v2.pdfKey));
  stored = JSON.parse(await env.RESERVATIONS_KV.get("standalone-inspection:" + inspection.id));
  assert.deepEqual(stored.inspectionRevisions.retour[0], v1Before, "la sauvegarde et la finalisation V2 ne modifient jamais V1");
  assert.ok(storage.objects.has(v1.pdfKey));
});

test("EDL indépendants : un départ créé après le retour peut être associé bidirectionnellement", async () => {
  const env = makeAgencyEnv({ DOCUMENTS_BUCKET: bucket(), RESERVATIONS_KV: createFakeKv() }), session = await loginAgency(env);
  const create = async (mode) => (await (await handleStandaloneInspections(agencyRequest("https://getlocation.fr/api/standalone-inspections", { method: "POST", session, body: { action: "create", mode, client: { prenom: "Couple", nom: "EDL" }, vehicule: { nom: "Peugeot 3008" } } }), env)).json()).inspection;
  const retour = await create("retour");
  const depart = await create("depart");
  const paired = await handleStandaloneInspections(agencyRequest("https://getlocation.fr/api/standalone-inspections", { method: "POST", session, body: { action: "associate-inspection", id: retour.id, pairedInspectionId: depart.id } }), env);
  assert.equal(paired.status, 200);
  const storedRetour = JSON.parse(await env.RESERVATIONS_KV.get("standalone-inspection:" + retour.id));
  const storedDepart = JSON.parse(await env.RESERVATIONS_KV.get("standalone-inspection:" + depart.id));
  assert.equal(storedRetour.pairedInspectionId, depart.id);
  assert.equal(storedDepart.pairedInspectionId, retour.id);
  const invalid = await handleStandaloneInspections(agencyRequest("https://getlocation.fr/api/standalone-inspections", { method: "POST", session, body: { action: "associate-inspection", id: depart.id, pairedInspectionId: depart.id } }), env);
  assert.equal(invalid.status, 404);
});

test("EDL retour V2 : une signature historique inchangée est conservée et toute erreur reste JSON", async () => {
  const env = makeAgencyEnv({ DOCUMENTS_BUCKET: bucket(), RESERVATIONS_KV: createFakeKv() }), session = await loginAgency(env);
  const id = "edl_ffffffffffffffff", historicalImage = "data:image/png;base64," + "A".repeat(70004);
  const base = report(1000); base.signatures.client = { name: "Client", imageDataUrl: historicalImage, signedAt: "2026-10-12T10:00:00Z" }; base.signatures.agence = { name: "Agence", imageDataUrl: historicalImage, signedAt: "2026-10-12T10:01:00Z" };
  const v1 = { revision: 1, status: "finalized", snapshot: structuredClone(base), media: [], pdfKey: "inspection-pdf-standalone/edl_ffffffffffffffff/retour/v1.pdf", finalizedAt: "2026-10-12T10:02:00Z" };
  const v2 = { revision: 2, status: "draft", snapshot: structuredClone(base), media: [], pdfKey: null, basedOnRevision: 1 };
  await env.RESERVATIONS_KV.put("standalone-inspection:" + id, JSON.stringify({ id, mode: "retour", dossier: { depart: null, retour: null, media: { depart: [], retour: [] } }, inspectionRevisions: { retour: [v1, v2] }, status: "finalized" }));
  const saved = await handleStandaloneInspections(agencyRequest("https://getlocation.fr/api/standalone-inspections", { method: "POST", session, body: { action: "update-stage", id, revision: 2, stage: { ...base, km: 1010 }, finalize: false } }), env);
  assert.equal(saved.status, 200);
  assert.match(saved.headers.get("content-type"), /application\/json/);
  const stored = JSON.parse(await env.RESERVATIONS_KV.get("standalone-inspection:" + id));
  assert.equal(stored.inspectionRevisions.retour[1].snapshot.signatures.client.imageDataUrl, historicalImage);
  assert.deepEqual(stored.inspectionRevisions.retour[0], v1);

  const invalid = report(1020); invalid.carburant = 75;
  const rejected = await handleStandaloneInspections(agencyRequest("https://getlocation.fr/api/standalone-inspections", { method: "POST", session, body: { action: "update-stage", id, revision: 2, stage: invalid, finalize: false } }), env);
  assert.equal(rejected.status, 400);
  assert.match(rejected.headers.get("content-type"), /application\/json/);
  assert.match((await rejected.json()).error, /carburant/i);
});

test("EDL autonome : un binding KV absent retourne une erreur JSON diagnostiquable", async () => {
  const response = await handleStandaloneInspections(new Request("https://getlocation.fr/api/standalone-inspections"), {});
  assert.equal(response.status, 503);
  assert.match(response.headers.get("content-type"), /application\/json/);
  assert.match((await response.json()).error, /stockage/i);
});

test("EDL retour V1 iPhone : une signature JPEG réelle de plus de 70 Ko se sauvegarde en JSON", async () => {
  const env = makeAgencyEnv({ DOCUMENTS_BUCKET: bucket(), RESERVATIONS_KV: createFakeKv() }), session = await loginAgency(env);
  const created = await handleStandaloneInspections(agencyRequest("https://getlocation.fr/api/standalone-inspections", { method: "POST", session, body: { action: "create", mode: "retour", client: { prenom: "Mobile", nom: "Safari" }, vehicule: { nom: "Toyota Proace" } } }), env);
  const inspection = (await created.json()).inspection;
  const imageDataUrl = `data:image/jpeg;base64,${fs.readFileSync(path.join(__dirname, "..", "images", "opel-corsa.jpg")).toString("base64")}`;
  assert.ok(imageDataUrl.length > 70000);
  const stage = report(32000); stage.signatures.client = { name: "Client iPhone", imageDataUrl };
  const saved = await handleStandaloneInspections(agencyRequest("https://getlocation.fr/api/standalone-inspections", { method: "POST", session, body: { action: "update-stage", id: inspection.id, revision: 1, stage, finalize: false } }), env);
  assert.equal(saved.status, 200);
  assert.match(saved.headers.get("content-type"), /application\/json/);
  assert.equal((await saved.json()).revision.snapshot.signatures.client.imageDataUrl, imageDataUrl);
});
test("EDL indépendant : création, association et photos R2 privées", async () => {
  const env=makeAgencyEnv({DOCUMENTS_BUCKET:bucket(),RESERVATIONS_KV:createFakeKv()}), session=await loginAgency(env);
  const create=await handleStandaloneInspections(agencyRequest("https://getlocation.fr/api/standalone-inspections",{method:"POST",session,body:{action:"create",mode:"depart",client:{prenom:"Amir",nom:"Test"},vehicule:{nom:"Corsa",immatriculation:"AA-123-AA"},internalNote:"Sans contrat"}}),env);
  assert.equal(create.status,201); const inspection=(await create.json()).inspection; assert.match(inspection.id,/^edl_/); assert.equal(inspection.linkedContractId,null);
  const listed=await handleStandaloneInspections(agencyRequest("https://getlocation.fr/api/standalone-inspections",{session}),env); assert.equal((await listed.json()).inspections.length,1);
  const form=new FormData();form.set("stage","depart");form.set("revision","1");form.set("slot","avant");form.set("file",new File(["image"],"a.jpg",{type:"image/jpeg"}));
  const uploadRequest=new Request("https://getlocation.fr/api/standalone-inspection-media?id="+inspection.id,{method:"POST",headers:{origin:"https://getlocation.fr",cookie:"agency_session="+session.cookie,"x-agency-csrf":session.csrfToken},body:form});
  const uploaded=await handleStandaloneInspectionMedia(uploadRequest,env); assert.equal(uploaded.status,200); const photo=(await uploaded.json()).item; assert.match(photo.key,new RegExp("^inspection-standalone/"+inspection.id+"/depart/"));
  const createdAt=photo.createdAt;
  const patched=await handleStandaloneInspectionMedia(agencyRequest("https://getlocation.fr/api/standalone-inspection-media?id="+inspection.id,{method:"PATCH",session,body:{key:photo.key,stage:"depart",revision:1,capturedAt:"2026-10-12T17:00"}}),env);
  assert.equal(patched.status,200); assert.equal((await patched.json()).item.createdAt,createdAt);
  const reloaded=await handleStandaloneInspections(agencyRequest("https://getlocation.fr/api/standalone-inspections?id="+inspection.id,{session}),env);
  assert.equal((await reloaded.json()).inspection.inspectionRevisions.depart[0].media[0].capturedAt,"2026-10-12T17:00");
  const stored=JSON.parse(await env.RESERVATIONS_KV.get("standalone-inspection:"+inspection.id));
  stored.inspectionRevisions.depart[0].status="finalized";
  stored.inspectionRevisions.depart.push({revision:2,status:"draft",snapshot:{},media:[{...photo,key:photo.key+"-v2"}],pdfKey:null});
  await env.RESERVATIONS_KV.put("standalone-inspection:"+inspection.id,JSON.stringify(stored));
  const finalizedPatch=await handleStandaloneInspectionMedia(agencyRequest("https://getlocation.fr/api/standalone-inspection-media?id="+inspection.id,{method:"PATCH",session,body:{key:photo.key,stage:"depart",revision:1,capturedAt:"2026-10-12T18:00"}}),env);
  assert.equal(finalizedPatch.status,409);
  const v2Patch=await handleStandaloneInspectionMedia(agencyRequest("https://getlocation.fr/api/standalone-inspection-media?id="+inspection.id,{method:"PATCH",session,body:{key:photo.key+"-v2",stage:"depart",revision:2,capturedAt:"2026-10-12T18:00"}}),env);
  assert.equal(v2Patch.status,200);
  const forbidden=await handleStandaloneInspectionMedia(agencyRequest("https://getlocation.fr/api/standalone-inspection-media?id="+inspection.id,{method:"GET",session}),env); assert.equal(forbidden.status,403);
});

test("EDL indépendant : la liste parcourt toutes les pages KV", async () => {
  const kv = createFakeKv();
  const env = makeAgencyEnv({ DOCUMENTS_BUCKET: bucket(), RESERVATIONS_KV: kv });
  const session = await loginAgency(env);
  const first = "standalone-inspection:edl_aaaaaaaaaaaaaaaa";
  const second = "standalone-inspection:edl_bbbbbbbbbbbbbbbb";
  await kv.put(first, JSON.stringify({ id: "edl_aaaaaaaaaaaaaaaa", mode: "depart", client: { prenom: "Toyota" }, vehicule: { nom: "Proace" }, status: "draft", createdAt: "2026-10-10T10:00:00Z", updatedAt: "2026-10-10T10:00:00Z", dossier: {} }));
  await kv.put(second, JSON.stringify({ id: "edl_bbbbbbbbbbbbbbbb", mode: "retour", client: { prenom: "Nicholson" }, vehicule: { nom: "Proace" }, status: "finalized", createdAt: "2026-10-11T10:00:00Z", updatedAt: "2026-10-11T10:00:00Z", dossier: {} }));
  let calls = 0;
  kv.list = async ({ cursor } = {}) => { calls += 1; return cursor ? { keys: [{ name: second }], list_complete: true } : { keys: [{ name: first }], list_complete: false, cursor: "page-2" }; };
  const response = await handleStandaloneInspections(agencyRequest("https://getlocation.fr/api/standalone-inspections", { session }), env);
  const body = await response.json();
  assert.equal(calls, 2);
  assert.equal(body.inspections.length, 2);
  assert.ok(body.inspections.some((item) => item.id === "edl_bbbbbbbbbbbbbbbb" && item.status === "finalized"));
});

test("EDL indépendant : une correction reprend le brouillon existant et peut repartir d'une ancienne version", async () => {
  const env = makeAgencyEnv({ DOCUMENTS_BUCKET: bucket(), RESERVATIONS_KV: createFakeKv() }), session = await loginAgency(env);
  const id = "edl_aaaaaaaaaaaaaaaa";
  const v1 = { revision: 1, status: "finalized", snapshot: { km: 100, signatures: { client: { signedAt: "a" }, agence: { signedAt: "b" } } }, media: [{ key: "inspection-standalone/edl_aaaaaaaaaaaaaaaa/depart/v1/photo.jpg" }], pdfKey: "v1.pdf" };
  const v2 = { revision: 2, status: "draft", snapshot: { km: 120, signatures: { client: null, agence: null } }, media: [], pdfKey: null };
  await env.RESERVATIONS_KV.put("standalone-inspection:" + id, JSON.stringify({ id, mode: "depart", dossier: { depart: v1.snapshot, media: { depart: v1.media } }, inspectionRevisions: { depart: [v1, v2] }, createdAt: "2026-10-01", updatedAt: "2026-10-01" }));
  const blocked = await handleStandaloneInspections(agencyRequest("https://getlocation.fr/api/standalone-inspections", { method: "POST", session, body: { action: "create-revision", id, stage: "depart", baseRevision: 1 } }), env);
  assert.equal(blocked.status, 409);
  assert.match((await blocked.json()).error, /V2/);
  const stored = JSON.parse(await env.RESERVATIONS_KV.get("standalone-inspection:" + id)); stored.inspectionRevisions.depart[1].status = "finalized"; stored.inspectionRevisions.depart[1].pdfKey = "v2.pdf"; await env.RESERVATIONS_KV.put("standalone-inspection:" + id, JSON.stringify(stored));
  const created = await handleStandaloneInspections(agencyRequest("https://getlocation.fr/api/standalone-inspections", { method: "POST", session, body: { action: "create-revision", id, stage: "depart", baseRevision: 1 } }), env);
  assert.equal(created.status, 201); const revision = (await created.json()).revision;
  assert.equal(revision.revision, 3); assert.equal(revision.basedOnRevision, 1); assert.equal(revision.snapshot.km, 100); assert.equal(revision.pdfKey, null);
});

test("EDL indépendant finalisé : V2 reste un brouillon modifiable et copie les signatures", async () => {
  const env = makeAgencyEnv({ DOCUMENTS_BUCKET: bucket(), RESERVATIONS_KV: createFakeKv() }), session = await loginAgency(env);
  const id = "edl_bbbbbbbbbbbbbbbb";
  const v1 = { revision: 1, status: "finalized", finalizedAt: "2026-10-13T10:00:00Z", snapshot: { dateHeure: "2026-10-13T10:00", km: 100, carburant: 100, propreteExterieure: 3, propreteInterieure: 3, propreteChargement: null, dommages: "", marks: [], utilityMarks: [], cles: 2, clesAccessoires: "", agent: "Agence", clientSigne: "Client", agenceSigne: "Agence", signatures: { client: { name: "Client", signedAt: "2026-10-13T10:00:00Z", displaySignedAt: "2026-10-13T09:30" }, agence: { name: "Agence", signedAt: "2026-10-13T10:01:00Z" } } }, media: [{ key: "inspection-standalone/edl_bbbbbbbbbbbbbbbb/depart/v1/photo.jpg" }], pdfKey: "v1.pdf" };
  await env.RESERVATIONS_KV.put("standalone-inspection:" + id, JSON.stringify({ id, mode: "depart", status: "finalized", dossier: { depart: { ...v1.snapshot, finalizedAt: v1.finalizedAt }, media: { depart: v1.media } }, inspectionRevisions: { depart: [v1] }, createdAt: "2026-10-01", updatedAt: "2026-10-13" }));
  const response = await handleStandaloneInspections(agencyRequest("https://getlocation.fr/api/standalone-inspections", { method: "POST", session, body: { action: "create-revision", id, stage: "depart", baseRevision: 1 } }), env);
  assert.equal(response.status, 201);
  const v2 = (await response.json()).revision;
  assert.equal(v2.status, "draft"); assert.equal(v2.finalizedAt, null); assert.equal(v2.pdfKey, null);
  assert.deepEqual(v2.snapshot.signatures, v1.snapshot.signatures);
  v2.snapshot.dateHeure = "2026-10-12T18:30"; v2.snapshot.signatures.client.displaySignedAt = "2026-10-12T18:30";
  const saved = await handleStandaloneInspections(agencyRequest("https://getlocation.fr/api/standalone-inspections", { method: "POST", session, body: { action: "update-stage", id, revision: 2, stage: v2.snapshot, finalize: false } }), env);
  assert.equal(saved.status, 200);
  const stored = JSON.parse(await env.RESERVATIONS_KV.get("standalone-inspection:" + id));
  assert.equal(stored.inspectionRevisions.depart[1].snapshot.dateHeure, "2026-10-12T18:30");
  assert.equal(stored.inspectionRevisions.depart[0].snapshot.dateHeure, "2026-10-13T10:00");
  assert.equal(stored.inspectionRevisions.depart[0].snapshot.signatures.client.displaySignedAt, "2026-10-13T09:30");
});

test("liste standalone : transmet V1/V2/V3 en métadonnées légères", async () => {
  const env = makeAgencyEnv({ DOCUMENTS_BUCKET: bucket(), RESERVATIONS_KV: createFakeKv() }), session = await loginAgency(env);
  const id = "edl_cccccccccccccccc";
  const revisions = [1, 2, 3].map((revision) => ({ revision, status: revision === 3 ? "draft" : "finalized", createdAt: `2026-10-0${revision}T10:00:00Z`, finalizedAt: revision === 3 ? null : `2026-10-0${revision}T11:00:00Z`, basedOnRevision: revision === 1 ? null : revision - 1, revisionReason: revision === 3 ? "Ajout dommage" : null, pdfKey: revision === 3 ? null : `inspection-pdf/${id}/depart/v${revision}.pdf`, snapshot: { signatures: { client: { imageDataUrl: "data:image/png;base64,heavy" } } }, media: [{ key: `inspection/${id}/depart/v${revision}/photo.jpg` }] }));
  await env.RESERVATIONS_KV.put("standalone-inspection:" + id, JSON.stringify({ id, mode: "depart", client: {}, vehicule: {}, dossier: { depart: revisions[2].snapshot }, inspectionRevisions: { depart: revisions }, updatedAt: "2026-10-13T12:00:00Z" }));
  const response = await handleStandaloneInspections(agencyRequest("https://getlocation.fr/api/standalone-inspections", { session }), env);
  const item = (await response.json()).inspections[0];
  assert.deepEqual(item.inspectionRevisions.depart.map((revision) => revision.revision), [1, 2, 3]);
  assert.equal(item.inspectionRevisions.depart[2].basedOnRevision, 2);
  assert.equal(item.inspectionRevisions.depart[2].revisionReason, "Ajout dommage");
  assert.equal(item.inspectionRevisions.depart[1].pdfKey, `inspection-pdf/${id}/depart/v2.pdf`);
  assert.equal(JSON.stringify(item.inspectionRevisions).includes("snapshot"), false);
  assert.equal(JSON.stringify(item.inspectionRevisions).includes("imageDataUrl"), false);
  assert.equal(JSON.stringify(item.inspectionRevisions).includes("media"), false);
});

test("EDL standalone : upload et capturedAt restent versionnés sur V4 puis V5", async () => {
  const storage = bucket(), env = makeAgencyEnv({ DOCUMENTS_BUCKET: storage, RESERVATIONS_KV: createFakeKv() }), session = await loginAgency(env);
  const id = "edl_dddddddddddddddd", prefix = `inspection-standalone/${id}/depart/`;
  const revisions = [1, 2, 3].map((revision) => ({ revision, status: "finalized", snapshot: { km: revision }, media: [{ key: `${prefix}v${revision}/historique-${revision}.jpg`, slot: "avant" }], pdfKey: `v${revision}.pdf`, basedOnRevision: revision > 1 ? revision - 1 : null }));
  await env.RESERVATIONS_KV.put("standalone-inspection:" + id, JSON.stringify({ id, mode: "depart", dossier: { depart: revisions[2].snapshot, media: { depart: revisions[2].media } }, inspectionRevisions: { depart: revisions }, createdAt: "2026-10-01", updatedAt: "2026-10-01" }));
  const createV4 = await handleStandaloneInspections(agencyRequest("https://getlocation.fr/api/standalone-inspections", { method: "POST", session, body: { action: "create-revision", id, stage: "depart", baseRevision: 3, revisionReason: "Ajout des photos manquantes" } }), env);
  assert.equal(createV4.status, 201); const createdV4 = (await createV4.json()).revision; assert.equal(createdV4.basedOnRevision, 3); assert.equal(createdV4.revisionReason, "Ajout des photos manquantes");
  const upload = async (revision, name) => {
    const form = new FormData(); form.set("stage", "depart"); form.set("revision", String(revision)); form.set("slot", "avant"); form.set("capturedAt", "2026-10-13T10:00"); form.set("file", new File([name], name + ".jpg", { type: "image/jpeg" }));
    return handleStandaloneInspectionMedia(new Request("https://getlocation.fr/api/standalone-inspection-media?id=" + id, { method: "POST", headers: { origin: "https://getlocation.fr", cookie: "agency_session=" + session.cookie, "x-agency-csrf": session.csrfToken }, body: form }), env);
  };
  const uploadedV4 = await upload(4, "photo-v4");
  assert.equal(uploadedV4.status, 200); assert.match(uploadedV4.headers.get("content-type"), /application\/json/);
  const photoV4 = (await uploadedV4.json()).item; assert.match(photoV4.key, /\/depart\/v4\//);
  const uploadedSecondV4 = await upload(4, "photo-b-v4"); assert.equal(uploadedSecondV4.status, 200);
  const patched = await handleStandaloneInspectionMedia(agencyRequest("https://getlocation.fr/api/standalone-inspection-media?id=" + id, { method: "PATCH", session, body: { key: photoV4.key, stage: "depart", revision: 4, capturedAt: "2026-10-13T11:15" } }), env);
  assert.equal(patched.status, 200);
  let stored = JSON.parse(await env.RESERVATIONS_KV.get("standalone-inspection:" + id));
  const inheritedKey = stored.inspectionRevisions.depart[3].media[0].key;
  const removed = await handleStandaloneInspectionMedia(agencyRequest("https://getlocation.fr/api/standalone-inspection-media?id=" + id, { method: "DELETE", session, body: { key: inheritedKey, stage: "depart", revision: 4 } }), env);
  assert.equal(removed.status, 200);
  stored = JSON.parse(await env.RESERVATIONS_KV.get("standalone-inspection:" + id));
  assert.equal(stored.inspectionRevisions.depart[2].media.length, 1, "V3 reste inchangée");
  assert.equal(stored.inspectionRevisions.depart[3].media.length, 2, "V4 conserve ses deux nouveaux médias après retrait de l'hérité");
  assert.equal(stored.inspectionRevisions.depart[3].media.find((item) => item.key === photoV4.key).capturedAt, "2026-10-13T11:15");
  stored.inspectionRevisions.depart[3].status = "finalized"; stored.inspectionRevisions.depart[3].pdfKey = "v4.pdf";
  await env.RESERVATIONS_KV.put("standalone-inspection:" + id, JSON.stringify(stored));
  const createV5 = await handleStandaloneInspections(agencyRequest("https://getlocation.fr/api/standalone-inspections", { method: "POST", session, body: { action: "create-revision", id, stage: "depart", baseRevision: 4 } }), env);
  assert.equal(createV5.status, 201); assert.equal((await createV5.json()).revision.basedOnRevision, 4);
  const uploadedV5 = await upload(5, "photo-v5"); assert.equal(uploadedV5.status, 200); assert.match((await uploadedV5.json()).item.key, /\/depart\/v5\//);
  stored = JSON.parse(await env.RESERVATIONS_KV.get("standalone-inspection:" + id));
  assert.equal(stored.inspectionRevisions.depart[3].media.length, 2, "V4 reste inchangée");
  assert.equal(stored.inspectionRevisions.depart[4].media.length, 3, "V5 hérite de V4 puis reçoit sa propre photo");
});

test("EDL standalone : une panne R2 renvoie toujours du JSON, jamais une page HTML", async () => {
  const env = makeAgencyEnv({ DOCUMENTS_BUCKET: { async put() { throw new Error("R2 indisponible"); } }, RESERVATIONS_KV: createFakeKv() }), session = await loginAgency(env), id = "edl_eeeeeeeeeeeeeeee";
  await env.RESERVATIONS_KV.put("standalone-inspection:" + id, JSON.stringify({ id, mode: "depart", dossier: { depart: {}, media: { depart: [] } }, inspectionRevisions: { depart: [{ revision: 1, status: "draft", snapshot: {}, media: [] }] } }));
  const form = new FormData(); form.set("stage", "depart"); form.set("revision", "1"); form.set("slot", "avant"); form.set("file", new File(["x"], "x.jpg", { type: "image/jpeg" }));
  const response = await handleStandaloneInspectionMedia(new Request("https://getlocation.fr/api/standalone-inspection-media?id=" + id, { method: "POST", headers: { origin: "https://getlocation.fr", cookie: "agency_session=" + session.cookie, "x-agency-csrf": session.csrfToken }, body: form }), env);
  assert.equal(response.status, 500); assert.match(response.headers.get("content-type"), /application\/json/); assert.match((await response.json()).error, /traitement de la photo/);
});

test("EDL standalone : les uploads ciblent explicitement V2, V3, V4 et V5", async () => {
  for (const revision of [2, 3, 4, 5]) {
    const env = makeAgencyEnv({ DOCUMENTS_BUCKET: bucket(), RESERVATIONS_KV: createFakeKv() }), session = await loginAgency(env), id = `edl_${String(revision).repeat(16)}`;
    const revisions = Array.from({ length: revision }, (_, index) => ({ revision: index + 1, status: index + 1 === revision ? "draft" : "finalized", snapshot: {}, media: [], pdfKey: index + 1 === revision ? null : `v${index + 1}.pdf` }));
    await env.RESERVATIONS_KV.put("standalone-inspection:" + id, JSON.stringify({ id, mode: "depart", dossier: { depart: {}, media: { depart: [] } }, inspectionRevisions: { depart: revisions } }));
    const form = new FormData(); form.set("stage", "depart"); form.set("revision", String(revision)); form.set("slot", "dommage"); form.set("file", new File([`v${revision}`], `v${revision}.jpg`, { type: "image/jpeg" }));
    const response = await handleStandaloneInspectionMedia(new Request("https://getlocation.fr/api/standalone-inspection-media?id=" + id, { method: "POST", headers: { origin: "https://getlocation.fr", cookie: "agency_session=" + session.cookie, "x-agency-csrf": session.csrfToken }, body: form }), env);
    assert.equal(response.status, 200, `upload standalone V${revision}`);
    assert.match((await response.json()).item.key, new RegExp(`/depart/v${revision}/`));
  }
});
