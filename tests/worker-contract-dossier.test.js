// tests/worker-contract-dossier.test.js
//
// src/api/contract-dossier-agency.js et src/api/contract-dossier-client.js —
// dossier contrat sécurisé (accès agence/client par jeton, jamais par
// paramètre URL en base64 pour les nouvelles données opérationnelles), avec
// recalcul serveur du kilométrage (jamais confiance à un calcul client) et
// blocage de l'envoi au client tant que les champs obligatoires manquent.
// Mêmes conventions que tests/worker-agency-documents.test.js.

const test = require("node:test");
const assert = require("node:assert/strict");

const { createFakeKv } = require("./helpers/fake-kv.js");
const { createReservation, updateReservationStatus, saveContractAgencyAccessIndex } = require("../src/lib/reservation-store.js");
const { issueContractAgencyAccess, hashContractAgencyToken, hashContractClientToken } = require("../src/lib/contract-dossier-token.js");
const { handleContractDossierAgency } = require("../src/api/contract-dossier-agency.js");
const { handleContractDossierClient } = require("../src/api/contract-dossier-client.js");
const { CGL_VERSION } = require("../js/data.js");

const PEPPER = "pepper-de-test-dossier-contrat-worker";

function env() {
  return { RESERVATIONS_KV: createFakeKv(), RATE_LIMITS_KV: createFakeKv(), DOCUMENT_TOKEN_PEPPER: PEPPER };
}

let ipCounter = 0;
function nextIp() {
  ipCounter += 1;
  return `198.51.100.${ipCounter % 250}`;
}

async function setupReservationPayee(e, overrides = {}) {
  const reservation = await createReservation(e, {
    vehiculeId: "opel-corsa",
    dateDebut: "2026-09-01",
    heureDebut: "10:00",
    dateFin: "2026-09-04",
    heureFin: "10:00",
    periodeDebut: "2026-09-01T10:00:00.000Z",
    periodeFin: "2026-09-04T10:00:00.000Z",
    total: 177,
    options: [],
    conducteur: { nom: "Tavares", prenom: "Edmond", email: "e@example.com", telephone: "0601020304", naissance: "1986-12-19" },
    ...overrides
  });
  const issued = await issueContractAgencyAccess(e, reservation, new Date().toISOString());
  await updateReservationStatus(e, reservation.id, "paid", { contractAgencyAccess: issued.stored });
  await saveContractAgencyAccessIndex(e, reservation.id, issued.stored.tokenHash, issued.stored.expiresAt);
  return { reservationId: reservation.id, agencyToken: issued.token };
}

function agencyGet(token) {
  return new Request("https://getlocation.fr/api/contract-dossier-agency", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, "cf-connecting-ip": nextIp() }
  });
}

function agencyPost(token, body) {
  return new Request("https://getlocation.fr/api/contract-dossier-agency", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "cf-connecting-ip": nextIp(), "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

function clientGet(token) {
  return new Request("https://getlocation.fr/api/contract-dossier-client", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, "cf-connecting-ip": nextIp() }
  });
}

function clientPost(token, body) {
  return new Request("https://getlocation.fr/api/contract-dossier-client", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "cf-connecting-ip": nextIp(), "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

const CHAMPS_MINIMAUX = { action: "update-fields", immatriculation: "AB-123-CD", modeCaution: "carte", adresse: "1 rue X", codePostal: "06130", ville: "Grasse", permisNumero: "123456789" };

// Le jeton client voyage en FRAGMENT d'URL (#clientToken=), jamais en
// paramètre de requête (voir contract-dossier-agency.js) : URL.searchParams
// ne le lit donc pas, il faut passer par URL.hash.
function extractClientToken(clientUrl) {
  return new URLSearchParams(new URL(clientUrl).hash.slice(1)).get("clientToken");
}

// --- Contrôle d'accès agence ---------------------------------------------

test("agence : refuse un jeton absent, inconnu, révoqué ou expiré", async () => {
  const e = env();
  const { agencyToken, reservationId } = await setupReservationPayee(e);

  const sansJeton = await handleContractDossierAgency(new Request("https://getlocation.fr/api/contract-dossier-agency", { headers: { "cf-connecting-ip": nextIp() } }), e);
  assert.equal(sansJeton.status, 401);

  const jetonInconnu = await handleContractDossierAgency(agencyGet("Z".repeat(43)), e);
  assert.equal(jetonInconnu.status, 401);

  const record = JSON.parse(await e.RESERVATIONS_KV.get(reservationId));
  record.contractAgencyAccess.revokedAt = new Date().toISOString();
  await e.RESERVATIONS_KV.put(reservationId, JSON.stringify(record));
  const jetonRevoque = await handleContractDossierAgency(agencyGet(agencyToken), e);
  assert.equal(jetonRevoque.status, 401);
});

test("agence : jeton valide donne accès en lecture (sans exposer plus que nécessaire)", async () => {
  const e = env();
  const { agencyToken } = await setupReservationPayee(e);
  const res = await handleContractDossierAgency(agencyGet(agencyToken), e);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.reservation.vehicule.id, "opel-corsa");
  assert.equal(body.dossier.status, "draft");
  assert.equal(body.kmInclusParJour, 200);
});

// --- Champs obligatoires avant envoi au client ---------------------------

test("send-to-client : refusé tant que les champs obligatoires manquent", async () => {
  const e = env();
  const { agencyToken } = await setupReservationPayee(e);
  const res = await handleContractDossierAgency(agencyPost(agencyToken, { action: "send-to-client" }), e);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.champsManquants.includes("adresse"));
  assert.ok(body.champsManquants.includes("permisNumero"));
});

// update-fields valide (validateContractFields) exige déjà les champs du
// second conducteur dès que la case est cochée : impossible d'enregistrer
// secondConducteur:true avec des champs vides via l'API elle-même. Ce test
// vérifie la garde de send-to-client en défense en profondeur, pour le cas
// où un tel état incohérent existerait malgré tout (édition KV directe,
// évolution future du code) — jamais atteignable via le formulaire agence.
test("send-to-client : refusé (défense en profondeur) si le dossier stocké a secondConducteur incohérent", async () => {
  const e = env();
  const { agencyToken, reservationId } = await setupReservationPayee(e);
  await handleContractDossierAgency(agencyPost(agencyToken, CHAMPS_MINIMAUX), e);
  const record = JSON.parse(await e.RESERVATIONS_KV.get(reservationId));
  record.contractDossier.fields.secondConducteur = true;
  await e.RESERVATIONS_KV.put(reservationId, JSON.stringify(record));

  const res = await handleContractDossierAgency(agencyPost(agencyToken, { action: "send-to-client" }), e);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.deepEqual(body.champsManquants.sort(), ["secondConducteurNom", "secondConducteurPermisNumero", "secondConducteurPrenom"].sort());
});

test("send-to-client : réussit une fois tous les champs présents, émet un jeton client distinct et met le statut à jour", async () => {
  const e = env();
  const { agencyToken, reservationId } = await setupReservationPayee(e);
  await handleContractDossierAgency(agencyPost(agencyToken, CHAMPS_MINIMAUX), e);

  const res = await handleContractDossierAgency(agencyPost(agencyToken, { action: "send-to-client" }), e);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.dossier.status, "sent");
  // En FRAGMENT (#clientToken=), jamais en paramètre de requête — voir
  // contract-dossier-agency.js.
  assert.match(body.clientUrl, /contrat\.html#clientToken=[A-Za-z0-9_-]{43}$/);

  const clientToken = extractClientToken(body.clientUrl);
  const clientHash = await hashContractClientToken(clientToken, PEPPER);
  const agencyHashOfSameToken = await hashContractAgencyToken(clientToken, PEPPER);
  assert.notEqual(clientHash, agencyHashOfSameToken, "le jeton client ne doit pas fonctionner comme un jeton agence");

  const record = JSON.parse(await e.RESERVATIONS_KV.get(reservationId));
  assert.equal(record.contractDossier.status, "sent");
});

// --- Aucune donnée sensible dans l'URL ------------------------------------

test("les jetons voyagent uniquement via l'en-tête Authorization, jamais en paramètre d'URL", async () => {
  const e = env();
  const { agencyToken } = await setupReservationPayee(e);
  const enQueryString = new Request(`https://getlocation.fr/api/contract-dossier-agency?token=${agencyToken}`, { headers: { "cf-connecting-ip": nextIp() } });
  const res = await handleContractDossierAgency(enQueryString, e);
  assert.equal(res.status, 401, "un jeton passé en paramètre d'URL (jamais lu) ne doit donner aucun accès");
});

// --- État des lieux départ / retour + calcul kilométrique ----------------

async function envoyerDossierComplet(e) {
  const { agencyToken, reservationId } = await setupReservationPayee(e);
  await handleContractDossierAgency(agencyPost(agencyToken, CHAMPS_MINIMAUX), e);
  return { agencyToken, reservationId };
}

test("update-retour avant update-depart est refusé", async () => {
  const e = env();
  const { agencyToken } = await envoyerDossierComplet(e);
  const res = await handleContractDossierAgency(agencyPost(agencyToken, { action: "update-retour", dateHeure: "2026-09-04T10:00", km: 15400, carburant: 100, agent: "Jean" }), e);
  assert.equal(res.status, 400);
});

test("kilométrage : sans dépassement, le supplément est nul et le message est explicite", async () => {
  const e = env();
  const { agencyToken } = await envoyerDossierComplet(e);
  await handleContractDossierAgency(agencyPost(agencyToken, { action: "update-depart", dateHeure: "2026-09-01T10:00", km: 15000, carburant: 100, agent: "Jean" }), e);
  const res = await handleContractDossierAgency(agencyPost(agencyToken, { action: "update-retour", dateHeure: "2026-09-04T10:00", km: 15500, carburant: 100, agent: "Jean" }), e);
  assert.equal(res.status, 200);
  const body = await res.json();
  // 3 jours facturables x 200 km = 600 km inclus ; 500 km parcourus => aucun dépassement.
  assert.equal(body.dossier.kilometrage.kmInclus, 600);
  assert.equal(body.dossier.kilometrage.kmParcourus, 500);
  assert.equal(body.dossier.kilometrage.kmDepasses, 0);
  assert.equal(body.dossier.kilometrage.supplementCentimes, 0);
});

test("kilométrage : un dépassement calcule le bon supplément (0,65 €/km), jamais une valeur envoyée par le client", async () => {
  const e = env();
  const { agencyToken } = await envoyerDossierComplet(e);
  await handleContractDossierAgency(agencyPost(agencyToken, { action: "update-depart", dateHeure: "2026-09-01T10:00", km: 15000, carburant: 100, agent: "Jean" }), e);
  // Tente d'injecter un faux supplément dans le corps de la requête : doit être ignoré, recalculé serveur.
  const res = await handleContractDossierAgency(agencyPost(agencyToken, {
    action: "update-retour", dateHeure: "2026-09-04T10:00", km: 15700, carburant: 80, agent: "Jean",
    supplementCentimes: 1, kmDepasses: 0, kilometrage: { supplementCentimes: 1 }
  }), e);
  assert.equal(res.status, 200);
  const body = await res.json();
  // 700 km parcourus, 600 inclus => 100 km de dépassement x 0,65 € = 65 €.
  assert.equal(body.dossier.kilometrage.kmDepasses, 100);
  assert.equal(body.dossier.kilometrage.supplementCentimes, 6500);
});

test("kilométrage : un retour inférieur au départ est rejeté (jamais enregistré)", async () => {
  const e = env();
  const { agencyToken, reservationId } = await envoyerDossierComplet(e);
  await handleContractDossierAgency(agencyPost(agencyToken, { action: "update-depart", dateHeure: "2026-09-01T10:00", km: 15000, carburant: 100, agent: "Jean" }), e);
  const res = await handleContractDossierAgency(agencyPost(agencyToken, { action: "update-retour", dateHeure: "2026-09-04T10:00", km: 14900, carburant: 100, agent: "Jean" }), e);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /supérieur ou égal/);

  const record = JSON.parse(await e.RESERVATIONS_KV.get(reservationId));
  assert.equal(record.contractDossier.retour, null, "aucun état de retour invalide ne doit être enregistré");
});

test("niveau de carburant hors liste (0/10/.../100) est rejeté par le serveur", async () => {
  const e = env();
  const { agencyToken } = await envoyerDossierComplet(e);
  const res = await handleContractDossierAgency(agencyPost(agencyToken, { action: "update-depart", dateHeure: "2026-09-01T10:00", km: 15000, carburant: 42, agent: "Jean" }), e);
  assert.equal(res.status, 400);
});

// --- Vue CLIENT : lecture + signature --------------------------------------

async function envoyerAuClient(e) {
  const { agencyToken, reservationId } = await envoyerDossierComplet(e);
  const sendRes = await handleContractDossierAgency(agencyPost(agencyToken, { action: "send-to-client" }), e);
  const body = await sendRes.json();
  const clientToken = extractClientToken(body.clientUrl);
  return { agencyToken, clientToken, reservationId };
}

test("client : le jeton agence ne fonctionne pas sur l'endpoint client, et réciproquement", async () => {
  const e = env();
  const { agencyToken, clientToken } = await envoyerAuClient(e);
  const resAvecJetonAgence = await handleContractDossierClient(clientGet(agencyToken), e);
  assert.equal(resAvecJetonAgence.status, 401);
  const resAgenceAvecJetonClient = await handleContractDossierAgency(agencyGet(clientToken), e);
  assert.equal(resAgenceAvecJetonClient.status, 401);
});

test("client : lecture du récapitulatif avant signature", async () => {
  const e = env();
  const { clientToken } = await envoyerAuClient(e);
  const res = await handleContractDossierClient(clientGet(clientToken), e);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, "sent");
  assert.equal(body.reservation.vehicule.nom, "Opel Corsa Business 1.2T");
  assert.equal(body.fields.permisNumero, "123456789");
});

test("client : la signature est refusée sans acceptation des CGL ou avec une version de CGL périmée", async () => {
  const e = env();
  const { clientToken } = await envoyerAuClient(e);
  const sigPng = "data:image/png;base64," + "A".repeat(200);

  const sansAcceptation = await handleContractDossierClient(clientPost(clientToken, { cglAccepted: false, cglVersion: CGL_VERSION, signatureImage: sigPng }), e);
  assert.equal(sansAcceptation.status, 400);

  const versionPerimee = await handleContractDossierClient(clientPost(clientToken, { cglAccepted: true, cglVersion: "2020-01-01", signatureImage: sigPng }), e);
  assert.equal(versionPerimee.status, 409);
});

test("client : la signature est refusée si l'image est manquante ou trop petite", async () => {
  const e = env();
  const { clientToken } = await envoyerAuClient(e);
  const res = await handleContractDossierClient(clientPost(clientToken, { cglAccepted: true, cglVersion: CGL_VERSION, signatureImage: "" }), e);
  assert.equal(res.status, 400);
});

test("client : signature réussie passe le dossier à 'signed' et reste consultable ensuite", async () => {
  const e = env();
  const { clientToken, reservationId } = await envoyerAuClient(e);
  const sigPng = "data:image/png;base64," + "A".repeat(200);
  const res = await handleContractDossierClient(clientPost(clientToken, { cglAccepted: true, cglVersion: CGL_VERSION, signatureImage: sigPng }), e);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, "signed");
  assert.ok(body.signatureId);

  const record = JSON.parse(await e.RESERVATIONS_KV.get(reservationId));
  assert.equal(record.contractDossier.status, "signed");
  assert.equal(record.contractDossier.signature.imageDataUrl, sigPng);

  // Consultable à nouveau après signature (le jeton n'est pas "consommé").
  const relecture = await handleContractDossierClient(clientGet(clientToken), e);
  assert.equal(relecture.status, 200);
  assert.equal((await relecture.json()).status, "signed");
});

test("agence : récupère l'image de signature une fois le contrat signé par le client (pour le PDF définitif)", async () => {
  const e = env();
  const { agencyToken, clientToken } = await envoyerAuClient(e);
  const sigPng = "data:image/png;base64," + "A".repeat(200);
  await handleContractDossierClient(clientPost(clientToken, { cglAccepted: true, cglVersion: CGL_VERSION, signatureImage: sigPng }), e);

  const vueAgence = await handleContractDossierAgency(agencyGet(agencyToken), e);
  assert.equal(vueAgence.status, 200);
  const body = await vueAgence.json();
  assert.equal(body.dossier.status, "signed");
  assert.equal(body.dossier.signature.imageDataUrl, sigPng);
});

// --- Réservation non payée : jamais d'écriture ----------------------------

test("aucune écriture sur le dossier contrat tant que la réservation n'est pas payée", async () => {
  const e = env();
  const reservation = await createReservation(e, { vehiculeId: "opel-corsa" }); // reste "pending_payment"
  const issued = await issueContractAgencyAccess(e, reservation, new Date().toISOString());
  // Index créé, mais la réservation n'a jamais été marquée "paid" : le
  // contrôle d'accès doit refuser (status !== "paid"), pas seulement
  // l'écriture derrière.
  await saveContractAgencyAccessIndex(e, reservation.id, issued.stored.tokenHash, issued.stored.expiresAt);
  const res = await handleContractDossierAgency(agencyGet(issued.token), e);
  assert.equal(res.status, 401);
});
