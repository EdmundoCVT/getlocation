// tests/migrate-legacy-contracts-to-d1.test.js
//
// scripts/migrate-legacy-contracts-to-d1.js — transformation PURE (aucun
// accès réseau/KV/D1 réel, voir l'en-tête du script pour la procédure
// complète) : dédoublonnage des clients, ignore proprement les
// enregistrements invalides, jamais de modification de la source.

const test = require("node:test");
const assert = require("node:assert/strict");

const { buildMigrationPlan, planToSql } = require("../scripts/migrate-legacy-contracts-to-d1.js");

const contratValide = {
  id: "res_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  status: "manual_contract",
  contractNumero: "GL-20260901-0001",
  vehiculeId: "opel-corsa",
  immat: "AB-123-CD",
  depart: "2026-09-10T10:00",
  retour: "2026-09-12T10:00",
  nom: "Dupont",
  prenom: "Jean",
  tel: "06 01 02 03 04",
  email: "jean@example.com",
  createdAt: "2026-08-01T09:00:00.000Z",
  createdBy: "Edmundo"
};

test("buildMigrationPlan : crée un client et une location pour un contrat manuel valide", () => {
  const plan = buildMigrationPlan([contratValide]);
  assert.equal(plan.clients.length, 1);
  assert.equal(plan.rentals.length, 1);
  assert.equal(plan.skipped.length, 0);
  assert.equal(plan.clients[0].firstName, "Jean");
  assert.equal(plan.rentals[0].clientId, plan.clients[0].id);
  assert.equal(plan.rentals[0].contractNumero, "GL-20260901-0001");
  assert.equal(plan.rentals[0].status, "contrat_genere");
});

test("buildMigrationPlan : deux contrats du même client (même téléphone) ne créent qu'un seul client", () => {
  const second = { ...contratValide, id: "res_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", contractNumero: "GL-20260901-0002" };
  const plan = buildMigrationPlan([contratValide, second]);
  assert.equal(plan.clients.length, 1);
  assert.equal(plan.rentals.length, 2);
});

test("buildMigrationPlan : deux clients à téléphones différents restent distincts", () => {
  const autre = { ...contratValide, id: "res_cccccccccccccccccccccccccccccccc", tel: "0699999999", nom: "Martin", prenom: "Marie" };
  const plan = buildMigrationPlan([contratValide, autre]);
  assert.equal(plan.clients.length, 2);
});

test("buildMigrationPlan : ignore un enregistrement qui n'est pas un contrat manuel", () => {
  const plan = buildMigrationPlan([{ ...contratValide, status: "paid" }]);
  assert.equal(plan.clients.length, 0);
  assert.equal(plan.skipped.length, 1);
});

test("buildMigrationPlan : ignore un contrat manuel avec des champs minimaux manquants", () => {
  const plan = buildMigrationPlan([{ ...contratValide, nom: "" }]);
  assert.equal(plan.rentals.length, 0);
  assert.equal(plan.skipped.length, 1);
});

test("buildMigrationPlan : une location en brouillon (jamais de numéro) reste sans contractNumero", () => {
  const plan = buildMigrationPlan([{ ...contratValide, contractNumero: undefined }]);
  assert.equal(plan.rentals[0].contractNumero, null);
  assert.equal(plan.rentals[0].status, "brouillon");
});

test("planToSql : produit un script transactionnel, jamais d'exécution directe", () => {
  const plan = buildMigrationPlan([contratValide]);
  const sql = planToSql(plan);
  assert.match(sql, /^-- /);
  assert.match(sql, /BEGIN TRANSACTION;/);
  assert.match(sql, /COMMIT;/);
  assert.match(sql, /INSERT INTO clients/);
  assert.match(sql, /INSERT INTO rentals/);
});

test("planToSql : échappe correctement les apostrophes (injection SQL basique)", () => {
  const plan = buildMigrationPlan([{ ...contratValide, nom: "O'Brien" }]);
  const sql = planToSql(plan);
  assert.match(sql, /O''Brien/);
});
