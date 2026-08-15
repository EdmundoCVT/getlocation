const { getVehiculeParId } = require("../../js/data.js");
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

function returnLocation(reservation) {
  const lieu = reservation.lieuRetour || "Lieu à confirmer avec l'agence";
  return reservation.adresseRetour ? `${lieu} — ${reservation.adresseRetour}` : lieu;
}

function buildReturnReminderEmailContent(reservation) {
  const vehicle = getVehiculeParId(reservation.vehiculeId);
  const vehicleName = vehicle ? vehicle.nom : reservation.vehiculeId;
  const returnDate = formatDateHeure(reservation.dateFin, reservation.heureFin);
  const location = returnLocation(reservation);
  const message = `Bonjour, je vous contacte au sujet de la restitution de ma réservation ${reservation.id}.`;
  const whatsappUrl = `https://wa.me/${AGENCY_WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
  const subject = `Rappel restitution — ${vehicleName}`;
  const checklist = [
    "Vérifier que tous vos effets personnels ont été retirés",
    "Restituer le véhicule avec le niveau de carburant prévu au contrat",
    "Signaler à l'agence tout dommage ou incident survenu pendant la location"
  ];
  const text = [
    "Bonjour,", "", "La restitution de votre véhicule approche :", "",
    `Véhicule : ${vehicleName}`,
    `Restitution : ${returnDate}`,
    `Lieu : ${location}`,
    `Référence : ${reservation.id}`, "",
    "Avant la restitution :", ...checklist.map((item) => `- ${item}`), "",
    `Prévenir l'agence sur WhatsApp en cas de retard ou de changement : ${whatsappUrl}`, "",
    "À bientôt,", "L'équipe GET LOCATION"
  ].join("\n");
  const checklistHtml = checklist.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const html = `<p>Bonjour,</p><p>La restitution de votre véhicule approche :</p><ul><li><strong>Véhicule :</strong> ${escapeHtml(vehicleName)}</li><li><strong>Restitution :</strong> ${escapeHtml(returnDate)}</li><li><strong>Lieu :</strong> ${escapeHtml(location)}</li><li><strong>Référence :</strong> ${escapeHtml(reservation.id)}</li></ul><p><strong>Avant la restitution :</strong></p><ul>${checklistHtml}</ul><p><a href="${escapeHtml(whatsappUrl)}" style="display:inline-block;padding:12px 18px;background:#25D366;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold">Prévenir l'agence sur WhatsApp</a></p><p>À bientôt,<br>L'équipe GET LOCATION</p>`;
  return { subject, text, html };
}

async function sendReturnReminderEmail(env, reservation) {
  const email = reservation.conducteur && reservation.conducteur.email;
  if (!env.RESEND_API_KEY || !email) return false;
  try {
    const content = buildReturnReminderEmailContent(reservation);
    await sendEmail(env.RESEND_API_KEY, {
      from: env.RESEND_FROM || "GET LOCATION <reservations@getlocation.fr>",
      to: [email],
      ...content
    });
    return true;
  } catch (err) {
    console.error("[return-reminder] Échec d'envoi pour la réservation", reservation.id, err && err.message);
    return false;
  }
}

module.exports = { buildReturnReminderEmailContent, sendReturnReminderEmail };
