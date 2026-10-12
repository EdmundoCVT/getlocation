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
  const form=new FormData();form.set("stage","depart");form.set("slot","avant");form.set("file",new File(["image"],"a.jpg",{type:"image/jpeg"}));
  const uploadRequest=new Request("https://getlocation.fr/api/standalone-inspection-media?id="+inspection.id,{method:"POST",headers:{origin:"https://getlocation.fr",cookie:"agency_session="+session.cookie,"x-agency-csrf":session.csrfToken},body:form});
  const uploaded=await handleStandaloneInspectionMedia(uploadRequest,env); assert.equal(uploaded.status,200); const photo=(await uploaded.json()).item; assert.match(photo.key,new RegExp("^inspection-standalone/"+inspection.id+"/depart/"));
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
