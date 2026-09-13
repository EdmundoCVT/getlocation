const { getVehiculeParId } = require("../../js/data.js");
const { sendEmail } = require("./resend-client.js");
const { traducteur, langueClient, lienPageClient, deuxPoints } = require("./textes-email.js");

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
}

async function sendDocumentsReminderEmail(env, reservation, token, reminderNumber) {
  const email = reservation.conducteur && reservation.conducteur.email;
  if (!env.RESEND_API_KEY || !email || !token) return false;
  // Écrit dans la langue où le client a réservé (voir textes-email.js).
  const langue = langueClient(reservation);
  const t = traducteur(langue);
  const sep = deuxPoints(langue);
  const vehicle = getVehiculeParId(reservation.vehiculeId);
  const vehicleName = vehicle ? vehicle.nom : reservation.vehiculeId;
  const link = lienPageClient(env.SITE_URL, "documents.html", langue, `token=${token}`);
  const subject = reminderNumber === 1
    ? t("Rappel — complétez votre dossier GETLOCATION")
    : t("Dernier rappel — dossier de location incomplet");
  const corps = t("Votre réservation {reference} ({vehicule}) est confirmée, mais votre dossier documentaire n'est pas encore complet.",
    { reference: reservation.id, vehicule: vehicleName });
  const corpsHtml = t("Votre réservation {reference} ({vehicule}) est confirmée, mais votre dossier documentaire n'est pas encore complet.",
    { reference: `<strong>${escapeHtml(reservation.id)}</strong>`, vehicule: escapeHtml(vehicleName) });
  const text = `${t("Bonjour,")}\n\n${corps}\n\n${t("Compléter mon dossier")}${sep}${link}\n\n${t("Ce lien sécurisé expire à la date indiquée lors de votre réservation. Si vous avez déjà envoyé vos documents, ignorez ce message.")}\n\n${t("L'équipe GETLOCATION")}`;
  const html = `<p>${escapeHtml(t("Bonjour,"))}</p><p>${corpsHtml}</p><p><a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 18px;background:#111827;color:#fff;text-decoration:none;border-radius:6px">${escapeHtml(t("Compléter mon dossier"))}</a></p><p>${escapeHtml(t("Si vous avez déjà envoyé vos documents, ignorez ce message."))}</p><p>${escapeHtml(t("L'équipe GETLOCATION"))}</p>`;
  try {
    await sendEmail(env.RESEND_API_KEY, { from: env.RESEND_FROM || "GET LOCATION <reservations@getlocation.fr>", to: [email], subject, text, html });
    return true;
  } catch (err) {
    console.error("[documents-reminder] Échec d'envoi pour la réservation", reservation.id, err && err.message);
    return false;
  }
}

module.exports = { sendDocumentsReminderEmail };
