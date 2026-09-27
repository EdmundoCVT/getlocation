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
    const rentalFields = "r.id, r.vehicule_id, r.date_debut, r.heure_debut, r.date_fin, r.heure_fin, r.status, c.first_name, c.last_name";
    const [rentals, deposits, todayMovements, upcomingRentals, draftRentals, pendingDepositRows] = await Promise.all([
      env.AGENCY_DB.prepare(
        "SELECT COALESCE(SUM(CASE WHEN date_debut = ? AND status != 'annulee' THEN 1 ELSE 0 END), 0) AS departuresToday, COALESCE(SUM(CASE WHEN date_fin = ? AND status != 'annulee' THEN 1 ELSE 0 END), 0) AS returnsToday, COALESCE(SUM(CASE WHEN status = 'en_cours' THEN 1 ELSE 0 END), 0) AS activeRentals FROM rentals"
      ).bind(today, today).first(),
      env.AGENCY_DB.prepare("SELECT COUNT(*) AS pendingDeposits FROM deposits WHERE status = ?").bind("attendue").first(),
      env.AGENCY_DB.prepare(`SELECT ${rentalFields} FROM rentals r JOIN clients c ON c.id = r.client_id WHERE r.status != 'annulee' AND (r.date_debut = ? OR r.date_fin = ?) ORDER BY CASE WHEN r.date_debut = ? THEN r.heure_debut ELSE r.heure_fin END ASC`).bind(today, today, today).all(),
      env.AGENCY_DB.prepare(`SELECT ${rentalFields} FROM rentals r JOIN clients c ON c.id = r.client_id WHERE r.status != 'annulee' AND r.date_debut >= ? ORDER BY r.date_debut ASC, r.heure_debut ASC LIMIT 5`).bind(today).all(),
      env.AGENCY_DB.prepare(`SELECT ${rentalFields} FROM rentals r JOIN clients c ON c.id = r.client_id WHERE r.status = 'brouillon' AND r.date_debut >= ? ORDER BY r.date_debut ASC, r.heure_debut ASC LIMIT 5`).bind(today).all(),
      env.AGENCY_DB.prepare(`SELECT d.id AS deposit_id, ${rentalFields} FROM deposits d JOIN rentals r ON r.id = d.rental_id JOIN clients c ON c.id = r.client_id WHERE d.status = 'attendue' AND r.status != 'annulee' ORDER BY r.date_debut ASC LIMIT 5`).bind().all()
    ]);
    return json(200, {
      date: today,
      departuresToday: Number(rentals && rentals.departuresToday) || 0,
      returnsToday: Number(rentals && rentals.returnsToday) || 0,
      activeRentals: Number(rentals && rentals.activeRentals) || 0,
      pendingDeposits: Number(deposits && deposits.pendingDeposits) || 0,
      todayMovements: (todayMovements.results || []).flatMap((rental) => {
        const common = { id: rental.id, vehicleId: rental.vehicule_id, clientName: [rental.first_name, rental.last_name].filter(Boolean).join(" ") };
        return [
          ...(rental.date_debut === today ? [{ ...common, type: "departure", time: rental.heure_debut }] : []),
          ...(rental.date_fin === today ? [{ ...common, type: "return", time: rental.heure_fin }] : [])
        ];
      }).sort((a, b) => String(a.time || "").localeCompare(String(b.time || ""))),
      upcomingRentals: (upcomingRentals.results || []).map((rental) => ({
        id: rental.id, date: rental.date_debut, time: rental.heure_debut, vehicleId: rental.vehicule_id,
        clientName: [rental.first_name, rental.last_name].filter(Boolean).join(" "), status: rental.status
      })),
      todo: [
        ...(pendingDepositRows.results || []).map((rental) => ({ type: "deposit", id: rental.id, vehicleId: rental.vehicule_id, clientName: [rental.first_name, rental.last_name].filter(Boolean).join(" ") })),
        ...(draftRentals.results || []).map((rental) => ({ type: "contract", id: rental.id, vehicleId: rental.vehicule_id, clientName: [rental.first_name, rental.last_name].filter(Boolean).join(" ") }))
      ]
    });
  } catch (error) {
    console.error("[agency-dashboard] lecture indisponible :", error && error.message);
    return json(503, { error: "Tableau de bord indisponible." });
  }
}

module.exports = { handleAgencyDashboard, todayParis };
