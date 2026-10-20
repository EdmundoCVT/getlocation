const test = require("node:test");
const assert = require("node:assert/strict");

const { recordToContractForm, mergeContractFormRecord } = require("../src/lib/contract-form-data.js");

function record() {
  return {
    id: "res_" + "a".repeat(32),
    status: "contract_version",
    contractNumero: "GL-20261020-0001",
    vehiculeId: "opel-corsa",
    immat: "AA-123-AA",
    lieu: "Agence de Grasse",
    lieuRetour: "Aéroport de Nice",
    depart: "2026-10-20T10:00",
    retour: "2026-10-22T18:00",
    prenom: "Jean", nom: "Dupont", naissance: "01/02/1990",
    adresse: "1 rue Test", codePostal: "06130", ville: "Grasse",
    tel: "0600000000", email: "jean@example.test",
    permis: "P123", permisDate: "01/02/2010", permisPays: "France", permisValidite: "01/02/2035",
    secondConducteur: true, prenom2: "Anne", nom2: "Dupont", naissance2: "02/03/1991", permis2: "P456", permis2Date: "03/04/2011", permis2Pays: "France",
    livraison: true, livraisonRue: "2 rue Livraison", livraisonCP: "06000", livraisonVille: "Nice",
    protection: "confort", siegeEnfant: true, rehausseur: false,
    tarifManuel: true, montantFinalConvenu: "450", tarifMotif: "Accord agence",
    modePaiement: "carte", montantRegle: "100", acompteRegle: true, modePaiementSolde: "virement", soldeRegle: false,
    modeCaution: "carte", cautionContractuelle: 1500,
    kmDepart: "1000", kmRetour: "1200", kmForfait: "km-200",
    contractMileage: { mode: "custom", kilometresInclusParJour: 150, supplementKmCentimes: 55, joursFactures: 3, kilometresInclusTotal: 450 },
    notes: "Interne", remarques: "Visible", contractLanguage: "en",
    etatDepart: { observations: "Départ", marks: [{ view: "avant", x: 10, y: 20, type: "rayure" }] },
    etatRetour: { observations: "Retour", marks: [] },
    paymentHistory: [{ id: "tr_1", amount: 100 }],
    contractDossier: { status: "draft", signature: { imageDataUrl: "data:image/png;base64,AAA", signedAt: "2026-10-20T09:00:00.000Z" }, fields: {} }
  };
}

test("recordToContractForm est une lecture pure et hydrate tous les groupes du formulaire canonique", () => {
  const source = record();
  const before = structuredClone(source);
  const form = recordToContractForm(source);
  assert.deepEqual(source, before, "ouvrir l'éditeur ne doit rien écrire");
  assert.equal(form.lieuRetour, "Aéroport de Nice");
  assert.equal(form.cautionContractuelle, 1500);
  assert.equal(form.secondConducteur, true);
  assert.equal(form.livraisonRue, "2 rue Livraison");
  assert.equal(form.contractMileage.kilometresInclusParJour, 150);
  assert.equal(form.langueClient, "en");
  assert.deepEqual(form.etatDepart, source.etatDepart);
});

test("mergeContractFormRecord met à jour la version courante sans perdre signature, paiement ni métadonnées", () => {
  const source = record();
  const form = recordToContractForm(source);
  form.nom = "Martin";
  form.lieuRetour = "Cannes";
  form.cautionContractuelle = 2000;
  const updated = mergeContractFormRecord(source, form, "Edmundo");
  assert.equal(updated.nom, "Martin");
  assert.equal(updated.lieuRetour, "Cannes");
  assert.equal(updated.cautionContractuelle, 2000);
  assert.deepEqual(updated.contractDossier.signature, source.contractDossier.signature);
  assert.deepEqual(updated.paymentHistory, source.paymentHistory);
  assert.equal(updated.id, source.id);
  assert.equal(updated.contractNumero, source.contractNumero);
  assert.equal(source.nom, "Dupont", "la source reste immuable");
});

test("recordToContractForm accepte un ancien contrat incomplet sans toLocaleString ni migration destructive", () => {
  const legacy = { id: "res_" + "b".repeat(32), status: "manual_contract", vehiculeId: "opel-corsa", depart: "2026-10-20T10:00", retour: "2026-10-21T10:00", prenom: "A", nom: "B" };
  const before = JSON.stringify(legacy);
  const form = recordToContractForm(legacy);
  assert.equal(form.langueClient, "fr");
  assert.ok(form.contractMileage);
  assert.equal(JSON.stringify(legacy), before);
});
