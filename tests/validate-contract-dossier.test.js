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
