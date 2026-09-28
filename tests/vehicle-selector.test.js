const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

function results(family = "car") {
  const dom = new JSDOM('<main><div id="filter-bar"></div><div id="vehicle-grid"></div></main>', {
    url: "https://getlocation.fr/vehicules.html", runScripts: "outside-only"
  });
  const { window } = dom;
  window.localStorage.setItem("gl_recherche", JSON.stringify({
    typeVehicule: family, dateDebut: "2026-10-02", heureDebut: "10:00",
    dateFin: "2026-10-05", heureFin: "10:00"
  }));
  window.eval(read("js/data.js") + "\n" + read("js/request-catalog.js") + "\n" + read("js/app.js"));
  window.initVehiculesPage();
  return window;
}

test("catégories voiture, filtres et demande sans permis", () => {
  const w = results();
  const labels = [...w.document.querySelectorAll(".vehicle-categories .filter-chip")].map(e => e.textContent);
  assert.deepEqual(labels, ["Toutes", "Citadine", "SUV / 4x4", "Berline", "Cabriolet", "Minibus", "Premium", "Sans permis"]);
  w.document.querySelectorAll(".vehicle-categories button")[1].click();
  assert.match(w.document.querySelector("#vehicle-grid").textContent, /Corsa/);
  w.document.querySelectorAll(".vehicle-categories button")[2].click();
  assert.match(w.document.querySelector("#vehicle-grid").textContent, /2008|3008/);
  w.document.querySelector(".vehicle-categories button:last-child").click();
  assert.match(w.document.querySelector("#vehicle-grid").textContent, /Véhicule sans permis/);
  assert.match(w.document.querySelector("#vehicle-grid").textContent, /Disponibilité à confirmer/);
  assert.ok(w.document.querySelector('[data-id="sans-permis-request"]'));
  assert.equal(w.document.querySelector("#vehicle-grid .price strong"), null);
  assert.doesNotMatch(w.document.querySelector("#vehicle-grid").textContent, /partenaire|prestataire|marketplace/i);
});

test("utilitaires et changement de famille conservent un seul choix actif", () => {
  const w = results("utility");
  assert.equal(w.document.querySelector(".vehicle-categories"), null);
  assert.match(w.document.querySelector("#vehicle-grid").textContent, /Proace/);
  w.document.querySelector('[data-type="car"]').click();
  assert.ok(w.document.querySelector(".vehicle-categories"));
  assert.equal(w.document.querySelectorAll(".family-tabs .active").length, 1);
  w.document.querySelector('[data-type="utility"]').click();
  assert.equal(w.document.querySelector(".vehicle-categories"), null);
  assert.equal(w.document.querySelectorAll(".family-tabs .active").length, 1);
});
