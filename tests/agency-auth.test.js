// tests/agency-auth.test.js
//
// src/lib/agency-auth.js — vérification de code, sessions, CSRF dérivé,
// rotation de code, limitation des tentatives, purge.

const test = require("node:test");
const assert = require("node:assert/strict");

const { createFakeD1 } = require("./helpers/fake-d1.js");
const {
  SESSION_COOKIE_NAME,
  matchOperator,
  createSession,
  revokeSessionById,
  resolveAgencySession,
  requireAgencySession,
  deriveCsrfToken,
  hashIp,
  countRecentFailedAttempts,
  recordLoginAttempt,
  purgeAgencyAuthData,
  timingSafeEqualHex
} = require("../src/lib/agency-auth.js");

const PEPPER = "pepper-de-test-agence";

function makeEnv(overrides = {}) {
  return {
    AGENCY_DB: createFakeD1(),
    AGENCY_AUTH_PEPPER: PEPPER,
    AGENCY_CODE_EDMUNDO: "code-edmundo-1234",
    AGENCY_CODE_ANTONIO: "code-antonio-5678",
    ...overrides
  };
}

function makeRequest(url, { cookie, csrf, origin = "https://getlocation.fr" } = {}) {
  const headers = {};
  if (origin) headers.origin = origin;
  if (cookie) headers.cookie = `${SESSION_COOKIE_NAME}=${cookie}`;
  if (csrf) headers["x-agency-csrf"] = csrf;
  return new Request(url, { headers });
}

test("timingSafeEqualHex : compare correctement, refuse une longueur différente ou vide", () => {
  assert.equal(timingSafeEqualHex("abcd", "abcd"), true);
  assert.equal(timingSafeEqualHex("abcd", "abce"), false);
  assert.equal(timingSafeEqualHex("abc", "abcd"), false);
  assert.equal(timingSafeEqualHex("", ""), false);
});

test("matchOperator : reconnaît Edmundo et Antonio, rejette un code inconnu sans révéler lequel a failli", async () => {
  const env = makeEnv();
  assert.equal((await matchOperator("code-edmundo-1234", env)).name, "Edmundo");
  assert.equal((await matchOperator("code-antonio-5678", env)).name, "Antonio");
  assert.equal(await matchOperator("mauvais-code", env), null);
  assert.equal(await matchOperator("", env), null);
  assert.equal(await matchOperator(null, env), null);
});

test("createSession + resolveAgencySession : une session fraîche est valide, jeton CSRF stable", async () => {
  const env = makeEnv();
  const match = await matchOperator("code-edmundo-1234", env);
  const session = await createSession(env, match.name, match.codeHash);

  const req = makeRequest("https://getlocation.fr/api/x", { cookie: session.token });
  const resolved = await resolveAgencySession(req, env);
  assert.equal(resolved.operator, "Edmundo");
  assert.match(resolved.csrfToken, /^[a-f0-9]{64}$/);

  const resolvedAgain = await resolveAgencySession(req, env);
  assert.equal(resolvedAgain.csrfToken, resolved.csrfToken, "le jeton CSRF doit être stable pour une même session");
});

test("resolveAgencySession : refuse un cookie absent ou un jeton inconnu", async () => {
  const env = makeEnv();
  assert.equal(await resolveAgencySession(makeRequest("https://getlocation.fr/api/x"), env), null);
  assert.equal(await resolveAgencySession(makeRequest("https://getlocation.fr/api/x", { cookie: "jeton-inconnu" }), env), null);
});

test("resolveAgencySession : refuse une session révoquée", async () => {
  const env = makeEnv();
  const match = await matchOperator("code-edmundo-1234", env);
  const session = await createSession(env, match.name, match.codeHash);
  await revokeSessionById(env, session.id);
  assert.equal(await resolveAgencySession(makeRequest("https://getlocation.fr/api/x", { cookie: session.token }), env), null);
});

test("resolveAgencySession : refuse une session expirée (30 jours)", async () => {
  const env = makeEnv();
  const match = await matchOperator("code-edmundo-1234", env);
  const session = await createSession(env, match.name, match.codeHash);
  env.AGENCY_DB._raw.sessions.get(session.id).expires_at = new Date(Date.now() - 1000).toISOString();
  assert.equal(await resolveAgencySession(makeRequest("https://getlocation.fr/api/x", { cookie: session.token }), env), null);
});

test("resolveAgencySession : une rotation du code de l'opérateur invalide immédiatement ses sessions", async () => {
  const env = makeEnv();
  const match = await matchOperator("code-edmundo-1234", env);
  const session = await createSession(env, match.name, match.codeHash);
  const req = makeRequest("https://getlocation.fr/api/x", { cookie: session.token });
  assert.ok(await resolveAgencySession(req, env));

  env.AGENCY_CODE_EDMUNDO = "nouveau-code-edmundo";
  assert.equal(await resolveAgencySession(req, env), null);
  assert.ok(env.AGENCY_DB._raw.sessions.get(session.id).revoked_at, "la session doit être révoquée en base, pas seulement ignorée");
});

test("requireAgencySession : 401 sans session valide", async () => {
  const env = makeEnv();
  const result = await requireAgencySession(makeRequest("https://getlocation.fr/api/x"), env);
  assert.equal(result.error.status, 401);
});

test("requireAgencySession : 403 si origine non autorisée (requireOrigin)", async () => {
  const env = makeEnv();
  const match = await matchOperator("code-edmundo-1234", env);
  const session = await createSession(env, match.name, match.codeHash);
  const req = makeRequest("https://getlocation.fr/api/x", { cookie: session.token, origin: "https://evil.example" });
  assert.equal((await requireAgencySession(req, env, { requireOrigin: true })).error.status, 403);
});

test("requireAgencySession : 403 si jeton CSRF absent ou invalide (requireCsrf)", async () => {
  const env = makeEnv();
  const match = await matchOperator("code-edmundo-1234", env);
  const session = await createSession(env, match.name, match.codeHash);
  const csrf = await deriveCsrfToken(session.id, env.AGENCY_AUTH_PEPPER);

  const sansCsrf = makeRequest("https://getlocation.fr/api/x", { cookie: session.token });
  assert.equal((await requireAgencySession(sansCsrf, env, { requireCsrf: true })).error.status, 403);

  const mauvaisCsrf = makeRequest("https://getlocation.fr/api/x", { cookie: session.token, csrf: "0".repeat(64) });
  assert.equal((await requireAgencySession(mauvaisCsrf, env, { requireCsrf: true })).error.status, 403);

  const bonCsrf = makeRequest("https://getlocation.fr/api/x", { cookie: session.token, csrf });
  const ok = await requireAgencySession(bonCsrf, env, { requireCsrf: true });
  assert.equal(ok.session.operator, "Edmundo");
});

test("countRecentFailedAttempts / recordLoginAttempt : compte les échecs récents, ignore les succès", async () => {
  const env = makeEnv();
  const ipHash = await hashIp("203.0.113.9", env.AGENCY_AUTH_PEPPER);
  await recordLoginAttempt(env, ipHash, false);
  await recordLoginAttempt(env, ipHash, false);
  await recordLoginAttempt(env, ipHash, true);
  assert.equal(await countRecentFailedAttempts(env, ipHash), 2);
});

test("purgeAgencyAuthData : supprime les sessions expirées/révoquées et les tentatives de plus de 24h", async () => {
  const env = makeEnv();
  const match = await matchOperator("code-edmundo-1234", env);
  const session = await createSession(env, match.name, match.codeHash);
  env.AGENCY_DB._raw.sessions.get(session.id).expires_at = new Date(Date.now() - 1000).toISOString();

  const ipHash = await hashIp("203.0.113.9", env.AGENCY_AUTH_PEPPER);
  env.AGENCY_DB._raw.loginAttempts.push({
    ip_hash: ipHash,
    attempted_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
    success: 0
  });

  await purgeAgencyAuthData(env);

  assert.equal(env.AGENCY_DB._raw.sessions.size, 0);
  assert.equal(env.AGENCY_DB._raw.loginAttempts.length, 0);
});

test("purgeAgencyAuthData : ne supprime pas une session encore valide ni une tentative récente", async () => {
  const env = makeEnv();
  const match = await matchOperator("code-edmundo-1234", env);
  await createSession(env, match.name, match.codeHash);
  const ipHash = await hashIp("203.0.113.9", env.AGENCY_AUTH_PEPPER);
  await recordLoginAttempt(env, ipHash, false);

  await purgeAgencyAuthData(env);

  assert.equal(env.AGENCY_DB._raw.sessions.size, 1);
  assert.equal(env.AGENCY_DB._raw.loginAttempts.length, 1);
});
