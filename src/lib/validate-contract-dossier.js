// src/lib/validate-contract-dossier.js
//
// Validation/normalisation serveur des champs du dossier contrat (agence),
// mêmes conventions que src/lib/validate-document-upload.js : on lève une
// Error au premier champ invalide, message utilisateur en français. Utilisé
// uniquement par src/api/contract-dossier-agency.js — jamais confiance à un
// champ du navigateur au-delà de ce que ces fonctions valident.

function text(value, name, { min = 1, max = 300, required = true } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) throw new Error(`Champ manquant : ${name}`);
    return "";
  }
  if (typeof value !== "string") throw new Error(`Champ invalide : ${name}`);
  const trimmed = value.trim();
  if (required && trimmed.length < min) throw new Error(`Champ invalide : ${name}`);
  if (trimmed.length > max) throw new Error(`Champ invalide : ${name}`);
  return trimmed;
}

function isDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(new Date(`${value}T00:00:00Z`).getTime());
}

function optionalDate(value, name) {
  if (!value) return "";
  if (!isDate(value)) throw new Error(`Date invalide : ${name}`);
  return value;
}

// Champs du contrat non déjà connus de la réservation (véhicule/dates/
// lieu/coordonnées restent lus depuis la réservation elle-même, jamais
// réécrits ici — voir contract-dossier-agency.js).
function validateContractFields(body) {
  const secondConducteur = Boolean(body.secondConducteur);
  const livraison = Boolean(body.livraison);
  const data = {
    immatriculation: text(body.immatriculation, "immatriculation", { max: 20 }),
    modeCaution: body.modeCaution === "especes" ? "especes" : "carte",
    adresse: text(body.adresse, "adresse", { max: 300 }),
    codePostal: text(body.codePostal, "code postal", { min: 4, max: 10 }),
    ville: text(body.ville, "ville", { max: 100 }),
    permisNumero: text(body.permisNumero, "numéro de permis", { min: 3, max: 50 }),
    permisDate: optionalDate(body.permisDate, "date d'obtention du permis"),
    permisPays: text(body.permisPays, "pays de délivrance du permis", { required: false, max: 100 }),
    permisValidite: optionalDate(body.permisValidite, "date de validité du permis"),
    livraison,
    livraisonRue: "",
    livraisonCP: "",
    livraisonVille: "",
    secondConducteur,
    secondConducteurNom: "",
    secondConducteurPrenom: "",
    secondConducteurNaissance: "",
    secondConducteurPermisNumero: "",
    secondConducteurPermisPays: "",
    secondConducteurPermisDate: ""
  };
  if (livraison) {
    data.livraisonRue = text(body.livraisonRue, "adresse de livraison", { max: 300 });
    data.livraisonCP = text(body.livraisonCP, "code postal de livraison", { min: 4, max: 10 });
    data.livraisonVille = text(body.livraisonVille, "ville de livraison", { max: 100 });
  }
  if (secondConducteur) {
    data.secondConducteurNom = text(body.secondConducteurNom, "nom du second conducteur", { max: 100 });
    data.secondConducteurPrenom = text(body.secondConducteurPrenom, "prénom du second conducteur", { max: 100 });
    data.secondConducteurNaissance = optionalDate(body.secondConducteurNaissance, "date de naissance du second conducteur");
    data.secondConducteurPermisNumero = text(body.secondConducteurPermisNumero, "numéro de permis du second conducteur", { min: 3, max: 50 });
    data.secondConducteurPermisPays = text(body.secondConducteurPermisPays, "pays de délivrance du permis du second conducteur", { required: false, max: 100 });
    data.secondConducteurPermisDate = optionalDate(body.secondConducteurPermisDate, "date d'obtention du permis du second conducteur");
  }
  return data;
}

// Liste les champs obligatoires manquants avant d'autoriser l'envoi du lien
// de signature au client (adresse complète, numéro de permis, informations
// du second conducteur si sélectionné — voir mission). Liste vide = prêt.
function champsManquantsAvantEnvoi(fields) {
  const manquants = [];
  if (!fields) return ["immatriculation", "adresse", "codePostal", "ville", "permisNumero"];
  if (!fields.immatriculation) manquants.push("immatriculation");
  if (!fields.adresse) manquants.push("adresse");
  if (!fields.codePostal) manquants.push("codePostal");
  if (!fields.ville) manquants.push("ville");
  if (!fields.permisNumero) manquants.push("permisNumero");
  if (fields.livraison) {
    if (!fields.livraisonRue) manquants.push("livraisonRue");
    if (!fields.livraisonCP) manquants.push("livraisonCP");
    if (!fields.livraisonVille) manquants.push("livraisonVille");
  }
  if (fields.secondConducteur) {
    if (!fields.secondConducteurNom) manquants.push("secondConducteurNom");
    if (!fields.secondConducteurPrenom) manquants.push("secondConducteurPrenom");
    if (!fields.secondConducteurPermisNumero) manquants.push("secondConducteurPermisNumero");
  }
  return manquants;
}

const NIVEAUX_CARBURANT_VALIDES = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
const TYPES_DOMMAGE_VALIDES = new Set(["rayure", "bosse", "eclat"]);
const VUES_DOMMAGE_VALIDES = new Set(["left", "front", "right", "rear", "top"]);

function scoreProprete(value, label) {
  if (value === undefined || value === null || value === "") return null;
  const score = Number(value);
  if (!Number.isInteger(score) || score < 1 || score > 5) throw new Error(`Niveau de propreté invalide : ${label}`);
  return score;
}

function validateMarks(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 200) throw new Error("Croquis de dommages invalide");
  return value.map((mark, index) => {
    if (!mark || typeof mark !== "object") throw new Error("Croquis de dommages invalide");
    const x = Number(mark.x), y = Number(mark.y);
    if (!VUES_DOMMAGE_VALIDES.has(mark.view) || !TYPES_DOMMAGE_VALIDES.has(mark.type) || !Number.isFinite(x) || !Number.isFinite(y)) throw new Error("Croquis de dommages invalide");
    return {
      id: typeof mark.id === "string" && mark.id.length <= 80 ? mark.id : `m${index + 1}`,
      view: mark.view,
      type: mark.type,
      x: Math.max(0, Math.min(100, Math.round(x * 10) / 10)),
      y: Math.max(0, Math.min(100, Math.round(y * 10) / 10))
    };
  });
}

function signature(value, label) {
  if (value === undefined || value === null || value === "") return null;
  if (!value || typeof value !== "object") throw new Error(`Signature invalide : ${label}`);
  const name = text(value.name, `nom de signature ${label}`, { required: false, max: 100 });
  const imageDataUrl = text(value.imageDataUrl, `image de signature ${label}`, { required: false, max: 70000 });
  if (imageDataUrl && !/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(imageDataUrl)) throw new Error(`Image de signature invalide : ${label}`);
  if (!name && !imageDataUrl) return null;
  return { name, imageDataUrl, signedAt: new Date().toISOString() };
}

// État des lieux départ/retour — mêmes champs pour les deux (voir mission).
function validateConditionReport(body) {
  const km = Number(body.km);
  if (!Number.isFinite(km) || km < 0) throw new Error("Kilométrage invalide");
  const carburant = Number(body.carburant);
  if (!NIVEAUX_CARBURANT_VALIDES.includes(carburant)) throw new Error("Niveau de carburant invalide (doit être un multiple de 10, de 0 à 100)");
  return {
    dateHeure: text(body.dateHeure, "date et heure", { max: 40 }),
    km,
    carburant,
    proprete: text(body.proprete, "état de propreté", { required: false, max: 200 }),
    // Nouveaux relevés distincts : l'ancien champ `proprete` est conservé
    // tel quel pour les dossiers antérieurs et la compatibilité PDF.
    propreteExterieure: scoreProprete(body.propreteExterieure, "extérieur"),
    propreteInterieure: scoreProprete(body.propreteInterieure, "intérieur"),
    propreteChargement: scoreProprete(body.propreteChargement, "espace de chargement"),
    dommages: text(body.dommages, "dommages / observations", { required: false, max: 2000 }),
    marks: validateMarks(body.marks),
    photosRef: text(body.photosRef, "référence des photos", { required: false, max: 200 }),
    cles: body.cles === undefined || body.cles === null || body.cles === "" ? null : (() => {
      const count = Number(body.cles);
      if (!Number.isInteger(count) || count < 0 || count > 20) throw new Error("Nombre de clés invalide");
      return count;
    })(),
    clesAccessoires: text(body.clesAccessoires, "clés et accessoires", { required: false, max: 300 }),
    agent: text(body.agent, "nom de l'agent", { max: 100 }),
    clientSigne: text(body.clientSigne, "signature client", { required: false, max: 100 }),
    agenceSigne: text(body.agenceSigne, "signature agence", { required: false, max: 100 }),
    signatures: {
      client: signature(body.signatures && body.signatures.client, "client"),
      agence: signature(body.signatures && body.signatures.agence, "agence")
    },
    completedAt: new Date().toISOString()
  };
}

module.exports = {
  validateContractFields,
  champsManquantsAvantEnvoi,
  validateConditionReport,
  NIVEAUX_CARBURANT_VALIDES,
  TYPES_DOMMAGE_VALIDES,
  VUES_DOMMAGE_VALIDES,
  isDate
};
