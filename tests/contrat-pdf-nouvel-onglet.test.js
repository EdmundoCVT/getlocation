// tests/contrat-pdf-nouvel-onglet.test.js
//
// Garde-fou pour le bug signalé le 12/09/2026 : cliquer sur "Générer le
// contrat officiel" / "Mettre à jour le contrat" faisait disparaître le
// formulaire agence — sur iPhone/iPad, doc.save() de jsPDF ne télécharge
// pas le PDF, le navigateur REMPLACE la page courante par le document.
//
// Corrigé par livrerPDF() : sur ces appareils le PDF part dans un onglet
// séparé (réservé dès le clic par reserverOngletPdf(), sans quoi le
// window.open() qui suit un appel réseau serait bloqué), ailleurs le
// téléchargement classique est conservé — il n'a jamais fait perdre la page
// et garde le nom de fichier du contrat.
//
// L'onglet reçoit une page d'accueil (ecrireOngletPdf) plutôt que le PDF
// brut : Safari affiche un PDF brut sans son nom, l'agence n'avait donc
// aucun moyen de l'enregistrer sous le nom du contrat.
//
// Exécute le vrai code de contrat.html via jsdom, comme
// tests/contrat-sms-href.test.js : jsdom permet de fixer le user-agent, ce
// qu'un test dans un vrai navigateur ne permet pas de faire de façon
// déterministe pour les deux plateformes.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const dataJsSource = fs.readFileSync(path.join(__dirname, "..", "js", "data.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "..", "contrat.html"), "utf8");

const FAUSSE_URL_BLOB = "blob:https://getlocation.fr/faux-blob";

function extractScriptBody() {
  const afterDataJs = html.indexOf("js/data.js");
  const openTag = html.indexOf("<script>", afterDataJs);
  assert.ok(openTag !== -1, "Balise <script> introuvable après js/data.js dans contrat.html");
  const bodyStart = openTag + "<script>".length;
  const initMarker = "var params = new URLSearchParams";
  const bodyEnd = html.indexOf(initMarker, bodyStart);
  assert.ok(bodyEnd !== -1, "Marqueur d'auto-init introuvable (structure de contrat.html changée ?)");
  return html.slice(bodyStart, bodyEnd);
}

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const DESKTOP_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// `t` : chaque fenêtre jsdom est refermée en fin de test, sinon ses minuteurs
// et ressources maintiendraient la suite de tests en vie.
function buildWindow(t, userAgent, { ongletsAutorises = true } = {}) {
  const dom = new JSDOM("<!DOCTYPE html><body></body>", {
    url: "https://getlocation.fr/contrat.html",
    runScripts: "outside-only",
    resources: { userAgent }
  });
  t.after(() => dom.window.close());
  const win = dom.window;
  const ouverts = [];
  const fermes = [];
  // Onglet réel (seconde fenêtre jsdom) : ecrireOngletPdf() y construit une
  // vraie page, que les tests inspectent comme le ferait l'utilisateur.
  win.open = function () {
    if (!ongletsAutorises) return null;
    const ongletDom = new JSDOM("<!DOCTYPE html><body></body>");
    t.after(() => ongletDom.window.close());
    const onglet = ongletDom.window;
    // jsdom n'implémente pas window.closed : la fermeture est tracée ici.
    const fermerReellement = onglet.close.bind(onglet);
    onglet.close = function () { fermes.push(onglet); fermerReellement(); };
    ouverts.push(onglet);
    return onglet;
  };
  win.URL.createObjectURL = () => FAUSSE_URL_BLOB;
  win.URL.revokeObjectURL = () => {};
  win.eval(dataJsSource);
  win.eval(extractScriptBody());
  win.__ongletsOuverts = ouverts;
  win.__ongletsFermes = fermes;
  return win;
}

// Faux document jsPDF : on n'a besoin que de save() et output('blob').
function fakeDoc() {
  return {
    sauvegardeSous: null,
    save(nomFichier) { this.sauvegardeSous = nomFichier; },
    output(type) {
      assert.equal(type, "blob", "livrerPDF doit demander un blob, jamais une autre sortie");
      return { fauxBlob: true };
    }
  };
}

test("iPhone : le PDF part dans un onglet séparé, jamais par doc.save() (qui remplacerait la page)", (t) => {
  const win = buildWindow(t, IPHONE_UA);
  assert.equal(win.pdfDoitOuvrirDansUnOnglet(), true);

  const doc = fakeDoc();
  win.livrerPDF(doc, "contrat-getlocation-test.pdf");

  assert.equal(doc.sauvegardeSous, null, "doc.save() ne doit pas être utilisé sur iPhone");
  assert.equal(win.__ongletsOuverts.length, 1);
});

test("iPhone : l'onglet propose un bouton de téléchargement PORTANT LE NOM DU CONTRAT, en plus de l'aperçu", (t) => {
  const win = buildWindow(t, IPHONE_UA);
  win.livrerPDF(fakeDoc(), "contrat-getlocation-benzaama-GL-20260912-0007.pdf");

  const d = win.__ongletsOuverts[0].document;
  assert.equal(d.title, "contrat-getlocation-benzaama-GL-20260912-0007.pdf");

  const telecharger = d.querySelector("a[download]");
  assert.ok(telecharger, "un lien de téléchargement doit exister dans l'onglet");
  assert.equal(telecharger.getAttribute("download"), "contrat-getlocation-benzaama-GL-20260912-0007.pdf");
  assert.equal(telecharger.getAttribute("href"), FAUSSE_URL_BLOB);

  const apercu = d.querySelector("iframe");
  assert.ok(apercu, "l'aperçu du PDF doit être affiché dans l'onglet");
  assert.equal(apercu.getAttribute("src"), FAUSSE_URL_BLOB);

  // Repli "Plein écran" : même PDF, sans l'attribut download (visionneuse).
  const liens = Array.from(d.querySelectorAll("a")).filter((a) => !a.hasAttribute("download"));
  assert.equal(liens.length, 1);
  assert.equal(liens[0].getAttribute("href"), FAUSSE_URL_BLOB);
});

test("iPhone : le nom du contrat est inséré comme texte, jamais interprété comme du HTML", (t) => {
  const win = buildWindow(t, IPHONE_UA);
  // Le nom est normalement assaini par genererPDF() ; on vérifie ici que
  // même une valeur hostile ne peut pas créer d'élément dans l'onglet.
  const nomHostile = '<img src=x onerror=alert(1)>.pdf';
  win.livrerPDF(fakeDoc(), nomHostile);

  const d = win.__ongletsOuverts[0].document;
  assert.equal(d.querySelector("img"), null, "aucun élément ne doit être créé depuis le nom de fichier");
  assert.equal(d.querySelector(".nom").textContent, nomHostile);
  assert.equal(d.querySelector("a[download]").getAttribute("download"), nomHostile);
});

test("ordinateur : le téléchargement classique est conservé (nom de fichier du contrat, aucun onglet ouvert)", (t) => {
  const win = buildWindow(t, DESKTOP_UA);
  assert.equal(win.pdfDoitOuvrirDansUnOnglet(), false);

  const doc = fakeDoc();
  win.livrerPDF(doc, "contrat-getlocation-test.pdf");

  assert.equal(doc.sauvegardeSous, "contrat-getlocation-test.pdf");
  assert.equal(win.__ongletsOuverts.length, 0, "aucun onglet ne doit être ouvert sur ordinateur");
});

test("iPhone : l'onglet réservé au clic est celui qui reçoit le PDF (pas un second ouvert après l'appel réseau)", (t) => {
  const win = buildWindow(t, IPHONE_UA);
  win.reserverOngletPdf();
  assert.equal(win.__ongletsOuverts.length, 1, "l'onglet doit être ouvert dès la réservation");
  const reserve = win.__ongletsOuverts[0];

  win.livrerPDF(fakeDoc(), "contrat.pdf");

  assert.equal(win.__ongletsOuverts.length, 1, "aucun second onglet ne doit être ouvert");
  assert.ok(reserve.document.querySelector("a[download]"), "le PDF doit être livré dans l'onglet réservé");
});

test("ordinateur : reserverOngletPdf() n'ouvre aucun onglet (comportement inchangé)", (t) => {
  const win = buildWindow(t, DESKTOP_UA);
  win.reserverOngletPdf();
  assert.equal(win.__ongletsOuverts.length, 0);
});

test("libererOngletPdf() referme l'onglet réservé quand le PDF n'est finalement pas généré (erreur réseau, photos invalides...)", (t) => {
  const win = buildWindow(t, IPHONE_UA);
  win.reserverOngletPdf();
  const reserve = win.__ongletsOuverts[0];

  win.libererOngletPdf();
  assert.deepEqual(win.__ongletsFermes, [reserve], "l'onglet réservé doit être refermé");

  // L'onglet libéré ne doit plus être réutilisé par une livraison ultérieure.
  win.livrerPDF(fakeDoc(), "contrat.pdf");
  assert.equal(win.__ongletsOuverts.length, 2, "un nouvel onglet doit être ouvert, jamais celui refermé");
  assert.ok(win.__ongletsOuverts[1].document.querySelector("a[download]"));
});

test("iPhone, onglet bloqué par le navigateur : repli sur doc.save() plutôt qu'aucun PDF", (t) => {
  const win = buildWindow(t, IPHONE_UA, { ongletsAutorises: false });
  const doc = fakeDoc();
  win.livrerPDF(doc, "contrat-getlocation-test.pdf");
  assert.equal(doc.sauvegardeSous, "contrat-getlocation-test.pdf");
});

test("genererPDF() délivre toujours via livrerPDF(), jamais par un doc.save() direct", () => {
  assert.match(html, /livrerPDF\(doc, nomFichier\);/);
  assert.doesNotMatch(html, /^\s*doc\.save\(nomFichier\);/m, "plus aucun doc.save() direct en fin de genererPDF()");
});

test("les boutons qui génèrent un PDF après un appel asynchrone réservent l'onglet dès le clic", () => {
  // "Générer/Mettre à jour le contrat officiel" et "Aperçu PDF" (vue agence),
  // signature client (contrat manuel et dossier sécurisé) : 4 réservations.
  const reservations = html.match(/reserverOngletPdf\(\);/g) || [];
  assert.equal(reservations.length, 4);
});
