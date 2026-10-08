// tests/worker-agency-rentals.test.js
//
// src/api/agency-rentals.js — session requise, CSRF/origine sur les
// écritures, client vérifié avant création, génération de contrat.

const test = require("node:test");
const assert = require("node:assert/strict");

const { makeAgencyEnv, loginAgency, agencyRequest } = require("./helpers/agency-session.js");
const { createFakeKv } = require("./helpers/fake-kv.js");
const { handleAgencyClients } = require("../src/api/agency-clients.js");
const { handleAgencyRentals } = require("../src/api/agency-rentals.js");
const { createReservation, updateReservationStatus, createManualContract } = require("../src/lib/reservation-store.js");
const { createRental } = require("../src/lib/rentals.js");
const { generateContractNumero } = require("../src/lib/contract-numero.js");

const dataValide = {
  vehiculeId: "opel-corsa",
  dateDebut: "2026-09-10",
  heureDebut: "10:00",
  dateFin: "2026-09-12",
  heureFin: "10:00"
};

async function creerClient(env, session) {
  const res = await handleAgencyClients(
    agencyRequest("https://getlocation.fr/api/agency-clients", { method: "POST", session, body: { action: "create", data: { firstName: "Jean", lastName: "Dupont" } } }),
    env
  );
  return (await res.json()).client;
}

test("GET : 401 sans session agence", async () => {
  const res = await handleAgencyRentals(agencyRequest("https://getlocation.fr/api/agency-rentals?id=rnt_x"), makeAgencyEnv());
  assert.equal(res.status, 401);
});

test("GET view=inspection : agrège KV/D1, reconnaît l'historique et ne renvoie aucune donnée sensible", async () => {
  const env = makeAgencyEnv({ RESERVATIONS_KV: createFakeKv() });
  const session = await loginAgency(env);
  const webSansEtat = await createReservation(env, {
    vehiculeId: "opel-corsa", dateDebut: "2027-09-10", heureDebut: "10:00", dateFin: "2027-09-11", heureFin: "10:00",
    conducteur: { prenom: "Jean", nom: "Dupont", email: "prive@example.com", telephone: "0600000000", permitNumber: "AA123" }
  });
  await updateReservationStatus(env, webSansEtat.id, "paid");

  const duplicateContractNumero = await generateContractNumero(env);
  const webAvecDepart = await createReservation(env, {
    vehiculeId: "opel-corsa", dateDebut: "2027-09-12", heureDebut: "10:00", dateFin: "2027-09-13", heureFin: "10:00",
    conducteur: { prenom: "Jean", nom: "Dupont", email: "prive@example.com" }
  });
  await updateReservationStatus(env, webAvecDepart.id, "paid", {
    inspectionSchema: null, // ancien dossier d'avant l'indicateur explicite
    contractNumero: duplicateContractNumero,
    contractDossier: { depart: { km: 12000 }, media: { retour: [{ key: "inspection/x/retour.jpg" }] } }
  });

  // Ancien contrat manuel conservé en KV : le croquis et les photos ne sont
  // pas déplacés, mais son historique est rendu dans la vue globale.
  const manual = await createManualContract(env, {
    vehiculeId: "peugeot-2008", immat: "AB-123-CD", depart: "2026-08-13T10:00", retour: "2026-08-15T10:00", nom: "Benzaama", prenom: "Israa",
    etatDepart: { marks: [{ id: "m1", view: "side", x: 10, y: 10, type: "rayure" }], observations: "" },
    etatRetour: { marks: [], observations: "Retour conforme" },
    photosEtatDesLieux: [{ label: "Départ avant" }, { label: "Retour arrière" }]
  }, "Edmundo");
  const oldManual = JSON.parse(await env.RESERVATIONS_KV.get(manual.id));
  delete oldManual.inspectionSchema;
  await env.RESERVATIONS_KV.put(manual.id, JSON.stringify(oldManual));

  const client = await creerClient(env, session);
  // Ancienne location D1 déjà terminée : D1 ne contient pas les binaires
  // photos, uniquement les relevés opérationnels existants.
  const d1Historique = await createRental(env, client.id, {
    vehiculeId: "peugeot-3008", immatriculation: "CD-456-EF", dateDebut: "2026-06-01", heureDebut: "09:00", dateFin: "2026-06-04", heureFin: "09:00", kmDepart: 32000, kmRetour: 32520
  }, "Edmundo");
  // Même location présente dans les deux sources mais sans identifiant
  // croisé : le rapprochement historique strict (client/véhicule/dates)
  // doit empêcher la double carte GL/rnt_.
  const d1Duplicate = await createRental(env, client.id, {
    vehiculeId: "opel-corsa", dateDebut: "2027-09-12", heureDebut: "10:00", dateFin: "2027-09-13", heureFin: "10:00", kmDepart: 12000, kmRetour: 12100
  }, "Edmundo");

  const unauthenticated = await handleAgencyRentals(agencyRequest("https://getlocation.fr/api/agency-rentals?view=inspection"), env);
  assert.equal(unauthenticated.status, 401);
  const body = await (await handleAgencyRentals(agencyRequest("https://getlocation.fr/api/agency-rentals?view=inspection", { session }), env)).json();
  assert.equal(body.rentals.length, 4, "KV payé, contrat manuel et locations D1 sont présents, sans doublon");
  assert.deepEqual(Object.keys(body.rentals[0]).sort(), ["client", "contractNumero", "dateDebut", "dateFin", "heureDebut", "heureFin", "historyId", "historyMode", "id", "immatriculation", "inspection", "openable", "source", "vehicule", "vehiculeId"].sort());
  const sansEtatDesLieux = body.rentals.find((rental) => rental.id === webSansEtat.id);
  assert.deepEqual(sansEtatDesLieux.inspection, { depart: false, retour: false, retourAvailable: false });
  assert.equal(sansEtatDesLieux.openable, true);
  assert.equal(sansEtatDesLieux.historyMode, null);
  assert.equal(sansEtatDesLieux.historyId, null);
  const deduplicated = body.rentals.find((rental) => rental.id === webAvecDepart.id);
  assert.deepEqual(deduplicated.inspection, { depart: true, retour: true, retourAvailable: true }, "les données existantes de chaque source sont conservées lors de la déduplication");
  assert.equal(deduplicated.openable, true, "la source KV ouvrable reste prioritaire");
  assert.equal(deduplicated.historyMode, "rental-record", "la carte fusionnée conserve l'accès à l'historique D1");
  assert.equal(deduplicated.historyId, d1Duplicate.id);
  const manualHistorique = body.rentals.find((rental) => rental.id === manual.id);
  assert.deepEqual(manualHistorique.inspection, { depart: true, retour: true, retourAvailable: true });
  assert.equal(manualHistorique.openable, false);
  assert.equal(manualHistorique.historyMode, "manual-contract");
  assert.equal(manualHistorique.historyId, manual.id);
  const d1Terminee = body.rentals.find((rental) => rental.id === d1Historique.id);
  assert.deepEqual(d1Terminee.inspection, { depart: true, retour: true, retourAvailable: true });
  assert.equal(d1Terminee.client.nom, "Dupont");
  assert.equal(d1Terminee.historyMode, "rental-record");
  assert.equal(d1Terminee.historyId, d1Historique.id);
  assert.equal(JSON.stringify(body).includes("permit"), false);
  assert.equal(JSON.stringify(body).includes("token"), false);
  assert.equal(JSON.stringify(body).includes("prive@example.com"), false);
  assert.equal(JSON.stringify(body).includes("0600000000"), false);
});

test("contrat manuel moderne fusionné avec D1 : le km historique ne valide pas l'EDL", async () => {
  const env = makeAgencyEnv({ RESERVATIONS_KV: createFakeKv() });
  const session = await loginAgency(env);
  const manual = await createManualContract(env, {
    vehiculeId: "opel-corsa", depart: "2026-10-10T10:00", retour: "2026-10-12T10:00",
    prenom: "Jean", nom: "Dupont", kmDepart: 12345,
    // Une valeur forgée par le formulaire contrat ne crée pas un EDL validé.
    contractDossier: { depart: { completedAt: "2026-10-10T10:00:00.000Z" } }
  }, "Edmundo");
  const client = await creerClient(env, session);
  await createRental(env, client.id, {
    vehiculeId: "opel-corsa", dateDebut: "2026-10-10", heureDebut: "10:00",
    dateFin: "2026-10-12", heureFin: "10:00", kmDepart: 12345
  }, "Edmundo");
  const response = await handleAgencyRentals(agencyRequest("https://getlocation.fr/api/agency-rentals?view=inspection", { session }), env);
  const items = (await response.json()).rentals;
  assert.equal(items.length, 1);
  assert.equal(items[0].id, manual.id);
  assert.deepEqual(items[0].inspection, { depart: false, retour: false, retourAvailable: false });
  assert.equal(items[0].historyMode, null);
  assert.equal(items[0].openable, true);
});

test("POST create : 403 sans origine autorisée", async () => {
  const env = makeAgencyEnv();
  const session = await loginAgency(env);
  const client = await creerClient(env, session);
  const req = new Request("https://getlocation.fr/api/agency-rentals", {
    method: "POST",
    headers: { origin: "https://evil.example", "content-type": "application/json", cookie: `agency_session=${session.cookie}`, "x-agency-csrf": session.csrfToken },
    body: JSON.stringify({ action: "create", clientId: client.id, data: dataValide })
  });
  const res = await handleAgencyRentals(req, env);
  assert.equal(res.status, 403);
});

test("POST create : 404 si le client n'existe pas", async () => {
  const env = makeAgencyEnv();
  const session = await loginAgency(env);
  const res = await handleAgencyRentals(
    agencyRequest("https://getlocation.fr/api/agency-rentals", { method: "POST", session, body: { action: "create", clientId: "clt_inconnu", data: dataValide } }),
    env
  );
  assert.equal(res.status, 404);
});

test("cas nominal : création, lecture par id, par client, mise à jour, génération du contrat", async () => {
  const env = makeAgencyEnv();
  const session = await loginAgency(env);
  const client = await creerClient(env, session);

  const createRes = await handleAgencyRentals(
    agencyRequest("https://getlocation.fr/api/agency-rentals", { method: "POST", session, body: { action: "create", clientId: client.id, data: dataValide } }),
    env
  );
  assert.equal(createRes.status, 200);
  const { rental } = await createRes.json();
  assert.equal(rental.createdBy, "Edmundo");
  assert.equal(rental.contractNumero, null);

  const byId = await (await handleAgencyRentals(agencyRequest(`https://getlocation.fr/api/agency-rentals?id=${rental.id}`, { session }), env)).json();
  assert.equal(byId.rental.id, rental.id);

  const byClient = await (await handleAgencyRentals(agencyRequest(`https://getlocation.fr/api/agency-rentals?clientId=${client.id}`, { session }), env)).json();
  assert.equal(byClient.rentals.length, 1);

  const updateRes = await handleAgencyRentals(
    agencyRequest("https://getlocation.fr/api/agency-rentals", { method: "POST", session, body: { action: "update", id: rental.id, data: { ...dataValide, kmDepart: 42000 } } }),
    env
  );
  const { rental: updated } = await updateRes.json();
  assert.equal(updated.kmDepart, 42000);

  const contractRes = await handleAgencyRentals(
    agencyRequest("https://getlocation.fr/api/agency-rentals", { method: "POST", session, body: { action: "generate-contract", id: rental.id } }),
    env
  );
  const { rental: withContract } = await contractRes.json();
  assert.match(withContract.contractNumero, /^GL-\d{8}-\d{4}$/);
  assert.equal(withContract.status, "contrat_genere");

  assert.equal(env.AGENCY_DB._raw.auditLog.some((e) => e.event_type === "contract_generated"), true);
});

test("GET par id : inclut syncStatus (null tant qu'aucune tentative n'a eu lieu)", async () => {
  const env = makeAgencyEnv();
  const session = await loginAgency(env);
  const client = await creerClient(env, session);
  // Pas de secret Google configuré dans makeAgencyEnv() : la tentative de
  // synchronisation best-effort déclenchée par "create" échoue, donc
  // syncStatus passe à "error" plutôt que de rester null après création.
  const createRes = await handleAgencyRentals(
    agencyRequest("https://getlocation.fr/api/agency-rentals", { method: "POST", session, body: { action: "create", clientId: client.id, data: dataValide } }),
    env
  );
  const { rental } = await createRes.json();
  assert.equal(rental.syncStatus.status, "error");
});

test("retry-sync : relance la synchronisation et renvoie l'état à jour", async () => {
  const env = makeAgencyEnv();
  const session = await loginAgency(env);
  const client = await creerClient(env, session);
  const createRes = await handleAgencyRentals(
    agencyRequest("https://getlocation.fr/api/agency-rentals", { method: "POST", session, body: { action: "create", clientId: client.id, data: dataValide } }),
    env
  );
  const { rental } = await createRes.json();

  const retryRes = await handleAgencyRentals(
    agencyRequest("https://getlocation.fr/api/agency-rentals", { method: "POST", session, body: { action: "retry-sync", id: rental.id } }),
    env
  );
  assert.equal(retryRes.status, 200);
  const { rental: retried } = await retryRes.json();
  assert.equal(retried.syncStatus.status, "error");
  assert.ok(retried.syncStatus.lastError);
});

test("retry-sync : 404 si la location est introuvable", async () => {
  const env = makeAgencyEnv();
  const session = await loginAgency(env);
  const res = await handleAgencyRentals(
    agencyRequest("https://getlocation.fr/api/agency-rentals", { method: "POST", session, body: { action: "retry-sync", id: "rnt_inconnu" } }),
    env
  );
  assert.equal(res.status, 404);
});
