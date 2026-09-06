// tests/helpers/agency-session.js
//
// Petit helper partagé par les tests d'intégration des endpoints agence
// (Lot 1 et Lot 2) : construit un env agence complet (D1 + secrets) et
// connecte "Edmundo" pour obtenir {cookie, csrfToken} réutilisables dans
// les requêtes suivantes — évite de dupliquer ce boilerplate dans chaque
// fichier de test d'endpoint (voir tests/worker-api-contracts-manual.test.js
// pour l'origine de ce pattern, Lot 1).

const { createFakeD1 } = require("./fake-d1.js");
const { handleAgencyLogin } = require("../../src/api/agency-login.js");

let ipCounter = 0;
function nextIp() {
  ipCounter += 1;
  return `198.51.100.${ipCounter}`;
}

function makeAgencyEnv(overrides = {}) {
  return {
    AGENCY_DB: createFakeD1(),
    AGENCY_AUTH_PEPPER: "pepper-de-test-agence",
    AGENCY_CODE_EDMUNDO: "code-edmundo-1234",
    AGENCY_CODE_ANTONIO: "code-antonio-5678",
    ...overrides
  };
}

async function loginAgency(env, code = "code-edmundo-1234") {
  const res = await handleAgencyLogin(
    new Request("https://getlocation.fr/api/agency-login", {
      method: "POST",
      headers: { origin: "https://getlocation.fr", "cf-connecting-ip": nextIp(), "content-type": "application/json" },
      body: JSON.stringify({ code })
    }),
    env
  );
  const json = await res.json();
  const cookie = /agency_session=([^;]+)/.exec(res.headers.get("set-cookie"))[1];
  return { cookie, csrfToken: json.csrfToken, operator: json.operator };
}

function agencyRequest(url, { method = "GET", session, body } = {}) {
  const headers = { origin: "https://getlocation.fr", "cf-connecting-ip": nextIp() };
  if (session) headers.cookie = `agency_session=${session.cookie}`;
  if (body !== undefined) {
    headers["content-type"] = "application/json";
    if (session) headers["x-agency-csrf"] = session.csrfToken;
  }
  return new Request(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
}

module.exports = { makeAgencyEnv, loginAgency, agencyRequest, nextIp };
