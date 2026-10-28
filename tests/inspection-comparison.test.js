const test = require("node:test");
const assert = require("node:assert/strict");
const { PDFDocument } = require("pdf-lib");
const { handleAgencyInspectionComparison } = require("../src/api/agency-inspection-comparison.js");
const { generateInspectionComparisonPdf } = require("../src/lib/inspection-comparison-pdf.js");
const { makeAgencyEnv, loginAgency, agencyRequest } = require("./helpers/agency-session.js");
const { createFakeKv } = require("./helpers/fake-kv.js");

function bucket() { return { async get() { return null; } }; }
function snapshot(km, note) { return { dateHeure: "2026-10-13T10:00", km, carburant: 80, propreteExterieure: 4, propreteInterieure: 3, cles: 2, clesAccessoires: "Deux clés", dommages: note, sketchVehicleType: "car", marks: [], utilityMarks: [], signatures: {} }; }
function finalized(revision, km, pdfKey) { return { revision, status: "finalized", snapshot: snapshot(km, `V${revision}`), media: [], pdfKey, finalizedAt: `2026-10-1${revision}T10:00:00Z` }; }

test("comparatif lié : choisit les dernières versions finalisées sans réécrire les PDF", async () => {
  const kv = createFakeKv(), env = makeAgencyEnv({ RESERVATIONS_KV: kv, DOCUMENTS_BUCKET: bucket() }), session = await loginAgency(env);
  const id = "res_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const record = { id, status: "paid", contractNumero: "GL-COMPARE", conducteur: { prenom: "Jeanne", nom: "Martin" }, vehicule: { nom: "Peugeot 3008", immatriculation: "AA-123-AA" }, contractDossier: {}, inspectionRevisions: { depart: [finalized(1, 100, "depart-v1.pdf"), finalized(2, 120, "depart-v2.pdf")], retour: [finalized(1, 420, "retour-v1.pdf")] } };
  await kv.put(id, JSON.stringify(record));
  const before = await kv.get(id);
  const response = await handleAgencyInspectionComparison(agencyRequest(`https://getlocation.fr/api/agency-inspection-comparison?source=linked&id=${id}`, { session }), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.equal(response.headers.get("x-inspection-depart-revision"), "2");
  assert.equal(response.headers.get("x-inspection-retour-revision"), "1");
  assert.ok((await PDFDocument.load(await response.arrayBuffer())).getPageCount() >= 1);
  assert.equal(await kv.get(id), before, "le comparatif ne modifie ni les révisions ni les pdfKey");
  const explicit = await handleAgencyInspectionComparison(agencyRequest(`https://getlocation.fr/api/agency-inspection-comparison?source=linked&id=${id}&departRevision=1&retourRevision=1`, { session }), env);
  assert.equal(explicit.status, 200);
  assert.equal(explicit.headers.get("x-inspection-depart-revision"), "1");
  const absent = await handleAgencyInspectionComparison(agencyRequest(`https://getlocation.fr/api/agency-inspection-comparison?source=linked&id=${id}&departRevision=99&retourRevision=1`, { session }), env);
  assert.equal(absent.status, 404, "une version explicite absente ne doit jamais retomber sur la dernière version");
});

test("comparatif indépendant : exige une association départ/retour bidirectionnelle", async () => {
  const kv = createFakeKv(), env = makeAgencyEnv({ RESERVATIONS_KV: kv, DOCUMENTS_BUCKET: bucket() }), session = await loginAgency(env);
  const departId = "edl_aaaaaaaaaaaaaaaa", retourId = "edl_bbbbbbbbbbbbbbbb";
  const depart = { id: departId, kind: "standalone-inspection", mode: "depart", pairedInspectionId: retourId, client: { prenom: "Amir", nom: "Test" }, vehicule: { nom: "Toyota Proace" }, dossier: {}, inspectionRevisions: { depart: [finalized(1, 1000, "depart.pdf")] } };
  const retour = { id: retourId, kind: "standalone-inspection", mode: "retour", pairedInspectionId: departId, client: depart.client, vehicule: depart.vehicule, dossier: {}, inspectionRevisions: { retour: [finalized(1, 1250, "retour.pdf")] } };
  await kv.put("standalone-inspection:" + departId, JSON.stringify(depart));
  await kv.put("standalone-inspection:" + retourId, JSON.stringify(retour));
  const url = `https://getlocation.fr/api/agency-inspection-comparison?source=standalone&departId=${departId}&retourId=${retourId}`;
  const response = await handleAgencyInspectionComparison(agencyRequest(url, { session }), env);
  assert.equal(response.status, 200);
  retour.pairedInspectionId = null;
  await kv.put("standalone-inspection:" + retourId, JSON.stringify(retour));
  const blocked = await handleAgencyInspectionComparison(agencyRequest(url, { session }), env);
  assert.equal(blocked.status, 409);
});

test("comparatif : absent sans deux versions finalisées et protégé par session agence", async () => {
  const kv = createFakeKv(), env = makeAgencyEnv({ RESERVATIONS_KV: kv, DOCUMENTS_BUCKET: bucket() }), session = await loginAgency(env);
  const id = "res_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  await kv.put(id, JSON.stringify({ id, status: "paid", contractDossier: {}, inspectionRevisions: { depart: [finalized(1, 10, "depart.pdf")], retour: [{ revision: 1, status: "draft", snapshot: snapshot(20), media: [], pdfKey: null }] } }));
  const url = `https://getlocation.fr/api/agency-inspection-comparison?source=linked&id=${id}`;
  const unauthorized = await handleAgencyInspectionComparison(new Request(url), env);
  assert.notEqual(unauthorized.status, 200);
  const missing = await handleAgencyInspectionComparison(agencyRequest(url, { session }), env);
  assert.equal(missing.status, 404);
});

test("comparatif : les photos modernes utilisent optimizedKey, les historiques restent compatibles", async () => {
  const requested = [], image = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "images", "opel-corsa.jpg"));
  const env = { DOCUMENTS_BUCKET: { async get(key) { requested.push(key); return { httpMetadata: { contentType: "image/jpeg" }, async arrayBuffer() { return image; } }; } } };
  const revision = (stage, media) => ({ revision: 1, snapshot: snapshot(stage === "depart" ? 10 : 20), media });
  await generateInspectionComparisonPdf({ env, id: "comparison", reference: "GL-COMPARE", depart: revision("depart", [{ key: "depart-original", optimizedKey: "depart-pdf", contentType: "image/jpeg" }]), retour: revision("retour", [{ key: "retour-legacy", contentType: "image/jpeg" }]), vehicle: {}, rental: {} });
  assert.deepEqual(requested, ["depart-pdf", "retour-legacy"]);
});
