// tests/mobile-menu.test.js
//
// Avant ce correctif, .main-nav disparaissait totalement en dessous de
// 640px sans aucune alternative (voir css/style.css avant P1) : plus
// aucune navigation ni accès téléphone n'était possible sur mobile. Ce
// test vérifie le comportement du bouton .nav-toggle ajouté en P1-3 :
// ouverture/fermeture, ARIA, fermeture au clavier (Escape), fermeture au
// clic sur un lien, fermeture au clic extérieur.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const DATA_SRC = fs.readFileSync(path.join(__dirname, "..", "js", "data.js"), "utf8");
const APP_SRC = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8");

function newWindow() {
  const html = `<!DOCTYPE html><body>
    <header class="site-header">
      <div class="header-inner container">
        <a href="index.html" class="logo">GL</a>
        <button type="button" class="nav-toggle" id="nav-toggle" aria-expanded="false" aria-controls="main-nav" aria-label="Ouvrir le menu">
          <span class="nav-toggle-bar"></span><span class="nav-toggle-bar"></span><span class="nav-toggle-bar"></span>
        </button>
        <nav class="main-nav" id="main-nav">
          <a href="index.html">Accueil</a>
          <a href="vehicules.html">Véhicules</a>
          <a href="tel:+33667485430">Nous appeler</a>
        </nav>
      </div>
    </header>
    <main id="ailleurs">Contenu de page</main>
  </body>`;
  const dom = new JSDOM(html, { url: "https://getlocation.fr/", runScripts: "outside-only" });
  dom.window.eval(DATA_SRC + "\n" + APP_SRC);
  dom.window.initMobileMenu();
  return dom.window;
}

test("le menu est fermé par défaut (aria-expanded=false, pas de classe is-open)", () => {
  const window = newWindow();
  const toggle = window.document.getElementById("nav-toggle");
  const nav = window.document.getElementById("main-nav");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(nav.classList.contains("is-open"), false);
});

test("cliquer sur le bouton ouvre le menu et déplace le focus sur le premier lien", () => {
  const window = newWindow();
  const toggle = window.document.getElementById("nav-toggle");
  const nav = window.document.getElementById("main-nav");

  toggle.dispatchEvent(new window.Event("click", { bubbles: true }));

  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.equal(nav.classList.contains("is-open"), true);
  assert.equal(window.document.activeElement, nav.querySelector("a"));
});

test("un second clic sur le bouton referme le menu et restaure le focus dessus", () => {
  const window = newWindow();
  const toggle = window.document.getElementById("nav-toggle");
  const nav = window.document.getElementById("main-nav");

  toggle.dispatchEvent(new window.Event("click", { bubbles: true }));
  toggle.dispatchEvent(new window.Event("click", { bubbles: true }));

  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(nav.classList.contains("is-open"), false);
  assert.equal(window.document.activeElement, toggle);
});

test("la touche Escape referme le menu et restaure le focus sur le bouton", () => {
  const window = newWindow();
  const toggle = window.document.getElementById("nav-toggle");
  const nav = window.document.getElementById("main-nav");

  toggle.dispatchEvent(new window.Event("click", { bubbles: true }));
  assert.equal(nav.classList.contains("is-open"), true);

  const escEvent = new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true });
  window.document.dispatchEvent(escEvent);

  assert.equal(nav.classList.contains("is-open"), false);
  assert.equal(window.document.activeElement, toggle);
});

test("cliquer sur un lien du menu le referme", () => {
  const window = newWindow();
  const toggle = window.document.getElementById("nav-toggle");
  const nav = window.document.getElementById("main-nav");

  toggle.dispatchEvent(new window.Event("click", { bubbles: true }));
  assert.equal(nav.classList.contains("is-open"), true);

  const link = nav.querySelector("a");
  link.dispatchEvent(new window.Event("click", { bubbles: true }));

  assert.equal(nav.classList.contains("is-open"), false);
});

test("un clic en dehors du menu le referme", () => {
  const window = newWindow();
  const toggle = window.document.getElementById("nav-toggle");
  const nav = window.document.getElementById("main-nav");

  toggle.dispatchEvent(new window.Event("click", { bubbles: true }));
  assert.equal(nav.classList.contains("is-open"), true);

  const dehors = window.document.getElementById("ailleurs");
  dehors.dispatchEvent(new window.Event("click", { bubbles: true }));

  assert.equal(nav.classList.contains("is-open"), false);
});

test("Tab en fin de liste boucle vers le premier lien (piège de focus simple)", () => {
  const window = newWindow();
  const toggle = window.document.getElementById("nav-toggle");
  const nav = window.document.getElementById("main-nav");
  toggle.dispatchEvent(new window.Event("click", { bubbles: true }));

  const links = nav.querySelectorAll("a");
  const last = links[links.length - 1];
  last.focus();

  const tabEvent = new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
  window.document.dispatchEvent(tabEvent);

  assert.equal(tabEvent.defaultPrevented, true);
  assert.equal(window.document.activeElement, links[0]);
});
