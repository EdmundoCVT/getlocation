const test = require("node:test");
const assert = require("node:assert/strict");
const { createInspectionApiClient } = require("../js/inspection-page.js");

const CSRF_A = "a".repeat(64);
const CSRF_B = "b".repeat(64);

function jsonResponse(body, status = 200, url = "https://getlocation.fr/api/standalone-inspections") {
  const response = new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  Object.defineProperty(response, "url", { value: url });
  return response;
}

function header(options, name) {
  return new Headers(options.headers).get(name);
}

test("onglets A/B : cookie renouvelé + ancien CSRF déclenche un refresh puis un seul retry", async () => {
  let sessionCalls = 0;
  const writes = [];
  const fetchImpl = async (url, options = {}) => {
    if (url === "/api/agency-session") {
      sessionCalls++;
      return jsonResponse({ authenticated: true, csrfToken: sessionCalls === 1 ? CSRF_A : CSRF_B }, 200, "https://getlocation.fr/api/agency-session");
    }
    writes.push({ url, options });
    return writes.length === 1
      ? jsonResponse({ error: "Jeton CSRF invalide" }, 403)
      : jsonResponse({ ok: true });
  };
  const client = createInspectionApiClient({ fetchImpl, standalone: true });

  await client.refreshSession();
  const response = await client.fetch("/api/standalone-inspections", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });

  assert.equal(response.status, 200);
  assert.equal(sessionCalls, 2, "chargement initial puis un seul renouvellement");
  assert.equal(writes.length, 2, "la requête métier est exécutée au maximum deux fois");
  assert.equal(header(writes[0].options, "x-agency-csrf"), CSRF_A);
  assert.equal(header(writes[1].options, "x-agency-csrf"), CSRF_B);
  assert.equal(writes[0].options.credentials, "same-origin");
  assert.equal(writes[1].options.credentials, "same-origin");
});

test("session réellement expirée : aucun retry métier et message explicite", async () => {
  let sessionCalls = 0, writeCalls = 0;
  const client = createInspectionApiClient({
    standalone: true,
    fetchImpl: async (url) => {
      if (url === "/api/agency-session") {
        sessionCalls++;
        return jsonResponse(sessionCalls === 1 ? { authenticated: true, csrfToken: CSRF_A } : { authenticated: false }, 200, "https://getlocation.fr/api/agency-session");
      }
      writeCalls++;
      return jsonResponse({ error: "Jeton CSRF invalide" }, 403);
    }
  });
  await client.refreshSession();

  await assert.rejects(
    () => client.fetch("/api/standalone-inspections", { method: "POST", body: "{}" }),
    error => error.code === "AGENCY_SESSION_EXPIRED" && /Votre session agence a expiré/.test(error.message)
  );
  assert.equal(sessionCalls, 2);
  assert.equal(writeCalls, 1, "aucun second appel métier sans nouvelle session valide");
});

test("un token de session absent ou mal formé est traité comme une session expirée", async () => {
  for (const session of [{ authenticated: true }, { authenticated: true, csrfToken: "invalide" }]) {
    const client = createInspectionApiClient({ standalone: true, fetchImpl: async () => jsonResponse(session, 200, "https://getlocation.fr/api/agency-session") });
    await assert.rejects(() => client.refreshSession(), error => error.code === "AGENCY_SESSION_EXPIRED");
  }
});

test("une lecture standalone garde credentials same-origin sans envoyer le CSRF", async () => {
  const calls = [];
  const client = createInspectionApiClient({
    standalone: true,
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      return url === "/api/agency-session" ? jsonResponse({ authenticated: true, csrfToken: CSRF_A }) : jsonResponse({ inspection: {} });
    }
  });
  await client.refreshSession();
  await client.fetch("/api/standalone-inspections?id=edl_test");
  assert.equal(calls[1].options.credentials, "same-origin");
  assert.equal(header(calls[1].options, "x-agency-csrf"), null);
});

test("les autres 403 ne renouvellent pas le CSRF et les EDL liés restent inchangés", async () => {
  let standaloneSessions = 0, standaloneWrites = 0;
  const standalone = createInspectionApiClient({
    standalone: true,
    fetchImpl: async (url) => {
      if (url === "/api/agency-session") { standaloneSessions++; return jsonResponse({ authenticated: true, csrfToken: CSRF_A }); }
      standaloneWrites++; return jsonResponse({ error: "Origine non autorisée" }, 403);
    }
  });
  await standalone.refreshSession();
  const forbidden = await standalone.fetch("/api/standalone-inspections", { method: "POST", body: "{}" });
  assert.equal(forbidden.status, 403);
  assert.equal(standaloneSessions, 1);
  assert.equal(standaloneWrites, 1);

  let linkedCalls = 0;
  const linked = createInspectionApiClient({
    standalone: false,
    authorizationToken: "dossier-token",
    fetchImpl: async (_url, options) => {
      linkedCalls++;
      assert.equal(header(options, "authorization"), "Bearer dossier-token");
      return jsonResponse({ error: "Jeton CSRF invalide" }, 403, "https://getlocation.fr/api/contract-dossier-agency");
    }
  });
  assert.equal((await linked.fetch("/api/contract-dossier-agency", { method: "POST", body: "{}" })).status, 403);
  assert.equal(linkedCalls, 1, "aucun retry ajouté au mécanisme d’accès dossier existant");
});

test("upload FormData : le retry reconstruit le body avec fichiers et métadonnées", async () => {
  let sessionCalls = 0;
  const attempts = [];
  const client = createInspectionApiClient({
    standalone: true,
    fetchImpl: async (url, options = {}) => {
      if (url === "/api/agency-session") {
        sessionCalls++;
        return jsonResponse({ authenticated: true, csrfToken: sessionCalls === 1 ? CSRF_A : CSRF_B }, 200, "https://getlocation.fr/api/agency-session");
      }
      attempts.push(options);
      return attempts.length === 1 ? jsonResponse({ error: "Jeton CSRF invalide" }, 403) : jsonResponse({ ok: true, item: { key: "photo-1" } });
    }
  });
  await client.refreshSession();
  const form = new FormData();
  form.append("stage", "retour");
  form.append("revision", "2");
  form.append("slot", "dommage");
  form.append("capturedAt", "2026-11-12T10:30");
  form.append("file", new File(["original-photo"], "preuve.jpg", { type: "image/jpeg" }));
  form.append("optimizedFile", new File(["optimized-photo"], "preuve-pdf.jpg", { type: "image/jpeg" }));
  form.append("originalWidth", "4032");
  form.append("optimizedWidth", "2000");

  assert.equal((await client.fetch("/api/standalone-inspection-media?id=edl_test", { method: "POST", body: form })).status, 200);
  assert.equal(attempts.length, 2);
  assert.notEqual(attempts[0].body, attempts[1].body, "chaque fetch reçoit un FormData neuf");
  for (const [index, attempt] of attempts.entries()) {
    assert.equal(attempt.body.get("stage"), "retour");
    assert.equal(attempt.body.get("revision"), "2");
    assert.equal(attempt.body.get("slot"), "dommage");
    assert.equal(attempt.body.get("capturedAt"), "2026-11-12T10:30");
    assert.equal(attempt.body.get("file").name, "preuve.jpg");
    assert.equal(await attempt.body.get("file").text(), "original-photo");
    assert.equal(attempt.body.get("optimizedFile").name, "preuve-pdf.jpg");
    assert.equal(await attempt.body.get("optimizedFile").text(), "optimized-photo");
    assert.equal(attempt.body.get("originalWidth"), "4032");
    assert.equal(attempt.body.get("optimizedWidth"), "2000");
    assert.equal(header(attempt, "x-agency-csrf"), index ? CSRF_B : CSRF_A);
  }
});

test("deux échecs CSRF simultanés partagent un seul refresh de session", async () => {
  let sessionCalls = 0;
  const attempts = new Map();
  const client = createInspectionApiClient({
    standalone: true,
    fetchImpl: async (url, options = {}) => {
      if (url === "/api/agency-session") {
        sessionCalls++;
        if (sessionCalls === 2) await new Promise(resolve => setTimeout(resolve, 10));
        return jsonResponse({ authenticated: true, csrfToken: sessionCalls === 1 ? CSRF_A : CSRF_B }, 200, "https://getlocation.fr/api/agency-session");
      }
      const count = (attempts.get(url) || 0) + 1; attempts.set(url, count);
      return count === 1 ? jsonResponse({ error: "Jeton CSRF invalide" }, 403) : jsonResponse({ ok: true });
    }
  });
  await client.refreshSession();

  const responses = await Promise.all([
    client.fetch("/api/standalone-inspections", { method: "POST", body: "{}" }),
    client.fetch("/api/standalone-inspection-media?id=edl_test", { method: "DELETE", body: "{}" })
  ]);
  assert.deepEqual(responses.map(response => response.status), [200, 200]);
  assert.equal(sessionCalls, 2, "un chargement initial et un refresh partagé");
  assert.equal(attempts.get("/api/standalone-inspections"), 2);
  assert.equal(attempts.get("/api/standalone-inspection-media?id=edl_test"), 2);
});
