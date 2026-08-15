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

// Numéro WhatsApp de l'agence, déjà utilisé comme repli paiement
// indisponible (js/app.js, showPaymentUnavailableFallback) et sur
// paiement.html — même numéro réutilisé ici pour le bouton de contact
// post-paiement, avec la référence de réservation pré-remplie dans le
// message pour que l'agence identifie immédiatement le dossier.
const AGENCY_WHATSAPP_NUMBER = "33667485430";

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

// Échappement HTML défensif de toute valeur dérivée de la réservation
// injectée dans le corps HTML de l'email (ex. prénom du conducteur, saisi
// librement par le client — voir AUDIT.md P0-7). Les autres champs
// interpolés ici (lieuPrise/lieuRetour, véhicule) sont en réalité des
// valeurs d'énumération déjà validées côté serveur (validate-reservation-
// input.js), mais on les échappe quand même par prudence plutôt que de
// supposer qu'ils resteront toujours non manipulables par l'utilisateur.
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function aOptionSelectionnee(reservation, optionId) {
  const options = Array.isArray(reservation.options) ? reservation.options : [];
  return options.some((o) => o && o.id === optionId);
}

// Lien WhatsApp prérempli vers l'agence, avec la référence de réservation
// dans le message pour éviter au client de la retaper.
function buildWhatsappUrl(reservationId) {
  const message = `Bonjour, je vous contacte au sujet de ma réservation ${reservationId}.`;
  return `https://wa.me/${AGENCY_WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}

function buildDocumentsUrl(reservation, siteUrl) {
  if (!reservation || !reservation.documentsAccessToken) return null;
  const origin = String(siteUrl || "https://getlocation.fr").replace(/\/+$/, "");
  return `${origin}/documents.html#token=${encodeURIComponent(reservation.documentsAccessToken)}`;
}

// Checklist des documents à préparer avant la prise en charge. Ne prétend
// jamais qu'un document a déjà été reçu ou validé (aucun système de
// collecte de documents n'existe encore, cf. AUDIT.md/CLAUDE.md) — se
// limite à indiquer ce que le client doit préparer de son côté.
function buildChecklistLignes(reservation) {
  const lignes = [
    "Permis de conduire valide",
    "Pièce d'identité (carte d'identité ou passeport)",
    "Justificatif de domicile ou adresse postale, si demandé par l'agence"
  ];
  if (aOptionSelectionnee(reservation, "second-conducteur")) {
    lignes.push("Permis de conduire et pièce d'identité du second conducteur");
  }
  return lignes;
}

function buildConfirmationEmailContent(reservation, siteUrl) {
  const vehicule = getVehiculeParId(reservation.vehiculeId);
  const vehiculeNom = vehicule ? vehicule.nom : reservation.vehiculeId;
  const prise = formatDateHeure(reservation.dateDebut, reservation.heureDebut);
  const retour = formatDateHeure(reservation.dateFin, reservation.heureFin);
  const total = typeof reservation.total === "number" ? formatEUR(reservation.total) : "";
  const caution = vehicule ? formatEUR(vehicule.caution) : "";
  const prenom = reservation.conducteur ? reservation.conducteur.prenom : "";
  const checklistLignes = buildChecklistLignes(reservation);
  const whatsappUrl = buildWhatsappUrl(reservation.id);
  const documentsUrl = buildDocumentsUrl(reservation, siteUrl);

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
    `Caution du véhicule : ${caution} (prélevée avant la remise des clés)`,
    `Référence de réservation : ${reservation.id}`,
    "",
    "Documents à préparer pour la prise en charge du véhicule :",
    ...checklistLignes.map((l) => `- ${l}`),
    ...(documentsUrl ? ["", "Complétez votre dossier en ligne :", documentsUrl] : []),
    "",
    "Prochaines étapes : notre équipe reprend contact avec vous avant la prise en charge pour finaliser les derniers détails. Vous pouvez dès maintenant nous écrire sur WhatsApp en mentionnant votre référence de réservation :",
    whatsappUrl,
    "",
    "Pour toute question, répondez simplement à cet email.",
    "",
    "À bientôt,",
    "L'équipe GET LOCATION"
  ];
  const text = lignes.join("\n");

  const checklistHtml = checklistLignes.map((l) => `<li>${escapeHtml(l)}</li>`).join("");
  const documentsHtml = documentsUrl
    ? `<p><a href="${escapeHtml(documentsUrl)}" style="display:inline-block;padding:10px 18px;background:#f2760c;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:bold;">Compléter mon dossier</a></p>`
    : "";

  const html = `<p>Bonjour ${escapeHtml(prenom)},</p>
<p>Votre réservation est confirmée. Voici son récapitulatif :</p>
<ul>
<li><strong>Véhicule :</strong> ${escapeHtml(vehiculeNom)}</li>
<li><strong>Prise en charge :</strong> ${escapeHtml(prise)}${reservation.lieuPrise ? ` — ${escapeHtml(reservation.lieuPrise)}` : ""}</li>
<li><strong>Retour :</strong> ${escapeHtml(retour)}${reservation.lieuRetour ? ` — ${escapeHtml(reservation.lieuRetour)}` : ""}</li>
<li><strong>Durée :</strong> ${reservation.jours} jour(s)</li>
<li><strong>Montant total réglé :</strong> ${escapeHtml(total)}</li>
<li><strong>Caution du véhicule :</strong> ${escapeHtml(caution)} (prélevée avant la remise des clés)</li>
<li><strong>Référence de réservation :</strong> ${escapeHtml(reservation.id)}</li>
</ul>
<p><strong>Documents à préparer pour la prise en charge du véhicule :</strong></p>
<ul>${checklistHtml}</ul>
${documentsHtml}
<p>Notre équipe reprend contact avec vous avant la prise en charge pour finaliser les derniers détails. Vous pouvez dès maintenant nous écrire sur WhatsApp en mentionnant votre référence de réservation :</p>
<p><a href="${escapeHtml(whatsappUrl)}" style="display:inline-block;padding:10px 18px;background:#25D366;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:bold;">💬 Contacter l'agence sur WhatsApp</a></p>
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

  const { subject, text, html } = buildConfirmationEmailContent(reservation, env.SITE_URL);
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
