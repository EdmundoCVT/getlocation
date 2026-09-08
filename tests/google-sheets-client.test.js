// tests/google-sheets-client.test.js
//
// src/lib/google-sheets-client.js — construction des requêtes REST Sheets
// v4 (plages A1, encodage, options d'écriture), gestion d'erreur.

const test = require("node:test");
const assert = require("node:assert/strict");

const { makeServiceAccountFixture } = require("./helpers/google-service-account-fixture.js");
const { getValues, updateValues, appendValues, getRowMeta, GoogleSheetsApiError } = require("../src/lib/google-sheets-client.js");

function makeEnv() {
  const { keyJson } = makeServiceAccountFixture();
  return { GOOGLE_SERVICE_ACCOUNT_KEY: keyJson, GOOGLE_SHEETS_SPREADSHEET_ID: "abc123" };
}

function withFakeFetch(handler, fn) {
  const original = globalThis.fetch;
  let call = 0;
  globalThis.fetch = (url, init) => {
    call += 1;
    // Le premier appel est toujours l'échange de jeton OAuth2 (voir
    // google-auth.js) — répondu automatiquement pour ne pas polluer chaque
    // test avec ce détail.
    if (call === 1 && String(url).includes("oauth2.googleapis.com")) {
      return Promise.resolve(new Response(JSON.stringify({ access_token: "jeton-de-test", expires_in: 3600 }), { status: 200 }));
    }
    return handler(url, init);
  };
  return Promise.resolve(fn()).finally(() => { globalThis.fetch = original; });
}

test("getValues : encode correctement la feuille et la plage, renvoie values", async () => {
  const env = makeEnv();
  const result = await withFakeFetch(
    async (url) => {
      assert.match(String(url), /\/v4\/spreadsheets\/abc123\/values\//);
      assert.ok(String(url).includes(encodeURIComponent("'Réservations'!A1:W1")));
      assert.ok(String(url).includes("valueRenderOption=UNFORMATTED_VALUE"));
      return new Response(JSON.stringify({ values: [["a", "b"]] }), { status: 200 });
    },
    () => getValues(env, "Réservations", "A1:W1")
  );
  assert.deepEqual(result, [["a", "b"]]);
});

test("getValues : renvoie un tableau vide si aucune valeur (plage vide)", async () => {
  const env = makeEnv();
  const result = await withFakeFetch(
    async () => new Response(JSON.stringify({}), { status: 200 }),
    () => getValues(env, "Réservations", "A2:A10")
  );
  assert.deepEqual(result, []);
});

test("updateValues : PUT avec valueInputOption=USER_ENTERED, jamais RAW", async () => {
  const env = makeEnv();
  await withFakeFetch(
    async (url, init) => {
      assert.equal(init.method, "PUT");
      assert.ok(String(url).includes("valueInputOption=USER_ENTERED"));
      assert.deepEqual(JSON.parse(init.body).values, [["x", "y"]]);
      return new Response(JSON.stringify({ updatedCells: 2 }), { status: 200 });
    },
    () => updateValues(env, "Réservations", "A5:B5", [["x", "y"]])
  );
});

test("appendValues : POST vers :append avec insertDataOption=INSERT_ROWS", async () => {
  const env = makeEnv();
  await withFakeFetch(
    async (url, init) => {
      assert.equal(init.method, "POST");
      assert.match(String(url), /:append/);
      assert.ok(String(url).includes("insertDataOption=INSERT_ROWS"));
      return new Response(JSON.stringify({ updates: {} }), { status: 200 });
    },
    () => appendValues(env, "Réservations", [["a", "b"]])
  );
});

test("getRowMeta : interroge spreadsheets.get avec ranges + fields, extrait rowData", async () => {
  const env = makeEnv();
  const result = await withFakeFetch(
    async (url) => {
      const u = new URL(String(url));
      assert.equal(u.searchParams.get("ranges"), "'Réservations'!A5:W5");
      assert.ok(u.searchParams.get("fields").includes("dataValidation"));
      return new Response(
        JSON.stringify({ sheets: [{ data: [{ rowData: [{ values: [{ userEnteredValue: { formulaValue: "=SUM(A1:A2)" } }] }] }] }] }),
        { status: 200 }
      );
    },
    () => getRowMeta(env, "Réservations", 5, "W")
  );
  assert.equal(result[0].userEnteredValue.formulaValue, "=SUM(A1:A2)");
});

test("une réponse non-ok lève GoogleSheetsApiError avec le message Google", async () => {
  const env = makeEnv();
  await assert.rejects(
    withFakeFetch(
      async () => new Response(JSON.stringify({ error: { message: "Feuille introuvable" } }), { status: 404 }),
      () => getValues(env, "Réservations", "A1:W1")
    ),
    GoogleSheetsApiError
  );
});

test("lève une erreur claire si GOOGLE_SHEETS_SPREADSHEET_ID est absent", async () => {
  await assert.rejects(getValues({ GOOGLE_SERVICE_ACCOUNT_KEY: "{}" }, "Réservations", "A1:W1"), GoogleSheetsApiError);
});
