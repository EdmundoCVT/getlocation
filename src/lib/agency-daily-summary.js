const { listReservations } = require("./reservation-store.js");
const { sendAgencyDailySummaryEmail } = require("./send-agency-daily-summary-email.js");

function franceDate(nowMs) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date(nowMs));
}

function eventsForDate(reservations, date) {
  const events = [];
  for (const reservation of reservations) {
    if (!reservation || reservation.status !== "paid") continue;
    if (reservation.dateDebut === date) events.push({ type: "pickup", reservation });
    if (reservation.dateFin === date) events.push({ type: "return", reservation });
  }
  return events.sort((a, b) => {
    const aHour = a.type === "pickup" ? a.reservation.heureDebut : a.reservation.heureFin;
    const bHour = b.type === "pickup" ? b.reservation.heureDebut : b.reservation.heureFin;
    return String(aHour || "99:99").localeCompare(String(bHour || "99:99"));
  });
}

async function runAgencyDailySummary(env, nowMs = Date.now(), sendSummary = sendAgencyDailySummaryEmail) {
  const date = franceDate(nowMs);
  const sentKey = `agency_summary_${date}`;
  if (await env.RESERVATIONS_KV.get(sentKey)) return { date, events: 0, sent: false, alreadySent: true };
  const reservations = await listReservations(env);
  const events = eventsForDate(reservations, date);
  if (!events.length) return { date, events: 0, sent: false, alreadySent: false };
  if (!await sendSummary(env, date, events)) return { date, events: events.length, sent: false, alreadySent: false };
  await env.RESERVATIONS_KV.put(sentKey, new Date(nowMs).toISOString(), { expirationTtl: 3 * 24 * 60 * 60 });
  return { date, events: events.length, sent: true, alreadySent: false };
}

module.exports = { franceDate, eventsForDate, runAgencyDailySummary };
