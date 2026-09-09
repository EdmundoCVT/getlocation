// tests/sheet-sync.test.js
//
// src/lib/sheet-sync.js — lecture dynamique des en-têtes (refus propre si
// structure changée), mapping des colonnes, clé d'idempotence ("N° résa",
// pas "Num contrat"), protection des formules/validations, écriture
// idempotente (création puis mise à jour ne doit jamais dupliquer la
// ligne).

const test = require("node:test");
const assert = require("node:assert/strict");

const { createFakeD1 } = require("./helpers/fake-d1.js");
const { makeServiceAccountFixture } = require("./helpers/google-service-account-fixture.js");
const { createFakeGoogleSheets, withFakeGoogleSheets } = require("./helpers/google-sheets-fake.js");
const { createClient } = require("../src/lib/clients.js");
const { createRental, generateRentalContract } = require("../src/lib/rentals.js");
const { addPayment } = require("../src/lib/payments.js");
const { EXPECTED_HEADERS, shortRef, buildRowValues, computeWritableRuns, verifyHeaders, syncRentalToSheet, SheetStructureError } = require("../src/lib/sheet-sync.js");

function makeEnv() {
  const { keyJson } = makeServiceAccountFixture();
  return {
    AGENCY_DB: createFakeD1(),
    GOOGLE_SERVICE_ACCOUNT_KEY: keyJson,
    GOOGLE_SHEETS_SPREADSHEET_ID: "test-spreadsheet-id"
  };
}

async function creerLocation(env, overrides = {}) {
  const client = await createClient(env, { firstName: "Jean", lastName: "Dupont", phone: "0601020304" }, "Edmundo");
  return createRental(env, client.id, {
    vehiculeId: "opel-corsa",
    dateDebut: "2026-09-10", heureDebut: "10:00",
    dateFin: "2026-09-12", heureFin: "10:00",
    priceTotal: 240,
    ...overrides
  }, "Edmundo");
}

test("shortRef : dérive une référence GL-<8 derniers hex majuscules>, comme la référence client en ligne", () => {
  const ref = shortRef("rnt_0123456789abcdef0123456789abcdef");
  assert.match(ref, /^GL-[0-9A-F]{8}$/);
  assert.equal(ref, "GL-" + "89ABCDEF".toUpperCase());
});

test("verifyHeaders : refuse proprement si une colonne attendue a changé", async () => {
  const env = makeEnv();
  const headers = EXPECTED_HEADERS.slice();
  headers[3] = "Nom (modifié)";
  const fake = createFakeGoogleSheets({ headers });
  await assert.rejects(withFakeGoogleSheets(fake, () => verifyHeaders(env)), SheetStructureError);
});

test("verifyHeaders : passe si les en-têtes correspondent exactement, y compris la colonne sans en-tête", async () => {
  const env = makeEnv();
  const fake = createFakeGoogleSheets({ headers: EXPECTED_HEADERS });
  await assert.doesNotReject(withFakeGoogleSheets(fake, () => verifyHeaders(env)));
});

test("buildRowValues : mappe les champs vers les 24 colonnes attendues", () => {
  const values = buildRowValues({
    rental: { id: "rnt_" + "a".repeat(32), contractNumero: "GL-20260910-0001", dateDebut: "2026-09-10", heureDebut: "10:00", dateFin: "2026-09-12", heureFin: "10:00", priceTotalCents: 24000, notes: "RAS", vehiculeId: "opel-corsa" },
    client: { firstName: "Jean", lastName: "Dupont", phone: "0601020304", email: "jean.dupont@example.com" },
    vehicule: { nom: "Opel Corsa", prixJour: 59 },
    paymentsSummary: { totalPaidCents: 5000, balanceCents: 19000, status: "partiel" },
    methodesUtilisees: ["carte"],
    deposit: null
  });
  assert.equal(values.length, 24);
  assert.equal(values[1], "GL-20260910-0001");
  assert.equal(values[2], "Jean");
  assert.equal(values[3], "Dupont");
  assert.equal(values[5], "jean.dupont@example.com");
  assert.equal(values[7], "10/09/2026");
  assert.equal(values[11], 2, "2 jours facturables");
  assert.equal(values[13], 240);
  assert.equal(values[14], 50);
  assert.equal(values[15], 190);
  assert.equal(values[16], "Carte bancaire");
  assert.equal(values[21], "Partiel");
  assert.equal(values[22], "Agence");
});

test("computeWritableRuns : saute une cellule contenant déjà une formule", () => {
  const values = ["A", "B", "C"];
  const rowMeta = [{}, { userEnteredValue: { formulaValue: "=A1" } }, {}];
  const runs = computeWritableRuns(values, rowMeta);
  assert.deepEqual(runs, [{ startIndex: 0, values: ["A"] }, { startIndex: 2, values: ["C"] }]);
});

test("computeWritableRuns : saute une valeur hors liste de validation", () => {
  const values = ["Payé bizarre"];
  const rowMeta = [{ dataValidation: { condition: { type: "ONE_OF_LIST", values: [{ userEnteredValue: "Impayé" }, { userEnteredValue: "Soldé" }] } } }];
  assert.deepEqual(computeWritableRuns(values, rowMeta), []);
});

test("computeWritableRuns : écrit normalement en l'absence de formule/validation bloquante", () => {
  const values = ["A", "B"];
  assert.deepEqual(computeWritableRuns(values, [{}, {}]), [{ startIndex: 0, values: ["A", "B"] }]);
});

test("syncRentalToSheet : ajoute une nouvelle ligne pour une location jamais synchronisée", async () => {
  const env = makeEnv();
  const rental = await creerLocation(env);
  const fake = createFakeGoogleSheets({ headers: EXPECTED_HEADERS });

  const result = await withFakeGoogleSheets(fake, () => syncRentalToSheet(env, rental.id));
  assert.equal(result.action, "created");
  assert.equal(fake.state.rows.length, 1);
  assert.equal(fake.state.rows[0][0], shortRef(rental.id));
  assert.equal(fake.state.rows[0][2], "Jean");
});

test("syncRentalToSheet : une seconde synchronisation MET À JOUR la même ligne, jamais de doublon", async () => {
  const env = makeEnv();
  const rental = await creerLocation(env);
  const fake = createFakeGoogleSheets({ headers: EXPECTED_HEADERS });

  await withFakeGoogleSheets(fake, () => syncRentalToSheet(env, rental.id));
  await addPayment(env, rental.id, { amount: 100, method: "carte" }, "Edmundo");
  const result = await withFakeGoogleSheets(fake, () => syncRentalToSheet(env, rental.id));

  assert.equal(result.action, "updated");
  assert.equal(fake.state.rows.length, 1, "toujours une seule ligne pour cette location");
  assert.equal(fake.state.rows[0][14], 100, "acompte versé mis à jour");
});

test("syncRentalToSheet : synchronise dès le brouillon (avant génération du contrat), Num contrat vide", async () => {
  const env = makeEnv();
  const rental = await creerLocation(env);
  const fake = createFakeGoogleSheets({ headers: EXPECTED_HEADERS });

  await withFakeGoogleSheets(fake, () => syncRentalToSheet(env, rental.id));
  assert.equal(fake.state.rows[0][1], "");

  await generateRentalContract(env, rental.id, "Edmundo");
  await withFakeGoogleSheets(fake, () => syncRentalToSheet(env, rental.id));
  assert.equal(fake.state.rows.length, 1, "toujours la même ligne, retrouvée via N° résa (pas Num contrat)");
  assert.match(fake.state.rows[0][1], /^GL-\d{8}-\d{4}$/);
});

test("syncRentalToSheet : ne remplace jamais une formule existante sur une ligne déjà présente", async () => {
  const env = makeEnv();
  const rental = await creerLocation(env);
  const fake = createFakeGoogleSheets({ headers: EXPECTED_HEADERS });
  await withFakeGoogleSheets(fake, () => syncRentalToSheet(env, rental.id));

  // Simule une formule saisie à la main par l'agence dans "Nb jours" (colonne index 11).
  fake.state.cellMeta["2:11"] = { formulaValue: "=J2-G2" };
  fake.state.rows[0][11] = 99; // valeur actuellement affichée par la formule

  await addPayment(env, rental.id, { amount: 50, method: "especes" }, "Edmundo");
  await withFakeGoogleSheets(fake, () => syncRentalToSheet(env, rental.id));

  assert.equal(fake.state.rows[0][11], 99, "la formule existante n'a pas été écrasée");
  assert.equal(fake.state.rows[0][14], 50, "les autres colonnes ont bien été mises à jour");
});

test("syncRentalToSheet : refuse si la structure de l'onglet a changé", async () => {
  const env = makeEnv();
  const rental = await creerLocation(env);
  const headers = EXPECTED_HEADERS.slice();
  headers[6] = "Modèle";
  const fake = createFakeGoogleSheets({ headers });
  await assert.rejects(withFakeGoogleSheets(fake, () => syncRentalToSheet(env, rental.id)), SheetStructureError);
  assert.equal(fake.state.rows.length, 0, "aucune écriture tentée si la structure est invalide");
});
