// tests/i18n-rendu-en.test.js
//
// Rendu réel des pages anglaises : on charge la vraie page HTML dans jsdom
// sous une adresse /en/…, on exécute js/i18n.js comme le ferait le
// navigateur, puis on vérifie qu'il ne reste aucun texte français à
// l'écran, que les liens internes restent dans la version anglaise et que
// la version française n'est jamais modifiée.
//
// Complète tests/i18n-couverture.test.js (qui vérifie le dictionnaire) en
// contrôlant cette fois le comportement du moteur.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const i18n = require("../js/i18n.js");
const { traduireEnTete, fichierPourCheminAnglais, estCheminAnglais } = require("../src/lib/pages-en.js");

const racine = path.join(__dirname, "..");
const sourceI18n = fs.readFileSync(path.join(racine, "js", "i18n.js"), "utf8");

// Charge une page comme le ferait un navigateur sur l'URL demandée, moteur
// de traduction compris. `runScripts: outside-only` : seuls nos appels
// explicites s'exécutent, jamais js/app.js (qui a besoin du réseau).
// La promesse n'est tenue qu'après DOMContentLoaded, puisque c'est à ce
// moment-là que le moteur s'applique à la page (comme dans un navigateur).
function chargerPage(fichier, url) {
  const html = fs.readFileSync(path.join(racine, fichier), "utf8");
  const dom = new JSDOM(html, { url, runScripts: "outside-only" });
  dom.window.eval(sourceI18n);
  return new Promise((resolve) => {
    if (dom.window.document.readyState !== "loading") return resolve(dom);
    dom.window.document.addEventListener("DOMContentLoaded", () => resolve(dom));
  });
}

function textesVisibles(document, NodeFilter) {
  const trouves = [];
  const parcours = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let noeud;
  while ((noeud = parcours.nextNode())) {
    if (noeud.parentElement.closest("script,style,noscript")) continue;
    const texte = noeud.textContent.trim();
    if (texte) trouves.push(texte);
  }
  return trouves;
}

test("page anglaise : plus aucun texte français à l'écran", async () => {
  const dom = await chargerPage("index.html", "https://getlocation.fr/en/");
  const { document, NodeFilter } = dom.window;

  // Un texte identique dans les deux langues (« Contact », « SUV »…) n'est
  // évidemment pas un oubli de traduction.
  const restes = textesVisibles(document, NodeFilter).filter(
    (texte) => i18n.TRADUCTIONS[texte] !== undefined && i18n.TRADUCTIONS[texte] !== texte
  );
  assert.deepEqual(restes, [], "ces textes français auraient dû être traduits à l'affichage");

  assert.equal(document.documentElement.lang, "en");
  assert.match(document.body.textContent, /Book\. We deliver\. You drive\./);
  assert.match(document.body.textContent, /Find your vehicle/);
  dom.window.close();
});

test("page française : strictement inchangée, aucun mot anglais injecté", async () => {
  const dom = await chargerPage("index.html", "https://getlocation.fr/");
  const { document } = dom.window;

  assert.equal(document.documentElement.lang, "fr");
  assert.match(document.body.textContent, /Le véhicule qu'il vous faut, livré où vous voulez\./);
  assert.doesNotMatch(document.body.textContent, /Book\. We deliver\./);
  // Les liens gardent leur forme française d'origine.
  assert.equal(document.querySelector('.main-nav a[href]').getAttribute("href"), "index.html");
  dom.window.close();
});

test("sélecteur de langue : présent dans les deux versions, avec la langue courante marquée", async () => {
  for (const url of ["https://getlocation.fr/", "https://getlocation.fr/en/"]) {
    const dom = await chargerPage("index.html", url);
    const { document } = dom.window;
    const options = [...document.querySelectorAll(".lang-switch-option")];
    assert.equal(options.length, 2, `sélecteur absent sur ${url}`);
    assert.deepEqual(options.map((o) => o.textContent), ["FR", "EN"]);

    const actif = document.querySelector(".lang-switch-option.active");
    const attendu = url.includes("/en/") ? "EN" : "FR";
    assert.equal(actif.textContent, attendu);
    // Chaque option mène à la même page dans l'autre langue.
    assert.equal(options[0].getAttribute("href"), "/index.html");
    assert.equal(options[1].getAttribute("href"), "/en/");
    dom.window.close();
  }
});

test("navigation anglaise : les liens internes restent en anglais, les liens externes intacts", async () => {
  const dom = await chargerPage("index.html", "https://getlocation.fr/en/");
  const { document } = dom.window;

  const vehicules = [...document.querySelectorAll("a[href]")].find((a) => /cars|vehicules/.test(a.getAttribute("href")));
  assert.match(vehicules.getAttribute("href"), /^\/en\//, "un lien interne doit rester dans la version anglaise");

  [...document.querySelectorAll("a[href]")].forEach((lien) => {
    const href = lien.getAttribute("href");
    if (/^(tel:|mailto:|https?:|#)/.test(href)) {
      assert.doesNotMatch(href, /^\/en\//, `lien externe modifié à tort : ${href}`);
    }
  });
  dom.window.close();
});

test("contenu ajouté après le chargement (fiches, filtres, messages) est traduit automatiquement", async () => {
  const dom = await chargerPage("vehicules.html", "https://getlocation.fr/en/cars");
  const { document } = dom.window;

  const bloc = document.createElement("div");
  bloc.innerHTML = '<p>Aucun véhicule ne correspond à cette recherche pour le moment.</p>' +
    '<a href="reservation.html">Réserver</a>';
  document.body.appendChild(bloc);

  // Le MutationObserver de jsdom s'exécute en microtâche : on laisse la
  // boucle d'événements tourner avant de vérifier.
  return new Promise((resolve) => {
    setTimeout(() => {
      assert.match(bloc.textContent, /No vehicle matches this search at the moment\./);
      assert.equal(bloc.querySelector("a").getAttribute("href"), "/en/booking");
      dom.window.close();
      resolve();
    }, 0);
  });
});

test("pages juridiques : corps en français, mention anglaise ajoutée sur la version EN", async () => {
  const enAnglais = await chargerPage("cgl.html", "https://getlocation.fr/en/terms");
  const note = enAnglais.window.document.querySelector(".legal-language-note");
  assert.ok(note, "la mention de langue doit être affichée sur la version anglaise");
  assert.match(note.textContent, /French version is the legally binding version/);
  assert.match(enAnglais.window.document.body.textContent, /dépôt de garantie/, "le corps juridique reste en français");
  enAnglais.window.close();

  const enFrancais = await chargerPage("cgl.html", "https://getlocation.fr/cgl.html");
  assert.equal(enFrancais.window.document.querySelector(".legal-language-note"), null);
  enFrancais.window.close();
});

test("t() : traduit les textes à variables, et laisse le français intact hors version anglaise", async () => {
  const en = (await chargerPage("index.html", "https://getlocation.fr/en/")).window;
  assert.equal(
    en.GLI18N.t("Télécharger {type}", { type: "permis" }),
    "Download permis"
  );
  assert.equal(
    en.GLI18N.t("Date invalide (JJ/MM/AAAA attendu) : {champ}.", { champ: "Date of birth" }),
    "Invalid date (DD/MM/YYYY expected): Date of birth."
  );
  en.close();

  const fr = (await chargerPage("index.html", "https://getlocation.fr/")).window;
  assert.equal(fr.GLI18N.t("{prix} / jour", { prix: "12 €" }), "12 € / jour");
  fr.close();
});

// --- Routage et métadonnées servis par le worker -------------------------

test("routage /en/ : chaque adresse anglaise pointe vers le bon fichier HTML", () => {
  assert.equal(fichierPourCheminAnglais("/en/"), "index.html");
  assert.equal(fichierPourCheminAnglais("/en"), "index.html");
  assert.equal(fichierPourCheminAnglais("/en/cars"), "vehicules.html");
  assert.equal(fichierPourCheminAnglais("/en/car-rental-nice-airport"), "location-voiture-aeroport-nice.html");
  assert.equal(fichierPourCheminAnglais("/en/inconnu"), null, "une adresse anglaise inconnue reste un 404");
  assert.equal(fichierPourCheminAnglais("/vehicules.html"), null, "les URLs françaises ne passent jamais par ce routage");
  assert.equal(estCheminAnglais("/enfants.html"), false);
});

test("métadonnées anglaises : titre, description, canonique et langue du document", () => {
  const html = fs.readFileSync(path.join(racine, "vehicules.html"), "utf8");
  const traduit = traduireEnTete(html, "vehicules.html");

  assert.match(traduit, /<html lang="en"/);
  assert.match(traduit, new RegExp(`<title>${i18n.SEO["vehicules.html"].titre.replace(/[|—]/g, ".")}</title>`));
  assert.ok(traduit.includes(i18n.SEO["vehicules.html"].description));
  assert.match(traduit, /<link rel="canonical" href="https:\/\/getlocation\.fr\/en\/cars">/);
  assert.match(traduit, /og:locale["'] content=["']en_GB/);
  // Le contenu de la page, lui, n'est pas touché côté serveur.
  assert.ok(traduit.includes("Choisissez votre véhicule"));
  // Les balises hreflang restent identiques dans les deux versions.
  assert.ok(traduit.includes('hreflang="fr"') && traduit.includes('hreflang="en"') && traduit.includes('hreflang="x-default"'));
});

test("chaque page française déclare ses deux versions linguistiques (hreflang)", () => {
  i18n.PAGES.forEach((page) => {
    const html = fs.readFileSync(path.join(racine, page), "utf8");
    const slug = i18n.SLUGS_EN[page];
    assert.ok(html.includes(`<link rel="alternate" hreflang="en" href="https://getlocation.fr/en/${slug}">`),
      `hreflang anglais manquant sur ${page}`);
    assert.ok(html.includes('hreflang="x-default"'), `hreflang x-default manquant sur ${page}`);
    assert.ok(html.includes("js/i18n.js"), `js/i18n.js n'est pas chargé par ${page}`);
  });
});
