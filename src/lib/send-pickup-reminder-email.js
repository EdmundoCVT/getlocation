const { getVehiculeParId, resolveDepositAmount, formatEUR } = require("../../js/data.js");
const { sendEmail } = require("./resend-client.js");
const { traducteur, langueClient, formatDateHeure, deuxPoints } = require("./textes-email.js");

const AGENCY_WHATSAPP_NUMBER = "33667485430";

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
}

function pickupLocation(reservation, t) {
  const lieu = t(reservation.lieuPrise || "Lieu à confirmer avec l'agence");
  return reservation.adressePrise ? `${lieu} — ${reservation.adressePrise}` : lieu;
}

function buildPickupReminderEmailContent(reservation) {
  // Écrit dans la langue où le client a réservé (voir textes-email.js).
  const langue = langueClient(reservation);
  const t = traducteur(langue);
  const sep = deuxPoints(langue);
  const vehicle = getVehiculeParId(reservation.vehiculeId);
  const vehicleName = vehicle ? vehicle.nom : reservation.vehiculeId;
  const caution = vehicle ? formatEUR(resolveDepositAmount(reservation, vehicle)) : t("à confirmer");
  const pickup = formatDateHeure(reservation.dateDebut, reservation.heureDebut, langue);
  const location = pickupLocation(reservation, t);
  const documentsSubmitted = reservation.documentsStatus === "submitted";
  const etatDossier = documentsSubmitted
    ? t("documents reçus par l'agence")
    : t("incomplet — contactez rapidement l'agence si nécessaire");
  const message = t("Bonjour, je vous contacte au sujet de la prise en charge de ma réservation {reference}.", { reference: reservation.id });
  const whatsappUrl = `https://wa.me/${AGENCY_WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
  const subject = t("Rappel prise en charge — {vehicule}", { vehicule: vehicleName });
  const text = [
    t("Bonjour,"), "", t("Votre location approche. Voici les informations à vérifier :"), "",
    t("Véhicule : {valeur}", { valeur: vehicleName }),
    t("Prise en charge : {valeur}", { valeur: pickup }),
    t("Lieu : {valeur}", { valeur: location }),
    t("Caution : {valeur} (prélevée avant la remise des clés)", { valeur: caution }),
    `${t("Dossier documentaire")}${sep}${etatDossier}`,
    t("Référence : {valeur}", { valeur: reservation.id }),
    "",
    t("À apporter : permis de conduire valide et pièce d'identité."),
    `${t("Contacter l'agence sur WhatsApp")}${sep}${whatsappUrl}`, "",
    t("À bientôt,"), t("L'équipe GET LOCATION")
  ].join("\n");
  const html = `<p>${escapeHtml(t("Bonjour,"))}</p><p>${escapeHtml(t("Votre location approche. Voici les informations à vérifier :"))}</p><ul><li><strong>${escapeHtml(t("Véhicule"))}${sep}</strong> ${escapeHtml(vehicleName)}</li><li><strong>${escapeHtml(t("Prise en charge"))}${sep}</strong> ${escapeHtml(pickup)}</li><li><strong>${escapeHtml(t("Lieu"))}${sep}</strong> ${escapeHtml(location)}</li><li><strong>${escapeHtml(t("Caution"))}${sep}</strong> ${escapeHtml(caution)} ${escapeHtml(t("(prélevée avant la remise des clés)"))}</li><li><strong>${escapeHtml(t("Dossier documentaire"))}${sep}</strong> ${escapeHtml(etatDossier)}</li><li><strong>${escapeHtml(t("Référence"))}${sep}</strong> ${escapeHtml(reservation.id)}</li></ul><p><strong>${escapeHtml(t("À apporter"))}${sep}</strong> ${escapeHtml(t("permis de conduire valide et pièce d'identité."))}</p><p><a href="${escapeHtml(whatsappUrl)}" style="display:inline-block;padding:12px 18px;background:#25D366;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold">${escapeHtml(t("Contacter l'agence sur WhatsApp"))}</a></p><p>${escapeHtml(t("À bientôt,"))}<br>${escapeHtml(t("L'équipe GET LOCATION"))}</p>`;
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
