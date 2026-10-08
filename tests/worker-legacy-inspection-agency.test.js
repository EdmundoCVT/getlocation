const test = require("node:test");
const assert = require("node:assert/strict");

const { makeAgencyEnv, loginAgency, agencyRequest } = require("./helpers/agency-session.js");
const { createFakeKv } = require("./helpers/fake-kv.js");
const { createManualContract } = require("../src/lib/reservation-store.js");
const { createClient } = require("../src/lib/clients.js");
const { createRental } = require("../src/lib/rentals.js");
const { handleLegacyInspectionAgency, handleLegacyInspectionMedia, handleLegacyInspectionDiagnostic, ZVEZDAN_LEGACY_ID } = require("../src/api/legacy-inspection-agency.js");

function fakeBucket() {
  const objects = new Map();
  return {
    async put(key, body, options = {}) { objects.set(key, { body, options }); },
    async get(key) {
      const object = objects.get(key);
      if (!object) return null;
      return { body: new Blob([object.body]).stream(), writeHttpMetadata(headers) { headers.set("content-type", object.options.contentType || "image/jpeg"); } };
    },
    async list({ prefix = "" } = {}) {
      return { objects: [...objects.entries()].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, size: String(value.body).length, uploaded: new Date("2026-09-25T19:30:00.000Z") })), truncated: false };
    }
  };
}

test("historique manuel : lecture agence seule, départ/retour et métadonnées sans réécriture", async () => {
  const env = makeAgencyEnv({ RESERVATIONS_KV: createFakeKv() });
  const session = await loginAgency(env);
  const record = await createManualContract(env, {
    vehiculeId: "opel-corsa", immat: "AB-123-CD", depart: "2026-08-13T10:00", retour: "2026-08-15T10:00", nom: "Benzaama", prenom: "Israa",
    kmDepart: "42150", kmRetour: "42736",
    etatDepart: { km: 42151, marks: [{ id: "m1", view: "left", x: 25, y: 40, type: "rayure" }], observations: "Rayure porte conducteur", carburant: 75, proprete: "4/5", cles: 2, clesAccessoires: "Carte grise", agent: "Edmundo", clientSigne: "Client départ", agenceSigne: "Agence départ", photosRef: "2 photos départ" },
    etatRetour: { marks: [{ id: "m2", view: "front", x: 50, y: 25, type: "impact" }], observations: "Impact constaté au retour", carburant: 50 },
    photosEtatDesLieux: [{ label: "Départ avant", dateHeure: "2026-08-13T10:05", dataUrl: "data:image/jpeg;base64,AA==" }, { label: "Retour arrière", capturedAt: "2026-08-15T10:10", dataUrl: "data:image/jpeg;base64,BB==" }]
  }, "Edmundo");
  // Simule le document KV historique tel qu'il était stocké avant que la
  // création de contrats ne sépare explicitement contrat et inspection.
  const historic = JSON.parse(await env.RESERVATIONS_KV.get(record.id));
  delete historic.inspectionSchema;
  historic.contractDossier = { depart: { km: 41000, dateHeure: "2026-08-13T10:00", proprete: "fallback non retenu" }, retour: { km: 42737, dateHeure: "2026-08-15T10:00", proprete: "3/5", clesAccessoires: "Chargeur", agent: "Antonio", clientSigne: "Client retour", agenceSigne: "Agence retour" }, signature: { signedAt: "2026-08-13T09:55:00.000Z", signatureId: "SIG-1", imageDataUrl: "data:image/png;base64,AA==" }, media: { depart: [], retour: [] } };
  await env.RESERVATIONS_KV.put(record.id, JSON.stringify(historic));
  const before = await env.RESERVATIONS_KV.get(record.id);

  const noSession = await handleLegacyInspectionAgency(agencyRequest(`https://getlocation.fr/api/legacy-inspection-agency?id=${record.id}`), env);
  assert.equal(noSession.status, 401);
  const response = await handleLegacyInspectionAgency(agencyRequest(`https://getlocation.fr/api/legacy-inspection-agency?id=${record.id}`, { session }), env);
  assert.equal(response.status, 200);
  const { inspection } = await response.json();
  assert.equal(inspection.depart.km, "42151", "etatDepart est prioritaire sur contractDossier et le champ racine");
  assert.equal(inspection.depart.carburant, "75");
  assert.equal(inspection.depart.marques[0].type, "rayure");
  assert.equal(inspection.depart.cles, "2");
  assert.equal(inspection.depart.agent, "Edmundo");
  assert.equal(inspection.depart.clientSigne, "Client départ");
  assert.equal(inspection.depart.agenceSigne, "Agence départ");
  assert.equal(inspection.depart.photos[0].dateHeure, "2026-08-13T10:05");
  assert.equal(inspection.retour.km, "42737", "contractDossier est utilisé si etatRetour ne porte pas le kilométrage");
  assert.equal(inspection.retour.marques[0].type, "impact");
  assert.equal(inspection.retour.proprete, "3/5");
  assert.equal(inspection.retour.clientSigne, "Client retour");
  assert.equal(inspection.retour.photos[0].capturedAt, "2026-08-15T10:10");
  assert.equal(inspection.contractSignature.signatureId, "SIG-1");
  assert.equal(await env.RESERVATIONS_KV.get(record.id), before, "une consultation ne modifie jamais le contrat historique");
  assert.ok(!JSON.stringify(inspection).includes("manualClientAccess"));
});

test("média R2 historique : lecture réservée à la session, clé listée et préfixe du dossier", async () => {
  const bucket = fakeBucket();
  const env = makeAgencyEnv({ RESERVATIONS_KV: createFakeKv(), DOCUMENTS_BUCKET: bucket });
  const session = await loginAgency(env);
  const record = await createManualContract(env, {
    vehiculeId: "peugeot-2008", depart: "2026-09-16T19:00", retour: "2026-09-25T19:00", nom: "VRBICA", prenom: "ZVEZDAN"
  }, "Edmundo");
  const key = `inspection/${record.id}/depart/photo.jpg`;
  const otherKey = `inspection/res_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/depart/other.jpg`;
  const stored = JSON.parse(await env.RESERVATIONS_KV.get(record.id));
  delete stored.inspectionSchema;
  stored.contractDossier = { media: { depart: [], retour: [] } };
  stored.contractDossier.media.depart.push({ key, slot: "avant", createdAt: "2026-09-16T19:05:00.000Z" });
  await env.RESERVATIONS_KV.put(record.id, JSON.stringify(stored));
  await bucket.put(key, "photo", { contentType: "image/jpeg" });

  const noSession = await handleLegacyInspectionMedia(agencyRequest(`https://getlocation.fr/api/legacy-inspection-media?id=${record.id}&key=${encodeURIComponent(key)}`), env);
  assert.equal(noSession.status, 401);
  const allowed = await handleLegacyInspectionMedia(agencyRequest(`https://getlocation.fr/api/legacy-inspection-media?id=${record.id}&key=${encodeURIComponent(key)}`, { session }), env);
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get("cache-control"), "private, no-store");
  const refused = await handleLegacyInspectionMedia(agencyRequest(`https://getlocation.fr/api/legacy-inspection-media?id=${record.id}&key=${encodeURIComponent(otherKey)}`, { session }), env);
  assert.equal(refused.status, 403);
});

test("diagnostic Zvezdan : lecture KV/R2 limitée, sans image binaire ni écriture", async () => {
  const bucket = fakeBucket();
  const env = makeAgencyEnv({ RESERVATIONS_KV: createFakeKv(), DOCUMENTS_BUCKET: bucket });
  const session = await loginAgency(env);
  const returnKey = `inspection/${ZVEZDAN_LEGACY_ID}/retour/dommage.jpg`;
  const record = {
    id: ZVEZDAN_LEGACY_ID, status: "manual_contract", kmRetour: 4210,
    etatDepart: { km: 4083 },
    etatRetour: { dateHeure: "2026-09-25T19:00", km: 4210, carburant: 40, proprete: "3/5", dommages: "Impact pare-chocs", cles: 2, clesAccessoires: "Carte grise", agent: "Edmundo", clientSigne: "Zvezdan", agenceSigne: "Edmundo", marks: [{ view: "rear", x: 50, y: 60, type: "bosse" }] },
    photosEtatDesLieux: [{ label: "Retour dommage", dataUrl: "data:image/jpeg;base64,NOT_EXPOSED" }],
    contractDossier: { retour: { observations: "Vu avec le client" }, media: { depart: [], retour: [{ key: returnKey, slot: "dommage" }] }, signature: { imageDataUrl: "data:image/png;base64,NOT_EXPOSED" } }
  };
  await env.RESERVATIONS_KV.put(ZVEZDAN_LEGACY_ID, JSON.stringify(record));
  await bucket.put(returnKey, "binary-photo", { contentType: "image/jpeg" });
  const before = await env.RESERVATIONS_KV.get(ZVEZDAN_LEGACY_ID);

  const noSession = await handleLegacyInspectionDiagnostic(agencyRequest("https://getlocation.fr/api/legacy-inspection-diagnostic"), env);
  assert.equal(noSession.status, 401);
  const response = await handleLegacyInspectionDiagnostic(agencyRequest("https://getlocation.fr/api/legacy-inspection-diagnostic", { session }), env);
  assert.equal(response.status, 200);
  const diagnostic = await response.json();
  assert.deepEqual(diagnostic.etatRetour.keys.sort(), ["agent", "agenceSigne", "carburant", "clientSigne", "cles", "clesAccessoires", "dateHeure", "dommages", "km", "marks", "proprete"].sort());
  assert.equal(diagnostic.etatRetour.values.clientSigne, "Zvezdan");
  assert.equal(diagnostic.photosEtatDesLieux.retourCount, 1);
  assert.equal(diagnostic.contractDossier.mediaRetour.count, 1);
  assert.equal(diagnostic.contractDossier.signaturePresent, true);
  assert.equal(diagnostic.r2Retour.count, 1);
  assert.equal(diagnostic.r2Retour.objects[0].key, returnKey);
  assert.ok(!JSON.stringify(diagnostic).includes("NOT_EXPOSED"), "le diagnostic ne renvoie jamais les images binaires");
  assert.equal(await env.RESERVATIONS_KV.get(ZVEZDAN_LEGACY_ID), before, "diagnostic strictement en lecture seule");
});

test("location D1 : consulte les relevés existants seulement", async () => {
  const env = makeAgencyEnv({ RESERVATIONS_KV: createFakeKv() });
  const session = await loginAgency(env);
  const client = await createClient(env, { firstName: "Jean", lastName: "Dupont" }, "Edmundo");
  const rental = await createRental(env, client.id, { vehiculeId: "peugeot-3008", dateDebut: "2026-06-01", heureDebut: "09:00", dateFin: "2026-06-04", heureFin: "09:00", kmDepart: 32000, kmRetour: 32520 }, "Edmundo");
  const response = await handleLegacyInspectionAgency(agencyRequest(`https://getlocation.fr/api/legacy-inspection-agency?id=${rental.id}`, { session }), env);
  assert.equal(response.status, 200);
  const { inspection } = await response.json();
  assert.equal(inspection.source, "rental-record");
  assert.equal(inspection.depart.km, 32000);
  assert.equal(inspection.retour.km, 32520);
  assert.deepEqual(inspection.depart.photos, []);
});
