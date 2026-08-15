const { getVehiculeParId } = require("../../js/data.js");
const { sendEmail } = require("./resend-client.js");

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
}

async function sendDocumentsNotificationEmail(env, reservation, documentTypes, agencyToken) {
  if (!env.RESEND_API_KEY || !env.AGENCY_EMAIL) return;
  const vehicle = getVehiculeParId(reservation.vehiculeId);
  const vehicleName = vehicle ? vehicle.nom : reservation.vehiculeId;
  const list = documentTypes.join(", ");
  const subject = `Dossier documentaire reçu — ${reservation.id}`;
  const siteUrl = String(env.SITE_URL || "https://getlocation.fr").replace(/\/$/, "");
  const accessUrl = agencyToken ? `${siteUrl}/agency-documents.html#token=${agencyToken}` : null;
  const text = `Le dossier documentaire de la réservation ${reservation.id} (${vehicleName}) a été envoyé.\nPièces reçues : ${list}.\nAucune pièce n'est jointe à cet e-mail.${accessUrl ? `\nConsulter le dossier (lien valable 7 jours) : ${accessUrl}` : ""}`;
  const html = `<p>Le dossier documentaire de la réservation <strong>${escapeHtml(reservation.id)}</strong> (${escapeHtml(vehicleName)}) a été envoyé.</p><p>Pièces reçues : ${escapeHtml(list)}.</p><p>Aucune pièce n'est jointe à cet e-mail.</p>${accessUrl ? `<p><a href="${escapeHtml(accessUrl)}" style="display:inline-block;padding:12px 18px;background:#111827;color:#fff;text-decoration:none;border-radius:6px">Consulter le dossier</a></p><p>Ce lien sécurisé expire dans 7 jours.</p>` : ""}`;
  try {
    await sendEmail(env.RESEND_API_KEY, {
      from: env.RESEND_FROM || "GET LOCATION <reservations@getlocation.fr>",
      to: [env.AGENCY_EMAIL],
      subject,
      text,
      html
    });
  } catch (err) {
    console.error("[documents-notification] Échec d'envoi pour la réservation", reservation.id, err && err.message);
  }
}

module.exports = { sendDocumentsNotificationEmail };
