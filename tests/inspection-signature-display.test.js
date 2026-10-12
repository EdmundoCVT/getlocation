const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { makeAgencyEnv, loginAgency, agencyRequest } = require("./helpers/agency-session.js");
const { createFakeKv } = require("./helpers/fake-kv.js");
const { createReservation, updateReservationStatus, getReservation, updateInspectionSignatureDisplay } = require("../src/lib/reservation-store.js");
const { handleStandaloneInspections } = require("../src/api/standalone-inspections.js");

const image = "data:image/png;base64,aGVsbG8=";
const stage = { dateHeure: "2026-10-12T10:00", km: 12000, carburant: 100, agent: "Edmundo", signatures: { client: { name: "Client", imageDataUrl: image }, agence: { name: "Agence", imageDataUrl: image } } };

test("correction d'heure EDL liée : signedAt est immuable, displaySignedAt et l'audit sont distincts", async () => {
  const env = makeAgencyEnv({ RESERVATIONS_KV: createFakeKv() });
  const reservation = await createReservation(env, { vehiculeId: "opel-corsa", conducteur: { prenom: "Jean", nom: "Dupont" } });
  const signedAt = "2026-10-12T21:12:07.000Z";
  await updateReservationStatus(env, reservation.id, "paid", { contractDossier: { status: "signed", depart: { signatures: { client: { name: "Jean", imageDataUrl: image, signedAt } } } } });
  const result = await updateInspectionSignatureDisplay(env, reservation.id, "depart", "client", "2026-10-12T17:00", "Edmundo");
  const saved = await getReservation(env, reservation.id), signature = saved.contractDossier.depart.signatures.client;
  assert.equal(signature.signedAt, signedAt);
  assert.equal(signature.displaySignedAt, "2026-10-12T17:00");
  assert.deepEqual(result.correction, { role: "client", previousDisplaySignedAt: null, newDisplaySignedAt: "2026-10-12T17:00", correctedAt: result.correction.correctedAt, correctedBy: "Edmundo" });
  await updateInspectionSignatureDisplay(env, reservation.id, "depart", "client", null, "Edmundo");
  assert.equal((await getReservation(env, reservation.id)).contractDossier.depart.signatures.client.displaySignedAt, undefined, "supprimer la correction revient à signedAt");
});

test("correction d'heure EDL indépendant finalisé : conservée et auditée", async () => {
  const env = makeAgencyEnv({ RESERVATIONS_KV: createFakeKv() }), session = await loginAgency(env);
  const created = await handleStandaloneInspections(agencyRequest("https://getlocation.fr/api/standalone-inspections", { method: "POST", session, body: { action: "create", mode: "depart", client: { prenom: "Nicholson", nom: "Joseph" }, vehicule: { nom: "Toyota Proace" } } }), env);
  const id = (await created.json()).inspection.id;
  const saved = await handleStandaloneInspections(agencyRequest("https://getlocation.fr/api/standalone-inspections", { method: "POST", session, body: { action: "update-stage", id, stage, finalize: true } }), env);
  const original = (await saved.json()).inspection.dossier.depart.signatures.client.signedAt;
  const corrected = await handleStandaloneInspections(agencyRequest("https://getlocation.fr/api/standalone-inspections", { method: "POST", session, body: { action: "update-signature-display-time", id, role: "client", displaySignedAt: "2026-10-12T17:00" } }), env);
  const inspection = (await corrected.json()).inspection, signature = inspection.dossier.depart.signatures.client;
  assert.equal(inspection.status, "finalized");
  assert.equal(signature.signedAt, original);
  assert.equal(signature.displaySignedAt, "2026-10-12T17:00");
  assert.equal(inspection.dossier.depart.signatureDisplayCorrections[0].correctedBy, "Edmundo");
  assert.equal(env.AGENCY_DB._raw.auditLog.at(-1).event_type, "inspection_signature_display_time_corrected");
  const resaved = await handleStandaloneInspections(agencyRequest("https://getlocation.fr/api/standalone-inspections", { method: "POST", session, body: { action: "update-stage", id, stage, finalize: false } }), env);
  const afterSave = (await resaved.json()).inspection.dossier.depart.signatures.client;
  assert.equal(afterSave.signedAt, original, "un enregistrement ultérieur ne recrée pas l'heure technique");
  assert.equal(afterSave.displaySignedAt, "2026-10-12T17:00");
});

test("PDF et interface privilégient displaySignedAt sans retirer signedAt", () => {
  const pdf = fs.readFileSync(path.join(__dirname, "..", "js", "inspection-document.js"), "utf8");
  const signatureUi = fs.readFileSync(path.join(__dirname, "..", "js", "inspection-signature.js"), "utf8");
  assert.match(pdf, /value\.displaySignedAt\|\|value\.signedAt/);
  assert.match(signatureUi, /Date et heure affichées/);
  assert.match(signatureUi, /Heure réelle interne/);
});
