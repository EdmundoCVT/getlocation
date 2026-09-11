// tests/contrat-date-inputs.test.js
//
// Les champs date JJ/MM/AAAA de contrat.html (naissance, dates de permis...)
// utilisent inputmode="numeric" pour afficher un clavier numérique sur
// mobile — mais ce clavier (iOS/Android) n'a pas de touche "/", rendant le
// format demandé impossible à saisir (constaté le 11/09/2026). Corrigé par
// activerSaisieDateAuto(), qui insère les "/" au fil de la frappe — même
// principe que insererSlashesDateFr() dans js/app.js (documents.html/
// paiement.html), dupliqué ici car contrat.html ne partage pas de module
// JS avec eux (voir tests/documents-page-dates.test.js pour l'équivalent).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const dataJsSource = fs.readFileSync(path.join(__dirname, "..", "js", "data.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "..", "contrat.html"), "utf8");

// Même extraction que tests/contrat-apercu-fill.test.js (pas une copie à la
// main) : le bloc de fonctions du script inline, avant l'auto-init du bas
// de fichier (qui a besoin d'un vrai window.location/DOM complet).
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

const DATE_FIELD_IDS = ["naissance", "permisDate", "permisValidite", "naissance2", "permis2Date", "df-permisDate", "df-permisValidite", "df-secondPermisDate"];

function buildWindow() {
  const body = DATE_FIELD_IDS.map((id) => `<input id="${id}" type="text">`).join("\n");
  const dom = new JSDOM(`<!DOCTYPE html><body>${body}</body>`, {
    url: "https://getlocation.fr/contrat.html",
    runScripts: "outside-only"
  });
  dom.window.eval(dataJsSource);
  dom.window.eval(extractScriptBody());
  return dom.window;
}

test("activerSaisieDateAuto : insère les \"/\" au fil de la frappe sur les 8 champs date de contrat.html", () => {
  const window = buildWindow();
  DATE_FIELD_IDS.forEach((id) => {
    const input = window.document.getElementById(id);
    input.value = "15061995";
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    assert.equal(input.value, "15/06/1995", `échec pour #${id}`);
  });
});

test("activerSaisieDateAuto : ne casse rien sur une saisie partielle (backspace, en cours de frappe)", () => {
  const window = buildWindow();
  const input = window.document.getElementById("naissance");

  input.value = "1";
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  assert.equal(input.value, "1");

  input.value = "15";
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  assert.equal(input.value, "15");

  input.value = "150";
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  assert.equal(input.value, "15/0");
});
