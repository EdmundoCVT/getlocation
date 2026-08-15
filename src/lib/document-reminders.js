const { listReservations, updateReservationStatus, saveDocumentAccessIndex } = require("./reservation-store.js");
const { issueDocumentAccess } = require("./document-access-token.js");
const { sendDocumentsReminderEmail } = require("./send-documents-reminder-email.js");

const FIRST_REMINDER_DELAY_MS = 24 * 60 * 60 * 1000;
const NEXT_REMINDER_DELAY_MS = 48 * 60 * 60 * 1000;
const MAX_REMINDERS = 2;

function shouldRemind(reservation, nowMs) {
  if (!reservation || reservation.status !== "paid" || reservation.documentsStatus === "submitted") return false;
  if (!reservation.conducteur || !reservation.conducteur.email) return false;
  const rentalStart = new Date(reservation.periodeDebut || `${reservation.dateDebut}T${reservation.heureDebut}:00`).getTime();
  if (!Number.isFinite(rentalStart) || rentalStart <= nowMs) return false;
  const reminder = reservation.documentsReminder || { count: 0 };
  if ((reminder.count || 0) >= MAX_REMINDERS) return false;
  const baseline = reminder.lastSentAt || reservation.paidAt;
  const baselineMs = new Date(baseline).getTime();
  const delay = reminder.count ? NEXT_REMINDER_DELAY_MS : FIRST_REMINDER_DELAY_MS;
  return Number.isFinite(baselineMs) && nowMs - baselineMs >= delay;
}

async function runDocumentReminders(env, nowMs = Date.now(), sendReminder = sendDocumentsReminderEmail) {
  const reservations = await listReservations(env);
  let sent = 0;
  for (const reservation of reservations) {
    if (!shouldRemind(reservation, nowMs)) continue;
    const issued = await issueDocumentAccess(env, reservation, new Date(nowMs).toISOString());
    if (!issued || new Date(issued.stored.expiresAt).getTime() <= nowMs) continue;
    const withToken = await updateReservationStatus(env, reservation.id, "paid", { documentAccess: issued.stored });
    if (!withToken) continue;
    const indexed = await saveDocumentAccessIndex(env, reservation.id, issued.stored.tokenHash, issued.stored.expiresAt);
    if (!indexed) continue;
    const number = ((reservation.documentsReminder && reservation.documentsReminder.count) || 0) + 1;
    if (!await sendReminder(env, withToken, issued.token, number)) continue;
    await updateReservationStatus(env, reservation.id, "paid", { documentsReminder: { count: number, lastSentAt: new Date(nowMs).toISOString() } });
    sent += 1;
  }
  return { scanned: reservations.length, sent };
}

module.exports = { shouldRemind, runDocumentReminders };
