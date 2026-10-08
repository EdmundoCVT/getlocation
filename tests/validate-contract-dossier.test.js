// tests/validate-contract-dossier.test.js
//
// src/lib/validate-contract-dossier.js — validation/normalisation serveur
// des champs du dossier contrat (agence) et de l'état des lieux
// départ/retour, mêmes conventions que
// tests/worker-validate-document-upload.test.js.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  validateContractFields,
  champsManquantsAvantEnvoi,
  validateConditionReport
} = require("../src/lib/validate-contract-dossier.js");

function champsValides(overrides = {}) {
  return {
    immatriculation: "AB-123-CD",
    modeCaution: "carte",
    adresse: "12 rue de la Paix",
    codePostal: "06130",
    ville: "Grasse",
    permisNumero: "123456789",
    ...overrides
  };
}

test("validateContractFields : accepte un dossier minimal valide", () => {
  const data = validateContractFields(champsValides());
  assert.equal(data.adresse, "12 rue de la Paix");
  assert.equal(data.secondConducteur, false);
  assert.equal(data.livraison, false);
});

test("validateContractFields : rejette une adresse manquante", () => {
  assert.throws(() => validateContractFields(champsValides({ adresse: "" })), /Champ manquant : adresse/);
});

test("validateContractFields : rejette un numéro de permis manquant", () => {
  assert.throws(() => validateContractFields(champsValides({ permisNumero: "" })), /Champ manquant/);
});

test("validateContractFields : exige les champs du second conducteur seulement si secondConducteur est vrai", () => {
  const sansSecond = validateContractFields(champsValides({ secondConducteur: false }));
  assert.equal(sansSecond.secondConducteurNom, "");

  assert.throws(
    () => validateContractFields(champsValides({ secondConducteur: true })),
    /Champ manquant : nom du second conducteur/
  );

  const avecSecond = validateContractFields(champsValides({
    secondConducteur: true,
    secondConducteurNom: "Dupont",
    secondConducteurPrenom: "Marie",
    secondConducteurPermisNumero: "987654321"
  }));
  assert.equal(avecSecond.secondConducteurNom, "Dupont");
});

test("validateContractFields : exige l'adresse de livraison seulement si livraison est vraie", () => {
  assert.throws(
    () => validateContractFields(champsValides({ livraison: true })),
    /Champ manquant : adresse de livraison/
  );
  const avecLivraison = validateContractFields(champsValides({
    livraison: true,
    livraisonRue: "5 avenue Foch",
    livraisonCP: "06400",
    livraisonVille: "Cannes"
  }));
  assert.equal(avecLivraison.livraisonVille, "Cannes");
});

test("champsManquantsAvantEnvoi : liste vide quand tout est renseigné", () => {
  const fields = validateContractFields(champsValides());
  assert.deepEqual(champsManquantsAvantEnvoi(fields), []);
});

test("champsManquantsAvantEnvoi : signale précisément l'adresse et le permis manquants", () => {
  assert.deepEqual(
    champsManquantsAvantEnvoi({ immatriculation: "AB-123-CD", adresse: "", codePostal: "", ville: "", permisNumero: "" }),
    ["adresse", "codePostal", "ville", "permisNumero"]
  );
});

test("champsManquantsAvantEnvoi : signale les champs du second conducteur si sélectionné", () => {
  const fields = { ...validateContractFields(champsValides()), secondConducteur: true, secondConducteurNom: "", secondConducteurPrenom: "", secondConducteurPermisNumero: "" };
  assert.deepEqual(champsManquantsAvantEnvoi(fields), ["secondConducteurNom", "secondConducteurPrenom", "secondConducteurPermisNumero"]);
});

test("champsManquantsAvantEnvoi : dossier absent renvoie la liste complète", () => {
  assert.deepEqual(champsManquantsAvantEnvoi(null), ["immatriculation", "adresse", "codePostal", "ville", "permisNumero"]);
});

function etatValide(overrides = {}) {
  return {
    dateHeure: "2026-08-20T10:00",
    km: 15000,
    carburant: 100,
    agent: "Jean Agent",
    ...overrides
  };
}

test("validateConditionReport : accepte un état des lieux minimal valide", () => {
  const data = validateConditionReport(etatValide());
  assert.equal(data.km, 15000);
  assert.equal(data.carburant, 100);
  assert.ok(data.completedAt);
});

test("validateConditionReport : rejette un kilométrage négatif ou non numérique", () => {
  assert.throws(() => validateConditionReport(etatValide({ km: -5 })), /Kilométrage invalide/);
  assert.throws(() => validateConditionReport(etatValide({ km: "beaucoup" })), /Kilométrage invalide/);
});

test("validateConditionReport : n'accepte que des niveaux de carburant multiples de 10 (0 à 100)", () => {
  assert.throws(() => validateConditionReport(etatValide({ carburant: 55 })), /Niveau de carburant invalide/);
  assert.throws(() => validateConditionReport(etatValide({ carburant: -10 })), /Niveau de carburant invalide/);
  assert.throws(() => validateConditionReport(etatValide({ carburant: 110 })), /Niveau de carburant invalide/);
  for (const niveau of [0, 10, 50, 90, 100]) {
    assert.equal(validateConditionReport(etatValide({ carburant: niveau })).carburant, niveau);
  }
});

test("validateConditionReport : exige le nom de l'agent mais pas les champs libres (dommages, photos, clés...)", () => {
  assert.throws(() => validateConditionReport(etatValide({ agent: "" })), /Champ manquant : nom de l'agent/);
  const data = validateConditionReport(etatValide());
  assert.equal(data.dommages, "");
  assert.equal(data.photosRef, "");
  assert.equal(data.clesAccessoires, "");
});

test("validateConditionReport : conserve les nouveaux relevés, croquis et signatures EDL séparées", () => {
  const signature = "data:image/png;base64,aGVsbG8=";
  const data = validateConditionReport(etatValide({
    cles: 2,
    proprete: "Ancienne valeur 4/5",
    propreteExterieure: 5,
    propreteInterieure: 4,
    propreteChargement: 3,
    marks: [{ id: "m1", view: "left", type: "rayure", x: 12.34, y: 55.55, description: "Porte avant gauche" }],
    signatures: { client: { name: "Client", imageDataUrl: signature }, agence: { name: "Agent", imageDataUrl: signature } }
  }));
  assert.equal(data.proprete, "Ancienne valeur 4/5");
  assert.equal(data.propreteExterieure, 5);
  assert.equal(data.propreteInterieure, 4);
  assert.equal(data.propreteChargement, 3);
  assert.equal(data.cles, 2);
  assert.deepEqual(data.marks, [{ id: "m1", view: "left", type: "rayure", x: 12.3, y: 55.6, description: "Porte avant gauche" }]);
  assert.equal(data.signatures.client.name, "Client");
  assert.equal(data.signatures.agence.imageDataUrl, signature);
  assert.ok(data.signatures.client.signedAt);
});

test("validateConditionReport : rejette les croquis, propretés et signatures mal formés", () => {
  assert.throws(() => validateConditionReport(etatValide({ propreteInterieure: 6 })), /Niveau de propreté invalide/);
  assert.throws(() => validateConditionReport(etatValide({ marks: [{ view: "unknown", type: "rayure", x: 0, y: 0 }] })), /Croquis de dommages invalide/);
  assert.throws(() => validateConditionReport(etatValide({ signatures: { client: { name: "X", imageDataUrl: "javascript:bad" } } })), /Image de signature invalide/);
});
