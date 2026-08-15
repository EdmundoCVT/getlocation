const { listReservations, updateReservationStatus } = require("./reservation-store.js");
const { sendReturnReminderEmail } = require("./send-return-reminder-email.js");

const MAX_DELAY_MS = 48 * 60 * 60 * 1000;

function periodMs(reservation, isoField, dateField, timeField) {
  return new Date(reservation[isoField] || `${reservation[dateField]}T${reservation[timeField] || "00:00"}:00`).getTime();
}

function shouldSendReturnReminder(reservation, nowMs) {
  if (!reservation || reservation.status !== "paid" || reservation.returnReminderSentAt) return false;
  if (!reservation.conducteur || !reservation.conducteur.email) return false;
  const startMs = periodMs(reservation, "periodeDebut", "dateDebut", "heureDebut");
  const returnMs = periodMs(reservation, "periodeFin", "dateFin", "heureFin");
  if (!Number.isFinite(startMs) || !Number.isFinite(returnMs) || nowMs < startMs) return false;
  const delay = returnMs - nowMs;
  return delay > 0 && delay <= MAX_DELAY_MS;
}

async function runReturnReminders(env, nowMs = Date.now(), sendReminder = sendReturnReminderEmail) {
  const reservations = await listReservations(env);
  let sent = 0;
  for (const reservation of reservations) {
    if (!shouldSendReturnReminder(reservation, nowMs)) continue;
    if (!await sendReminder(env, reservation)) continue;
    await updateReservationStatus(env, reservation.id, "paid", {
      returnReminderSentAt: new Date(nowMs).toISOString()
    });
    sent += 1;
  }
  return { scanned: reservations.length, sent };
}

module.exports = { shouldSendReturnReminder, runReturnReminders };
