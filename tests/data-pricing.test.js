// tests/data-pricing.test.js
//
// Couvre le cœur du calcul de prix (js/data.js) : durée réelle en heures,
// arrondi en jours facturables, et calcul du prix total. C'est la fonction
// utilisée à la fois par l'affichage client ET par le recalcul serveur
// faisant foi (create-payment-intent.js) — toute régression ici a un
// impact direct sur la sécurité du paiement (montant facturé).

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  dureeEnHeures,
  joursFacturablesDepuisHeures,
  calculerPrixTotal,
  getVehiculeParId,
  PRIX_ASSURANCE_JOUR
} = require("../js/data.js");

test("dureeEnHeures : calcule correctement la durée en heures", () => {
  assert.equal(dureeEnHeures("2026-08-10", "10:00", "2026-08-11", "10:00"), 24);
  assert.equal(dureeEnHeures("2026-08-10", "10:00", "2026-08-10", "16:00"), 6);
  assert.equal(dureeEnHeures("2026-08-10", "10:00", "2026-08-10", "08:00"), -2);
});

test("joursFacturablesDepuisHeures : arrondit toute heure entamée à un jour de plus", () => {
  assert.equal(joursFacturablesDepuisHeures(24), 1);
  assert.equal(joursFacturablesDepuisHeures(24.01), 2);
  assert.equal(joursFacturablesDepuisHeures(1), 1); // minimum 1 jour
  assert.equal(joursFacturablesDepuisHeures(48), 2);
  assert.equal(joursFacturablesDepuisHeures(49), 3);
  assert.equal(joursFacturablesDepuisHeures(0), 1);
  assert.equal(joursFacturablesDepuisHeures(-5), 1);
  assert.equal(joursFacturablesDepuisHeures(NaN), 1);
});

test("calculerPrixTotal : renvoie null pour un véhicule inconnu", () => {
  const result = calculerPrixTotal({
    vehiculeId: "vehicule-inexistant",
    dateDebut: "2026-08-10",
    heureDebut: "10:00",
    dateFin: "2026-08-12",
    heureFin: "10:00",
    assurance: false
  });
  assert.equal(result, null);
});

test("calculerPrixTotal : renvoie null pour une durée nulle ou négative", () => {
  const params = {
    vehiculeId: "opel-corsa",
    dateDebut: "2026-08-10",
    heureDebut: "10:00",
    dateFin: "2026-08-10",
    heureFin: "10:00",
    assurance: false
  };
  assert.equal(calculerPrixTotal(params), null);

  const negatif = calculerPrixTotal({ ...params, dateFin: "2026-08-09" });
  assert.equal(negatif, null);
});

test("calculerPrixTotal : calcule correctement sans assurance", () => {
  const vehicule = getVehiculeParId("peugeot-3008");
  const result = calculerPrixTotal({
    vehiculeId: "peugeot-3008",
    dateDebut: "2026-08-01",
    heureDebut: "10:00",
    dateFin: "2026-08-04",
    heureFin: "10:00",
    assurance: false
  });
  assert.equal(result.jours, 3);
  assert.equal(result.sousTotal, vehicule.prixJour * 3);
  assert.equal(result.assuranceMontant, 0);
  assert.equal(result.total, vehicule.prixJour * 3);
  assert.equal(result.totalCentimes, Math.round(result.total * 100));
});

test("calculerPrixTotal : calcule correctement avec assurance", () => {
  const vehicule = getVehiculeParId("peugeot-3008");
  const result = calculerPrixTotal({
    vehiculeId: "peugeot-3008",
    dateDebut: "2026-08-01",
    heureDebut: "10:00",
    dateFin: "2026-08-04",
    heureFin: "10:00",
    assurance: true
  });
  assert.equal(result.jours, 3);
  assert.equal(result.assuranceMontant, PRIX_ASSURANCE_JOUR * 3);
  assert.equal(result.total, vehicule.prixJour * 3 + PRIX_ASSURANCE_JOUR * 3);
});

test("calculerPrixTotal : une heure entamée au-delà d'un multiple de 24h ajoute un jour facturable", () => {
  const vehicule = getVehiculeParId("opel-corsa");
  // 24h pile => 1 jour
  const pile = calculerPrixTotal({
    vehiculeId: "opel-corsa",
    dateDebut: "2026-08-01", heureDebut: "10:00",
    dateFin: "2026-08-02", heureFin: "10:00",
    assurance: false
  });
  assert.equal(pile.jours, 1);
  assert.equal(pile.total, vehicule.prixJour);

  // 24h + 1 minute => 2 jours facturables
  const depasse = calculerPrixTotal({
    vehiculeId: "opel-corsa",
    dateDebut: "2026-08-01", heureDebut: "10:00",
    dateFin: "2026-08-02", heureFin: "10:01",
    assurance: false
  });
  assert.equal(depasse.jours, 2);
  assert.equal(depasse.total, vehicule.prixJour * 2);
});

test("calculerPrixTotal : totalCentimes est cohérent avec total (pas d'erreur d'arrondi flottant)", () => {
  const result = calculerPrixTotal({
    vehiculeId: "toyota-proace-city",
    dateDebut: "2026-08-01", heureDebut: "10:00",
    dateFin: "2026-08-08", heureFin: "10:00",
    assurance: true
  });
  assert.equal(result.totalCentimes, Math.round(result.total * 100));
  assert.equal(Number.isInteger(result.totalCentimes), true);
});
