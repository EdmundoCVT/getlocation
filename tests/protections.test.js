// tests/protections.test.js
//
// Niveaux de protection (PROTECTIONS, js/data.js) : quatre formules
// comparables, une seule retenue par réservation, la formule incluse par
// défaut. Ces tests couvrent les points sensibles :
//   - le prix de chaque formule pour chaque durée, plafond compris ;
//   - la combinaison avec les autres lignes de la facture (options enfant,
//     livraison, supplément jeune conducteur, remise longue durée) ;
//   - le refus côté serveur d'un identifiant de protection inconnu ;
//   - l'absence totale de l'ancienne option « assurance-passagers » ;
//   - la reprise fidèle de la protection sur le contrat PDF ;
//   - l'immunité des anciennes réservations, enregistrées sans protection.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const data = require("../js/data.js");
const {
  PROTECTIONS,
  PROTECTION_PAR_DEFAUT,
  calculerProtection,
  calculerPrixTotal,
  getProtectionParId,
  estProtectionConnue,
  getOptionParId
} = data;
const { validateReservationInput } = require("../src/lib/validate-reservation-input.js");

// Opel Corsa : 59 €/jour, le véhicule utilisé par les autres tests de prix.
const VEHICULE = "opel-corsa";

// Les espaces fines insécables des montants sont normalisées à l'écriture
// dans le PDF (nettoyerTextePdf, contrat.html) : on compare donc sur la même
// base, sans quoi « 500 € » et « 500 € » paraîtraient différents.
const memeMontant = (a, b) =>
  String(a).replace(/[\u202F\u00A0]/g, " ") === String(b).replace(/[\u202F\u00A0]/g, " ");

function prix(jours, extra = {}) {
  const debut = new Date(Date.UTC(2026, 9, 5, 10, 0));
  const fin = new Date(debut.getTime() + jours * 24 * 3600 * 1000);
  const iso = (d) => d.toISOString().slice(0, 10);
  return calculerPrixTotal({
    vehiculeId: VEHICULE,
    dateDebut: iso(debut), heureDebut: "10:00",
    dateFin: iso(fin), heureFin: "10:00",
    options: [],
    codePromo: "",
    ...extra
  });
}

// ---------------------------------------------------------------------
// 1. Tarification de chaque formule, pour chaque durée
// ---------------------------------------------------------------------

test("prix des quatre protections pour 1, 5, 7, 8 et 20 jours (plafond à 7 jours facturés)", () => {
  // Attendu : { protection: { 1j, 5j, 7j, 8j, 20j } }
  const attendu = {
    essentiel: [0, 0, 0, 0, 0],
    confort: [6, 30, 42, 42, 42],
    serenite: [12, 60, 84, 84, 84],
    "serenite-plus": [20, 100, 140, 140, 140]
  };
  const durees = [1, 5, 7, 8, 20];

  Object.keys(attendu).forEach((id) => {
    durees.forEach((jours, i) => {
      const calcul = calculerProtection(id, jours);
      assert.equal(calcul.montant, attendu[id][i], `${id} sur ${jours} jour(s)`);
      assert.equal(calcul.id, id);
      // Le plafond ne se voit qu'au-delà de la période facturée, et jamais
      // pour la formule incluse (qui n'est pas « plafonnée », elle est
      // gratuite du premier au dernier jour).
      const protection = getProtectionParId(id);
      assert.equal(calcul.plafonne, protection.prixParJour > 0 && jours > protection.joursFacturesMax);
    });
  });
});

test("franchise de chaque formule : décroissante, jamais nulle (aucune promesse de « franchise 0 € »)", () => {
  const franchises = PROTECTIONS.map((p) => p.franchise);
  assert.deepEqual(franchises, [2000, 1500, 750, 300]);
  franchises.forEach((franchise) => assert.ok(franchise > 0, "aucune formule ne supprime la franchise"));
});

test("une seule formule est recommandée, et la formule incluse est celle par défaut", () => {
  assert.equal(PROTECTIONS.filter((p) => p.recommande).length, 1);
  assert.equal(PROTECTIONS.find((p) => p.recommande).id, "serenite");
  const parDefaut = getProtectionParId(PROTECTION_PAR_DEFAUT);
  assert.equal(parDefaut.prixParJour, 0, "la formule par défaut doit être incluse, jamais facturée");
});

test("identifiant de protection inconnu ou absent : repli silencieux sur la formule incluse", () => {
  ["", null, undefined, "gratuit-total", "serenite ", 42].forEach((valeur) => {
    assert.equal(getProtectionParId(valeur).id, PROTECTION_PAR_DEFAUT);
    assert.equal(estProtectionConnue(valeur), false);
  });
  PROTECTIONS.forEach((p) => assert.equal(estProtectionConnue(p.id), true));
});

// ---------------------------------------------------------------------
// 2. Intégration dans le prix total
// ---------------------------------------------------------------------

test("10 jours en Sérénité : location remisée + protection plafonnée", () => {
  const resultat = prix(10, { protection: "serenite" });
  // 10 × 59 = 590, remise longue durée -5 €/jour = -50, protection 84.
  assert.equal(resultat.sousTotalBrut, 590);
  assert.equal(resultat.reductionDuree.montant, 50);
  assert.equal(resultat.protection.montant, 84);
  assert.equal(resultat.protection.plafonne, true);
  assert.equal(resultat.total, 590 - 50 + 84);
});

test("protection, options enfant, livraison, jeune conducteur et remise durée se cumulent sans se recouvrir", () => {
  const resultat = prix(5, {
    protection: "serenite-plus",
    options: ["siege-enfant", "livraison-adresse"],
    permisDate: "2025-01-01" // permis de moins de 3 ans
  });
  assert.equal(resultat.protection.montant, 100); // 5 j × 20 €
  assert.equal(resultat.optionsMontant, 50 + 20); // siège 5 j × 10 € + livraison 20 €
  assert.equal(resultat.supplementJeuneConducteur.montant, 150); // 5 j × 30 €
  assert.equal(resultat.reductionDuree.montant, 25); // 5 j × 5 €
  assert.equal(resultat.total, 5 * 59 - 25 + 100 + 70 + 150);
});

test("changer de formule remplace le montant au lieu de s'y ajouter", () => {
  const base = prix(3, { protection: "confort" });
  const remplacee = prix(3, { protection: "serenite" });
  const retour = prix(3, { protection: PROTECTION_PAR_DEFAUT });
  assert.equal(base.protection.montant, 18);
  assert.equal(remplacee.protection.montant, 36);
  assert.equal(retour.protection.montant, 0);
  assert.equal(retour.total, base.total - 18);
});

test("la protection n'est pas une option : elle n'apparaît jamais dans le catalogue d'options", () => {
  assert.equal(getOptionParId("assurance-passagers"), undefined, "l'ancienne option payante a été retirée");
  data.OPTIONS.forEach((option) => {
    assert.equal(
      PROTECTIONS.some((p) => p.id === option.id),
      false,
      `l'option ${option.id} ne doit pas porter le même identifiant qu'une protection`
    );
  });
});

test("une ancienne réservation demandant « assurance-passagers » n'est plus facturée pour cette option", () => {
  const resultat = prix(2, { options: ["assurance-passagers"], protection: PROTECTION_PAR_DEFAUT });
  assert.equal(resultat.optionsMontant, 0, "une option disparue du catalogue ne doit rien facturer");
  assert.equal(resultat.total, 2 * 59);
});

// ---------------------------------------------------------------------
// 3. Serveur : ce que le client envoie n'est jamais cru sur parole
// ---------------------------------------------------------------------

function entreeValide(extra = {}) {
  return {
    vehiculeId: VEHICULE,
    dateDebut: "2099-01-01", heureDebut: "10:00",
    dateFin: "2099-01-03", heureFin: "10:00",
    lieuPrise: data.LIEUX[0], lieuRetour: data.LIEUX[0],
    adressePrise: data.LIEUX[0] === data.LIEU_LIVRAISON ? data.VILLES_LIVRAISON[0] : "",
    adresseRetour: data.LIEUX[0] === data.LIEU_LIVRAISON ? data.VILLES_LIVRAISON[0] : "",
    options: [],
    codePromo: "",
    conducteur: {
      nom: "Dupont", prenom: "Jean", email: "jean@example.com",
      telephone: "0600000000", naissance: "1990-06-15", permisDate: "2012-06-15"
    },
    idempotencyKey: "cle-test-protection",
    cglAccepted: true,
    cglVersion: data.CGL_VERSION,
    langue: "fr",
    ...extra
  };
}

test("validateReservationInput : accepte les quatre formules et retient celle demandée", () => {
  PROTECTIONS.forEach((protection) => {
    const resultat = validateReservationInput(entreeValide({ protection: protection.id }));
    assert.deepEqual(resultat.errors, [], `formule refusée : ${protection.id}`);
    assert.equal(resultat.protection, protection.id);
  });
});

test("validateReservationInput : protection absente => formule incluse, protection inventée => refus", () => {
  const sansProtection = validateReservationInput(entreeValide());
  assert.deepEqual(sansProtection.errors, []);
  assert.equal(sansProtection.protection, PROTECTION_PAR_DEFAUT);

  ["franchise-zero", "SERENITE", { id: "serenite" }, 7].forEach((valeur) => {
    const resultat = validateReservationInput(entreeValide({ protection: valeur }));
    assert.ok(
      resultat.errors.includes("Niveau de protection invalide"),
      `un identifiant fabriqué doit être refusé, pas corrigé en silence : ${JSON.stringify(valeur)}`
    );
  });
});

// ---------------------------------------------------------------------
// 4. Contrat PDF : protection, franchise et dépôt de garantie distincts
// ---------------------------------------------------------------------

const dataJsSource = fs.readFileSync(path.join(__dirname, "..", "js", "data.js"), "utf8");
const contratEnSource = fs.readFileSync(path.join(__dirname, "..", "js", "contrat-en.js"), "utf8");
const contratHtml = fs.readFileSync(path.join(__dirname, "..", "contrat.html"), "utf8");

function corpsScriptContrat() {
  const apresDataJs = contratHtml.indexOf("js/data.js");
  const debutBalise = contratHtml.indexOf("<script>", apresDataJs);
  const debut = debutBalise + "<script>".length;
  const fin = contratHtml.indexOf("var params = new URLSearchParams", debut);
  assert.ok(fin !== -1, "structure de contrat.html changée ?");
  return contratHtml.slice(debut, fin);
}

function fauxJsPdf(journal) {
  return function () {
    let page = 1, pages = 1, taille = 10;
    return {
      internal: { pageSize: { getWidth: () => 595.28, getHeight: () => 841.89 }, getNumberOfPages: () => pages },
      setFont() {}, setTextColor() {}, setDrawColor() {}, setFillColor() {},
      setLineWidth() {}, setCharSpace() {},
      line() {}, rect() {}, roundedRect() {}, ellipse() {}, addImage() {},
      getImageProperties: () => ({ width: 700, height: 150 }),
      setFontSize(t) { taille = t; },
      getTextWidth(texte) { return String(texte).length * taille * 0.5; },
      splitTextToSize(texte) { return [String(texte)]; },
      text(txt, x, y) {
        (Array.isArray(txt) ? txt : [txt]).forEach((v) => journal.push({ page, x, y, texte: String(v) }));
      },
      addPage() { pages += 1; page = pages; },
      setPage(n) { page = n; }
    };
  };
}

const formulaireAgence = {
  vehiculeId: VEHICULE,
  immat: "HK-085-LQ",
  lieu: "Agence GETLOCATION — Grasse",
  depart: "2026-10-05T10:00",
  retour: "2026-10-10T10:00",
  modeCaution: "carte", modePaiement: "carte", modePaiementSolde: "carte",
  acompteRegle: true, soldeRegle: false, montantRegle: "100",
  prenom: "Ildiko", nom: "Wiecherink", naissance: "17/08/1984",
  adresse: "12 avenue des Palmiers", codePostal: "06130", ville: "Grasse",
  tel: "06 26 79 39 01", email: "ildiko@example.com", permis: "060087612",
  secondConducteur: false, livraison: false, notes: "", remarques: "",
  etatDepart: { marks: [], observations: "" },
  etatRetour: { marks: [], observations: "" }
};

function contratPdf(surcharges = {}) {
  const journal = [];
  const dom = new JSDOM(contratHtml, { url: "https://getlocation.fr/contrat.html", runScripts: "outside-only" });
  const win = dom.window;
  win.jspdf = { jsPDF: fauxJsPdf(journal) };
  win.eval(dataJsSource);
  win.eval(contratEnSource);
  win.eval(corpsScriptContrat());
  win.livrerPDF = function () {};
  const payload = win.construirePayload({ ...formulaireAgence, ...surcharges }, null, null);
  win.genererPDF(payload, false);
  dom.window.close();
  return { journal, payload, tout: journal.map((e) => e.texte).join("\n") };
}

test("contrat PDF : niveau de protection, franchise et dépôt de garantie sont trois informations distinctes", () => {
  const { tout, journal, payload } = contratPdf({ protection: "serenite" });

  assert.match(tout, /NIVEAU DE PROTECTION/);
  assert.match(tout, /FRANCHISE \//);
  assert.match(tout, /RESPONSABILITÉ MAXIMALE/);
  assert.match(tout, /DÉPÔT DE GARANTIE/);

  // Les trois valeurs figurent bien, et ne sont pas confondues : la
  // franchise vient de la formule, le dépôt du véhicule.
  assert.equal(payload.protection.id, "serenite");
  assert.equal(payload.protection.franchise, 750);
  assert.ok(journal.some((e) => e.texte === "Serenity" || e.texte === "Sérénité"), "nom de la formule absent");
  assert.ok(journal.some((e) => memeMontant(e.texte, "750 €")), "franchise de la formule absente");
  assert.ok(journal.some((e) => memeMontant(e.texte, payload.caution)), "dépôt de garantie absent");
  assert.equal(memeMontant(payload.caution, "750 €"), false, "le dépôt ne doit pas être confondu avec la franchise");

  // Chacune sur sa propre colonne : trois abscisses différentes.
  const abscisse = (fragment) => journal.find((e) => e.texte.startsWith(fragment)).x;
  const colonnes = [abscisse("NIVEAU DE PROTECTION"), abscisse("FRANCHISE"), abscisse("DÉPÔT DE GARANTIE")];
  assert.equal(new Set(colonnes).size, 3, "les trois informations doivent occuper trois colonnes distinctes");
});

test("contrat PDF : la protection payante figure comme ligne de prix, la formule incluse non", () => {
  const payante = contratPdf({ protection: "serenite-plus" });
  const ligne = payante.payload.syntheseFinanciere.options.find((o) => /Sérénité\+/.test(o.nom));
  assert.ok(ligne, "la protection payante doit apparaître dans le détail des prix");
  assert.equal(ligne.montant, 100); // 5 jours × 20 €

  const incluse = contratPdf({ protection: "essentiel" });
  assert.equal(
    incluse.payload.syntheseFinanciere.options.some((o) => /Essentiel/.test(o.nom)),
    false,
    "une protection gratuite ne doit pas créer une ligne à 0 €"
  );
  // Elle reste néanmoins affichée dans le bloc protection/garantie.
  assert.match(incluse.tout, /NIVEAU DE PROTECTION/);
  assert.equal(incluse.payload.protection.franchise, 2000);
});

test("contrat PDF : total = location + options + protection, sans double comptage", () => {
  const { payload } = contratPdf({ protection: "serenite" });
  const synthese = payload.syntheseFinanciere;
  const sommeOptions = synthese.options.reduce((total, o) => total + o.montant, 0);
  assert.equal(synthese.location + sommeOptions, synthese.totalLocation);
});

test("contrat PDF anglais : la formule porte son nom anglais, la franchise le sien", () => {
  const { tout } = contratPdf({ protection: "serenite", langueClient: "en" });
  assert.match(tout, /PROTECTION LEVEL/);
  assert.match(tout, /EXCESS \//);
  assert.match(tout, /MAXIMUM LIABILITY/);
  assert.ok(tout.includes("Serenity"), "le nom de la formule doit être traduit");
  assert.equal(/NIVEAU DE PROTECTION/.test(tout), false, "aucun intitulé français sur le contrat anglais");
});

// ---------------------------------------------------------------------
// 5. Compatibilité : rien n'est recalculé rétroactivement
// ---------------------------------------------------------------------

test("statut public d'une réservation d'avant les protections : protection nulle, total inchangé", async () => {
  const { createFakeKv } = require("./helpers/fake-kv.js");
  const { handleReservationStatus } = require("../src/api/reservation-status.js");
  const { createReservation } = require("../src/lib/reservation-store.js");

  const env = { RESERVATIONS_KV: createFakeKv(), RATE_LIMITS_KV: createFakeKv() };
  // Dossier tel qu'il a été enregistré à l'époque : ni protection, ni
  // supplément jeune conducteur, ces champs n'existaient pas.
  const ancienne = await createReservation(env, {
    vehiculeId: VEHICULE,
    dateDebut: "2026-03-01", heureDebut: "10:00",
    dateFin: "2026-03-03", heureFin: "10:00",
    jours: 2, sousTotalBrut: 118, options: [], optionsMontant: 0, total: 118,
    conducteur: { nom: "Ancien", prenom: "Client", email: "ancien@example.com" }
  });

  const requete = new Request(`https://getlocation.fr/api/reservation-status?id=${ancienne.id}`, {
    headers: { origin: "https://getlocation.fr", "cf-connecting-ip": "198.51.100.77" }
  });
  const vue = await (await handleReservationStatus(requete, env)).json();

  assert.equal(vue.protection, null, "aucune protection inventée après coup");
  assert.equal(vue.supplementJeuneConducteur, null);
  assert.equal(vue.total, 118, "le total enregistré fait foi, jamais recalculé avec la grille du jour");
});

test("contrat établi pour une réservation sans protection : repli sur la formule incluse, jamais un supplément", () => {
  const { payload } = contratPdf({ protection: undefined });
  assert.equal(payload.protection.id, PROTECTION_PAR_DEFAUT);
  assert.equal(payload.protection.montant, 0);
  assert.equal(
    payload.syntheseFinanciere.options.some((o) => /protection/i.test(o.nom)),
    false,
    "aucune ligne de protection facturée sans choix explicite"
  );
});

// ---------------------------------------------------------------------
// 6. Formulaire agence : un contrat au comptoir facture comme le site
// ---------------------------------------------------------------------

test("formulaire agence : la protection est un champ du contrat, lu, enregistré et rechargé", () => {
  // Le sélecteur existe et la liste est construite depuis js/data.js, jamais
  // recopiée à la main dans le HTML (règle n°1).
  assert.match(contratHtml, /<select id="protection"><\/select>/);
  assert.match(contratHtml, /getProtections\(\)\.forEach/);

  // Il est lu avec le reste du formulaire…
  assert.match(contratHtml, /protection: selectProtection \? selectProtection\.value : getProtectionParDefaut\(\)/);
  // …et rechargé à la réouverture comme à la duplication d'un contrat, avec
  // repli sur la formule incluse pour un contrat d'avant les protections.
  assert.match(contratHtml, /estProtectionConnue\(rawData\.protection\)/);
  assert.match(contratHtml, /estProtectionConnue\(prefill\.protection\)/);
});

test("formulaire agence : la protection survit à l'encodage du lien de contrat (réouverture, duplication)", () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { runScripts: "outside-only" });
  const win = dom.window;
  win.eval(dataJsSource);
  win.eval(corpsScriptContrat());

  const donnees = { ...formulaireAgence, protection: "serenite-plus", siegeEnfant: true, rehausseur: false };
  const relu = win.decodeData(win.encodeData(donnees));
  assert.equal(relu.protection, "serenite-plus");
  assert.equal(relu.siegeEnfant, true);
  dom.window.close();
});

test("contrat agence : la protection choisie au comptoir change le total facturé", () => {
  const incluse = contratPdf({ protection: "essentiel" });
  const payante = contratPdf({ protection: "serenite" });
  // 5 jours : Sérénité = 5 × 12 €.
  assert.equal(payante.payload.syntheseFinanciere.totalLocation - incluse.payload.syntheseFinanciere.totalLocation, 60);
});

test("contrat anglais : chaque formule a son libellé de ligne de prix traduit", () => {
  // syntheseFinancierePdf() compose « Protection <nom> » ; le contrat anglais
  // traduit ce libellé entier. Une formule ajoutée sans son entrée ici
  // ressortirait en français sur un contrat anglais.
  const contratEn = require("../js/contrat-en.js");
  PROTECTIONS.forEach((protection) => {
    const cle = `Protection ${protection.nom}`;
    assert.ok(contratEn.TEXTES[cle], `traduction manquante pour « ${cle} » dans js/contrat-en.js`);
  });
});
