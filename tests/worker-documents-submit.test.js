const test = require("node:test");
const assert = require("node:assert/strict");
const { createFakeKv } = require("./helpers/fake-kv.js");
const { handleDocumentsSubmit } = require("../src/api/documents-submit.js");
const { createReservation, updateReservationStatus, saveDocumentAccessIndex, getReservation } = require("../src/lib/reservation-store.js");
const { issueDocumentAccess } = require("../src/lib/document-access-token.js");

const PEPPER = "submit-pepper-de-test";
function bucket() {
  const objects = new Map();
  return { objects, async put(k,b,o){objects.set(k,{b,o});}, async get(k){return objects.get(k)||null;}, async delete(k){objects.delete(k);} };
}
function env() { return { RESERVATIONS_KV:createFakeKv(), RATE_LIMITS_KV:createFakeKv(), DOCUMENT_TOKEN_PEPPER:PEPPER, DOCUMENTS_BUCKET:bucket() }; }
function jpeg() { return new File([new Uint8Array([0xff,0xd8,0xff,0x00])], "nom-client.jpg", { type:"image/jpeg" }); }
function form(birthDate="1990-01-01") {
  const data = new FormData();
  data.set("birthDate",birthDate); data.set("postalAddress","12 rue Test, Grasse"); data.set("permitNumber","AB12345"); data.set("permitDate","2015-01-01");
  data.set("permis-recto",jpeg()); data.set("permis-verso",jpeg()); data.set("identite",jpeg()); return data;
}
async function setup(e) {
  const start = new Date(Date.now()+5*86400000), end = new Date(Date.now()+6*86400000);
  const reservation = await createReservation(e,{vehiculeId:"opel-corsa",periodeDebut:start.toISOString(),periodeFin:end.toISOString(),conducteur:{naissance:"1990-01-01"},options:[]});
  const issued = await issueDocumentAccess(e,reservation,new Date().toISOString());
  const paid = await updateReservationStatus(e,reservation.id,"paid",{documentsStatus:"pending",documentAccess:issued.stored});
  await saveDocumentAccessIndex(e,paid.id,issued.stored.tokenHash,issued.stored.expiresAt);
  return {paid,token:issued.token};
}
function request(token, data=form()) { return new Request("https://getlocation.fr/api/documents-submit",{method:"POST",headers:{Authorization:`Bearer ${token}`,"cf-connecting-ip":"198.51.100.80"},body:data}); }

test("enregistre trois pièces privées et conserve le statut paid", async () => {
  const e=env(), {paid,token}=await setup(e);
  const response=await handleDocumentsSubmit(request(token),e);
  assert.equal(response.status,200);
  const updated=await getReservation(e,paid.id);
  assert.equal(updated.status,"paid"); assert.equal(updated.documentsStatus,"submitted"); assert.equal(updated.documentFiles.length,3);
  assert.equal(e.DOCUMENTS_BUCKET.objects.size,3);
  for (const key of e.DOCUMENTS_BUCKET.objects.keys()) assert.doesNotMatch(key,/nom-client/);
});

test("refuse une mauvaise date de naissance sans écrire dans R2", async () => {
  const e=env(), {token}=await setup(e);
  const response=await handleDocumentsSubmit(request(token,form("1991-01-01")),e);
  assert.equal(response.status,400); assert.equal(e.DOCUMENTS_BUCKET.objects.size,0);
});

test("refuse si R2 n'est pas configuré", async () => {
  const e=env(), {token}=await setup(e); delete e.DOCUMENTS_BUCKET;
  assert.equal((await handleDocumentsSubmit(request(token),e)).status,503);
});

test("un nouvel envoi remplace les anciens objets", async () => {
  const e=env(), {token}=await setup(e);
  assert.equal((await handleDocumentsSubmit(request(token),e)).status,200);
  const first=[...e.DOCUMENTS_BUCKET.objects.keys()];
  assert.equal((await handleDocumentsSubmit(request(token),e)).status,200);
  assert.equal(e.DOCUMENTS_BUCKET.objects.size,3);
  first.forEach((key)=>assert.equal(e.DOCUMENTS_BUCKET.objects.has(key),false));
});
