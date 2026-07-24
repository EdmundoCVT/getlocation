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
  PRIX_ASSURANCE_JOUR,
  REDUCTIONS_DUREE,
  reductionDureeApplicable,
  getCodePromo,
  OPTIONS,
  getOptionParId
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

/* ---------------------------------------------------------
   Réductions durée (7 / 14 / 30 jours)
--------------------------------------------------------- */

test("reductionDureeApplicable : aucun palier en dessous de 7 jours", () => {
  assert.equal(reductionDureeApplicable(1), null);
  assert.equal(reductionDureeApplicable(6), null);
});

test("reductionDureeApplicable : retient le meilleur palier atteint", () => {
  assert.equal(reductionDureeApplicable(7).seuilJours, 7);
  assert.equal(reductionDureeApplicable(13).seuilJours, 7);
  assert.equal(reductionDureeApplicable(14).seuilJours, 14);
  assert.equal(reductionDureeApplicable(29).seuilJours, 14);
  assert.equal(reductionDureeApplicable(30).seuilJours, 30);
  assert.equal(reductionDureeApplicable(90).seuilJours, 30);
});

test("calculerPrixTotal : applique la remise durée au palier 7 jours sur le sous-total, pas sur l'assurance", () => {
  const vehicule = getVehiculeParId("opel-corsa");
  const palier7 = REDUCTIONS_DUREE.find(r => r.seuilJours === 7);
  const result = calculerPrixTotal({
    vehiculeId: "opel-corsa",
    dateDebut: "2026-08-01", heureDebut: "10:00",
    dateFin: "2026-08-08", heureFin: "10:00", // 7 jours pile
    assurance: true
  });
  assert.equal(result.jours, 7);
  assert.equal(result.sousTotalBrut, vehicule.prixJour * 7);
  assert.ok(result.reductionDuree);
  assert.equal(result.reductionDuree.pourcentage, palier7.pourcentage);
  assert.equal(result.reductionDuree.montant, Math.round(vehicule.prixJour * 7 * palier7.pourcentage) / 100);
  assert.equal(result.sousTotal, result.sousTotalBrut - result.reductionDuree.montant);
  assert.equal(result.assuranceMontant, PRIX_ASSURANCE_JOUR * 7); // pas remisée
  assert.equal(result.total, result.sousTotal + result.assuranceMontant);
});

test("calculerPrixTotal : sans palier atteint, aucune remise durée n'est appliquée", () => {
  const vehicule = getVehiculeParId("opel-corsa");
  const result = calculerPrixTotal({
    vehiculeId: "opel-corsa",
    dateDebut: "2026-08-01", heureDebut: "10:00",
    dateFin: "2026-08-04", heureFin: "10:00", // 3 jours
    assurance: false
  });
  assert.equal(result.reductionDuree, null);
  assert.equal(result.sousTotal, vehicule.prixJour * 3);
});

/* ---------------------------------------------------------
   Codes promo
--------------------------------------------------------- */

test("getCodePromo : normalise la casse et les espaces, rejette un code inconnu", () => {
  assert.equal(getCodePromo("  bienvenue10  ").code, "BIENVENUE10");
  assert.equal(getCodePromo("BIENVENUE10").pourcentage > 0, true);
  assert.equal(getCodePromo("CODE-INEXISTANT"), null);
  assert.equal(getCodePromo(""), null);
  assert.equal(getCodePromo(null), null);
  assert.equal(getCodePromo(undefined), null);
});

test("calculerPrixTotal : applique un code promo valide sur le total (assurance + options incluses)", () => {
  const vehicule = getVehiculeParId("opel-corsa");
  const promo = getCodePromo("BIENVENUE10");
  const result = calculerPrixTotal({
    vehiculeId: "opel-corsa",
    dateDebut: "2026-08-01", heureDebut: "10:00",
    dateFin: "2026-08-04", heureFin: "10:00", // 3 jours, pas de remise durée
    assurance: true,
    codePromo: "bienvenue10"
  });
  const baseAvantPromo = vehicule.prixJour * 3 + PRIX_ASSURANCE_JOUR * 3;
  assert.equal(result.baseAvantPromo, baseAvantPromo);
  assert.ok(result.codePromo);
  assert.equal(result.codePromo.code, "BIENVENUE10");
  assert.equal(result.reductionPromoMontant, Math.round(baseAvantPromo * promo.pourcentage) / 100);
  assert.equal(result.total, baseAvantPromo - result.reductionPromoMontant);
});

test("calculerPrixTotal : un code promo invalide est ignoré (aucune erreur, aucune remise)", () => {
  const vehicule = getVehiculeParId("opel-corsa");
  const result = calculerPrixTotal({
    vehiculeId: "opel-corsa",
    dateDebut: "2026-08-01", heureDebut: "10:00",
    dateFin: "2026-08-04", heureFin: "10:00",
    assurance: false,
    codePromo: "PAS-UN-VRAI-CODE"
  });
  assert.equal(result.codePromo, null);
  assert.equal(result.reductionPromoMontant, 0);
  assert.equal(result.total, vehicule.prixJour * 3);
});

/* ---------------------------------------------------------
   Options (siège auto, forfaits, etc.)
--------------------------------------------------------- */

test("OPTIONS : chaque option a un id, un prix positif et un type valide", () => {
  assert.ok(OPTIONS.length > 0);
  OPTIONS.forEach((opt) => {
    assert.equal(typeof opt.id, "string");
    assert.ok(["jour", "forfait"].includes(opt.type));
    assert.ok(opt.prix > 0);
    assert.equal(getOptionParId(opt.id).id, opt.id);
  });
});

test("calculerPrixTotal : une option type \"jour\" est multipliée par le nombre de jours, une option \"forfait\" ne l'est pas", () => {
  const vehicule = getVehiculeParId("opel-corsa");
  const siegeAuto = getOptionParId("siege-auto"); // type "jour"
  const nettoyage = getOptionParId("nettoyage"); // type "forfait"
  const result = calculerPrixTotal({
    vehiculeId: "opel-corsa",
    dateDebut: "2026-08-01", heureDebut: "10:00",
    dateFin: "2026-08-04", heureFin: "10:00", // 3 jours
    assurance: false,
    options: ["siege-auto", "nettoyage"]
  });
  assert.equal(result.jours, 3);
  const optSiege = result.optionsSelectionnees.find(o => o.id === "siege-auto");
  const optNettoyage = result.optionsSelectionnees.find(o => o.id === "nettoyage");
  assert.equal(optSiege.montant, siegeAuto.prix * 3);
  assert.equal(optNettoyage.montant, nettoyage.prix);
  assert.equal(result.optionsMontant, optSiege.montant + optNettoyage.montant);
  assert.equal(result.total, vehicule.prixJour * 3 + result.optionsMontant);
});

test("calculerPrixTotal : ignore un identifiant d'option inconnu et déduplique les doublons", () => {
  const result = calculerPrixTotal({
    vehiculeId: "opel-corsa",
    dateDebut: "2026-08-01", heureDebut: "10:00",
    dateFin: "2026-08-04", heureFin: "10:00",
    assurance: false,
    options: ["siege-auto", "siege-auto", "option-qui-nexiste-pas"]
  });
  assert.equal(result.optionsSelectionnees.length, 1);
  assert.equal(result.optionsSelectionnees[0].id, "siege-auto");
});

test("calculerPrixTotal : pipeline complet — remise durée + assurance + options − code promo", () => {
  const vehicule = getVehiculeParId("peugeot-3008");
  const palier14 = REDUCTIONS_DUREE.find(r => r.seuilJours === 14);
  const promo = getCodePromo("ETE2026");
  const siegeAuto = getOptionParId("siege-auto");
  const livraison = getOptionParId("livraison-adresse");

  const result = calculerPrixTotal({
    vehiculeId: "peugeot-3008",
    dateDebut: "2026-08-01", heureDebut: "10:00",
    dateFin: "2026-08-15", heureFin: "10:00", // 14 jours
    assurance: true,
    options: ["siege-auto", "livraison-adresse"],
    codePromo: "ETE2026"
  });

  const sousTotalBrut = vehicule.prixJour * 14;
  const reductionDureeMontant = Math.round(sousTotalBrut * palier14.pourcentage) / 100;
  const sousTotal = sousTotalBrut - reductionDureeMontant;
  const assuranceMontant = PRIX_ASSURANCE_JOUR * 14;
  const optionsMontant = siegeAuto.prix * 14 + livraison.prix;
  const baseAvantPromo = sousTotal + assuranceMontant + optionsMontant;
  const reductionPromoMontant = Math.round(baseAvantPromo * promo.pourcentage) / 100;
  const total = baseAvantPromo - reductionPromoMontant;

  assert.equal(result.sousTotalBrut, sousTotalBrut);
  assert.equal(result.reductionDuree.montant, reductionDureeMontant);
  assert.equal(result.sousTotal, sousTotal);
  assert.equal(result.assuranceMontant, assuranceMontant);
  assert.equal(result.optionsMontant, optionsMontant);
  assert.equal(result.baseAvantPromo, baseAvantPromo);
  assert.equal(result.reductionPromoMontant, reductionPromoMontant);
  assert.equal(result.total, total);
  assert.equal(result.totalCentimes, Math.round(total * 100));
});
