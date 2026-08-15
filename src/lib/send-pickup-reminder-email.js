const { getVehiculeParId, formatEUR } = require("../../js/data.js");
const { sendEmail } = require("./resend-client.js");

const AGENCY_WHATSAPP_NUMBER = "33667485430";

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
}

function formatDateHeure(dateISO, heure) {
  if (!dateISO) return "";
  const date = new Date(`${dateISO}T00:00:00`).toLocaleDateString("fr-FR", {
    weekday: "long", day: "numeric", month: "long", year: "numeric"
  });
  return heure ? `${date} à ${heure}` : date;
}

function pickupLocation(reservation) {
  const lieu = reservation.lieuPrise || "Lieu à confirmer avec l'agence";
  return reservation.adressePrise ? `${lieu} — ${reservation.adressePrise}` : lieu;
}

function buildPickupReminderEmailContent(reservation) {
  const vehicle = getVehiculeParId(reservation.vehiculeId);
  const vehicleName = vehicle ? vehicle.nom : reservation.vehiculeId;
  const caution = vehicle ? formatEUR(vehicle.caution) : "à confirmer";
  const pickup = formatDateHeure(reservation.dateDebut, reservation.heureDebut);
  const location = pickupLocation(reservation);
  const documentsSubmitted = reservation.documentsStatus === "submitted";
  const documentsLine = documentsSubmitted
    ? "Dossier documentaire : documents reçus par l'agence"
    : "Dossier documentaire : incomplet — contactez rapidement l'agence si nécessaire";
  const message = `Bonjour, je vous contacte au sujet de la prise en charge de ma réservation ${reservation.id}.`;
  const whatsappUrl = `https://wa.me/${AGENCY_WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
  const subject = `Rappel prise en charge — ${vehicleName}`;
  const text = [
    "Bonjour,", "", "Votre location approche. Voici les informations à vérifier :", "",
    `Véhicule : ${vehicleName}`,
    `Prise en charge : ${pickup}`,
    `Lieu : ${location}`,
    `Caution : ${caution} (prélevée avant la remise des clés)`,
    documentsLine,
    `Référence : ${reservation.id}`, "",
    "À apporter : permis de conduire valide et pièce d'identité.",
    `Contacter l'agence sur WhatsApp : ${whatsappUrl}`, "",
    "À bientôt,", "L'équipe GET LOCATION"
  ].join("\n");
  const html = `<p>Bonjour,</p><p>Votre location approche. Voici les informations à vérifier :</p><ul><li><strong>Véhicule :</strong> ${escapeHtml(vehicleName)}</li><li><strong>Prise en charge :</strong> ${escapeHtml(pickup)}</li><li><strong>Lieu :</strong> ${escapeHtml(location)}</li><li><strong>Caution :</strong> ${escapeHtml(caution)} (prélevée avant la remise des clés)</li><li><strong>Dossier documentaire :</strong> ${documentsSubmitted ? "documents reçus par l'agence" : "incomplet — contactez rapidement l'agence si nécessaire"}</li><li><strong>Référence :</strong> ${escapeHtml(reservation.id)}</li></ul><p><strong>À apporter :</strong> permis de conduire valide et pièce d'identité.</p><p><a href="${escapeHtml(whatsappUrl)}" style="display:inline-block;padding:12px 18px;background:#25D366;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold">Contacter l'agence sur WhatsApp</a></p><p>À bientôt,<br>L'équipe GET LOCATION</p>`;
  return { subject, text, html };
}

async function sendPickupReminderEmail(env, reservation) {
  const email = reservation.conducteur && reservation.conducteur.email;
  if (!env.RESEND_API_KEY || !email) return false;
  try {
    const content = buildPickupReminderEmailContent(reservation);
    await sendEmail(env.RESEND_API_KEY, {
      from: env.RESEND_FROM || "GET LOCATION <reservations@getlocation.fr>",
      to: [email],
      ...content
    });
    return true;
  } catch (err) {
    console.error("[pickup-reminder] Échec d'envoi pour la réservation", reservation.id, err && err.message);
    return false;
  }
}

module.exports = { buildPickupReminderEmailContent, sendPickupReminderEmail };
