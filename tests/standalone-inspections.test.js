const test = require("node:test");
const assert = require("node:assert/strict");
const { handleStandaloneInspections } = require("../src/api/standalone-inspections.js");
const { handleStandaloneInspectionMedia } = require("../src/api/standalone-inspection-media.js");
const { makeAgencyEnv, loginAgency, agencyRequest } = require("./helpers/agency-session.js");
const { createFakeKv } = require("./helpers/fake-kv.js");

function bucket(){const map=new Map();return{async put(key,value,meta){map.set(key,{value,meta});},async get(key){const x=map.get(key);return x&&{body:x.value,writeHttpMetadata(h){h.set("Content-Type",x.meta.httpMetadata.contentType);}}},async delete(key){map.delete(key);}};}
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
  const revisions = [1, 2, 3].map((revision) => ({ revision, status: revision === 3 ? "draft" : "finalized", createdAt: `2026-10-0${revision}T10:00:00Z`, finalizedAt: revision === 3 ? null : `2026-10-0${revision}T11:00:00Z`, basedOnRevision: revision === 1 ? null : revision - 1, pdfKey: revision === 3 ? null : `inspection-pdf/${id}/depart/v${revision}.pdf`, snapshot: { signatures: { client: { imageDataUrl: "data:image/png;base64,heavy" } } }, media: [{ key: `inspection/${id}/depart/v${revision}/photo.jpg` }] }));
  await env.RESERVATIONS_KV.put("standalone-inspection:" + id, JSON.stringify({ id, mode: "depart", client: {}, vehicule: {}, dossier: { depart: revisions[2].snapshot }, inspectionRevisions: { depart: revisions }, updatedAt: "2026-10-13T12:00:00Z" }));
  const response = await handleStandaloneInspections(agencyRequest("https://getlocation.fr/api/standalone-inspections", { session }), env);
  const item = (await response.json()).inspections[0];
  assert.deepEqual(item.inspectionRevisions.depart.map((revision) => revision.revision), [1, 2, 3]);
  assert.equal(item.inspectionRevisions.depart[2].basedOnRevision, 2);
  assert.equal(item.inspectionRevisions.depart[1].pdfKey, `inspection-pdf/${id}/depart/v2.pdf`);
  assert.equal(JSON.stringify(item.inspectionRevisions).includes("snapshot"), false);
  assert.equal(JSON.stringify(item.inspectionRevisions).includes("imageDataUrl"), false);
  assert.equal(JSON.stringify(item.inspectionRevisions).includes("media"), false);
});
