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
  env.AGENCY_DB._raw.clients.set("c1", { id: "c1", first_name: "Jeanne", last_name: "Durand" });
  env.AGENCY_DB._raw.rentals.set("r1", { id: "r1", client_id: "c1", vehicule_id: "opel-corsa", date_debut: today, heure_debut: "09:00", date_fin: today, heure_fin: "18:00", status: "en_cours" });
  env.AGENCY_DB._raw.rentals.set("r2", { id: "r2", client_id: "c1", vehicule_id: "opel-corsa", date_debut: today, heure_debut: "09:00", date_fin: "2099-01-01", heure_fin: "18:00", status: "annulee" });
  env.AGENCY_DB._raw.deposits.set("d1", { id: "d1", rental_id: "r1", status: "attendue" });
  const res = await handleAgencyDashboard(agencyRequest("https://getlocation.fr/api/agency-dashboard", { session }), env);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.deepEqual({ date: json.date, departuresToday: json.departuresToday, returnsToday: json.returnsToday, activeRentals: json.activeRentals, pendingDeposits: json.pendingDeposits }, { date: today, departuresToday: 1, returnsToday: 1, activeRentals: 1, pendingDeposits: 1 });
  assert.equal(json.todayMovements[0].clientName, "Jeanne Durand");
  assert.equal(json.todo[0].type, "deposit");
});
