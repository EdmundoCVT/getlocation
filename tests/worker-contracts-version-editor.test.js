const test = require("node:test");
const assert = require("node:assert/strict");
const { createFakeKv } = require("./helpers/fake-kv.js");
const { createFakeD1 } = require("./helpers/fake-d1.js");
const { handleAgencyLogin } = require("../src/api/agency-login.js");
const { handleContractsVersionEditor } = require("../src/api/contracts-version-editor.js");
const { createManualContract, createContractVersion, getReservation, updateContractDossier } = require("../src/lib/reservation-store.js");

function env() { return { RESERVATIONS_KV:createFakeKv(), RATE_LIMITS_KV:createFakeKv(), AGENCY_DB:createFakeD1(), AGENCY_AUTH_PEPPER:"pepper", AGENCY_CODE_EDMUNDO:"code-edmundo-1234" }; }
async function login(environment) {
  const response=await handleAgencyLogin(new Request("https://getlocation.fr/api/agency-login",{method:"POST",headers:{origin:"https://getlocation.fr","cf-connecting-ip":"198.51.100.8","content-type":"application/json"},body:JSON.stringify({code:"code-edmundo-1234"})}),environment);
  const body=await response.json();
  return {cookie:/agency_session=([^;]+)/.exec(response.headers.get("set-cookie"))[1],csrf:body.csrfToken};
}
function request(id, session, body) {
  const headers={origin:"https://getlocation.fr",cookie:`agency_session=${session.cookie}`};
  if(body){headers["content-type"]="application/json";headers["x-agency-csrf"]=session.csrf;}
  return new Request(`https://getlocation.fr/api/contracts-version-editor${body?"":"?id="+id}`,{method:body?"POST":"GET",headers,body:body?JSON.stringify(body):undefined});
}
const form={vehiculeId:"opel-corsa",immat:"AA-123-AA",lieu:"Agence de Grasse",lieuRetour:"Nice",depart:"2026-10-20T10:00",retour:"2026-10-21T10:00",prenom:"Jean",nom:"Dupont",naissance:"01/01/1990",adresse:"1 rue",codePostal:"06130",ville:"Grasse",tel:"0600000000",email:"j@example.test",permis:"P1",protection:"essentielle",langueClient:"fr",modeCaution:"carte",modePaiement:"carte",modePaiementSolde:"carte",contractMileage:{mode:"standard"}};

test("GET ouvre la version dans le formulaire canonique sans aucune écriture", async()=>{
  const environment=env(),session=await login(environment),created=await createManualContract(environment,form,"Edmundo");
  const before=await getReservation(environment,created.id);
  const response=await handleContractsVersionEditor(request(created.id,session),environment);
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.form.nom,"Dupont");
  assert.equal(body.form.lieuRetour,"Nice");
  assert.deepEqual(await getReservation(environment,created.id),before);
});

test("POST save-form édite la même version et conserve les champs internes", async()=>{
  const environment=env(),session=await login(environment),created=await createManualContract(environment,form,"Edmundo");
  const updatedForm={...form,nom:"Martin",cautionContractuelle:1800};
  const response=await handleContractsVersionEditor(request(created.id,session,{action:"save-form",id:created.id,rawData:updatedForm}),environment);
  assert.equal(response.status,200);
  const stored=await getReservation(environment,created.id);
  assert.equal(stored.nom,"Martin");assert.equal(stored.cautionContractuelle,1800);assert.equal(stored.contractVersion.version,1);
});

test("une version finalisée est strictement immuable dans l'éditeur", async()=>{
  const environment=env(),session=await login(environment),created=await createManualContract(environment,form,"Edmundo");
  await updateContractDossier(environment,created.id,{contractDossier:{...created.contractDossier,status:"signed"},contractVersion:{...created.contractVersion,status:"signed"}});
  const response=await handleContractsVersionEditor(request(created.id,session,{action:"save-form",id:created.id,rawData:{...form,nom:"Interdit"}}),environment);
  assert.equal(response.status,409);
  assert.equal((await getReservation(environment,created.id)).nom,"Dupont");
});

test("V2 est préremplie par copie profonde, signature comprise, sans altérer V1", async()=>{
  const environment=env(),session=await login(environment),created=await createManualContract(environment,form,"Edmundo");
  const signature={imageDataUrl:"data:image/png;base64,"+"A".repeat(120),name:"Jean Dupont",signedAt:"2026-10-20T12:00:00.000Z",displaySignedAt:"2026-10-20T14:00",signatureId:"SIG-V1"};
  await updateContractDossier(environment,created.id,{contractDossier:{...created.contractDossier,status:"signed",signature},contractVersion:{...created.contractVersion,status:"signed",signedAt:signature.signedAt}});
  const v1Before=await getReservation(environment,created.id);
  const v2=await createContractVersion(environment,created.id,"Edmundo","Correction client");
  const response=await handleContractsVersionEditor(request(v2.id,session),environment);
  const body=await response.json();
  assert.equal(body.version.version,2);
  assert.equal(body.form.nom,"Dupont");
  assert.deepEqual(body.signature,signature);
  assert.notStrictEqual((await getReservation(environment,v2.id)).contractDossier.signature,v1Before.contractDossier.signature);
  assert.deepEqual(await getReservation(environment,created.id),v1Before);
});
