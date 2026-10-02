const test = require("node:test");
const assert = require("node:assert/strict");

const { makeAgencyEnv, loginAgency, agencyRequest } = require("./helpers/agency-session.js");
const { createFakeKv } = require("./helpers/fake-kv.js");
const { createManualContract } = require("../src/lib/reservation-store.js");
const { createClient } = require("../src/lib/clients.js");
const { createRental } = require("../src/lib/rentals.js");
const { handleLegacyInspectionAgency } = require("../src/api/legacy-inspection-agency.js");

test("historique manuel : lecture agence seule, départ/retour et métadonnées sans réécriture", async () => {
  const env = makeAgencyEnv({ RESERVATIONS_KV: createFakeKv() });
  const session = await loginAgency(env);
  const record = await createManualContract(env, {
    vehiculeId: "opel-corsa", immat: "AB-123-CD", depart: "2026-08-13T10:00", retour: "2026-08-15T10:00", nom: "Benzaama", prenom: "Israa",
    kmDepart: "42150", kmRetour: "42736",
    etatDepart: { marks: [{ id: "m1", view: "side", x: 25, y: 40, type: "rayure" }], observations: "Rayure porte conducteur", carburant: 75, proprete: "4/5", clesAccessoires: "2 clés" },
    etatRetour: { marks: [{ id: "m2", view: "front", x: 50, y: 25, type: "impact" }], observations: "Impact constaté au retour", carburant: 50 },
    photosEtatDesLieux: [{ label: "Départ avant", dateHeure: "2026-08-13T10:05", dataUrl: "data:image/jpeg;base64,AA==" }, { label: "Retour arrière", capturedAt: "2026-08-15T10:10", dataUrl: "data:image/jpeg;base64,BB==" }]
  }, "Edmundo");
  const before = await env.RESERVATIONS_KV.get(record.id);

  const noSession = await handleLegacyInspectionAgency(agencyRequest(`https://getlocation.fr/api/legacy-inspection-agency?id=${record.id}`), env);
  assert.equal(noSession.status, 401);
  const response = await handleLegacyInspectionAgency(agencyRequest(`https://getlocation.fr/api/legacy-inspection-agency?id=${record.id}`, { session }), env);
  assert.equal(response.status, 200);
  const { inspection } = await response.json();
  assert.equal(inspection.depart.km, "42150");
  assert.equal(inspection.depart.carburant, "75");
  assert.equal(inspection.depart.marques[0].type, "rayure");
  assert.equal(inspection.depart.photos[0].dateHeure, "2026-08-13T10:05");
  assert.equal(inspection.retour.km, "42736");
  assert.equal(inspection.retour.marques[0].type, "impact");
  assert.equal(inspection.retour.photos[0].capturedAt, "2026-08-15T10:10");
  assert.equal(await env.RESERVATIONS_KV.get(record.id), before, "une consultation ne modifie jamais le contrat historique");
  assert.ok(!JSON.stringify(inspection).includes("manualClientAccess"));
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
