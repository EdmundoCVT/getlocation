const { getVehiculeParId } = require("../../js/data.js");
const { sendEmail } = require("./resend-client.js");

async function sendDocumentsNotificationEmail(env, reservation, documentTypes) {
  if (!env.RESEND_API_KEY || !env.AGENCY_EMAIL) return;
  const vehicle = getVehiculeParId(reservation.vehiculeId);
  const vehicleName = vehicle ? vehicle.nom : reservation.vehiculeId;
  const list = documentTypes.join(", ");
  const subject = `Dossier documentaire reçu — ${reservation.id}`;
  const text = `Le dossier documentaire de la réservation ${reservation.id} (${vehicleName}) a été envoyé.\nPièces reçues : ${list}.\nAucune pièce n'est jointe à cet e-mail.`;
  const html = `<p>Le dossier documentaire de la réservation <strong>${reservation.id}</strong> (${vehicleName}) a été envoyé.</p><p>Pièces reçues : ${list}.</p><p>Aucune pièce n'est jointe à cet e-mail.</p>`;
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
