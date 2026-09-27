const test = require("node:test");
const assert = require("node:assert/strict");

const { handleAgencyGoogleSheets, configuredSheetUrl } = require("../src/api/agency-google-sheets.js");
const { makeAgencyEnv, loginAgency, agencyRequest } = require("./helpers/agency-session.js");

test("l'accès au fichier Google Sheets est refusé sans session agence", async () => {
  const res = await handleAgencyGoogleSheets(agencyRequest("https://getlocation.fr/api/agency-google-sheets"), makeAgencyEnv());
  assert.equal(res.status, 401);
});

test("l'URL Google Sheets n'est renvoyée qu'à une session agence valide", async () => {
  const url = "https://docs.google.com/spreadsheets/d/1SuXCyRVjKh0vThVPCKdQjeyezubcyisj-ZI24Gu2Q8o/edit";
  const env = makeAgencyEnv({ GOOGLE_SHEETS_URL: url });
  const session = await loginAgency(env);
  const res = await handleAgencyGoogleSheets(agencyRequest("https://getlocation.fr/api/agency-google-sheets", { session }), env);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { configured: true, url });
  assert.equal(res.headers.get("cache-control"), "no-store");
});

test("seule une URL Google Sheets HTTPS valide peut être exposée", () => {
  assert.equal(configuredSheetUrl("https://docs.google.com/spreadsheets/d/abc/edit"), "https://docs.google.com/spreadsheets/d/abc/edit");
  assert.equal(configuredSheetUrl("https://example.com/spreadsheets/d/abc"), null);
  assert.equal(configuredSheetUrl("javascript:alert(1)"), null);
});
