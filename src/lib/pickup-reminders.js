const { listReservations, updateReservationStatus } = require("./reservation-store.js");
const { sendPickupReminderEmail } = require("./send-pickup-reminder-email.js");

const MIN_DELAY_MS = 24 * 60 * 60 * 1000;
const MAX_DELAY_MS = 48 * 60 * 60 * 1000;

function rentalStartMs(reservation) {
  return new Date(reservation.periodeDebut || `${reservation.dateDebut}T${reservation.heureDebut || "00:00"}:00`).getTime();
}

function shouldSendPickupReminder(reservation, nowMs) {
  if (!reservation || reservation.status !== "paid" || reservation.pickupReminderSentAt) return false;
  if (!reservation.conducteur || !reservation.conducteur.email) return false;
  const startMs = rentalStartMs(reservation);
  if (!Number.isFinite(startMs)) return false;
  const delay = startMs - nowMs;
  return delay >= MIN_DELAY_MS && delay <= MAX_DELAY_MS;
}

async function runPickupReminders(env, nowMs = Date.now(), sendReminder = sendPickupReminderEmail) {
  const reservations = await listReservations(env);
  let sent = 0;
  for (const reservation of reservations) {
    if (!shouldSendPickupReminder(reservation, nowMs)) continue;
    if (!await sendReminder(env, reservation)) continue;
    await updateReservationStatus(env, reservation.id, "paid", {
      pickupReminderSentAt: new Date(nowMs).toISOString()
    });
    sent += 1;
  }
  return { scanned: reservations.length, sent };
}

module.exports = { shouldSendPickupReminder, runPickupReminders };
