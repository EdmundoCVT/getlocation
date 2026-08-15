const test = require("node:test");
const assert = require("node:assert/strict");

const { createFakeKv } = require("./helpers/fake-kv.js");
const { handleDocumentsAccess } = require("../src/api/documents-access.js");
const {
  createReservation,
  updateReservationStatus,
  saveDocumentAccessIndex
} = require("../src/lib/reservation-store.js");
const { issueDocumentAccess } = require("../src/lib/document-access-token.js");
const { formatAdressePersonnalisee } = require("../js/data.js");

const PEPPER = "pepper-de-test-documents-access";

function makeEnv() {
  return {
    RESERVATIONS_KV: createFakeKv(),
    RATE_LIMITS_KV: createFakeKv(),
    DOCUMENT_TOKEN_PEPPER: PEPPER
  };
}

function request(token, method = "GET", ip = "198.51.100.50") {
  return new Request("https://getlocation.fr/api/documents-access", {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "cf-connecting-ip": ip
    }
  });
}

async function paidReservationWithAccess(env, overrides = {}) {
  const now = new Date();
  const start = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const reservation = await createReservation(env, {
    vehiculeId: "peugeot-3008",
    periodeDebut: start.toISOString(),
    periodeFin: end.toISOString(),
    conducteur: { naissance: "1990-01-01", email: "client@example.com" },
    ...overrides
  });
  const issued = await issueDocumentAccess(env, reservation, now.toISOString());
  const paid = await updateReservationStatus(env, reservation.id, "paid", {
    documentsStatus: "pending",
    documentAccess: issued.stored
  });
  await saveDocumentAccessIndex(env, paid.id, issued.stored.tokenHash, issued.stored.expiresAt);
  return { reservation: paid, token: issued.token };
}

test("refuse une méthode autre que GET et accepte OPTIONS", async () => {
  const env = makeEnv();
  assert.equal((await handleDocumentsAccess(request(null, "POST"), env)).status, 405);
  const preflight = await handleDocumentsAccess(request(null, "OPTIONS"), env);
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get("Access-Control-Allow-Headers"), /Authorization/);
});

test("refuse un jeton absent, mal formé ou inconnu sans révéler la cause", async () => {
  const env = makeEnv();
  for (const token of [null, "trop-court", "A".repeat(43)]) {
    const response = await handleDocumentsAccess(request(token, "GET", `198.51.100.${Math.floor(Math.random() * 100) + 1}`), env);
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error, "Lien invalide ou expiré");
  }
});

test("renvoie uniquement la vue minimale d'une réservation payée", async () => {
  const env = makeEnv();
  const { reservation, token } = await paidReservationWithAccess(env, {
    options: [{ id: "second-conducteur" }, { id: "livraison-adresse" }],
    adressePrise: formatAdressePersonnalisee("12 avenue Jean Médecin", "06000", "Nice")
  });
  const response = await handleDocumentsAccess(request(token), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
  const body = await response.json();
  assert.equal(body.reference, reservation.id);
  assert.equal(body.vehicle.name, "Peugeot 3008");
  assert.equal(body.documentsStatus, "pending");
  assert.equal(body.secondDriverRequired, true);
  assert.equal(body.deliveryAddressRequired, true);
  assert.equal(body.deliveryAddressPrefill, "12 avenue Jean Médecin, 06000 Nice");
  assert.equal(JSON.stringify(body).includes("client@example.com"), false);
  assert.equal(JSON.stringify(body).includes("1990-01-01"), false);
  assert.equal(JSON.stringify(body).includes(token), false);
});

test("refuse une réservation non payée, révoquée ou expirée", async () => {
  const env = makeEnv();
  const active = await paidReservationWithAccess(env);

  await updateReservationStatus(env, active.reservation.id, "cancelled");
  assert.equal((await handleDocumentsAccess(request(active.token), env)).status, 401);

  const revoked = await paidReservationWithAccess(env);
  await updateReservationStatus(env, revoked.reservation.id, "paid", {
    documentAccess: { ...revoked.reservation.documentAccess, revokedAt: new Date().toISOString() }
  });
  assert.equal((await handleDocumentsAccess(request(revoked.token, "GET", "198.51.100.60"), env)).status, 401);

  const expired = await paidReservationWithAccess(env);
  await updateReservationStatus(env, expired.reservation.id, "paid", {
    documentAccess: { ...expired.reservation.documentAccess, expiresAt: new Date(Date.now() - 1000).toISOString() }
  });
  assert.equal((await handleDocumentsAccess(request(expired.token, "GET", "198.51.100.61"), env)).status, 401);
});

test("limite les tentatives répétées", async () => {
  const env = makeEnv();
  let response;
  for (let i = 0; i < 21; i += 1) response = await handleDocumentsAccess(request("A".repeat(43)), env);
  assert.equal(response.status, 429);
});
