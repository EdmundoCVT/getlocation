// netlify/functions/lib/send-contract-email.js
//
// Envoi à l'agence (jamais au client) d'un email contenant un lien vers
// contrat.html pré-rempli avec les informations déjà connues de la
// réservation payée — voir l'appel dans mollie-webhook.js, juste après
// send-confirmation-email.js. L'agence peut ouvrir ce lien, compléter les
// champs non collectés pendant la réservation (date de naissance, adresse
// postale, éventuel second conducteur), puis utiliser les boutons de
// partage déjà présents sur contrat.html (WhatsApp/SMS/e-mail) pour envoyer
// le contrat définitif au client et lui demander les documents
// complémentaires.
//
// Best effort volontaire, comme send-confirmation-email.js : un échec
// d'envoi ne remet jamais en cause la confirmation du paiement.
//
// Réutilise GMAIL_USER/GMAIL_APP_PASSWORD (déjà configurées pour l'email de
// confirmation client) — aucune variable d'environnement supplémentaire.

const nodemailer = require("nodemailer");
const { getVehiculeParId } = require("../../../js/data.js");

function createTransport() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return null;
  return nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
}

// Même encodage que encodeData() côté navigateur (contrat.html) :
// base64 des octets UTF-8 du JSON. decodeData() côté client applique
// l'opération inverse et retrouve exactement la même chaîne.
function encodeContractData(data) {
  return Buffer.from(JSON.stringify(data), "utf8").toString("base64");
}

// Construit l'objet attendu par le formulaire AGENCE de contrat.html
// (voir regenererLien() dans ce fichier) à partir des seuls champs connus
// au moment de la réservation. Les champs jamais collectés pendant la
// réservation (naissance, adresse postale du locataire, détails d'un
// éventuel second conducteur) sont volontairement absents : contrat.html
// les affiche alors vides, à compléter par l'agence avant envoi au client.
function buildContractPrefillData(reservation) {
  const options = Array.isArray(reservation.options) ? reservation.options : [];
  const aOption = (id) => options.some((o) => o.id === id);

  return {
    vehiculeId: reservation.vehiculeId,
    lieu: "Agence Grasse",
    depart: reservation.dateDebut && reservation.heureDebut ? `${reservation.dateDebut}T${reservation.heureDebut}` : "",
    retour: reservation.dateFin && reservation.heureFin ? `${reservation.dateFin}T${reservation.heureFin}` : "",
    prenom: reservation.conducteur.prenom || "",
    nom: reservation.conducteur.nom || "",
    tel: reservation.conducteur.telephone || "",
    email: reservation.conducteur.email || "",
    permis: reservation.conducteur.permis || "",
    secondConducteur: aOption("second-conducteur"),
    livraison: aOption("livraison-adresse"),
    livraisonRue: reservation.adressePrise || reservation.adresseRetour || ""
  };
}

async function sendContractEmail(reservation) {
  if (!reservation || !reservation.conducteur) return;

  const transport = createTransport();
  if (!transport) {
    console.warn(
      "[send-contract-email] GMAIL_USER/GMAIL_APP_PASSWORD non configurés : email de contrat non envoyé."
    );
    return;
  }

  const vehicule = getVehiculeParId(reservation.vehiculeId);
  const vehiculeNom = vehicule ? vehicule.nom : reservation.vehiculeId;
  const origin = process.env.URL || "https://getlocation.fr";
  const prefillData = buildContractPrefillData(reservation);
  const contratUrl = `${origin}/contrat.html?prefill=${encodeURIComponent(encodeContractData(prefillData))}`;

  const subject = `Contrat à préparer — ${reservation.conducteur.prenom} ${reservation.conducteur.nom} (${vehiculeNom})`;
  const text = [
    `Nouvelle réservation payée : ${reservation.conducteur.prenom} ${reservation.conducteur.nom}, ${vehiculeNom}.`,
    "",
    `Contrat pré-rempli à compléter et envoyer au client : ${contratUrl}`,
    "",
    "Les champs déjà connus (véhicule, dates, coordonnées) sont pré-remplis.",
    "Complétez la date de naissance, l'adresse postale et le reste avant d'envoyer",
    "le lien au client (boutons WhatsApp/SMS/e-mail en bas du formulaire) pour",
    "lui demander les documents complémentaires.",
    "",
    `Référence de réservation : ${reservation.id}`
  ].join("\n");
  const html = `<p>Nouvelle réservation payée : <strong>${reservation.conducteur.prenom} ${reservation.conducteur.nom}</strong>, ${vehiculeNom}.</p>
<p><a href="${contratUrl}">Ouvrir le contrat pré-rempli</a></p>
<p>Les champs déjà connus (véhicule, dates, coordonnées) sont pré-remplis. Complétez la date de naissance, l'adresse postale et le reste avant d'envoyer le lien au client (boutons WhatsApp/SMS/e-mail en bas du formulaire) pour lui demander les documents complémentaires.</p>
<p>Référence de réservation : ${reservation.id}</p>`;

  try {
    await transport.sendMail({
      from: `"GET LOCATION" <${process.env.GMAIL_USER}>`,
      to: process.env.GMAIL_USER,
      subject,
      text,
      html
    });
  } catch (err) {
    console.error(
      `[send-contract-email] Échec de l'envoi pour la réservation ${reservation.id} :`,
      err && err.message
    );
  }
}

module.exports = { sendContractEmail, buildContractPrefillData, encodeContractData };
