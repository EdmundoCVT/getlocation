// netlify/functions/lib/validate-reservation-input.js
//
// Validation stricte des paramètres MÉTIER envoyés par le client pour
// initier un paiement. Ne valide QUE la forme des données (véhicule connu,
// dates/heures bien formées et futures, longueurs de chaînes bornées) —
// ne calcule et ne fait jamais confiance à un prix fourni par le client.

const { getVehiculeParId, LIEUX, LIEU_LIVRAISON, VILLES_LIVRAISON, CGL_VERSION } = require("../../../js/data.js");

const MAX_LEN = {
  nom: 100,
  prenom: 100,
  email: 254,
  telephone: 30,
  permis: 50
};

function isNonEmptyString(v, max, min = 1) {
  return typeof v === "string" && v.trim().length >= min && v.length <= max;
}

function isValidDate(v) {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(new Date(`${v}T00:00:00`).getTime());
}

function isValidHeure(v) {
  return typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}

function isValidEmail(v) {
  return typeof v === "string" && v.length <= MAX_LEN.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

// Tolérance pour compenser une légère dérive d'horloge côté client / le
// temps de trajet réseau entre l'affichage du formulaire et l'envoi.
const PAST_DATE_TOLERANCE_MS = 5 * 60 * 1000;

function validateReservationInput(payload) {
  const errors = [];
  if (!payload || typeof payload !== "object") {
    return { valid: false, errors: ["Requête invalide"], vehicule: null };
  }

  const {
    vehiculeId,
    dateDebut,
    heureDebut,
    dateFin,
    heureFin,
    lieuPrise,
    lieuRetour,
    adressePrise,
    adresseRetour,
    assurance,
    conducteur,
    idempotencyKey,
    cglAccepted,
    cglVersion
  } = payload;

  const vehicule = typeof vehiculeId === "string" ? getVehiculeParId(vehiculeId) : null;
  if (!vehicule) errors.push("Véhicule inconnu");

  if (!isValidDate(dateDebut)) errors.push("Date de début invalide");
  if (!isValidDate(dateFin)) errors.push("Date de fin invalide");
  if (!isValidHeure(heureDebut)) errors.push("Heure de début invalide");
  if (!isValidHeure(heureFin)) errors.push("Heure de fin invalide");

  if (isValidDate(dateDebut) && isValidHeure(heureDebut)) {
    const debut = new Date(`${dateDebut}T${heureDebut}:00`);
    if (debut.getTime() < Date.now() - PAST_DATE_TOLERANCE_MS) {
      errors.push("La date de début ne peut pas être dans le passé");
    }
  }
  if (isValidDate(dateDebut) && isValidHeure(heureDebut) && isValidDate(dateFin) && isValidHeure(heureFin)) {
    const debut = new Date(`${dateDebut}T${heureDebut}:00`);
    const fin = new Date(`${dateFin}T${heureFin}:00`);
    if (fin.getTime() <= debut.getTime()) errors.push("La date de fin doit être postérieure à la date de début");
  }

  if (lieuPrise !== undefined && lieuPrise !== null && !LIEUX.includes(lieuPrise)) {
    errors.push("Lieu de prise en charge invalide");
  }
  if (lieuRetour !== undefined && lieuRetour !== null && !LIEUX.includes(lieuRetour)) {
    errors.push("Lieu de restitution invalide");
  }
  // Depuis le passage à un choix de ville (plutôt qu'une adresse libre), la
  // valeur envoyée doit être exactement une des villes autorisées — jamais
  // une saisie arbitraire. La contrainte n'est appliquée que si le lieu
  // correspondant est bien "Livraison" (sinon adressePrise/adresseRetour
  // doivent être vides).
  if (adressePrise !== undefined && adressePrise !== null && adressePrise !== "") {
    if (lieuPrise !== LIEU_LIVRAISON || !VILLES_LIVRAISON.includes(adressePrise)) {
      errors.push("Ville de livraison (prise en charge) invalide");
    }
  }
  if (adresseRetour !== undefined && adresseRetour !== null && adresseRetour !== "") {
    if (lieuRetour !== LIEU_LIVRAISON || !VILLES_LIVRAISON.includes(adresseRetour)) {
      errors.push("Ville de livraison (restitution) invalide");
    }
  }

  if (typeof assurance !== "boolean") errors.push("Champ assurance invalide");

  if (!conducteur || typeof conducteur !== "object") {
    errors.push("Informations conducteur manquantes");
  } else {
    if (!isNonEmptyString(conducteur.nom, MAX_LEN.nom, 2)) errors.push("Nom invalide");
    if (!isNonEmptyString(conducteur.prenom, MAX_LEN.prenom, 2)) errors.push("Prénom invalide");
    if (!isValidEmail(conducteur.email)) errors.push("E-mail invalide");
    const telephoneDigits = typeof conducteur.telephone === "string" ? conducteur.telephone.replace(/\D/g, "") : "";
    if (!isNonEmptyString(conducteur.telephone, MAX_LEN.telephone) || telephoneDigits.length < 8) {
      errors.push("Téléphone invalide");
    }
    if (!isNonEmptyString(conducteur.permis, MAX_LEN.permis, 4)) errors.push("Numéro de permis invalide");
    const age = Number(conducteur.age);
    if (!Number.isFinite(age) || age < 21 || age > 99) errors.push("Âge du conducteur invalide (21 à 99 ans)");
  }

  if (idempotencyKey !== undefined && !(typeof idempotencyKey === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(idempotencyKey))) {
    errors.push("Clé d'idempotence invalide");
  }

  // Case CGL/confidentialité obligatoire avant paiement (P0-8) : on exige
  // explicitement `true` (pas une simple valeur "truthy") et on revalide la
  // version acceptée contre la version actuellement en vigueur côté
  // serveur, pour ne jamais enregistrer une acceptation sur un texte
  // obsolète (ex. page mise en cache par le navigateur après une mise à
  // jour des CGL).
  if (cglAccepted !== true) {
    errors.push("Vous devez accepter les conditions générales de location et la politique de confidentialité");
  }
  if (cglAccepted === true && cglVersion !== CGL_VERSION) {
    errors.push("La version des conditions générales a été mise à jour, veuillez recharger la page et réessayer");
  }

  return { valid: errors.length === 0, errors, vehicule };
}

module.exports = { validateReservationInput };
