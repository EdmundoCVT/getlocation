// Résumé opérationnel minimal : données déjà fiables en D1 uniquement.
// Les réservations web/KV et le planning Google Sheets ne sont pas mélangés
// ici afin de ne jamais présenter un total incomplet comme une vérité globale.

const { requireAgencySession } = require("../lib/agency-auth.js");

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}

function todayParis() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const fields = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

async function handleAgencyDashboard(request, env) {
  if (request.method !== "GET") return json(405, { error: "Méthode non autorisée" });
  const auth = await requireAgencySession(request, env);
  if (auth.error) return auth.error;

  try {
    const today = todayParis();
    const [rentals, deposits] = await Promise.all([
      env.AGENCY_DB.prepare(
        "SELECT COALESCE(SUM(CASE WHEN date_debut = ? AND status != 'annulee' THEN 1 ELSE 0 END), 0) AS departuresToday, COALESCE(SUM(CASE WHEN date_fin = ? AND status != 'annulee' THEN 1 ELSE 0 END), 0) AS returnsToday, COALESCE(SUM(CASE WHEN status = 'en_cours' THEN 1 ELSE 0 END), 0) AS activeRentals FROM rentals"
      ).bind(today, today).first(),
      env.AGENCY_DB.prepare("SELECT COUNT(*) AS pendingDeposits FROM deposits WHERE status = ?").bind("attendue").first()
    ]);
    return json(200, {
      date: today,
      departuresToday: Number(rentals && rentals.departuresToday) || 0,
      returnsToday: Number(rentals && rentals.returnsToday) || 0,
      activeRentals: Number(rentals && rentals.activeRentals) || 0,
      pendingDeposits: Number(deposits && deposits.pendingDeposits) || 0
    });
  } catch (error) {
    console.error("[agency-dashboard] lecture indisponible :", error && error.message);
    return json(503, { error: "Tableau de bord indisponible." });
  }
}

module.exports = { handleAgencyDashboard, todayParis };
