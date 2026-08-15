// src/lib/send-contract-email.js
//
// Envoi à l'agence (jamais au client) d'un email contenant un lien vers
// contrat.html pré-rempli avec les informations déjà connues de la
// réservation payée — voir l'appel dans src/api/mollie-webhook.js, juste
// après send-confirmation-email.js. L'agence peut ouvrir ce lien, compléter
// les champs non collectés pendant la réservation (numéro de permis,
// adresse postale, éventuel second conducteur), puis utiliser les boutons
// de partage déjà présents sur contrat.html (WhatsApp/SMS/e-mail) pour
// envoyer le contrat définitif au client.
//
// Best effort volontaire, comme send-confirmation-email.js : un échec
// d'envoi ne remet jamais en cause la confirmation du paiement.
//
// Configuration requise (secrets Cloudflare Worker, voir DEPLOIEMENT.md) :
//   - RESEND_API_KEY (déjà utilisée par send-confirmation-email.js)
//   - AGENCY_EMAIL : adresse de l'agence recevant cet email (obligatoire
//     pour que cet email parte — sans elle, non envoyé, avertissement en log)
//   - RESEND_FROM (optionnel), voir send-confirmation-email.js

const { getVehiculeParId } = require("../../js/data.js");
const { sendEmail } = require("./resend-client.js");

// Même encodage que encodeData() côté navigateur (contrat.html) : base64
// des octets UTF-8 du JSON. decodeData() côté client applique l'opération
// inverse et retrouve exactement la même chaîne. btoa() (Web API, dispo à
// la fois sous Cloudflare Workers et sous Node) remplace ici
// Buffer.from(...).toString("base64") — même résultat pour du texte UTF-8.
function encodeContractData(data) {
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
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

  return {
    vehiculeId: reservation.vehiculeId,
    lieu: "Agence Grasse",
    depart: reservation.dateDebut && reservation.heureDebut ? `${reservation.dateDebut}T${reservation.heureDebut}` : "",
    retour: reservation.dateFin && reservation.heureFin ? `${reservation.dateFin}T${reservation.heureFin}` : "",
    prenom: reservation.conducteur.prenom || "",
    nom: reservation.conducteur.nom || "",
    naissance: reservation.conducteur.naissance || "",
    tel: reservation.conducteur.telephone || "",
    email: reservation.conducteur.email || "",
    secondConducteur: aOption("second-conducteur"),
    livraison: aOption("livraison-adresse"),
    livraisonRue: reservation.adressePrise || reservation.adresseRetour || ""
  };
}

async function sendContractEmail(env, reservation) {
  if (!reservation || !reservation.conducteur) return false;

  if (!env.RESEND_API_KEY) {
    console.warn("[send-contract-email] RESEND_API_KEY non configurée : email de contrat non envoyé.");
    return false;
  }
  if (!env.AGENCY_EMAIL) {
    console.warn("[send-contract-email] AGENCY_EMAIL non configurée : email de contrat non envoyé.");
    return false;
  }

  const vehicule = getVehiculeParId(reservation.vehiculeId);
  const vehiculeNom = vehicule ? vehicule.nom : reservation.vehiculeId;
  const origin = env.SITE_URL || "https://getlocation.fr";
  // Lien sécurisé (jeton agence, dossier associé à la réservation — voir
  // contract-dossier-token.js) quand disponible ; repli sur l'ancien lien
  // ?prefill= en base64 (jamais associé à la réservation, non sécurisé)
  // uniquement si DOCUMENT_TOKEN_PEPPER n'est pas configuré — voir
  // mollie-webhook.js. Les anciens liens ?prefill= déjà envoyés avant ce
  // changement continuent de fonctionner (contrat.html les gère toujours).
  //
  // Jeton en FRAGMENT d'URL (#agencyToken=, jamais ?agencyToken=) : comme
  // pour le lien documentaire (voir send-confirmation-email.js), un
  // fragment n'est jamais transmis au serveur par le navigateur — contraire
  // à un paramètre de requête, qui apparaîtrait dans les journaux d'accès.
  const prefillData = buildContractPrefillData(reservation);
  const contratUrl = reservation.contractDossierToken
    ? `${origin}/contrat.html#agencyToken=${encodeURIComponent(reservation.contractDossierToken)}`
    : `${origin}/contrat.html?prefill=${encodeURIComponent(encodeContractData(prefillData))}`;

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

  const from = env.RESEND_FROM || "GET LOCATION <reservations@getlocation.fr>";

  try {
    await sendEmail(env.RESEND_API_KEY, {
      from,
      to: [env.AGENCY_EMAIL],
      subject,
      text,
      html
    });
    return true;
  } catch (err) {
    console.error(
      `[send-contract-email] Échec de l'envoi pour la réservation ${reservation.id} :`,
      err && err.message
    );
    return false;
  }
}

module.exports = { sendContractEmail, buildContractPrefillData, encodeContractData };
