const test = require("node:test");
const assert = require("node:assert/strict");

const { handleAgencyDashboard, todayParis } = require("../src/api/agency-dashboard.js");
const { makeAgencyEnv, loginAgency, agencyRequest } = require("./helpers/agency-session.js");

test("le résumé opérationnel exige une session agence", async () => {
  const res = await handleAgencyDashboard(agencyRequest("https://getlocation.fr/api/agency-dashboard"), makeAgencyEnv());
  assert.equal(res.status, 401);
});

test("le résumé opérationnel compte seulement les locations D1 fiables", async () => {
  const env = makeAgencyEnv();
  const session = await loginAgency(env);
  const today = todayParis();
  env.AGENCY_DB._raw.rentals.set("r1", { id: "r1", date_debut: today, date_fin: today, status: "en_cours" });
  env.AGENCY_DB._raw.rentals.set("r2", { id: "r2", date_debut: today, date_fin: "2099-01-01", status: "annulee" });
  env.AGENCY_DB._raw.deposits.set("d1", { id: "d1", status: "attendue" });
  const res = await handleAgencyDashboard(agencyRequest("https://getlocation.fr/api/agency-dashboard", { session }), env);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { date: today, departuresToday: 1, returnsToday: 1, activeRentals: 1, pendingDeposits: 1 });
});
