const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CODES_PROMO,
  calculerPrixTotal,
  getCodePromo,
  validerCodesPromo
} = require("../js/data.js");
const { validateReservationInput } = require("../src/lib/validate-reservation-input.js");
const { CGL_VERSION } = require("../js/data.js");

function dates(jours) {
  const debut = new Date("2027-01-01T10:00:00Z");
  const fin = new Date(debut);
  fin.setUTCDate(fin.getUTCDate() + jours);
  return {
    dateDebut: debut.toISOString().slice(0, 10), heureDebut: "10:00",
    dateFin: fin.toISOString().slice(0, 10), heureFin: "10:00"
  };
}

function prix(jours, codesPromo = [], extra = {}) {
  return calculerPrixTotal({ vehiculeId: "opel-corsa", ...dates(jours), codesPromo, options: [], ...extra });
}

function futureDate(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function payload(overrides = {}) {
  return {
    vehiculeId: "opel-corsa",
    dateDebut: futureDate(30), heureDebut: "10:00",
    dateFin: futureDate(33), heureFin: "10:00",
    lieuPrise: "Agence Grasse", lieuRetour: "Agence Grasse",
    options: [], codesPromo: [],
    conducteur: { nom: "Martin", prenom: "Alice", email: "alice@example.com", telephone: "0601020304", naissance: "1990-01-01" },
    cglAccepted: true, cglVersion: CGL_VERSION,
    ...overrides
  };
}

test("catalogue : BIENVENUE20 et GETLOC5 à GETLOC95 restent disponibles", () => {
  assert.equal(getCodePromo(" bienvenue20 ").montant, 20);
  for (let taux = 5; taux <= 95; taux += 5) {
    assert.equal(CODES_PROMO[`GETLOC${taux}`].pourcentage, taux);
  }
});

test("CORSA50 facture exactement 50 € par jour sur toutes les durées demandées", () => {
  for (const jours of [1, 3, 5, 7, 11, 15, 30]) {
    const resultat = prix(jours, ["CORSA50"]);
    assert.equal(resultat.total, 50 * jours);
    assert.equal(resultat.locationNette, 50 * jours);
    assert.equal(resultat.reductionDuree, null);
  }
});

test("CORSA50 est limité à l'Opel Corsa", () => {
  const resultat = validerCodesPromo({ codesPromo: ["CORSA50"], vehiculeId: "peugeot-3008", dateDebut: "2027-01-01" });
  assert.equal(resultat.valid, false);
  assert.equal(resultat.errors[0].type, "vehicle");
});

test("un tarif fixe remplace le tarif public sans plafonnement implicite", () => {
  const resultat = prix(11, ["CORSA50"]);
  assert.equal(resultat.sousTotal, 550);
  assert.equal(resultat.tarifJournalierFixe.tarifJournalier, 50);
  assert.equal(resultat.tarifJournalierFixe.ajustementMontant, 550 - resultat.sousTotalBrut);
});

test("CORSA50 peut augmenter le prix public basse saison", () => {
  const resultat = calculerPrixTotal({
    vehiculeId: "opel-corsa",
    dateDebut: "2027-11-08", heureDebut: "10:00",
    dateFin: "2027-11-09", heureFin: "10:00",
    codesPromo: ["CORSA50"]
  });
  assert.equal(resultat.sousTotalBrut, 49);
  assert.equal(resultat.total, 50);
  assert.equal(resultat.tarifJournalierFixe.ajustementMontant, 1);
});

test("cumul de référence : CORSA50 + GETLOC10 + BIENVENUE20 = 475 €", () => {
  const resultat = prix(11, ["CORSA50", "GETLOC10", "BIENVENUE20"]);
  assert.equal(resultat.sousTotal, 550);
  assert.deepEqual(resultat.reductionsPromo.map((r) => [r.code, r.montantApplique]), [["GETLOC10", 55], ["BIENVENUE20", 20]]);
  assert.equal(resultat.locationNette, 475);
  assert.equal(resultat.total, 475);
});

test("les pourcentages sont séquentiels puis les montants fixes", () => {
  const resultat = prix(3, ["BIENVENUE20", "CORSA50", "GETLOC10", "GETLOC20"]);
  // 150 - 10 % = 135 ; -20 % = 108 ; -20 € = 88.
  assert.equal(resultat.locationNette, 88);
  assert.deepEqual(resultat.reductionsPromo.map((r) => r.code), ["GETLOC10", "GETLOC20", "BIENVENUE20"]);
});

test("options, protection et suppléments restent intégralement hors remise", () => {
  const sansExtra = prix(3, ["GETLOC50"]);
  const avecExtra = prix(3, ["GETLOC50"], { options: ["siege-enfant"], protection: "confort" });
  assert.equal(avecExtra.reductionPromoMontant, sansExtra.reductionPromoMontant);
  assert.equal(avecExtra.locationNette, sansExtra.locationNette);
  assert.equal(avecExtra.total - sansExtra.total, avecExtra.optionsMontant + avecExtra.protection.montant);
});

test("les remises sont arrondies au centime à chaque étape", () => {
  const resultat = prix(1, ["GETLOC15", "GETLOC10"]);
  assert.equal(Number.isInteger(resultat.totalCentimes), true);
  assert.equal(resultat.total, resultat.totalCentimes / 100);
  assert.ok(resultat.reductionsPromo.every((r) => Number.isInteger(Math.round(r.montantApplique * 100))));
});

test("un doublon, un code inconnu et le mauvais véhicule sont refusés sans prix modifié", () => {
  const doublon = validerCodesPromo({ codesPromo: ["GETLOC10", "getloc10"], vehiculeId: "opel-corsa" });
  const inconnu = validerCodesPromo({ codesPromo: ["INCONNU"], vehiculeId: "opel-corsa" });
  assert.equal(doublon.errors[0].type, "duplicate");
  assert.equal(inconnu.errors[0].type, "unknown");
  assert.equal(prix(3, ["INCONNU"]).total, prix(3).total);
});

test("le moteur générique refuse deux tarifs journaliers fixes", () => {
  CODES_PROMO.CORSA40TEST = { type: "tarif_journalier_fixe", tarifJournalier: 40, vehiculeIds: ["opel-corsa"], description: "test" };
  try {
    const resultat = validerCodesPromo({ codesPromo: ["CORSA50", "CORSA40TEST"], vehiculeId: "opel-corsa" });
    assert.equal(resultat.valid, false);
    assert.equal(resultat.errors[0].type, "fixed_rate_conflict");
  } finally {
    delete CODES_PROMO.CORSA40TEST;
  }
});

test("snapshot : toutes les promotions et leurs effets sont conservés", () => {
  const resultat = prix(11, ["CORSA50", "GETLOC10", "BIENVENUE20"]);
  assert.deepEqual(resultat.pricingSnapshot.codesPromo.map((p) => p.code), ["CORSA50", "GETLOC10", "BIENVENUE20"]);
  assert.equal(resultat.pricingSnapshot.montantLocationNet, 475);
  assert.equal(resultat.pricingSnapshot.tarifJournalierFixe.tarifJournalier, 50);
});

test("validation serveur : liste multiple et ancien champ singulier sont compatibles", () => {
  const multiple = validateReservationInput(payload({ codesPromo: ["corsa50", "getloc10"] }));
  assert.equal(multiple.valid, true, multiple.errors.join(", "));
  assert.deepEqual(multiple.codesPromo, ["CORSA50", "GETLOC10"]);
  const legacy = validateReservationInput(payload({ codesPromo: undefined, codePromo: " bienvenue20 " }));
  assert.equal(legacy.valid, true, legacy.errors.join(", "));
  assert.deepEqual(legacy.codesPromo, ["BIENVENUE20"]);
});

