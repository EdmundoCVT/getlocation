const test = require("node:test");
const assert = require("node:assert/strict");
const { createFakeKv } = require("./helpers/fake-kv.js");
const { makeAgencyEnv, loginAgency, agencyRequest, nextIp } = require("./helpers/agency-session.js");
const { handleContractsManualCreate } = require("../src/api/contracts-manual-create.js");
const { handleContractsManualUpdate } = require("../src/api/contracts-manual-update.js");
const { handleAgencyRentals } = require("../src/api/agency-rentals.js");
const { handleContractAgencyLink } = require("../src/api/contract-agency-link.js");
const { handleContractDossierAgency } = require("../src/api/contract-dossier-agency.js");
const { handleInspectionMedia } = require("../src/api/inspection-media.js");
const { createManualContract } = require("../src/lib/reservation-store.js");

const rawData = {
  vehiculeId: "opel-corsa", depart: "2026-10-10T10:00", retour: "2026-10-12T10:00",
  nom: "Martin", prenom: "Anne", immat: "AA-123-BB", kmDepart: "4083", signatureClient: "signature du contrat",
  etatDepart: { marks: [], observations: "" }, etatRetour: { marks: [], observations: "" }
};
function env() {
  const objects = new Map();
  return makeAgencyEnv({
    RESERVATIONS_KV: createFakeKv(), RATE_LIMITS_KV: createFakeKv(), DOCUMENT_TOKEN_PEPPER: "manual-inspection-test-pepper",
    DOCUMENTS_BUCKET: {
      async put(key, body, options) { objects.set(key, { body, options }); },
      async get(key) { const item = objects.get(key); return item ? { body: new Blob([item.body]).stream(), writeHttpMetadata(headers) { headers.set("Content-Type", item.options.httpMetadata.contentType); } } : null; },
      async delete(key) { objects.delete(key); }
    }
  });
}
async function list(e, session) {
  const response = await handleAgencyRentals(agencyRequest("https://getlocation.fr/api/agency-rentals?view=inspection", { session }), e);
  assert.equal(response.status, 200);
  return (await response.json()).rentals;
}
function bearer(url, token, method = "GET", body) {
  return new Request(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, "cf-connecting-ip": nextIp(), ...(body && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {})
  });
}

test("contrat manuel : km du contrat ne termine pas l'EDL, accès sécurisé, média puis validation explicite", async () => {
  const e = env(), session = await loginAgency(e);
  const created = await handleContractsManualCreate(agencyRequest("https://getlocation.fr/api/contracts-manual-create", { method: "POST", session, body: { rawData } }), e);
  assert.equal(created.status, 200);
  const { id, numero } = await created.json();
  const initial = (await list(e, session)).find((item) => item.id === id);
  assert.equal(initial.contractNumero, numero);
  assert.equal(initial.openable, true);
  assert.equal(initial.historyMode, null);
  assert.deepEqual(initial.inspection, { depart: false, retour: false, retourAvailable: false });

  const anonymous = await handleContractAgencyLink(agencyRequest("https://getlocation.fr/api/contract-agency-link", { method: "POST", body: { id } }), e);
  assert.equal(anonymous.status, 401);
  const linkResponse = await handleContractAgencyLink(agencyRequest("https://getlocation.fr/api/contract-agency-link", { method: "POST", session, body: { id } }), e);
  assert.equal(linkResponse.status, 200);
  const { agencyUrl } = await linkResponse.json();
  assert.match(agencyUrl, /^https:\/\/getlocation\.fr\/etat-des-lieux\.html#agencyToken=/);
  assert.equal(agencyUrl.includes("manualToken"), false);
  const token = new URLSearchParams(new URL(agencyUrl).hash.slice(1)).get("agencyToken");
  const view = await handleContractDossierAgency(bearer("https://getlocation.fr/api/contract-dossier-agency", token), e);
  assert.equal(view.status, 200);
  const details = await view.json();
  assert.equal(details.reservation.contractNumero, numero);
  assert.equal(details.reservation.conducteur.nom, "Martin");
  assert.equal(details.reservation.dateDebut, "2026-10-10");
  assert.equal(details.dossier.depart, null);
  assert.equal((await list(e, session)).find((item) => item.id === id).inspection.depart, false, "ouvrir sans enregistrer reste À faire");

  const photo = new FormData();
  photo.append("stage", "depart"); photo.append("slot", "avant"); photo.append("file", new Blob(["original"], { type: "image/jpeg" }), "avant.jpg");
  const upload = await handleInspectionMedia(bearer("https://getlocation.fr/api/inspection-media", token, "POST", photo), e);
  assert.equal(upload.status, 200);
  const uploaded = (await upload.json()).item;
  assert.match(uploaded.key, new RegExp(`^inspection/${id}/depart/`));
  assert.equal((await list(e, session)).find((item) => item.id === id).inspection.depart, false, "une photo seule ne termine pas le départ");

  const save = await handleContractDossierAgency(bearer("https://getlocation.fr/api/contract-dossier-agency", token, "POST", {
    action: "update-depart", dateHeure: "2026-10-10T10:15", km: 4083, carburant: 80, agent: "Edmundo",
    marks: [{ id: "m1", view: "left", type: "rayure", x: 20, y: 30 }], propreteExterieure: 4, propreteInterieure: 5
  }), e);
  assert.equal(save.status, 200);
  const saved = await save.json();
  assert.match(saved.dossier.depart.completedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(saved.dossier.media.depart[0].key, uploaded.key);
  assert.deepEqual((await list(e, session)).find((item) => item.id === id).inspection, { depart: true, retour: false, retourAvailable: true });

  // Une mise à jour ultérieure du contrat conserve le dossier EDL et son accès.
  const update = await handleContractsManualUpdate(agencyRequest("https://getlocation.fr/api/contracts-manual-update", { method: "POST", session, body: { id, rawData: { ...rawData, kmDepart: "4090", contractDossier: { depart: { completedAt: "forged" } }, contractAgencyAccess: { tokenHash: "forged" } } } }), e);
  assert.equal(update.status, 200);
  assert.equal((await handleContractDossierAgency(bearer("https://getlocation.fr/api/contract-dossier-agency", token), e)).status, 200);
  const persisted = JSON.parse(await e.RESERVATIONS_KV.get(id));
  assert.equal(persisted.contractDossier.depart.km, 4083);
  assert.notEqual(persisted.contractDossier.depart.completedAt, "forged");
  assert.notEqual(persisted.contractAgencyAccess.tokenHash, "forged");
  assert.equal(persisted.contractDossier.media.depart[0].key, uploaded.key);
  assert.equal(persisted.kmDepart, "4090");
  assert.equal(persisted.signatureClient, "signature du contrat");
});

test("ancien contrat manuel : marques et photos historiques restent consultables sans statut fondé sur km seul", async () => {
  const e = env(), session = await loginAgency(e);
  const historic = await createManualContract(e, { ...rawData, etatDepart: { marks: [{ id: "a", view: "left", x: 5, y: 10, type: "rayure" }], observations: "" } }, "Edmundo");
  const old = JSON.parse(await e.RESERVATIONS_KV.get(historic.id));
  delete old.inspectionSchema;
  await e.RESERVATIONS_KV.put(historic.id, JSON.stringify(old));
  const found = (await list(e, session)).find((item) => item.id === historic.id);
  assert.equal(found.historyMode, "manual-contract");
  assert.equal(found.inspection.depart, true);
  assert.equal(found.inspection.retour, false);
  const onlyKm = await createManualContract(e, {
    ...rawData, depart: "2026-10-20T10:00", retour: "2026-10-22T10:00"
  }, "Edmundo");
  const unmarked = JSON.parse(await e.RESERVATIONS_KV.get(onlyKm.id));
  delete unmarked.inspectionSchema;
  await e.RESERVATIONS_KV.put(onlyKm.id, JSON.stringify(unmarked));
  const kmRecord = (await list(e, session)).find((item) => item.id === onlyKm.id);
  assert.equal(kmRecord.inspection.depart, false);
  assert.equal(kmRecord.openable, true);
  const oldLink = await handleContractAgencyLink(agencyRequest("https://getlocation.fr/api/contract-agency-link", { method: "POST", session, body: { id: historic.id } }), e);
  assert.equal(oldLink.status, 409, "un vrai historique reste dans la consultation legacy");
  const modernLink = await handleContractAgencyLink(agencyRequest("https://getlocation.fr/api/contract-agency-link", { method: "POST", session, body: { id: onlyKm.id } }), e);
  assert.equal(modernLink.status, 200);
  assert.equal(JSON.parse(await e.RESERVATIONS_KV.get(onlyKm.id)).inspectionSchema, "modern");
  const token = new URLSearchParams(new URL((await modernLink.json()).agencyUrl).hash.slice(1)).get("agencyToken");
  const photo = new FormData();
  photo.append("stage", "depart"); photo.append("slot", "avant");
  photo.append("file", new Blob(["photo"], { type: "image/jpeg" }), "avant.jpg");
  assert.equal((await handleInspectionMedia(bearer("https://getlocation.fr/api/inspection-media", token, "POST", photo), e)).status, 200);
  const afterPhoto = (await list(e, session)).find((item) => item.id === onlyKm.id);
  assert.equal(afterPhoto.inspection.depart, false);
  assert.equal(afterPhoto.historyMode, null);
});
