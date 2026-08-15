// src/lib/send-confirmation-email.js
//
// Envoi de l'email de confirmation au client (avec copie cachée à l'agence)
// une fois une réservation passée au statut "paid" — voir l'appel dans
// src/api/mollie-webhook.js. Remplace nodemailer/SMTP Gmail par l'API HTTP
// de Resend (voir resend-client.js) — le contenu de l'email (buildConfirmationEmailContent)
// est inchangé par rapport à l'ancienne version Netlify.
//
// Best effort volontaire : un échec d'envoi ne doit jamais faire échouer le
// traitement du webhook Mollie (qui a déjà confirmé le paiement à ce
// stade). Les erreurs sont donc uniquement journalisées ici, jamais
// propagées à l'appelant.
//
// Configuration requise (secrets Cloudflare Worker, voir DEPLOIEMENT.md) :
//   - RESEND_API_KEY : clé API Resend
//   - RESEND_FROM (optionnel) : adresse expéditrice ("Nom <adresse@domaine>"),
//     doit appartenir à un domaine vérifié dans Resend. Par défaut
//     "GET LOCATION <reservations@getlocation.fr>".
//   - AGENCY_EMAIL (optionnel) : adresse recevant la copie cachée de chaque
//     confirmation. Sans elle, aucune copie cachée n'est envoyée.
// Tant que RESEND_API_KEY n'est pas définie, l'email n'est pas envoyé
// (avertissement en log) mais la confirmation de paiement elle-même n'est
// pas affectée.

const { getVehiculeParId, formatEUR } = require("../../js/data.js");
const { sendEmail } = require("./resend-client.js");

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

async function sendConfirmationEmail(env, reservation) {
  if (!reservation || !reservation.conducteur || !reservation.conducteur.email) return;

  if (!env.RESEND_API_KEY) {
    console.warn("[send-confirmation-email] RESEND_API_KEY non configurée : email de confirmation non envoyé.");
    return;
  }

  const { subject, text, html } = buildConfirmationEmailContent(reservation);
  const from = env.RESEND_FROM || "GET LOCATION <reservations@getlocation.fr>";

  try {
    await sendEmail(env.RESEND_API_KEY, {
      from,
      to: [reservation.conducteur.email],
      bcc: env.AGENCY_EMAIL ? [env.AGENCY_EMAIL] : undefined,
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
