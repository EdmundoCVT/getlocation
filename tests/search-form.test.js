// tests/search-form.test.js
//
// Couvre la refonte du formulaire de recherche (index.html + pages
// location-voiture-*.html) : lieu de restitution masqué par défaut et
// synchronisé sur la prise en charge (révélé par un petit bouton), villes de
// livraison en liste fermée (Côte d'Azur) plutôt qu'une adresse libre.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
// Import direct (Node/CommonJS) plutôt que via `window.X` après eval : les
// `const` de haut niveau évalués dans jsdom restent dans la portée lexicale
// du script, mais ne deviennent PAS des propriétés de l'objet window (au
// contraire des déclarations de fonction, ex. window.initSearchForm plus
// bas) — voir tests/tunnel-robustness.test.js pour le même contournement.
const { LIEU_LIVRAISON, VILLES_LIVRAISON } = require("../js/data.js");

const DATA_SRC = fs.readFileSync(path.join(__dirname, "..", "js", "data.js"), "utf8");
const APP_SRC = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8");

function searchFormHtml() {
  return `<!DOCTYPE html><body>
    <form id="search-form" class="search-card">
      <div class="field">
        <label for="lieu-prise">Lieu de prise en charge</label>
        <select id="lieu-prise" required></select>
      </div>
      <div class="field" id="adresse-prise-field" style="display:none;">
        <label for="adresse-prise">Ville de livraison</label>
        <select id="adresse-prise"></select>
      </div>
      <div class="field field-toggle-retour">
        <button type="button" class="toggle-retour" id="toggle-retour">Restituer à un endroit différent</button>
        <div class="field" id="retour-field" style="display:none;">
          <label for="lieu-retour">Lieu de restitution</label>
          <select id="lieu-retour" required></select>
        </div>
      </div>
      <div class="field" id="adresse-retour-field" style="display:none;">
        <label for="adresse-retour">Ville de livraison (restitution)</label>
        <select id="adresse-retour"></select>
      </div>
      <div class="field">
        <label for="date-debut">Date et heure de départ</label>
        <div class="datetime-group">
          <input type="date" id="date-debut" required>
          <select id="heure-debut" required></select>
        </div>
      </div>
      <div class="field">
        <label for="date-fin">Date et heure de retour</label>
        <div class="datetime-group">
          <input type="date" id="date-fin" required>
          <select id="heure-fin" required></select>
        </div>
      </div>
      <button type="submit" class="btn btn-primary">Rechercher</button>
    </form>
  </body>`;
}

function newWindow() {
  const dom = new JSDOM(searchFormHtml(), { url: "https://getlocation.fr/index.html", runScripts: "outside-only" });
  dom.window.eval(DATA_SRC + "\n" + APP_SRC);
  dom.window.initSearchForm();
  return dom.window;
}

test("le lieu de restitution est masqué par défaut, le bouton pour le révéler est visible", () => {
  // On vérifie style.display (pas la propriété hidden, qui ne reflète que la
  // présence de l'attribut HTML et pas le rendu visuel réel une fois la
  // feuille de style du site appliquée — .field impose display:flex, qui
  // l'emportait sur [hidden]{display:none} dans un vrai navigateur, bug
  // corrigé en pilotant l'affichage uniquement via style.display en JS).
  const window = newWindow();
  const document = window.document;
  assert.equal(document.getElementById("retour-field").style.display, "none");
  assert.notEqual(document.getElementById("toggle-retour").style.display, "none");
});

test("les villes de livraison (Côte d'Azur) peuplent les deux selects d'adresse, rien d'autre", () => {
  const window = newWindow();
  const document = window.document;
  const villesPrise = [...document.getElementById("adresse-prise").options].map((o) => o.value).filter(Boolean);
  const villesRetour = [...document.getElementById("adresse-retour").options].map((o) => o.value).filter(Boolean);
  assert.deepEqual(villesPrise, VILLES_LIVRAISON);
  assert.deepEqual(villesRetour, VILLES_LIVRAISON);
});

test("cliquer sur le bouton révèle le lieu de restitution et masque le bouton", () => {
  const window = newWindow();
  const document = window.document;
  document.getElementById("toggle-retour").dispatchEvent(new window.Event("click", { bubbles: true }));
  assert.equal(document.getElementById("retour-field").style.display, "");
  assert.equal(document.getElementById("toggle-retour").style.display, "none");
});

test("sans restitution indépendante : le lieu et la ville de retour reprennent silencieusement ceux de la prise en charge", () => {
  const window = newWindow();
  const document = window.document;
  const selectPrise = document.getElementById("lieu-prise");
  const selectAdressePrise = document.getElementById("adresse-prise");

  selectPrise.value = LIEU_LIVRAISON;
  selectPrise.dispatchEvent(new window.Event("change", { bubbles: true }));
  selectAdressePrise.value = "Cannes";
  selectAdressePrise.dispatchEvent(new window.Event("change", { bubbles: true }));

  document.getElementById("search-form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));

  const recherche = JSON.parse(window.localStorage.getItem("gl_recherche"));
  assert.equal(recherche.lieuPrise, LIEU_LIVRAISON);
  assert.equal(recherche.adressePrise, "Cannes");
  assert.equal(recherche.lieuRetour, LIEU_LIVRAISON);
  assert.equal(recherche.adresseRetour, "Cannes");
});

test("restitution indépendante : le lieu et la ville de retour choisis sont respectés, même différents de la prise en charge", () => {
  const window = newWindow();
  const document = window.document;
  const selectPrise = document.getElementById("lieu-prise");
  const selectAdressePrise = document.getElementById("adresse-prise");

  selectPrise.value = LIEU_LIVRAISON;
  selectPrise.dispatchEvent(new window.Event("change", { bubbles: true }));
  selectAdressePrise.value = "Nice";
  selectAdressePrise.dispatchEvent(new window.Event("change", { bubbles: true }));

  document.getElementById("toggle-retour").dispatchEvent(new window.Event("click", { bubbles: true }));

  const selectRetour = document.getElementById("lieu-retour");
  const selectAdresseRetour = document.getElementById("adresse-retour");
  selectRetour.value = "Agence Grasse";
  selectRetour.dispatchEvent(new window.Event("change", { bubbles: true }));

  document.getElementById("search-form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));

  const recherche = JSON.parse(window.localStorage.getItem("gl_recherche"));
  assert.equal(recherche.lieuPrise, LIEU_LIVRAISON);
  assert.equal(recherche.adressePrise, "Nice");
  assert.equal(recherche.lieuRetour, "Agence Grasse");
  assert.equal(recherche.adresseRetour, "");
  assert.notEqual(selectAdresseRetour, null);
});
