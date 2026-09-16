// tests/contrat-pdf-structure.test.js
//
// Structure du contrat PDF après la refonte visuelle du 12/09/2026 :
//   page 1 SYNTHÈSE (locataire, véhicule, location, tarification, garantie),
//   page 2 CONDITIONS (articles, déclaration, signatures),
//   page 3 ANNEXE (état des lieux).
// Ces tests protègent ce que la refonte devait garantir : l'ordre et la
// présence des sections, la hiérarchie des montants (TOTAL LOCATION puis
// RESTE À PAYER), la séparation du dépôt de garantie, l'absence de
// caractères corrompus et la confidentialité des notes internes.
//
// jsPDF n'est pas une dépendance du projet (il est chargé depuis un CDN par
// le navigateur) : le moteur PDF est donc remplacé ici par un enregistreur
// qui note simplement chaque texte écrit et sur quelle page — suffisant pour
// vérifier la structure, sans rien installer.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const dataJsSource = fs.readFileSync(path.join(__dirname, "..", "js", "data.js"), "utf8");
const contratEnSource = fs.readFileSync(path.join(__dirname, "..", "js", "contrat-en.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "..", "contrat.html"), "utf8");

function extractScriptBody() {
  const afterDataJs = html.indexOf("js/data.js");
  const openTag = html.indexOf("<script>", afterDataJs);
  const bodyStart = openTag + "<script>".length;
  const bodyEnd = html.indexOf("var params = new URLSearchParams", bodyStart);
  assert.ok(bodyEnd !== -1, "Marqueur d'auto-init introuvable (structure de contrat.html changée ?)");
  return html.slice(bodyStart, bodyEnd);
}

// Faux moteur PDF : même surface d'API que jsPDF pour ce que genererPDF
// utilise, mais il se contente d'enregistrer les textes écrits.
function createFauxJsPdf(journal) {
  const LARGEUR = 595.28, HAUTEUR = 841.89;
  return function () {
    let pageCourante = 1;
    let pages = 1;
    let taillePolice = 10;
    const doc = {
      internal: {
        pageSize: { getWidth: () => LARGEUR, getHeight: () => HAUTEUR },
        getNumberOfPages: () => pages
      },
      setFont() {}, setTextColor() {}, setDrawColor() {}, setFillColor() {},
      setLineWidth() {}, setCharSpace() {},
      line() {}, rect() {}, roundedRect() {}, ellipse() {}, addImage() {},
      getImageProperties: () => ({ width: 700, height: 150 }),
      setFontSize(t) { taillePolice = t; },
      getTextWidth(texte) { return String(texte).length * taillePolice * 0.5; },
      splitTextToSize(texte, largeur) {
        const parMot = String(texte).split(/\s+/).filter(Boolean);
        const maxCaracteres = Math.max(8, Math.floor(largeur / (taillePolice * 0.5)));
        const lignes = [];
        let courante = "";
        parMot.forEach((mot) => {
          const essai = courante ? courante + " " + mot : mot;
          if (essai.length > maxCaracteres && courante) { lignes.push(courante); courante = mot; }
          else { courante = essai; }
        });
        if (courante) lignes.push(courante);
        return lignes.length ? lignes : [""];
      },
      text(txt, x, y) {
        (Array.isArray(txt) ? txt : [txt]).forEach((v) => journal.push({ page: pageCourante, x, y, texte: String(v) }));
      },
      addPage() { pages += 1; pageCourante = pages; },
      setPage(n) { pageCourante = n; }
    };
    return doc;
  };
}

const donneesBase = {
  vehiculeId: "peugeot-3008",
  immat: "HK-085-LQ",
  lieu: "Agence GETLOCATION — Grasse",
  depart: "2026-09-11T20:30",
  retour: "2026-09-16T20:30",
  modeCaution: "carte",
  modePaiement: "carte",
  montantRegle: "50",
  acompteRegle: true,
  modePaiementSolde: "especes",
  soldeRegle: false,
  prenom: "Ildiko",
  nom: "Wiecherink",
  naissance: "17/08/1984",
  adresse: "12 avenue des Palmiers",
  codePostal: "06130",
  ville: "Grasse",
  tel: "06 26 79 39 01",
  email: "ildiko@example.com",
  permis: "060087612",
  secondConducteur: false,
  livraison: false,
  notes: "NOTE INTERNE confidentielle agence",
  remarques: "",
  etatDepart: { marks: [], observations: "" },
  etatRetour: { marks: [], observations: "" }
};

function genererJournal(surcharges = {}, { estApercu = false, payloadExtra = {} } = {}) {
  const journal = [];
  const dom = new JSDOM(html, { url: "https://getlocation.fr/contrat.html", runScripts: "outside-only" });
  const win = dom.window;
  win.jspdf = { jsPDF: createFauxJsPdf(journal) };
  win.eval(dataJsSource);
  win.eval(contratEnSource);
  win.eval(extractScriptBody());
  win.livrerPDF = function () {};
  const payload = win.construirePayload({ ...donneesBase, ...surcharges }, null, null);
  Object.assign(payload, payloadExtra);
  win.genererPDF(payload, estApercu);
  dom.window.close();
  return journal;
}

function pageDe(journal, debutTexte) {
  const trouve = journal.find((e) => e.texte.startsWith(debutTexte));
  assert.ok(trouve, `Texte introuvable dans le PDF : « ${debutTexte} »`);
  return trouve.page;
}
function contient(journal, fragment) {
  return journal.some((e) => e.texte.includes(fragment));
}

test("page 1 : les cinq sections de synthèse y figurent, le locataire en premier", () => {
  const journal = genererJournal();
  const ordre = ["LOCATAIRE / CONDUCTEUR PRINCIPAL", "VÉHICULE", "LOCATION", "TARIFICATION", "PROTECTION ET GARANTIE"];
  ordre.forEach((titre) => assert.equal(pageDe(journal, titre), 1, `${titre} doit être sur la page 1`));

  const positions = ordre.map((titre) => journal.findIndex((e) => e.texte.startsWith(titre)));
  assert.deepEqual(positions.slice().sort((a, b) => a - b), positions, "les sections doivent se suivre dans cet ordre");
});

test("page 1 : les huit informations que le client doit saisir en 10 secondes sont présentes", () => {
  const journal = genererJournal();
  const page1 = journal.filter((e) => e.page === 1).map((e) => e.texte).join(" | ");
  assert.match(page1, /Ildiko Wiecherink/);          // qui
  assert.match(page1, /Peugeot 3008/);               // quel véhicule
  assert.match(page1, /HK-085-LQ/);
  assert.match(page1, /11 septembre 2026/);          // quand
  assert.match(page1, /16 septembre 2026/);
  assert.match(page1, /Agence GETLOCATION/);         // où
  assert.match(page1, /TOTAL LOCATION/);             // combien
  assert.match(page1, /Acompte déjà réglé/);         // déjà payé
  assert.match(page1, /RESTE À PAYER/);              // reste à payer
  assert.match(page1, /DÉPÔT DE GARANTIE/);          // garantie
});

test("tarification : prix de location + options retenues, aucun détail de calcul interne", () => {
  // Le client lit le prix convenu, pas la façon dont l'agence y est arrivée.
  const journal = genererJournal({ codePromo: "BIENVENUE20" });
  ["Sous-total", "Réduction durée (", "Remises", "Ajustement tarif"].forEach((interdit) => {
    assert.ok(!contient(journal, interdit), `« ${interdit} » ne doit jamais figurer sur le contrat client`);
  });
});

test("tarif manuel : la ligne Location porte directement le prix convenu", () => {
  // Cas H de la recette : tarif spécial fixé par l'agence, sans option.
  const journal = genererJournal({ tarifManuel: true, montantFinalConvenu: "711", secondConducteur: false, livraison: false });
  const location = journal.find((e) => e.texte.startsWith("Location —"));
  const total = journal.find((e) => e.texte.startsWith("TOTAL LOCATION"));
  const montantApres = (entree) => journal[journal.indexOf(entree) + 1].texte;

  assert.ok(location, "la ligne Location doit exister");
  assert.match(montantApres(location), /711/, "la ligne Location porte le prix convenu");
  assert.match(montantApres(total), /711/);
  assert.ok(!contient(journal, "Ajustement"), "aucune ligne d'ajustement sur le document client");
});

test("tarif manuel avec option : location ajustée, option détaillée, total correct", () => {
  // Cas I de la recette. L'option reste visible à son montant réel ; c'est
  // la ligne Location qui absorbe l'écart avec le tarif théorique.
  const journal = genererJournal({ tarifManuel: true, montantFinalConvenu: "711", rehausseur: true });
  const montantApres = (debut) => {
    const entree = journal.find((e) => e.texte.startsWith(debut));
    assert.ok(entree, `ligne « ${debut} » absente`);
    return journal[journal.indexOf(entree) + 1].texte;
  };
  const nombre = (texte) => Number(texte.replace(/[^\d,.-]/g, "").replace(",", "."));

  const location = nombre(montantApres("Location —"));
  const option = nombre(montantApres("Rehausseur"));
  assert.equal(Math.round((location + option) * 100) / 100, 711, "location + option doit faire le total convenu");
  assert.match(montantApres("TOTAL LOCATION"), /711/);
});

test("aucune option retenue : pas de ligne « Options » vide", () => {
  // Cas J de la recette.
  const journal = genererJournal({ secondConducteur: false, livraison: false, kmForfait: "" });
  assert.ok(!contient(journal, "Options"), "aucune ligne générique « Options » quand rien n'est retenu");
});

test("tarification : le dépôt de garantie n'est jamais mêlé au récapitulatif du prix", () => {
  const journal = genererJournal();
  const indexTotal = journal.findIndex((e) => e.texte.startsWith("TOTAL LOCATION"));
  const indexReste = journal.findIndex((e) => e.texte.startsWith("RESTE À PAYER"));
  const indexGarantie = journal.findIndex((e) => e.texte.startsWith("PROTECTION ET GARANTIE"));
  assert.ok(indexTotal < indexReste, "le total doit précéder le reste à payer");
  assert.ok(indexReste < indexGarantie, "la garantie vient après l'état du règlement, dans son propre bloc");
  assert.ok(contient(journal, "ne constitue pas un paiement de la location"));
});

test("aucun caractère corrompu : les montants retranchés utilisent le tiret ASCII, jamais U+2212", () => {
  const journal = genererJournal({ codePromo: "BIENVENUE20" });
  journal.forEach((e) => {
    assert.ok(!e.texte.includes("−"), `signe moins typographique interdit dans le PDF : « ${e.texte} »`);
  });
  assert.ok(journal.some((e) => /^-\d/.test(e.texte)), "les remises doivent s'afficher avec un tiret ASCII");
});

test("mention « aperçu » : uniquement en aperçu, jamais sur un contrat officiel", () => {
  const apercu = genererJournal({}, { estApercu: true });
  assert.ok(contient(apercu, "APERÇU — DOCUMENT NON CONTRACTUEL"));

  const officiel = genererJournal({}, { estApercu: false, payloadExtra: { numero: "GL-20260912-0001" } });
  assert.ok(!contient(officiel, "non contractuel"), "un contrat officiel n'est jamais un aperçu");
  assert.ok(contient(officiel, "EN ATTENTE DE SIGNATURE DU LOCATAIRE"));
  assert.ok(contient(officiel, "N° GL-20260912-0001"), "le numéro de contrat doit être visible en en-tête");
});

test("conducteur supplémentaire : aucun bloc vide quand il n'y en a pas", () => {
  const sans = genererJournal();
  assert.ok(!contient(sans, "Conducteur supplémentaire"));

  const avec = genererJournal({ secondConducteur: true, prenom2: "Marc", nom2: "Wiecherink", permis2: "060087613" });
  assert.ok(contient(avec, "CONDUCTEUR SUPPLÉMENTAIRE"));
  assert.ok(contient(avec, "Marc Wiecherink"));
});

test("remarques particulières : affichées seulement si renseignées, retours à la ligne conservés", () => {
  const sans = genererJournal();
  assert.ok(!contient(sans, "Remarques particulières"));

  const avec = genererJournal({ remarques: "Première ligne de remarque.\nSeconde ligne de remarque." });
  assert.ok(contient(avec, "Remarques particulières"));
  // Chaque suite de mots de même graisse est écrite d'un seul tenant (voir
  // viderLigne) : le retour à la ligne se vérifie sur la position, la
  // seconde ligne saisie repartant de la marge, sous la première.
  const premiere = avec.find((e) => e.texte.startsWith("Première ligne de remarque"));
  const seconde = avec.find((e) => e.texte.startsWith("Seconde ligne de remarque"));
  assert.ok(premiere && seconde, "les deux lignes de remarque doivent être imprimées");
  assert.equal(seconde.x, premiere.x, "la seconde ligne saisie doit repartir de la marge");
  assert.ok(seconde.y > premiere.y, "la seconde ligne saisie doit être imprimée sous la première");
});

test("notes internes : jamais imprimées sur le contrat remis au client", () => {
  const journal = genererJournal();
  assert.ok(!contient(journal, "NOTE INTERNE"), "les notes internes de l'agence ne doivent jamais figurer dans le PDF");
});

test("conditions, déclaration et signatures viennent après la synthèse, l'état des lieux en annexe dédiée", () => {
  const journal = genererJournal();
  assert.ok(pageDe(journal, "PRINCIPALES CONDITIONS DE LOCATION") >= 2);
  assert.ok(pageDe(journal, "DÉCLARATION DU LOCATAIRE") >= 2);
  assert.ok(pageDe(journal, "SIGNATURES") >= 2);
  const pageAnnexe = pageDe(journal, "ANNEXE — ÉTAT DES LIEUX");
  assert.ok(pageAnnexe > pageDe(journal, "SIGNATURES"), "l'annexe doit venir après les signatures, sur sa propre page");
  assert.ok(contient(journal, "Cette annexe fait partie intégrante"));
  // L'annexe commence bien en haut d'une page (aucun texte au-dessus d'elle).
  const premierDeLAnnexe = journal.find((e) => e.page === pageAnnexe);
  assert.match(premierDeLAnnexe.texte, /ANNEXE/);
});

test("articles des conditions : numéro et intitulé séparés pour être repérables", () => {
  const journal = genererJournal();
  assert.ok(contient(journal, "ARTICLE 1"));
  assert.ok(contient(journal, "Objet et durée"));
  assert.ok(!contient(journal, "Article 1 — Objet et durée"), "le titre brut doit être scindé en deux niveaux");
});

test("pied de page : numéro de contrat, pagination et identité légale sur chaque page", () => {
  const journal = genererJournal({}, { payloadExtra: { numero: "GL-20260912-0001" } });
  const pages = Math.max(...journal.map((e) => e.page));
  for (let p = 1; p <= pages; p++) {
    const textesPage = journal.filter((e) => e.page === p).map((e) => e.texte);
    assert.ok(textesPage.some((t) => t.includes("Contrat GL-20260912-0001")), `pied de page manquant page ${p}`);
    assert.ok(textesPage.some((t) => t === `Page ${p} / ${pages}`), `pagination manquante page ${p}`);
    assert.ok(textesPage.some((t) => t.includes("SIRET")), `identité légale manquante page ${p}`);
  }
});

test("synthèse financière : location + options = total, sans recalcul", () => {
  const dom = new JSDOM(html, { url: "https://getlocation.fr/contrat.html", runScripts: "outside-only" });
  dom.window.eval(dataJsSource);
  dom.window.eval(contratEnSource);
  dom.window.eval(extractScriptBody());
  const payload = dom.window.construirePayload({ ...donneesBase, codePromo: "BIENVENUE20" }, null, null);
  const s = payload.syntheseFinanciere;
  assert.equal(Math.round((s.location + s.optionsMontant) * 100) / 100, s.totalLocation);
  assert.equal(Math.round((s.totalLocation - s.dejaRegle) * 100) / 100, s.resteAPayer);
  // Le détail interne reste disponible pour l'historique, mais n'entre pas
  // dans l'addition présentée au client.
  assert.ok(typeof s.tarifTheorique === "number");
  assert.ok(Array.isArray(s.remises));
  dom.window.close();
});

// --- Contrat établi en anglais -------------------------------------------
//
// Le contrat est traduit en entier, avec en tête de ses conditions un
// avertissement disant que la version française est la seule qui fasse foi
// (voir js/contrat-en.js). Les chiffres, eux, sont écrits à l'identique dans
// les deux versions.

test("contrat anglais : intitulés, articles et déclaration traduits", () => {
  const journal = genererJournal({ langueClient: "en" });
  const tout = journal.map((e) => e.texte).join(" | ");

  ["RENTAL AGREEMENT", "RENTER / MAIN DRIVER", "VEHICLE", "PRICING", "RENTAL TOTAL",
   "BALANCE DUE", "SECURITY DEPOSIT", "MAIN RENTAL CONDITIONS", "RENTER'S DECLARATION",
   "SIGNATURES", "APPENDIX — VEHICLE CONDITION REPORT"].forEach((intitule) => {
    assert.ok(tout.includes(intitule), `intitulé anglais manquant : ${intitule}`);
  });

  // Les six articles sont là, en anglais.
  ["Subject and term", "Price and payment", "Mileage and fuel",
   "Security deposit and insurance", "Return, late return and incidents",
   "Acceptance of the General Rental Conditions"].forEach((titre) => {
    assert.ok(tout.includes(titre), `article anglais manquant : ${titre}`);
  });

  assert.ok(tout.includes("By signing this agreement, the renter declares"), "déclaration non traduite");
});

test("contrat anglais : plus aucun intitulé français imprimé", () => {
  const journal = genererJournal({ langueClient: "en" });
  // Intitulés du contrat français qui ne doivent plus apparaître. Le texte
  // libre saisi par l'agence (remarques, observations) reste en revanche tel
  // qu'il a été écrit — il n'est jamais traduit automatiquement.
  const intitulesFrancais = [
    "CONTRAT DE LOCATION", "LOCATAIRE / CONDUCTEUR PRINCIPAL", "VÉHICULE", "TARIFICATION",
    "TOTAL LOCATION", "RESTE À PAYER", "PROTECTION ET GARANTIE", "PRINCIPALES CONDITIONS DE LOCATION",
    "DÉCLARATION DU LOCATAIRE", "ANNEXE — ÉTAT DES LIEUX DU VÉHICULE",
    "Objet et durée", "Prix et règlement", "Kilométrage et carburant"
  ];
  const restes = intitulesFrancais.filter((intitule) => journal.some((e) => e.texte.includes(intitule)));
  assert.deepEqual(restes, [], "ces intitulés français figurent encore sur le contrat anglais");
});

test("contrat anglais : avertissement de traduction en tête des conditions", () => {
  const journal = genererJournal({ langueClient: "en" });
  const avertissement = journal.find((e) => e.texte.includes("only legally binding version"));
  assert.ok(avertissement, "l'avertissement de traduction doit figurer sur le contrat");
  assert.equal(avertissement.page, pageDe(journal, "MAIN RENTAL CONDITIONS"),
    "l'avertissement doit précéder les conditions, là où il concerne le texte engageant");
  assert.ok(contient(journal, "IMPORTANT — ENGLISH TRANSLATION".toUpperCase()) ||
    journal.some((e) => /IMPORTANT/i.test(e.texte)), "le titre de l'avertissement doit être visible");
});

test("contrat français : aucun mot anglais ajouté", () => {
  const journal = genererJournal();
  assert.equal(journal.some((e) => /legally binding|RENTAL AGREEMENT/.test(e.texte)), false,
    "un contrat français ne doit porter aucune mention anglaise");
  assert.ok(contient(journal, "LOCATAIRE / CONDUCTEUR PRINCIPAL"));
});

test("la version anglaise n'ajoute aucune page et ne change aucun chiffre", () => {
  const journalFr = genererJournal();
  const journalEn = genererJournal({ langueClient: "en" });

  assert.equal(
    Math.max(...journalEn.map((e) => e.page)),
    Math.max(...journalFr.map((e) => e.page)),
    "la traduction ne doit pas ajouter de page"
  );

  // Montants et kilométrages : écrits à l'identique des deux côtés. Une
  // valeur qui se lirait différemment sur les deux documents serait
  // exactement l'erreur que l'avertissement de traduction doit éviter.
  // On compare les VALEURS elles-mêmes, extraites du texte complet : la
  // ponctuation, elle, diffère légitimement (l'anglais ne met pas d'espace
  // avant les deux-points).
  const valeurs = (journal) => {
    const tout = journal.map((e) => e.texte).join(" ");
    const montants = tout.match(/\d[\d\s\u00a0\u202f]*(?:,\d+)?\s?€/g) || [];
    const kilometres = tout.match(/\d[\d\s\u00a0\u202f]*\s?km/g) || [];
    return montants.concat(kilometres).map((v) => v.replace(/[\s\u00a0\u202f]/g, "")).sort();
  };
  assert.deepEqual(valeurs(journalEn), valeurs(journalFr), "les montants ou kilométrages diffèrent entre les deux versions");
});
