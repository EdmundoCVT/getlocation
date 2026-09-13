// src/lib/textes-email.js
//
// Traduction anglaise des e-mails envoyés AU CLIENT (confirmation, rappels
// dossier / prise en charge / restitution). La langue vient de la
// réservation elle-même (`langue: "fr" | "en"`, enregistrée par
// src/api/create-payment.js d'après la version du site où le client a
// réservé) : un client qui a réservé en anglais est écrit en anglais.
//
// Pourquoi un dictionnaire séparé de js/i18n.js : celui-là est chargé par
// le navigateur sur CHAQUE page du site. Les phrases d'e-mail n'y ont rien
// à faire — elles ne s'affichent jamais à l'écran et alourdiraient
// inutilement toutes les visites. Ce fichier-ci ne quitte jamais le
// serveur.
//
// Les e-mails destinés à l'AGENCE (contrat, dépôt de documents, récapitulatif
// quotidien) restent en français : ils ne sont lus que par l'équipe.
//
// Même principe d'indexation que js/i18n.js : la clé est le texte français
// lui-même. Une phrase française modifiée sans sa traduction retombe donc
// en français plutôt que d'afficher une clé technique — et
// tests/emails-en.test.js signale l'oubli.

const TRADUCTIONS = {
  // --- Formules communes
  "Bonjour,": "Hello,",
  "Bonjour {prenom},": "Hello {prenom},",
  "À bientôt,": "See you soon,",
  "L'équipe GET LOCATION": "The GET LOCATION team",
  "L'équipe GETLOCATION": "The GETLOCATION team",
  "Véhicule : {valeur}": "Vehicle: {valeur}",
  "Véhicule": "Vehicle",
  "Lieu : {valeur}": "Location: {valeur}",
  "Lieu": "Location",
  "Référence : {valeur}": "Reference: {valeur}",
  "Référence": "Reference",
  "Caution : {valeur} (prélevée avant la remise des clés)":
    "Deposit: {valeur} (taken before the keys are handed over)",
  "Caution": "Deposit",
  "(prélevée avant la remise des clés)": "(taken before the keys are handed over)",
  "Lieu à confirmer avec l'agence": "Location to be confirmed with the agency",
  "à confirmer": "to be confirmed",

  // --- E-mail de confirmation de réservation
  "Confirmation de votre réservation GET LOCATION — {vehicule}":
    "Your GET LOCATION booking is confirmed — {vehicule}",
  "Votre réservation est confirmée. Voici son récapitulatif :":
    "Your booking is confirmed. Here is a summary:",
  "Prise en charge : {valeur}": "Pick-up: {valeur}",
  "Prise en charge": "Pick-up",
  "Retour : {valeur}": "Drop-off: {valeur}",
  "Retour": "Drop-off",
  "Durée : {jours} jour(s)": "Duration: {jours} day(s)",
  "Durée": "Duration",
  "{jours} jour(s)": "{jours} day(s)",
  "Montant total réglé : {valeur}": "Total amount paid: {valeur}",
  "Montant total réglé": "Total amount paid",
  "Caution du véhicule : {valeur} (prélevée avant la remise des clés)":
    "Vehicle deposit: {valeur} (taken before the keys are handed over)",
  "Caution du véhicule": "Vehicle deposit",
  "Référence de réservation : {valeur}": "Booking reference: {valeur}",
  "Référence de réservation": "Booking reference",
  "Documents à préparer pour la prise en charge du véhicule :":
    "Documents to have ready when you collect the vehicle:",
  "Permis de conduire valide": "Valid driving licence",
  "Pièce d'identité (carte d'identité ou passeport)": "Proof of identity (ID card or passport)",
  "Justificatif de domicile ou adresse postale, si demandé par l'agence":
    "Proof of address, if the agency asks for it",
  "Permis de conduire et pièce d'identité du second conducteur":
    "Driving licence and proof of identity for the second driver",
  "Complétez votre dossier en ligne :": "Complete your file online:",
  "Compléter mon dossier": "Complete my file",
  "Prochaines étapes : notre équipe reprend contact avec vous avant la prise en charge pour finaliser les derniers détails. Vous pouvez dès maintenant nous écrire sur WhatsApp en mentionnant votre référence de réservation :":
    "What happens next: our team will get back to you before pick-up to settle the final details. You can already message us on WhatsApp, quoting your booking reference:",
  "Notre équipe reprend contact avec vous avant la prise en charge pour finaliser les derniers détails. Vous pouvez dès maintenant nous écrire sur WhatsApp en mentionnant votre référence de réservation :":
    "Our team will get back to you before pick-up to settle the final details. You can already message us on WhatsApp, quoting your booking reference:",
  "Pour toute question, répondez simplement à cet email.":
    "If you have any questions, simply reply to this email.",
  "💬 Contacter l'agence sur WhatsApp": "💬 Message the agency on WhatsApp",
  "Contacter l'agence sur WhatsApp": "Message the agency on WhatsApp",
  "Bonjour, je vous contacte au sujet de ma réservation {reference}.":
    "Hello, I am contacting you about my booking {reference}.",

  // --- Rappel « dossier incomplet »
  "Rappel — complétez votre dossier GETLOCATION": "Reminder — complete your GETLOCATION file",
  "Dernier rappel — dossier de location incomplet": "Final reminder — your rental file is incomplete",
  "Votre réservation {reference} ({vehicule}) est confirmée, mais votre dossier documentaire n'est pas encore complet.":
    "Your booking {reference} ({vehicule}) is confirmed, but your file is not complete yet.",
  "Ce lien sécurisé expire à la date indiquée lors de votre réservation. Si vous avez déjà envoyé vos documents, ignorez ce message.":
    "This secure link expires on the date given when you booked. If you have already sent your documents, please ignore this message.",
  "Si vous avez déjà envoyé vos documents, ignorez ce message.":
    "If you have already sent your documents, please ignore this message.",

  // --- Rappel prise en charge
  "Rappel prise en charge — {vehicule}": "Pick-up reminder — {vehicule}",
  "Votre location approche. Voici les informations à vérifier :":
    "Your rental is coming up. Here is what to check:",
  "Dossier documentaire : documents reçus par l'agence":
    "Document file: received by the agency",
  "Dossier documentaire : incomplet — contactez rapidement l'agence si nécessaire":
    "Document file: incomplete — please contact the agency as soon as possible",
  "Dossier documentaire": "Document file",
  "documents reçus par l'agence": "received by the agency",
  "incomplet — contactez rapidement l'agence si nécessaire":
    "incomplete — please contact the agency as soon as possible",
  "À apporter : permis de conduire valide et pièce d'identité.":
    "Please bring: a valid driving licence and proof of identity.",
  "À apporter": "Please bring",
  "permis de conduire valide et pièce d'identité.": "a valid driving licence and proof of identity.",
  "Bonjour, je vous contacte au sujet de la prise en charge de ma réservation {reference}.":
    "Hello, I am contacting you about collecting my booking {reference}.",

  // --- Rappel restitution
  "Rappel restitution — {vehicule}": "Return reminder — {vehicule}",
  "La restitution de votre véhicule approche :": "Your vehicle is due back soon:",
  "Restitution : {valeur}": "Return: {valeur}",
  "Restitution": "Return",
  "Avant la restitution :": "Before you return the vehicle:",
  "Avant la restitution": "Before you return the vehicle",
  "Vérifier que tous vos effets personnels ont été retirés":
    "Check that you have taken all your belongings",
  "Restituer le véhicule avec le niveau de carburant prévu au contrat":
    "Return the vehicle with the fuel level set out in the agreement",
  "Signaler à l'agence tout dommage ou incident survenu pendant la location":
    "Report any damage or incident that occurred during the rental to the agency",
  "Prévenir l'agence sur WhatsApp en cas de retard ou de changement : {lien}":
    "Let the agency know on WhatsApp if you are running late or something changes: {lien}",
  "Prévenir l'agence sur WhatsApp": "Let the agency know on WhatsApp",
  "Bonjour, je vous contacte au sujet de la restitution de ma réservation {reference}.":
    "Hello, I am contacting you about returning my booking {reference}."
};

function normaliserLangue(valeur) {
  return valeur === "en" ? "en" : "fr";
}

// Langue à utiliser pour écrire au client d'une réservation donnée.
function langueClient(reservation) {
  return normaliserLangue(reservation && reservation.langue);
}

function substituer(texte, variables) {
  if (!variables) return texte;
  return Object.keys(variables).reduce(
    (resultat, nom) => resultat.split(`{${nom}}`).join(String(variables[nom])),
    texte
  );
}

// Renvoie la fonction de traduction de la langue demandée. En français
// (et pour toute phrase sans traduction), le texte français est rendu tel
// quel : un oubli de dictionnaire ne casse jamais un envoi d'e-mail.
// Typographie des deux-points : le français les précède d'une espace
// insécable, l'anglais jamais (« Véhicule : X » contre « Vehicle: X »).
// Utilisé pour les libellés de liste, dont le texte et la valeur sont
// assemblés séparément (gras en HTML).
function deuxPoints(langue) {
  return normaliserLangue(langue) === "en" ? ": " : " : ";
}

function traducteur(langue) {
  const anglais = normaliserLangue(langue) === "en";
  // Les valeurs venues de js/data.js (lieu de livraison, noms d'options…)
  // sont déjà traduites pour le site : on réutilise ce dictionnaire-là
  // plutôt que d'en recopier les entrées ici (une seule à maintenir).
  const dictionnaireSite = require("../../js/i18n.js").TRADUCTIONS;
  return function t(texte, variables) {
    const source = String(texte);
    let traduction = source;
    if (anglais) {
      if (TRADUCTIONS[source] !== undefined) traduction = TRADUCTIONS[source];
      else if (dictionnaireSite[source] !== undefined) traduction = dictionnaireSite[source];
    }
    return substituer(traduction, variables);
  };
}

// Date longue dans la langue du client : « lundi 16 septembre 2026 à 10:00 »
// ou « Monday 16 September 2026 at 10:00 ».
function formatDateHeure(dateISO, heure, langue) {
  if (!dateISO) return "";
  const anglais = normaliserLangue(langue) === "en";
  const date = new Date(`${dateISO}T00:00:00`).toLocaleDateString(anglais ? "en-GB" : "fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  });
  if (!heure) return date;
  return anglais ? `${date} at ${heure}` : `${date} à ${heure}`;
}

// Adresse de la page client correspondante dans la langue de la réservation :
// les liens envoyés par e-mail doivent ouvrir la version que le client sait
// lire (voir src/lib/pages-en.js pour les adresses anglaises).
function lienPageClient(siteUrl, fichier, langue, fragment) {
  const origine = String(siteUrl || "https://getlocation.fr").replace(/\/+$/, "");
  const { SLUGS_EN } = require("../../js/i18n.js");
  const suffixe = fragment ? `#${fragment}` : "";
  if (normaliserLangue(langue) !== "en" || SLUGS_EN[fichier] === undefined) {
    return `${origine}/${fichier}${suffixe}`;
  }
  return `${origine}/en/${SLUGS_EN[fichier]}${suffixe}`;
}

module.exports = { TRADUCTIONS, traducteur, langueClient, formatDateHeure, lienPageClient, normaliserLangue, deuxPoints };
