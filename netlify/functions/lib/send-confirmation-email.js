// netlify/functions/lib/send-confirmation-email.js
//
// Envoi de l'email de confirmation au client (avec copie cachée à
// l'adresse GET LOCATION) une fois une réservation passée au statut "paid"
// — voir l'appel dans mollie-webhook.js.
//
// Best effort volontaire : un échec d'envoi ne doit jamais faire échouer le
// traitement du webhook Mollie (qui a déjà confirmé le paiement à ce
// stade), ni provoquer de nouvelle tentative de paiement. Les erreurs sont
// donc uniquement journalisées ici, jamais propagées à l'appelant.
//
// Configuration requise (Netlify > Site configuration > Environment
// variables) :
//   - GMAIL_USER : adresse Gmail expéditrice (getlocation.fr@gmail.com)
//   - GMAIL_APP_PASSWORD : mot de passe d'application Google associé
//     (à générer sur https://myaccount.google.com/apppasswords — nécessite
//     la validation en 2 étapes activée sur ce compte)
// Tant que ces deux variables ne sont pas définies, l'email n'est pas
// envoyé (avertissement en log) mais la confirmation de paiement elle-même
// n'est pas affectée.

const nodemailer = require("nodemailer");
const { getVehiculeParId, formatEUR } = require("../../../js/data.js");

function createTransport() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return null;
  return nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
}

function formatDateHeure(dateISO, heure) {
  if (!dateISO) return "";
  const date = new Date(`${dateISO}T00:00:00`).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  });
  return heure ? `${date} à ${heure}` : date;
}

function buildConfirmationEmailContent(reservation) {
  const vehicule = getVehiculeParId(reservation.vehiculeId);
  const vehiculeNom = vehicule ? vehicule.nom : reservation.vehiculeId;
  const prise = formatDateHeure(reservation.dateDebut, reservation.heureDebut);
  const retour = formatDateHeure(reservation.dateFin, reservation.heureFin);
  const total = typeof reservation.total === "number" ? formatEUR(reservation.total) : "";
  const prenom = reservation.conducteur ? reservation.conducteur.prenom : "";

  const subject = `Confirmation de votre réservation GET LOCATION — ${vehiculeNom}`;

  const lignes = [
    `Bonjour ${prenom},`,
    "",
    `Votre réservation est confirmée. Voici son récapitulatif :`,
    "",
    `Véhicule : ${vehiculeNom}`,
    `Prise en charge : ${prise}${reservation.lieuPrise ? ` — ${reservation.lieuPrise}` : ""}`,
    `Retour : ${retour}${reservation.lieuRetour ? ` — ${reservation.lieuRetour}` : ""}`,
    `Durée : ${reservation.jours} jour(s)`,
    `Montant total réglé : ${total}`,
    `Référence de réservation : ${reservation.id}`,
    "",
    "Pour toute question, répondez simplement à cet email.",
    "",
    "À bientôt,",
    "L'équipe GET LOCATION"
  ];
  const text = lignes.join("\n");

  const html = `<p>Bonjour ${prenom},</p>
<p>Votre réservation est confirmée. Voici son récapitulatif :</p>
<ul>
<li><strong>Véhicule :</strong> ${vehiculeNom}</li>
<li><strong>Prise en charge :</strong> ${prise}${reservation.lieuPrise ? ` — ${reservation.lieuPrise}` : ""}</li>
<li><strong>Retour :</strong> ${retour}${reservation.lieuRetour ? ` — ${reservation.lieuRetour}` : ""}</li>
<li><strong>Durée :</strong> ${reservation.jours} jour(s)</li>
<li><strong>Montant total réglé :</strong> ${total}</li>
<li><strong>Référence de réservation :</strong> ${reservation.id}</li>
</ul>
<p>Pour toute question, répondez simplement à cet email.</p>
<p>À bientôt,<br>L'équipe GET LOCATION</p>`;

  return { subject, text, html };
}

async function sendConfirmationEmail(reservation) {
  if (!reservation || !reservation.conducteur || !reservation.conducteur.email) return;

  const transport = createTransport();
  if (!transport) {
    console.warn(
      "[send-confirmation-email] GMAIL_USER/GMAIL_APP_PASSWORD non configurés : email de confirmation non envoyé."
    );
    return;
  }

  const { subject, text, html } = buildConfirmationEmailContent(reservation);

  try {
    await transport.sendMail({
      from: `"GET LOCATION" <${process.env.GMAIL_USER}>`,
      to: reservation.conducteur.email,
      bcc: process.env.GMAIL_USER,
      subject,
      text,
      html
    });
  } catch (err) {
    // Ne jamais faire échouer le traitement du paiement pour un incident
    // d'envoi d'email : on journalise (sans donnée personnelle) pour
    // pouvoir diagnostiquer, sans bloquer ni relancer.
    console.error(
      `[send-confirmation-email] Échec de l'envoi pour la réservation ${reservation.id} :`,
      err && err.message
    );
  }
}

module.exports = { sendConfirmationEmail, buildConfirmationEmailContent };
