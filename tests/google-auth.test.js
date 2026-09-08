// tests/google-auth.test.js
//
// src/lib/google-auth.js — signature JWT RS256 réelle (Web Crypto),
// échange contre un jeton d'accès. Vérifie aussi que la signature produite
// est authentique (vérifiable avec la clé publique correspondante), pas
// seulement que l'appel réseau a eu lieu.

const test = require("node:test");
const assert = require("node:assert/strict");
const { verify } = require("node:crypto");

const { makeServiceAccountFixture } = require("./helpers/google-service-account-fixture.js");
const { getAccessToken, GoogleAuthError } = require("../src/lib/google-auth.js");

function withFakeFetch(handler, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return Promise.resolve(fn()).finally(() => { globalThis.fetch = original; });
}

function base64UrlDecode(str) {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (str.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}

test("getAccessToken : échange un JWT signé RS256 valide contre un jeton d'accès", async () => {
  const { keyJson, publicKeyPem, clientEmail } = makeServiceAccountFixture();
  const env = { GOOGLE_SERVICE_ACCOUNT_KEY: keyJson };

  let capturedBody;
  const token = await withFakeFetch(
    async (url, init) => {
      assert.equal(url, "https://oauth2.googleapis.com/token");
      assert.equal(init.method, "POST");
      capturedBody = new URLSearchParams(init.body);
      return new Response(JSON.stringify({ access_token: "jeton-de-test", expires_in: 3600 }), { status: 200 });
    },
    () => getAccessToken(env)
  );

  assert.equal(token, "jeton-de-test");
  assert.equal(capturedBody.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");

  const jwt = capturedBody.get("assertion");
  const [headerB64, claimsB64, sigB64] = jwt.split(".");
  const header = JSON.parse(base64UrlDecode(headerB64).toString("utf8"));
  const claims = JSON.parse(base64UrlDecode(claimsB64).toString("utf8"));
  assert.equal(header.alg, "RS256");
  assert.equal(claims.iss, clientEmail);
  assert.equal(claims.scope, "https://www.googleapis.com/auth/spreadsheets");
  assert.equal(claims.aud, "https://oauth2.googleapis.com/token");
  assert.ok(claims.exp - claims.iat === 3600);

  const signingInput = `${headerB64}.${claimsB64}`;
  const signatureValid = verify("RSA-SHA256", Buffer.from(signingInput), publicKeyPem, base64UrlDecode(sigB64));
  assert.equal(signatureValid, true, "la signature du JWT doit être vérifiable avec la clé publique correspondante");
});

test("getAccessToken : lève GoogleAuthError si GOOGLE_SERVICE_ACCOUNT_KEY est absent ou invalide", async () => {
  await assert.rejects(getAccessToken({}), GoogleAuthError);
  await assert.rejects(getAccessToken({ GOOGLE_SERVICE_ACCOUNT_KEY: "pas-du-json" }), GoogleAuthError);
  await assert.rejects(getAccessToken({ GOOGLE_SERVICE_ACCOUNT_KEY: JSON.stringify({ client_email: "x@y.com" }) }), GoogleAuthError);
});

test("getAccessToken : lève GoogleAuthError si Google refuse l'échange", async () => {
  const { keyJson } = makeServiceAccountFixture();
  await assert.rejects(
    withFakeFetch(
      async () => new Response(JSON.stringify({ error: "invalid_grant", error_description: "Jeton invalide" }), { status: 400 }),
      () => getAccessToken({ GOOGLE_SERVICE_ACCOUNT_KEY: keyJson })
    ),
    GoogleAuthError
  );
});
