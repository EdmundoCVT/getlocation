const { getVehiculeParId } = require("../../js/data.js");
const { sendEmail } = require("./resend-client.js");

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
}

async function sendDocumentsReminderEmail(env, reservation, token, reminderNumber) {
  const email = reservation.conducteur && reservation.conducteur.email;
  if (!env.RESEND_API_KEY || !email || !token) return false;
  const vehicle = getVehiculeParId(reservation.vehiculeId);
  const vehicleName = vehicle ? vehicle.nom : reservation.vehiculeId;
  const siteUrl = String(env.SITE_URL || "https://getlocation.fr").replace(/\/$/, "");
  const link = `${siteUrl}/documents.html#token=${token}`;
  const subject = reminderNumber === 1 ? "Rappel — complétez votre dossier GETLOCATION" : "Dernier rappel — dossier de location incomplet";
  const text = `Bonjour,\n\nVotre réservation ${reservation.id} (${vehicleName}) est confirmée, mais votre dossier documentaire n'est pas encore complet.\n\nCompléter mon dossier : ${link}\n\nCe lien sécurisé expire à la date indiquée lors de votre réservation. Si vous avez déjà envoyé vos documents, ignorez ce message.\n\nL'équipe GETLOCATION`;
  const html = `<p>Bonjour,</p><p>Votre réservation <strong>${escapeHtml(reservation.id)}</strong> (${escapeHtml(vehicleName)}) est confirmée, mais votre dossier documentaire n'est pas encore complet.</p><p><a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 18px;background:#111827;color:#fff;text-decoration:none;border-radius:6px">Compléter mon dossier</a></p><p>Si vous avez déjà envoyé vos documents, ignorez ce message.</p><p>L'équipe GETLOCATION</p>`;
  try {
    await sendEmail(env.RESEND_API_KEY, { from: env.RESEND_FROM || "GET LOCATION <reservations@getlocation.fr>", to: [email], subject, text, html });
    return true;
  } catch (err) {
    console.error("[documents-reminder] Échec d'envoi pour la réservation", reservation.id, err && err.message);
    return false;
  }
}

module.exports = { sendDocumentsReminderEmail };
