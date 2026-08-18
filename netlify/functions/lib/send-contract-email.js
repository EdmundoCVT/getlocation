// netlify/functions/lib/send-contract-email.js
//
// Envoi à l'agence (jamais au client) d'un email contenant un lien vers
// contrat.html pré-rempli avec les informations déjà connues de la
// réservation payée — voir l'appel dans mollie-webhook.js, juste après
// send-confirmation-email.js. L'agence peut ouvrir ce lien, compléter les
// champs non collectés pendant la réservation (numéro de permis, adresse
// postale, éventuel second conducteur), puis utiliser les boutons de
// partage déjà présents sur contrat.html (WhatsApp/SMS/e-mail) pour envoyer
// le contrat définitif au client et lui demander les documents
// complémentaires (permis de conduire, pièce d'identité).
//
// Best effort volontaire, comme send-confirmation-email.js : un échec
// d'envoi ne remet jamais en cause la confirmation du paiement.
//
// Réutilise GMAIL_USER/GMAIL_APP_PASSWORD (déjà configurées pour l'email de
// confirmation client) — aucune variable d'environnement supplémentaire.

const nodemailer = require("nodemailer");
const { getVehiculeParId, LIEU_LIVRAISON, parseAdressePersonnalisee, libelleAdresseLivraison } = require("../../../js/data.js");

function createTransport() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return null;
  return nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
}

// Même encodage que encodeData() côté navigateur (contrat.html) :
// base64url (RFC 4648 §5, pas le base64 standard — voir le commentaire de
// encodeData() dans contrat.html) des octets UTF-8 du JSON. decodeData()
// côté client applique l'opération inverse et retrouve exactement la même
// chaîne.
function encodeContractData(data) {
  return Buffer.from(JSON.stringify(data), "utf8").toString("base64url");
}

// Construit l'objet attendu par le formulaire AGENCE de contrat.html
// (voir regenererLien() dans ce fichier) à partir des seuls champs connus
// au moment de la réservation. Le numéro de permis et l'adresse postale du
// locataire, ainsi que les détails d'un éventuel second conducteur, ne sont
// jamais collectés pendant la réservation en ligne (demandés séparément par
// e-mail après paiement) : volontairement absents ici, contrat.html les
// affiche alors vides, à compléter par l'agence avant envoi au client.
function buildContractPrefillData(reservation) {
  const options = Array.isArray(reservation.options) ? reservation.options : [];
  const aOption = (id) => options.some((o) => o.id === id);
  const adressePersonnalisee = parseAdressePersonnalisee(reservation.adressePrise);

  return {
    vehiculeId: reservation.vehiculeId,
    lieu: libelleAdresseLivraison(reservation.adressePrise) || reservation.lieuPrise || LIEU_LIVRAISON,
    depart: reservation.dateDebut && reservation.heureDebut ? `${reservation.dateDebut}T${reservation.heureDebut}` : "",
    retour: reservation.dateFin && reservation.heureFin ? `${reservation.dateFin}T${reservation.heureFin}` : "",
    prenom: reservation.conducteur.prenom || "",
    nom: reservation.conducteur.nom || "",
    naissance: reservation.conducteur.naissance || "",
    tel: reservation.conducteur.telephone || "",
    email: reservation.conducteur.email || "",
    secondConducteur: aOption("second-conducteur"),
    livraison: aOption("livraison-adresse") || reservation.lieuPrise === LIEU_LIVRAISON,
    livraisonRue: adressePersonnalisee ? adressePersonnalisee.rue : "",
    livraisonCP: adressePersonnalisee ? adressePersonnalisee.codePostal : "",
    livraisonVille: adressePersonnalisee ? adressePersonnalisee.ville : (reservation.adressePrise || "")
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
    "Les champs déjà connus (véhicule, dates, coordonnées, date de naissance)",
    "sont pré-remplis. Complétez le numéro de permis, l'adresse postale et le",
    "reste avant d'envoyer le lien au client (boutons WhatsApp/SMS/e-mail en",
    "bas du formulaire) pour lui demander les documents complémentaires",
    "(permis de conduire, pièce d'identité).",
    "",
    `Référence de réservation : ${reservation.id}`
  ].join("\n");
  const html = `<p>Nouvelle réservation payée : <strong>${reservation.conducteur.prenom} ${reservation.conducteur.nom}</strong>, ${vehiculeNom}.</p>
<p><a href="${contratUrl}">Ouvrir le contrat pré-rempli</a></p>
<p>Les champs déjà connus (véhicule, dates, coordonnées, date de naissance) sont pré-remplis. Complétez le numéro de permis, l'adresse postale et le reste avant d'envoyer le lien au client (boutons WhatsApp/SMS/e-mail en bas du formulaire) pour lui demander les documents complémentaires (permis de conduire, pièce d'identité).</p>
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
