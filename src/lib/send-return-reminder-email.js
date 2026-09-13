const { getVehiculeParId } = require("../../js/data.js");
const { sendEmail } = require("./resend-client.js");
const { traducteur, langueClient, formatDateHeure, deuxPoints } = require("./textes-email.js");

const AGENCY_WHATSAPP_NUMBER = "33667485430";

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
}

function returnLocation(reservation, t) {
  const lieu = t(reservation.lieuRetour || "Lieu à confirmer avec l'agence");
  return reservation.adresseRetour ? `${lieu} — ${reservation.adresseRetour}` : lieu;
}

function buildReturnReminderEmailContent(reservation) {
  // Écrit dans la langue où le client a réservé (voir textes-email.js).
  const langue = langueClient(reservation);
  const t = traducteur(langue);
  const sep = deuxPoints(langue);
  const vehicle = getVehiculeParId(reservation.vehiculeId);
  const vehicleName = vehicle ? vehicle.nom : reservation.vehiculeId;
  const returnDate = formatDateHeure(reservation.dateFin, reservation.heureFin, langue);
  const location = returnLocation(reservation, t);
  const message = t("Bonjour, je vous contacte au sujet de la restitution de ma réservation {reference}.", { reference: reservation.id });
  const whatsappUrl = `https://wa.me/${AGENCY_WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
  const subject = t("Rappel restitution — {vehicule}", { vehicule: vehicleName });
  const checklist = [
    t("Vérifier que tous vos effets personnels ont été retirés"),
    t("Restituer le véhicule avec le niveau de carburant prévu au contrat"),
    t("Signaler à l'agence tout dommage ou incident survenu pendant la location")
  ];
  const text = [
    t("Bonjour,"), "", t("La restitution de votre véhicule approche :"), "",
    t("Véhicule : {valeur}", { valeur: vehicleName }),
    t("Restitution : {valeur}", { valeur: returnDate }),
    t("Lieu : {valeur}", { valeur: location }),
    t("Référence : {valeur}", { valeur: reservation.id }), "",
    t("Avant la restitution :"), ...checklist.map((item) => `- ${item}`), "",
    t("Prévenir l'agence sur WhatsApp en cas de retard ou de changement : {lien}", { lien: whatsappUrl }), "",
    t("À bientôt,"), t("L'équipe GET LOCATION")
  ].join("\n");
  const checklistHtml = checklist.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const html = `<p>${escapeHtml(t("Bonjour,"))}</p><p>${escapeHtml(t("La restitution de votre véhicule approche :"))}</p><ul><li><strong>${escapeHtml(t("Véhicule"))}${sep}</strong> ${escapeHtml(vehicleName)}</li><li><strong>${escapeHtml(t("Restitution"))}${sep}</strong> ${escapeHtml(returnDate)}</li><li><strong>${escapeHtml(t("Lieu"))}${sep}</strong> ${escapeHtml(location)}</li><li><strong>${escapeHtml(t("Référence"))}${sep}</strong> ${escapeHtml(reservation.id)}</li></ul><p><strong>${escapeHtml(t("Avant la restitution"))}${sep}</strong></p><ul>${checklistHtml}</ul><p><a href="${escapeHtml(whatsappUrl)}" style="display:inline-block;padding:12px 18px;background:#25D366;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold">${escapeHtml(t("Prévenir l'agence sur WhatsApp"))}</a></p><p>${escapeHtml(t("À bientôt,"))}<br>${escapeHtml(t("L'équipe GET LOCATION"))}</p>`;
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
