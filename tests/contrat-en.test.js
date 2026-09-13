// tests/contrat-en.test.js
//
// Contrat de location en anglais (js/contrat-en.js, utilisé par contrat.html
// quand « Langue du client » vaut English).
//
// Ce que ces tests protègent, par ordre d'importance :
//   1. l'avertissement de traduction est présent et dit bien ce qui protège
//      l'agence (version française prévalente, droit français, aucune
//      obligation créée par une erreur de traduction) ;
//   2. la version anglaise ne peut pas dériver de la française : mêmes
//      articles, mêmes emplacements de valeurs, mêmes chiffres ;
//   3. la version française reste strictement inchangée.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const racine = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(racine, "contrat.html"), "utf8");
const CONTRAT_EN = require("../js/contrat-en.js");
const i18n = require("../js/i18n.js");
const data = require("../js/data.js");

// --- 1. Avertissement de traduction --------------------------------------

test("l'avertissement dit que la version française prévaut et que le droit français s'applique", () => {
  const texte = CONTRAT_EN.AVERTISSEMENT.paragraphes.join(" ");

  // La clause qui protège réellement : une seule version fait foi.
  assert.match(texte, /French version is the only legally binding version/i);
  assert.match(texte, /the French wording alone applies/i);
  // Droit et juridiction.
  assert.match(texte, /governed by French law/i);
  assert.match(texte, /jurisdiction of the French courts/i);
  // Erreur de traduction : formulée en règle d'interprétation (aucune
  // obligation créée), et non en exclusion générale de responsabilité, qui
  // serait inopposable à un consommateur.
  assert.match(texte, /No translation error may create, extend or reduce any right or obligation/i);
  assert.doesNotMatch(texte, /shall not be liable|excludes? all liability/i,
    "une exclusion générale de responsabilité serait probablement jugée abusive : rester sur la règle d'interprétation");

  assert.match(CONTRAT_EN.AVERTISSEMENT.titre, /English translation/i);
});

// --- 2. Aucune dérive possible entre les deux versions -------------------

function articlesFrancais() {
  const dom = new JSDOM(html);
  const bloc = dom.window.document.getElementById("contractText");
  const sections = [];
  let courante = null;
  Array.prototype.forEach.call(bloc.children, (noeud) => {
    if (noeud.tagName === "H3") {
      courante = { titre: noeud.textContent.trim(), paragraphes: [], jetons: [], id: noeud.id };
      sections.push(courante);
    } else if (noeud.tagName === "P" && courante) {
      courante.paragraphes.push({ id: noeud.id, texte: noeud.textContent.trim() });
      noeud.querySelectorAll("[data-fill]").forEach((el) => courante.jetons.push(el.getAttribute("data-fill")));
      if (noeud.hasAttribute("data-fill")) courante.jetons.push(noeud.getAttribute("data-fill"));
    }
  });
  dom.window.close();
  return sections;
}

function jetonsDe(article) {
  const textes = article.paragraphes.concat(Object.values(article.clauses || {}));
  const trouves = [];
  textes.forEach((t) => (String(t).match(/\{([a-zA-Z0-9]+)\}/g) || []).forEach((j) => trouves.push(j.slice(1, -1))));
  return trouves;
}

test("chaque article français a son équivalent anglais, dans le même ordre", () => {
  // « Remarques particulières » est un intertitre optionnel rempli par
  // l'agence, pas un article : il est ajouté à part (voir sectionsContrat).
  const francais = articlesFrancais().filter((a) => a.id !== "remarquesTitre");
  assert.equal(
    CONTRAT_EN.ARTICLES.length,
    francais.length,
    "un article a été ajouté ou retiré côté français sans être reporté dans js/contrat-en.js"
  );
  francais.forEach((article, index) => {
    const numeroFr = /^Article\s+(\d+)/.exec(article.titre);
    const numeroEn = /^Article\s+(\d+)/.exec(CONTRAT_EN.ARTICLES[index].titre);
    assert.ok(numeroFr && numeroEn, `numéro d'article illisible : ${article.titre}`);
    assert.equal(numeroEn[1], numeroFr[1], `les articles ${index + 1} ne se correspondent pas`);
  });
});

test("les deux versions injectent exactement les mêmes valeurs (mêmes emplacements)", () => {
  const francais = articlesFrancais().filter((a) => a.id !== "remarquesTitre");
  francais.forEach((article, index) => {
    const attendus = [...new Set(article.jetons)].sort();
    const obtenus = [...new Set(jetonsDe(CONTRAT_EN.ARTICLES[index]))].sort();
    assert.deepEqual(
      obtenus,
      attendus,
      `article ${index + 1} : la version anglaise n'injecte pas les mêmes valeurs que la française`
    );
  });
});

test("la déclaration anglaise a autant de points que la française", () => {
  const francaise = /const DECLARATION_LOCATAIRE_TEXTE = "([^"]+)"/.exec(html)[1];
  const points = (texte) => texte.split(" : ").slice(1).join(" : ").replace(/\.$/, "").split(" ; ").length;
  assert.equal(points(CONTRAT_EN.DECLARATION), points(francaise),
    "un engagement a été ajouté ou retiré d'un côté seulement");
  assert.match(CONTRAT_EN.DECLARATION, /^By signing this agreement/);
});

test("les valeurs de js/data.js sont traduites pareil sur le site et sur le contrat", () => {
  // Un client qui a réservé une « Livraison du véhicule » sur le site doit
  // lire la même chose sur son contrat. La comparaison ne porte QUE sur ces
  // valeurs-là : les intitulés d'interface, eux, peuvent légitimement
  // différer selon le contexte (« Nom » = nom de famille dans un formulaire
  // du site, nom complet sur le contrat).
  const valeursData = data.OPTIONS.map((o) => o.nom).concat(data.LIEUX);
  const divergences = valeursData
    .filter((source) => i18n.TRADUCTIONS[source] !== undefined && CONTRAT_EN.TEXTES[source] !== undefined)
    .filter((source) => i18n.TRADUCTIONS[source] !== CONTRAT_EN.TEXTES[source])
    .map((source) => `${source} : site « ${i18n.TRADUCTIONS[source]} » / contrat « ${CONTRAT_EN.TEXTES[source]} »`);
  assert.deepEqual(divergences, [], "traductions divergentes entre js/i18n.js et js/contrat-en.js");
});

test("chaque option de js/data.js est traduisible sur le contrat", () => {
  const manquantes = data.OPTIONS.map((o) => o.nom).filter((nom) => CONTRAT_EN.texte(nom) === nom);
  assert.deepEqual(manquantes, [], "options sans traduction dans js/contrat-en.js");
});

// --- 3. Comportement du dictionnaire -------------------------------------

test("un intitulé sans traduction reste en français plutôt que de disparaître", () => {
  assert.equal(CONTRAT_EN.texte("Intitulé jamais traduit"), "Intitulé jamais traduit");
  assert.equal(CONTRAT_EN.texte(""), "");
  assert.equal(CONTRAT_EN.texte(null), "");
});

test("les durées sont traduites au pluriel correct", () => {
  assert.equal(CONTRAT_EN.duree("5 jours"), "5 days");
  assert.equal(CONTRAT_EN.duree("1 jour"), "1 day");
  assert.equal(CONTRAT_EN.duree("2 jours 4 heures"), "2 days 4 hours");
  assert.equal(CONTRAT_EN.duree("1 heure"), "1 hour");
});

test("une valeur absente laisse un emplacement visible, jamais « undefined »", () => {
  const rendu = CONTRAT_EN.articles({ vehicule: "", immat: null }, {})[0].paragraphes[0];
  assert.doesNotMatch(rendu, /undefined|null|\{/);
  assert.match(rendu, /…/);
});

test("clauses conditionnelles : présentes seulement quand elles s'appliquent", () => {
  const valeurs = { nom2: "Marc Smith", permis2: "123", ribIban: "FR76", ribTitulaire: "John Smith" };
  const sans = CONTRAT_EN.articles(valeurs, {});
  const avec = CONTRAT_EN.articles(valeurs, { secondConducteur: true, ribClient: true });
  const article4Sans = sans[3].paragraphes.join(" ");
  const article4Avec = avec[3].paragraphes.join(" ");

  assert.doesNotMatch(article4Sans, /additional driver, Marc Smith/i);
  assert.match(article4Avec, /additional driver, Marc Smith/i);
  assert.match(article4Avec, /IBAN FR76/);
});
