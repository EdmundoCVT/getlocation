// tests/tarifs-2026-09.test.js
//
// Règles tarifaires et de présentation mises en place le 15/09/2026 :
//   - remise longue durée ramenée à -5 €/jour à partir de 5 jours ;
//   - deux options enfant seulement (siège enfant 10 €/jour, rehausseur
//     5 €/jour), avec âge et poids demandés pour le siège ;
//   - supplément jeune conducteur automatique (+30 €/jour, permis de moins
//     de 3 ans) ;
//   - contrat PDF : prix de location + options retenues, sans ligne
//     d'ajustement tarifaire ni ligne « Options » vide ;
//   - aperçu PDF jamais bloqué par une information manquante.
//
// Reprend les cas A à K de la recette demandée.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const data = require("../js/data.js");
const {
  calculerPrixTotal, getOptionParId, estJeuneConducteur, anciennetePermisAnnees,
  REDUCTIONS_DUREE, SUPPLEMENT_JEUNE_CONDUCTEUR, OPTIONS
} = data;

const racine = path.join(__dirname, "..");

// Location de N jours pleins à partir du 1er octobre 2026.
function prix(jours, extra) {
  const fin = new Date(Date.UTC(2026, 9, 1) + jours * 86400000).toISOString().slice(0, 10);
  return calculerPrixTotal(Object.assign({
    vehiculeId: "opel-corsa",
    dateDebut: "2026-10-01", heureDebut: "10:00",
    dateFin: fin, heureFin: "10:00",
    options: []
  }, extra || {}));
}

// --- Remise longue durée (cas A, B, C) -----------------------------------

test("remise longue durée : -5 €/jour à partir de 5 jours, rien en dessous", () => {
  assert.equal(REDUCTIONS_DUREE.length, 1);
  assert.equal(REDUCTIONS_DUREE[0].seuilJours, 5);
  assert.equal(REDUCTIONS_DUREE[0].montantParJour, 5, "l'ancienne remise de 10 €/jour ne doit plus exister");

  assert.equal(prix(4).reductionDuree, null, "cas A : 4 jours, aucune remise");
  assert.equal(prix(5).reductionDuree.montant, 25, "cas B : 5 jours, -25 €");
  assert.equal(prix(9).reductionDuree.montant, 45, "cas C : 9 jours, -45 €");
  assert.equal(prix(10).reductionDuree.montant, 50);
});

test("la remise s'applique à toute la durée, pas seulement aux jours au-delà du seuil", () => {
  const p = prix(9);
  assert.equal(p.sousTotal, p.sousTotalBrut - 45);
});

// --- Options enfants (cas D, E) ------------------------------------------

test("options enfants : deux seulement, siège enfant 10 €/jour et rehausseur 5 €/jour", () => {
  const ids = OPTIONS.map((o) => o.id);
  assert.equal(ids.includes("siege-auto"), false, "l'ancienne option « Siège bébé » a été retirée");
  assert.equal(getOptionParId("siege-enfant").prix, 10);
  assert.equal(getOptionParId("siege-enfant").nom, "Siège enfant");
  assert.equal(getOptionParId("rehausseur").prix, 5);
  assert.equal(getOptionParId("rehausseur").nom, "Rehausseur");

  assert.equal(prix(5, { options: ["siege-enfant"] }).optionsMontant, 50, "cas D");
  assert.equal(prix(5, { options: ["rehausseur"] }).optionsMontant, 25, "cas E");
});

test("le siège enfant demande l'âge et le poids, le rehausseur non", () => {
  const siege = getOptionParId("siege-enfant");
  assert.deepEqual(siege.saisies.map((s) => s.cle), ["enfantAge", "enfantPoids"]);
  assert.equal(getOptionParId("rehausseur").saisies, undefined);
  // Le client ne choisit pas la catégorie du siège : c'est l'agence qui la
  // détermine à partir de ces deux informations.
  assert.match(siege.description, /âge et du poids de l'enfant/);
});

// --- Supplément jeune conducteur (cas F, G) ------------------------------

test("supplément jeune conducteur : +30 €/jour pour un permis de moins de 3 ans", () => {
  assert.equal(SUPPLEMENT_JEUNE_CONDUCTEUR.montantParJour, 30);
  assert.equal(SUPPLEMENT_JEUNE_CONDUCTEUR.anneesMin, 3);

  const jeune = prix(5, { permisDate: "2025-01-01" });
  assert.equal(jeune.supplementJeuneConducteur.montant, 150, "cas F : 5 jours x 30 €");
  assert.equal(prix(1, { permisDate: "2025-01-01" }).supplementJeuneConducteur.montant, 30);
  assert.equal(prix(10, { permisDate: "2025-01-01" }).supplementJeuneConducteur.montant, 300);

  // Le supplément entre bien dans le total facturé.
  assert.equal(jeune.total, prix(5).total + 150);
});

test("aucun supplément à partir de 3 ans de permis, ni sans date connue", () => {
  assert.equal(prix(5, { permisDate: "2020-01-01" }).supplementJeuneConducteur, null, "cas G");
  assert.equal(prix(5).supplementJeuneConducteur, null, "date absente : jamais de supplément au hasard");
  assert.equal(prix(5, { permisDate: "pas-une-date" }).supplementJeuneConducteur, null);
});

test("le seuil des 3 ans se compte en années révolues", () => {
  const reference = "2026-09-15T00:00:00Z";
  assert.equal(estJeuneConducteur("2023-09-16", reference), true, "3 ans moins un jour");
  assert.equal(estJeuneConducteur("2023-09-15", reference), false, "exactement 3 ans : plus de supplément");
  assert.equal(estJeuneConducteur("2023-09-14", reference), false);
  assert.equal(anciennetePermisAnnees("2023-09-15", reference), 3);
  // Une date future ne rend pas « jeune conducteur » : elle est simplement
  // refusée en amont par la validation du formulaire et du serveur.
  assert.equal(estJeuneConducteur("2030-01-01", reference), false);
});

// --- FAQ ------------------------------------------------------------------

test("la question « Quels véhicules proposez-vous ? » a disparu de la page et du balisage", () => {
  const html = fs.readFileSync(path.join(racine, "index.html"), "utf8");
  assert.equal(html.includes("Quels véhicules proposez-vous"), false);
  assert.equal(html.includes("Quels véhicules propose GETLOCATION"), false, "la question doit aussi sortir du balisage FAQPage");

  // Le balisage Schema.org doit rester un JSON valide après le retrait.
  const blocs = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  const faq = blocs.map((b) => JSON.parse(b[1])).find((d) => d["@type"] === "FAQPage");
  assert.ok(faq, "le balisage FAQPage doit rester présent");
  assert.equal(faq.mainEntity.length, 4);
});

// --- Contrat : aperçu jamais bloquant (cas K) ----------------------------

test("aperçu PDF : aucune validation bloquante, les manques s'affichent « À compléter »", () => {
  const contratHtml = fs.readFileSync(path.join(racine, "contrat.html"), "utf8");

  // Le bouton d'aperçu est un bouton simple : il ne déclenche jamais la
  // validation HTML du formulaire (qui exigerait l'adresse du client).
  assert.match(contratHtml, /<button type="button"[^>]*id="downloadPdfBtn"/);

  // Et il n'appelle aucune fonction de validation avant de générer.
  const handler = contratHtml.slice(contratHtml.indexOf("getElementById('downloadPdfBtn')"));
  const corpsHandler = handler.slice(0, handler.indexOf("});"));
  ["checkValidity", "reportValidity", "champsManquants"].forEach((bloquant) => {
    assert.equal(corpsHandler.includes(bloquant), false, `l'aperçu ne doit pas dépendre de ${bloquant}`);
  });

  // Les valeurs absentes sont remplacées par « À compléter » en mode aperçu.
  assert.match(contratHtml, /estApercu \? T\('À compléter'\) : '—'/);
});

// --- Lien client immédiatement sous la génération (cas L) ----------------

test("le lien à envoyer au client est placé juste sous la génération du contrat", () => {
  const dom = new JSDOM(fs.readFileSync(path.join(racine, "contrat.html"), "utf8"));
  const document = dom.window.document;

  const titres = [...document.querySelectorAll("h2")].map((h) => h.textContent.trim());
  const indexGeneration = titres.findIndex((t) => /Générer le contrat officiel/.test(t));
  const indexLien = titres.findIndex((t) => /Lien à envoyer au client/.test(t));
  const indexHistorique = titres.findIndex((t) => /Derniers contrats/.test(t));

  assert.ok(indexGeneration !== -1 && indexLien !== -1 && indexHistorique !== -1);
  assert.equal(indexLien, indexGeneration + 1, "le lien client suit immédiatement le bloc de génération");
  assert.ok(indexLien < indexHistorique, "il ne faut plus descendre après « Derniers contrats » pour le trouver");

  // Un seul bloc de lien : pas de doublon introduit en le remontant.
  assert.equal(titres.filter((t) => /Lien à envoyer au client/.test(t)).length, 1);
  assert.equal(document.querySelectorAll("#linkOutput").length, 1);
  assert.equal(document.querySelectorAll("#copyBtn").length, 1);

  // Copier, ouvrir et confirmation de copie sont bien présents.
  assert.ok(document.getElementById("copyBtn"));
  assert.ok(document.getElementById("openLinkBtn"));
  assert.match(document.getElementById("copiedMsg").textContent, /Lien copié/);
  dom.window.close();
});

// --- État des lieux : carburant et clés (cas O) --------------------------

test("état des lieux : niveaux de carburant lisibles et nombre de clés distinct des accessoires", () => {
  const contratHtml = fs.readFileSync(path.join(racine, "contrat.html"), "utf8");
  const dom = new JSDOM(contratHtml);
  const document = dom.window.document;

  ["rr-depart-cles", "rr-retour-cles"].forEach((id) => {
    const champ = document.getElementById(id);
    assert.ok(champ, `champ ${id} manquant`);
    assert.equal(champ.type, "number");
  });
  assert.ok(document.getElementById("rr-depart-clesAccessoires"), "les accessoires restent un champ à part");

  // Les niveaux sont ceux d'une jauge, pas une échelle de pourcentages.
  ["Vide", "Réserve", "1/4", "1/2", "3/4", "Plein"].forEach((niveau) => {
    assert.ok(contratHtml.includes(`libelle: '${niveau}'`), `niveau de carburant « ${niveau} » manquant`);
  });
  // Les relevés déjà saisis en pourcentage restent lisibles.
  assert.match(contratHtml, /connu \? connu\.libelle : \(niveau \+ ' %'\)/);
  dom.window.close();
});
