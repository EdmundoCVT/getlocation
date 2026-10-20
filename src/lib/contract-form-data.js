const {
  getOptionParId,
  getProtectionParDefaut,
  estProtectionConnue,
  getVehiculeParId,
  getCglVersion,
  KM_PACKAGE_OPTION_IDS
} = require("../../js/data.js");
const { normalizeContractMileage, agreedTotal } = require("./contract-mileage.js");

const TEXT_FIELDS = [
  "vehiculeId", "immat", "lieu", "lieuRetour", "depart", "retour",
  "modeCaution", "modePaiement", "montantRegle", "modePaiementSolde",
  "prenom", "nom", "naissance", "adresse", "codePostal", "ville", "tel", "email",
  "permis", "permisDate", "permisPays", "permisValidite",
  "prenom2", "nom2", "naissance2", "permis2", "permis2Date", "permis2Pays",
  "livraisonRue", "livraisonCP", "livraisonVille", "notes", "remarques",
  "montantFinalConvenu", "tarifMotif", "kmDepart", "kmRetour", "kmForfait",
  "protection", "langueClient", "ribIban", "ribTitulaire"
];
const BOOLEAN_FIELDS = [
  "acompteRegle", "soldeRegle", "secondConducteur", "livraison", "tarifManuel",
  "siegeEnfant", "rehausseur"
];

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function text(value, max = 1500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function localDateTime(value) {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(String(value || ""));
  return match ? `${match[1]}T${match[2]}` : "";
}

function dateTimeFromRecord(record, prefix) {
  const isStart = prefix === "debut";
  const canonical = localDateTime(record && (isStart ? record.depart : record.retour));
  if (canonical) return canonical;
  const date = record && record[isStart ? "dateDebut" : "dateFin"];
  const hour = record && record[isStart ? "heureDebut" : "heureFin"];
  if (date && hour) return localDateTime(`${date}T${hour}`);
  return localDateTime(record && record[isStart ? "periodeDebut" : "periodeFin"]);
}

function optionIds(record) {
  return (Array.isArray(record && record.options) ? record.options : [])
    .map((item) => typeof item === "string" ? item : item && item.id)
    .filter(Boolean);
}

function protectionId(record) {
  const value = record && (record.protectionId || record.protection);
  if (typeof value === "string" && estProtectionConnue(value)) return value;
  if (value && typeof value === "object" && typeof value.id === "string" && estProtectionConnue(value.id)) return value.id;
  return getProtectionParDefaut();
}

function recordToContractForm(record) {
  const dossier = record && record.contractDossier || {};
  const fields = dossier.fields || {};
  const driver = record && record.conducteur || {};
  const ids = optionIds(record);
  const vehicle = getVehiculeParId(record && record.vehiculeId);
  let mileage;
  try { mileage = normalizeContractMileage(record || {}, record && record.contractMileage); }
  catch (error) { mileage = null; }
  const contractualTotal = record && record.montantFinalConvenu !== undefined && record.montantFinalConvenu !== ""
    ? record.montantFinalConvenu
    : record && record.agreedRentalTotal !== undefined && record.agreedRentalTotal !== null
      ? record.agreedRentalTotal
      : record && record.total !== undefined ? record.total : "";
  const deposit = record && record.cautionContractuelle !== undefined
    ? record.cautionContractuelle
    : record && record.depotGarantie !== undefined
      ? record.depotGarantie
      : vehicle && vehicle.caution !== undefined ? vehicle.caution : "";
  const isManual = record && (record.status === "manual_contract" || record.contractSourceType === "manual");
  return {
    vehiculeId: text(record && record.vehiculeId),
    immat: text(record && (record.immat || record.immatriculation) || fields.immatriculation),
    lieu: text(record && (record.lieu || record.lieuPrise)),
    lieuRetour: text(record && (record.lieuRetour || record.lieu || record.lieuPrise)),
    depart: dateTimeFromRecord(record, "debut"),
    retour: dateTimeFromRecord(record, "fin"),
    modeCaution: text(record && record.modeCaution || fields.modeCaution) || "carte",
    modePaiement: text(record && record.modePaiement) || "carte",
    montantRegle: record && record.montantRegle !== undefined ? String(record.montantRegle) : record && record.paidAmount !== undefined ? String(record.paidAmount) : "",
    acompteRegle: record && record.acompteRegle === undefined ? !(record && record.paymentStatus === "pending") : !!record.acompteRegle,
    modePaiementSolde: text(record && record.modePaiementSolde) || "carte",
    soldeRegle: record && record.soldeRegle === undefined ? true : !!record.soldeRegle,
    prenom: text(record && record.prenom || driver.prenom),
    nom: text(record && record.nom || driver.nom),
    naissance: text(record && record.naissance || driver.naissance),
    adresse: text(record && record.adresse || fields.adresse),
    codePostal: text(record && record.codePostal || fields.codePostal),
    ville: text(record && record.ville || fields.ville),
    tel: text(record && record.tel || driver.telephone),
    email: text(record && record.email || driver.email),
    permis: text(record && record.permis || fields.permisNumero),
    permisDate: text(record && record.permisDate || fields.permisDate),
    permisPays: text(record && record.permisPays || fields.permisPays),
    permisValidite: text(record && record.permisValidite || fields.permisValidite),
    secondConducteur: !!(record && record.secondConducteur || fields.secondConducteur || ids.includes("second-conducteur")),
    prenom2: text(record && record.prenom2 || fields.secondConducteurPrenom),
    nom2: text(record && record.nom2 || fields.secondConducteurNom),
    naissance2: text(record && record.naissance2),
    permis2: text(record && record.permis2 || fields.secondConducteurPermisNumero),
    permis2Date: text(record && record.permis2Date || fields.secondConducteurPermisDate),
    permis2Pays: text(record && record.permis2Pays || fields.secondConducteurPermisPays),
    livraison: !!(record && record.livraison || fields.livraison || ids.includes("livraison-adresse")),
    livraisonRue: text(record && record.livraisonRue || fields.livraisonRue),
    livraisonCP: text(record && record.livraisonCP || fields.livraisonCP),
    livraisonVille: text(record && record.livraisonVille || fields.livraisonVille),
    notes: text(record && record.notes),
    remarques: text(record && record.remarques),
    tarifManuel: !!(record && record.tarifManuel) || (!isManual && contractualTotal !== ""),
    montantFinalConvenu: contractualTotal === "" ? "" : String(contractualTotal),
    tarifMotif: text(record && record.tarifMotif),
    contractMileage: mileage,
    kmDepart: record && record.kmDepart !== undefined ? String(record.kmDepart) : "",
    kmRetour: record && record.kmRetour !== undefined ? String(record.kmRetour) : "",
    kmForfait: text(record && record.kmForfait || ids.find((id) => KM_PACKAGE_OPTION_IDS.includes(id))),
    protection: protectionId(record),
    siegeEnfant: !!(record && record.siegeEnfant || ids.includes("siege-enfant")),
    rehausseur: !!(record && record.rehausseur || ids.includes("rehausseur")),
    langueClient: record && (record.contractLanguage === "en" || record.langueClient === "en" || record.langue === "en") ? "en" : "fr",
    cautionContractuelle: deposit,
    ribIban: text(record && record.ribIban),
    ribTitulaire: text(record && record.ribTitulaire),
    etatDepart: clone(record && record.etatDepart),
    etatRetour: clone(record && record.etatRetour)
  };
}

function normalizeContractFormData(rawData) {
  if (!rawData || typeof rawData !== "object" || Array.isArray(rawData)) throw new Error("Données du contrat invalides");
  const result = {};
  for (const key of TEXT_FIELDS) result[key] = text(rawData[key], key === "notes" || key === "remarques" ? 1500 : 300);
  for (const key of BOOLEAN_FIELDS) result[key] = !!rawData[key];
  const legacyOptionIds = (Array.isArray(rawData.options) ? rawData.options : [])
    .map((item) => typeof item === "string" ? item : item && item.id).filter(Boolean);
  if (legacyOptionIds.includes("second-conducteur")) result.secondConducteur = true;
  if (legacyOptionIds.includes("livraison-adresse")) result.livraison = true;
  if (legacyOptionIds.includes("siege-enfant")) result.siegeEnfant = true;
  if (legacyOptionIds.includes("rehausseur")) result.rehausseur = true;
  if (!result.kmForfait) result.kmForfait = legacyOptionIds.find((id) => KM_PACKAGE_OPTION_IDS.includes(id)) || "";
  if (!result.montantFinalConvenu && rawData.total !== undefined && rawData.total !== null && rawData.total !== "") {
    result.tarifManuel = true;
    result.montantFinalConvenu = String(rawData.total);
  }
  result.langueClient = rawData.langueClient === "en" ? "en" : "fr";
  result.modeCaution = ["carte", "especes", "virement"].includes(rawData.modeCaution) ? rawData.modeCaution : "carte";
  result.modePaiement = ["carte", "especes", "virement"].includes(rawData.modePaiement) ? rawData.modePaiement : "carte";
  result.modePaiementSolde = ["carte", "especes", "virement"].includes(rawData.modePaiementSolde) ? rawData.modePaiementSolde : "carte";
  const rawProtection = rawData.protection && typeof rawData.protection === "object" ? rawData.protection.id : rawData.protection;
  result.protection = estProtectionConnue(rawProtection) ? rawProtection : getProtectionParDefaut();
  result.contractMileage = rawData.contractMileage && typeof rawData.contractMileage === "object" ? clone(rawData.contractMileage) : { mode: "standard" };
  for (const key of ["etatDepart", "etatRetour"]) result[key] = rawData[key] && typeof rawData[key] === "object" ? clone(rawData[key]) : null;
  const deposit = Number(rawData.cautionContractuelle);
  result.cautionContractuelle = Number.isFinite(deposit) && deposit >= 0 ? deposit : null;
  return result;
}

function optionsFromForm(form) {
  const ids = [];
  if (form.secondConducteur) ids.push("second-conducteur");
  if (form.livraison) ids.push("livraison-adresse");
  if (form.siegeEnfant) ids.push("siege-enfant");
  if (form.rehausseur) ids.push("rehausseur");
  if (form.kmForfait) ids.push(form.kmForfait);
  return ids.map(getOptionParId).filter(Boolean).map(clone);
}

function mergeContractFormRecord(record, rawData, operator) {
  const form = normalizeContractFormData(rawData);
  if (!form.vehiculeId || !form.depart || !form.retour || !form.nom || !form.prenom) throw new Error("Champs requis manquants (véhicule, dates, nom, prénom)");
  const [dateDebut, heureDebut] = form.depart.split("T");
  const [dateFin, heureFin] = form.retour.split("T");
  const contractMileage = normalizeContractMileage(form, form.contractMileage);
  const total = agreedTotal(form);
  const language = form.langueClient === "en" ? "en" : "fr";
  const dossier = record && record.contractDossier || { status: "draft", fields: null };
  const previousFields = dossier.fields || {};
  const fields = {
    ...previousFields,
    immatriculation: form.immat,
    modeCaution: form.modeCaution,
    adresse: form.adresse,
    codePostal: form.codePostal,
    ville: form.ville,
    permisNumero: form.permis,
    permisDate: form.permisDate,
    permisPays: form.permisPays,
    permisValidite: form.permisValidite,
    livraison: form.livraison,
    livraisonRue: form.livraisonRue,
    livraisonCP: form.livraisonCP,
    livraisonVille: form.livraisonVille,
    secondConducteur: form.secondConducteur,
    secondConducteurNom: form.nom2,
    secondConducteurPrenom: form.prenom2,
    secondConducteurPermisNumero: form.permis2,
    secondConducteurPermisDate: form.permis2Date,
    secondConducteurPermisPays: form.permis2Pays
  };
  const now = new Date().toISOString();
  return {
    ...record,
    ...form,
    dateDebut,
    heureDebut,
    dateFin,
    heureFin,
    periodeDebut: `${form.depart}:00.000Z`,
    periodeFin: `${form.retour}:00.000Z`,
    lieuPrise: form.lieu,
    lieuRetour: form.lieuRetour || form.lieu,
    adressePrise: form.livraison ? [form.livraisonRue, form.livraisonCP, form.livraisonVille].filter(Boolean).join(", ") : form.lieu,
    adresseRetour: form.lieuRetour || form.lieu,
    conducteur: { ...(record && record.conducteur || {}), nom: form.nom, prenom: form.prenom, naissance: form.naissance, telephone: form.tel, email: form.email },
    immatriculation: form.immat,
    options: optionsFromForm(form),
    protection: form.protection,
    protectionId: form.protection,
    contractLanguage: language,
    contractMileage,
    agreedRentalTotal: total,
    total: total === null ? record && record.total : total,
    depotGarantie: form.cautionContractuelle,
    cautionContractuelle: form.cautionContractuelle,
    contractDossier: { ...dossier, fields, contractLanguage: language, cglVersion: getCglVersion(language), updatedAt: now },
    updatedAt: now,
    updatedBy: operator || record && record.updatedBy || null
  };
}

module.exports = { recordToContractForm, normalizeContractFormData, mergeContractFormRecord };
