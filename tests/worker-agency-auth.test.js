// tests/worker-agency-auth.test.js
//
// src/api/agency-login.js, agency-logout.js, agency-session.js — cycle
// complet connexion/vérification/déconnexion, limitation des tentatives,
// vérification d'origine.

const test = require("node:test");
const assert = require("node:assert/strict");

const { createFakeD1 } = require("./helpers/fake-d1.js");
const { handleAgencyLogin } = require("../src/api/agency-login.js");
const { handleAgencyLogout } = require("../src/api/agency-logout.js");
const { handleAgencySession } = require("../src/api/agency-session.js");

function makeEnv() {
  return {
    AGENCY_DB: createFakeD1(),
    AGENCY_AUTH_PEPPER: "pepper-de-test-agence",
    AGENCY_CODE_EDMUNDO: "code-edmundo-1234",
    AGENCY_CODE_ANTONIO: "code-antonio-5678"
  };
}

let ipCounter = 0;
function loginRequest(code, { origin = "https://getlocation.fr", ip } = {}) {
  ipCounter += 1;
  return new Request("https://getlocation.fr/api/agency-login", {
    method: "POST",
    headers: { origin, "cf-connecting-ip": ip || `198.51.100.${ipCounter}`, "content-type": "application/json" },
    body: JSON.stringify({ code })
  });
}

function extractCookie(response) {
  const setCookie = response.headers.get("set-cookie") || "";
  const match = /agency_session=([^;]+)/.exec(setCookie);
  return match ? match[1] : null;
}

test("handleAgencyLogin : rejette une méthode autre que POST/OPTIONS", async () => {
  const res = await handleAgencyLogin(
    new Request("https://getlocation.fr/api/agency-login", { method: "GET", headers: { origin: "https://getlocation.fr" } }),
    makeEnv()
  );
  assert.equal(res.status, 405);
});

test("handleAgencyLogin : rejette une origine non autorisée", async () => {
  const res = await handleAgencyLogin(loginRequest("code-edmundo-1234", { origin: "https://evil.example" }), makeEnv());
  assert.equal(res.status, 403);
});

test("handleAgencyLogin : code correct pose un cookie HttpOnly/Secure/SameSite=Lax et renvoie opérateur + jeton CSRF", async () => {
  const env = makeEnv();
  const res = await handleAgencyLogin(loginRequest("code-antonio-5678"), env);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.operator, "Antonio");
  assert.match(json.csrfToken, /^[a-f0-9]{64}$/);
  const setCookie = res.headers.get("set-cookie");
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /SameSite=Lax/);
  assert.ok(extractCookie(res));
});

test("handleAgencyLogin : code incorrect renvoie 401 avec un message générique (ne révèle jamais quel opérateur)", async () => {
  const res = await handleAgencyLogin(loginRequest("mauvais-code"), makeEnv());
  assert.equal(res.status, 401);
  const json = await res.json();
  assert.equal(json.error, "Code incorrect.");
});

test("handleAgencyLogin : bloque après 5 échecs depuis la même IP, même avec le bon code ensuite", async () => {
  const env = makeEnv();
  const ip = "198.51.100.42";
  for (let i = 0; i < 5; i++) {
    const res = await handleAgencyLogin(loginRequest("mauvais-code", { ip }), env);
    assert.equal(res.status, 401);
  }
  const bloque = await handleAgencyLogin(loginRequest("code-edmundo-1234", { ip }), env);
  assert.equal(bloque.status, 429);
});

test("cycle complet : connexion -> vérification de session -> déconnexion -> session invalide", async () => {
  const env = makeEnv();

  const loginRes = await handleAgencyLogin(loginRequest("code-edmundo-1234"), env);
  const { csrfToken } = await loginRes.json();
  const cookie = extractCookie(loginRes);

  const sessionRes = await handleAgencySession(
    new Request("https://getlocation.fr/api/agency-session", { headers: { cookie: `agency_session=${cookie}` } }),
    env
  );
  const sessionJson = await sessionRes.json();
  assert.equal(sessionJson.authenticated, true);
  assert.equal(sessionJson.operator, "Edmundo");
  assert.equal(sessionJson.csrfToken, csrfToken);

  const logoutRes = await handleAgencyLogout(
    new Request("https://getlocation.fr/api/agency-logout", {
      method: "POST",
      headers: { origin: "https://getlocation.fr", cookie: `agency_session=${cookie}`, "x-agency-csrf": csrfToken }
    }),
    env
  );
  assert.equal(logoutRes.status, 200);

  const sessionApres = await handleAgencySession(
    new Request("https://getlocation.fr/api/agency-session", { headers: { cookie: `agency_session=${cookie}` } }),
    env
  );
  assert.equal((await sessionApres.json()).authenticated, false);
});

test("handleAgencySession : sans cookie, renvoie authenticated:false (jamais une erreur)", async () => {
  const res = await handleAgencySession(new Request("https://getlocation.fr/api/agency-session"), makeEnv());
  assert.equal(res.status, 200);
  assert.equal((await res.json()).authenticated, false);
});

test("handleAgencyLogout : refuse sans jeton CSRF valide", async () => {
  const env = makeEnv();
  const loginRes = await handleAgencyLogin(loginRequest("code-edmundo-1234"), env);
  const cookie = extractCookie(loginRes);
  const res = await handleAgencyLogout(
    new Request("https://getlocation.fr/api/agency-logout", {
      method: "POST",
      headers: { origin: "https://getlocation.fr", cookie: `agency_session=${cookie}` }
    }),
    env
  );
  assert.equal(res.status, 403);
});
