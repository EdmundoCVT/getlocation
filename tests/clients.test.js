// tests/clients.test.js
//
// src/lib/clients.js — normalisation, création/mise à jour, recherche
// (téléphone/email exacts, nom secondaire), jamais de fusion automatique,
// jamais de consentement marketing par défaut.

const test = require("node:test");
const assert = require("node:assert/strict");

const { createFakeD1 } = require("./helpers/fake-d1.js");
const { normalizePhone, normalizeEmail, createClient, updateClient, getClientById, searchClients } = require("../src/lib/clients.js");

function makeEnv() {
  return { AGENCY_DB: createFakeD1() };
}

test("normalizePhone : retire les espaces/points/tirets, conserve le préfixe international", () => {
  assert.equal(normalizePhone("06 01 02 03 04"), "0601020304");
  assert.equal(normalizePhone("+33 6 01 02 03 04"), "+33601020304");
  assert.equal(normalizePhone(""), "");
  assert.equal(normalizePhone(null), "");
});

test("normalizeEmail : minuscules et espaces retirés", () => {
  assert.equal(normalizeEmail("  Jean.Dupont@Example.com "), "jean.dupont@example.com");
});

test("createClient : cas nominal, marketingConsent jamais activé par défaut", async () => {
  const env = makeEnv();
  const client = await createClient(env, { firstName: "Jean", lastName: "Dupont", phone: "0601020304", email: "jean@example.com" }, "Edmundo");
  assert.match(client.id, /^clt_[a-f0-9]{32}$/);
  assert.equal(client.marketingConsent, false);
  assert.equal(client.createdBy, "Edmundo");
  assert.equal(client.updatedBy, "Edmundo");
});

test("createClient : marketingConsent nécessite exactement `true`, jamais une valeur approchante", async () => {
  const env = makeEnv();
  const c1 = await createClient(env, { firstName: "A", lastName: "B", marketingConsent: "true" }, "Edmundo");
  assert.equal(c1.marketingConsent, false);
  const c2 = await createClient(env, { firstName: "A", lastName: "B", marketingConsent: 1 }, "Edmundo");
  assert.equal(c2.marketingConsent, false);
  const c3 = await createClient(env, { firstName: "A", lastName: "B", marketingConsent: true }, "Edmundo");
  assert.equal(c3.marketingConsent, true);
});

test("createClient : rejette un prénom ou un nom manquant", async () => {
  const env = makeEnv();
  await assert.rejects(createClient(env, { firstName: "", lastName: "Dupont" }, "Edmundo"));
  await assert.rejects(createClient(env, { firstName: "Jean", lastName: "" }, "Edmundo"));
});

test("createClient : adresse en 3 champs séparés (rue/code postal/ville, Lot 5)", async () => {
  const env = makeEnv();
  const client = await createClient(env, {
    firstName: "Jean", lastName: "Dupont",
    postalAddress: "12 rue des Lilas", postalCode: "06130", city: "Grasse"
  }, "Edmundo");
  assert.equal(client.postalAddress, "12 rue des Lilas");
  assert.equal(client.postalCode, "06130");
  assert.equal(client.city, "Grasse");

  const reloaded = await getClientById(env, client.id);
  assert.equal(reloaded.postalCode, "06130");
  assert.equal(reloaded.city, "Grasse");
});

test("updateClient : corrige en place (même id), renvoie null si introuvable", async () => {
  const env = makeEnv();
  const created = await createClient(env, { firstName: "Jean", lastName: "Dupont", phone: "0601020304" }, "Edmundo");
  const updated = await updateClient(env, created.id, { firstName: "Jean", lastName: "Dupont", phone: "0611223344" }, "Antonio");
  assert.equal(updated.id, created.id);
  assert.equal(updated.phone, "0611223344");
  assert.equal(updated.updatedBy, "Antonio");
  assert.equal(updated.createdBy, "Edmundo", "createdBy ne change jamais lors d'une mise à jour");

  assert.equal(await updateClient(env, "clt_inconnu", { firstName: "A", lastName: "B" }, "Edmundo"), null);
});

test("searchClients : téléphone exact prioritaire sur la recherche par nom", async () => {
  const env = makeEnv();
  const client = await createClient(env, { firstName: "Jean", lastName: "Dupont", phone: "0601020304" }, "Edmundo");
  await createClient(env, { firstName: "Jean", lastName: "Durand", phone: "0699999999" }, "Edmundo");

  const parTelephone = await searchClients(env, { phone: "06 01 02 03 04" });
  assert.equal(parTelephone.length, 1);
  assert.equal(parTelephone[0].id, client.id);
});

test("searchClients : email exact, insensible à la casse", async () => {
  const env = makeEnv();
  const client = await createClient(env, { firstName: "Jean", lastName: "Dupont", email: "Jean@Example.com" }, "Edmundo");
  const res = await searchClients(env, { email: "jean@example.com" });
  assert.equal(res.length, 1);
  assert.equal(res[0].id, client.id);
});

test("searchClients : recherche par nom uniquement en secours (ni téléphone ni email fournis)", async () => {
  const env = makeEnv();
  const client = await createClient(env, { firstName: "Jean", lastName: "Dupont" }, "Edmundo");
  await createClient(env, { firstName: "Marie", lastName: "Martin" }, "Edmundo");

  const res = await searchClients(env, { lastName: "Dupont" });
  assert.equal(res.length, 1);
  assert.equal(res[0].id, client.id);
});

test("searchClients : signale les ressemblances (plusieurs fiches) sans jamais fusionner", async () => {
  const env = makeEnv();
  await createClient(env, { firstName: "Jean", lastName: "Dupont", phone: "0601020304" }, "Edmundo");
  await createClient(env, { firstName: "Jean-Paul", lastName: "Dupont", phone: "0601020304" }, "Edmundo");
  const res = await searchClients(env, { phone: "0601020304" });
  assert.equal(res.length, 2, "deux fiches distinctes doivent pouvoir partager un téléphone, sans fusion automatique");
});

test("getClientById : renvoie null pour un id inconnu ou vide", async () => {
  const env = makeEnv();
  assert.equal(await getClientById(env, "clt_inconnu"), null);
  assert.equal(await getClientById(env, ""), null);
});
