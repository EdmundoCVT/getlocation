// tests/i18n-couverture.test.js
//
// Filet de sécurité de la version anglaise (/en/, voir js/i18n.js) : le
// site reste écrit en français dans les fichiers HTML, la traduction étant
// indexée par le texte français lui-même. Ce test échoue donc dès qu'un
// texte visible d'une page client n'a pas de traduction — que ce soit parce
// qu'on a ajouté du contenu sans le traduire, ou parce qu'on a modifié une
// phrase française déjà traduite (la clé ne correspond alors plus).
//
// Les pages juridiques (CGL, mentions légales, confidentialité) sont
// volontairement exclues : leur corps reste en français, seule version
// faisant foi, et les pages anglaises affichent la mention correspondante.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const i18n = require("../js/i18n.js");

const racine = path.join(__dirname, "..");

// Textes qui n'ont pas à être traduits : noms propres, marques, modèles de
// véhicules, coordonnées, symboles.
const SANS_TRADUCTION = new Set([
  "GETLOCATION", "WhatsApp", "💬 WhatsApp", "Mollie", "getlocation.fr", "Google Maps",
  "Grasse", "Nice", "Cannes", "Antibes", "Monaco", "TLST SAS",
  "Opel Corsa Business 1.2T", "Peugeot 2008 Hybrid", "Peugeot 3008", "Toyota Proace Medium",
  "SUV", "✉️ contact@getlocation.fr",
  "GETLOCATION — TLST SAS · SIRET 932 098 908 00019 ·"
]);

function textesVisibles(fichier) {
  const dom = new JSDOM(fs.readFileSync(path.join(racine, fichier), "utf8"));
  const { document, NodeFilter } = dom.window;
  const trouves = [];
  const parcours = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let noeud;
  while ((noeud = parcours.nextNode())) {
    if (noeud.parentElement.closest("script,style,noscript")) continue;
    const texte = noeud.textContent.trim();
    if (texte && /[A-Za-zÀ-ÿ]/.test(texte)) trouves.push(texte);
  }
  document.querySelectorAll("[placeholder],[aria-label],[title],[alt],[data-empty]").forEach((el) => {
    ["placeholder", "aria-label", "title", "alt", "data-empty"].forEach((attribut) => {
      const valeur = (el.getAttribute(attribut) || "").trim();
      if (valeur && /[A-Za-zÀ-ÿ]{3}/.test(valeur)) trouves.push(valeur);
    });
  });
  dom.window.close();
  return trouves;
}

const pagesATraduire = i18n.PAGES.filter((page) => i18n.PAGES_JURIDIQUES.indexOf(page) === -1);

test("chaque texte visible des pages client a une traduction anglaise", () => {
  const manquants = new Map();
  pagesATraduire.forEach((page) => {
    textesVisibles(page).forEach((texte) => {
      if (SANS_TRADUCTION.has(texte)) return;
      if (i18n.TRADUCTIONS[texte] !== undefined) return;
      if (!manquants.has(texte)) manquants.set(texte, page);
    });
  });
  assert.deepEqual(
    [...manquants].map(([texte, page]) => `${page} : ${texte}`),
    [],
    "textes sans traduction anglaise (à ajouter dans js/i18n.js)"
  );
});

// Les textes commerciaux (options, lieux, paliers de remise, descriptions de
// véhicules) ne vivent PAS dans les fichiers HTML mais dans js/data.js, seule
// source de vérité (règle n°1 du CLAUDE.md) : js/app.js les insère dans la
// page à l'exécution. Le test ci-dessus, qui ne lit que le HTML, ne les voyait
// donc pas — c'est ainsi que le tunnel de réservation s'est retrouvé en
// français sur la version anglaise (options, « Livraison du véhicule »…).
test("chaque texte de js/data.js affiché au client a une traduction anglaise", () => {
  const data = require("../js/data.js");
  const aTraduire = [];

  data.OPTIONS.forEach((option) => aTraduire.push(option.nom, option.description));
  data.LIEUX.forEach((lieu) => aTraduire.push(lieu));
  data.REDUCTIONS_DUREE.forEach((palier) => aTraduire.push(palier.libelle));
  data.VEHICULES.forEach((vehicule) => aTraduire.push(vehicule.description));
  // Libellés des filtres du catalogue.
  [data.FAMILLES_VEHICULE, data.TYPES_VOITURE, data.CARBURANTS].forEach((groupe) => {
    (groupe || []).forEach((entree) => aTraduire.push(entree.label));
  });
  (data.CATEGORIES || []).forEach((categorie) => aTraduire.push(categorie));

  const manquants = aTraduire.filter(
    (texte) => texte && !SANS_TRADUCTION.has(texte) && i18n.TRADUCTIONS[texte] === undefined
  );
  assert.deepEqual(manquants, [], "textes de js/data.js sans traduction anglaise (à ajouter dans js/i18n.js)");
});

// Les descriptions des codes promo sont reconstruites par js/app.js à partir
// des champs structurés (pourcentage / montant) : ce sont ces modèles-là qui
// doivent exister, pas une entrée par code promo.
test("les remises promo sont traduites par modèle, pas code par code", () => {
  const data = require("../js/data.js");
  assert.ok(i18n.MODELES["{pourcentage} % de réduction"], "modèle de remise en pourcentage manquant");
  assert.ok(i18n.MODELES["{montant} € de réduction"], "modèle de remise en euros manquant");

  // Le français reconstruit doit rester mot pour mot celui de js/data.js,
  // sinon l'affichage français changerait sans qu'on s'en aperçoive.
  Object.keys(data.CODES_PROMO).forEach((code) => {
    const promo = data.CODES_PROMO[code];
    const reconstruit = promo.pourcentage !== undefined
      ? `${promo.pourcentage} % de réduction`
      : `${promo.montant} € de réduction`;
    assert.equal(reconstruit, promo.description, `libellé promo divergent pour ${code}`);
  });
});

test("les pages juridiques n'ont que leur en-tête traduit : leur corps reste en français", () => {
  // Le corps des CGL/mentions/confidentialité ne doit JAMAIS se retrouver
  // dans le dictionnaire : la version française est la seule qui fasse foi.
  const clausesJuridiques = i18n.PAGES_JURIDIQUES.flatMap((page) =>
    textesVisibles(page).filter((texte) => texte.length > 200)
  );
  assert.ok(clausesJuridiques.length > 0, "les pages juridiques doivent bien contenir des clauses longues");
  clausesJuridiques.forEach((clause) => {
    assert.equal(i18n.TRADUCTIONS[clause], undefined, "une clause juridique ne doit pas être traduite sans validation");
  });
  assert.match(i18n.MENTION_JURIDIQUE, /French version is the legally binding version/);
});

test("aucune traduction vide, identique au français, ou contenant encore un mot français courant", () => {
  const piegesFrancais = /\b(votre|vous|nous|véhicule|réservation|livraison|jour|avec|pour|sans|dans)\b/i;
  Object.keys(i18n.TRADUCTIONS).forEach((source) => {
    const traduction = i18n.TRADUCTIONS[source];
    assert.ok(typeof traduction === "string" && traduction.trim().length > 0, `traduction vide pour « ${source} »`);
    // Quelques mots sont identiques dans les deux langues (Contact, SUV…) :
    // on ne signale que les phrases, où l'identité trahit un oubli.
    if (source.split(" ").length > 3) {
      assert.notEqual(traduction, source, `« ${source} » n'a pas été traduit`);
      assert.doesNotMatch(traduction, piegesFrancais, `« ${traduction} » contient encore du français`);
    }
  });
});

test("chaque page client a un titre et une description SEO anglais distincts du français", () => {
  const titresVus = new Set();
  i18n.PAGES.forEach((page) => {
    const seo = i18n.SEO[page];
    assert.ok(seo, `métadonnées anglaises manquantes pour ${page}`);
    assert.ok(seo.titre.length > 20 && seo.titre.length <= 75, `titre EN de longueur inadaptée pour ${page}`);
    assert.ok(seo.description.length > 60 && seo.description.length <= 185, `description EN de longueur inadaptée pour ${page}`);
    assert.ok(!titresVus.has(seo.titre), `titre EN dupliqué : ${seo.titre}`);
    titresVus.add(seo.titre);
    assert.doesNotMatch(seo.titre, /véhicule|Location de/i, `titre encore en français pour ${page}`);
  });
});

test("urlVersLangue : bascule les liens internes sans toucher aux liens externes", () => {
  assert.equal(i18n.urlVersLangue("vehicules.html", "en"), "/en/cars");
  assert.equal(i18n.urlVersLangue("/vehicules.html", "en"), "/en/cars");
  assert.equal(i18n.urlVersLangue("/en/cars", "fr"), "/vehicules.html");
  assert.equal(i18n.urlVersLangue("index.html", "fr"), "/index.html");
  assert.equal(i18n.urlVersLangue("index.html", "en"), "/en/");
  // Paramètres et ancres conservés de part et d'autre.
  assert.equal(i18n.urlVersLangue("vehicules.html?vehicule=opel-corsa", "en"), "/en/cars?vehicule=opel-corsa");
  assert.equal(i18n.urlVersLangue("/en/car-rental-nice#faq", "fr"), "/location-voiture-nice.html#faq");
  ["https://example.com", "tel:+33667485430", "mailto:contact@getlocation.fr", "#contact"].forEach((externe) => {
    assert.equal(i18n.urlVersLangue(externe, "en"), externe, "un lien externe ne doit jamais être préfixé");
  });
});

test("nomDePage et langueDuChemin identifient correctement page et langue", () => {
  assert.equal(i18n.nomDePage("/"), "index.html");
  assert.equal(i18n.nomDePage("/en/"), "index.html");
  assert.equal(i18n.nomDePage("/en/cars?vehicule=opel-corsa"), "vehicules.html");
  assert.equal(i18n.nomDePage("/en/car-rental-nice-airport"), "location-voiture-aeroport-nice.html");
  assert.equal(i18n.langueDuChemin("/en/cars"), "en");
  assert.equal(i18n.langueDuChemin("/en"), "en");
  assert.equal(i18n.langueDuChemin("/vehicules.html"), "fr");
  assert.equal(i18n.langueDuChemin("/enfants.html"), "fr", "un chemin commençant par « en » sans séparateur reste français");
});

test("chaque texte traduit depuis js/app.js via t() existe bien dans le dictionnaire", () => {
  const appJs = fs.readFileSync(path.join(racine, "js", "app.js"), "utf8");
  // Repère les appels t("…") — seule forme utilisée dans le code.
  const appels = [...appJs.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)].map((m) =>
    m[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\")
  );
  assert.ok(appels.length >= 8, "js/app.js doit bien passer ses textes générés par t()");
  const inconnus = appels.filter(
    (cle) => i18n.TRADUCTIONS[cle] === undefined && i18n.MODELES[cle] === undefined
  );
  assert.deepEqual(inconnus, [], "textes traduits en JS sans entrée dans js/i18n.js");
});

test("les modèles à variables déclarent les mêmes variables en français et en anglais", () => {
  Object.keys(i18n.MODELES).forEach((source) => {
    const variables = (texte) => (texte.match(/\{[a-zA-Zé]+\}/g) || []).sort();
    assert.deepEqual(
      variables(i18n.MODELES[source]),
      variables(source),
      `variables incohérentes entre « ${source} » et sa traduction`
    );
  });
});
