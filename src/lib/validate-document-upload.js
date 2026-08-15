const MAX_FILE_SIZE = 8 * 1024 * 1024;
const MAX_TOTAL_SIZE = 50 * 1024 * 1024;
const { LIEU_LIVRAISON } = require("../../js/data.js");

const BASE_DOCUMENTS = ["permis-recto", "permis-verso", "identite"];
const SECOND_DRIVER_DOCUMENTS = ["second-permis-recto", "second-permis-verso", "second-identite"];

function detectedContentType(bytes) {
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) return "image/png";
  if (bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-") return "application/pdf";
  return null;
}

async function validateUploadedFile(file, fieldName) {
  if (!file || typeof file.arrayBuffer !== "function") throw new Error(`Fichier manquant : ${fieldName}`);
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_FILE_SIZE) {
    throw new Error(`Le fichier ${fieldName} doit faire moins de 8 Mo`);
  }
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const actualType = detectedContentType(bytes);
  if (!actualType || file.type !== actualType) {
    throw new Error(`Format invalide pour ${fieldName} (JPG, PNG ou PDF attendu)`);
  }
  return { fieldName, contentType: actualType, size: file.size, buffer };
}

function isDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(new Date(`${value}T00:00:00Z`).getTime());
}

function text(form, name, min, max) {
  const value = form.get(name);
  if (typeof value !== "string") throw new Error(`Champ manquant : ${name}`);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) throw new Error(`Champ invalide : ${name}`);
  return trimmed;
}

function permitDate(form, name) {
  const value = text(form, name, 10, 10);
  if (!isDate(value) || new Date(`${value}T00:00:00Z`).getTime() > Date.now()) throw new Error(`Date invalide : ${name}`);
  return value;
}

async function validateDocumentSubmission(form, reservation) {
  const birthDate = text(form, "birthDate", 10, 10);
  if (!reservation.conducteur || birthDate !== reservation.conducteur.naissance) {
    throw new Error("Date de naissance incorrecte");
  }

  const data = {
    postalAddress: text(form, "postalAddress", 5, 300),
    permitNumber: text(form, "permitNumber", 3, 50),
    permitDate: permitDate(form, "permitDate")
  };

  const hasOption = (id) => Array.isArray(reservation.options) && reservation.options.some((o) => o && o.id === id);
  const secondDriverRequired = hasOption("second-conducteur");
  const deliveryAddressRequired = hasOption("livraison-adresse") || reservation.lieuPrise === LIEU_LIVRAISON || reservation.lieuRetour === LIEU_LIVRAISON;
  if (deliveryAddressRequired) data.deliveryAddress = text(form, "deliveryAddress", 5, 300);
  if (secondDriverRequired) {
    data.secondDriver = {
      firstName: text(form, "secondDriverFirstName", 2, 100),
      lastName: text(form, "secondDriverLastName", 2, 100),
      permitNumber: text(form, "secondDriverPermitNumber", 3, 50),
      permitDate: permitDate(form, "secondDriverPermitDate")
    };
  }

  const expected = secondDriverRequired ? [...BASE_DOCUMENTS, ...SECOND_DRIVER_DOCUMENTS] : BASE_DOCUMENTS;
  const files = [];
  let totalSize = 0;
  for (const fieldName of expected) {
    const validated = await validateUploadedFile(form.get(fieldName), fieldName);
    totalSize += validated.size;
    if (totalSize > MAX_TOTAL_SIZE) throw new Error("La taille totale des documents dépasse 50 Mo");
    files.push(validated);
  }
  return { data, files };
}

module.exports = { validateUploadedFile, validateDocumentSubmission, detectedContentType, MAX_FILE_SIZE };
