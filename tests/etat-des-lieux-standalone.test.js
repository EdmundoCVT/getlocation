const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const root = path.join(__dirname, "..");
const page = fs.readFileSync(path.join(root, "etat-des-lieux.html"), "utf8");
const script = fs.readFileSync(path.join(root, "js", "inspection-page.js"), "utf8");
const sketch = fs.readFileSync(path.join(root, "js", "inspection-sketch.js"), "utf8");

test("état des lieux autonome : charge le croquis historique, la galerie R2 et les signatures distinctes", () => {
  assert.match(page, /js\/inspection-sketch\.js/);
  assert.match(page, /js\/inspection-page\.js/);
  assert.match(script, /Signature client/);
  assert.match(page, /Imprimer \/ enregistrer en PDF/);
  assert.match(script, /\/api\/inspection-media/);
  assert.match(script, /capturedAt/);
  assert.match(script, /createdAt/);
  assert.match(script, /signatures:\{client:client,agence:agency\}/);
  assert.match(sketch, /Profil conducteur/);
  assert.match(sketch, /Profil passager/);
  assert.match(sketch, /Bosse \/ impact/);
});

test("état des lieux autonome : les états historiques restent sur la voie lecture seule", () => {
  assert.match(script, /p\.get\(\"source\"\)===\"legacy\"/);
  assert.match(script, /Historique en consultation seule/);
  assert.match(script, /legacy-inspection-agency/);
});

test("impression : la feuille A4 conserve les blocs, compacte les photos et retire le fragment sécurisé", () => {
  assert.match(page, /@page\{size:A4;margin:9mm\}/);
  assert.match(page, /inspection-sketch-grid\{grid-template-columns:repeat\(5/);
  assert.match(page, /break-inside:avoid/);
  assert.match(page, /photo-grid\{grid-template-columns:repeat\(3/);
  assert.match(page, /field\.print-empty/);
  assert.match(script, /history\.replaceState\(null,"",location\.pathname\+location\.search\)/);
  assert.match(script, /location\.search\+originalHash/);
  assert.doesNotMatch(page, /agencyToken=/);
});

test("état des lieux autonome : rend le croquis, les propretés et les signatures pour un dossier retour", async () => {
  const dom = new JSDOM(page, {
    url: "https://getlocation.fr/etat-des-lieux.html?mode=retour#agencyToken=" + "a".repeat(43),
    runScripts: "outside-only",
    beforeParse(window) {
      window.HTMLCanvasElement.prototype.getContext = () => ({ lineWidth: 0, lineCap: "", beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, clearRect() {}, drawImage() {} });
      window.HTMLCanvasElement.prototype.toDataURL = () => "data:image/png;base64,aGVsbG8=";
      window.fetch = async () => ({ ok: true, json: async () => ({
        reservation: { id: "res_test", contractNumero: "GL-TEST", vehicule: { nom: "Toyota Proace", immatriculation: "AA-000-AA", vehicleFamily: "utility" }, conducteur: { prenom: "Jean", nom: "Dupont" }, dateDebut: "2026-10-01", heureDebut: "10:00", dateFin: "2026-10-02", heureFin: "10:00" },
        dossier: { depart: { km: 100, carburant: 100, dommages: "Rayure existante", marks: [{ id: "m1", view: "left", type: "rayure", x: 20, y: 30 }], media: [] }, retour: { km: 120, carburant: 80, agent: "Agent", marks: [], signatures: {} }, media: { depart: [], retour: [] } }
      }) });
    }
  });
  dom.window.eval(sketch);
  dom.window.eval(script);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(dom.window.document.querySelectorAll(".inspection-sketch-view").length, 5);
  assert.equal(dom.window.document.querySelectorAll(".cleanliness-buttons").length, 3, "utilitaire : extérieur, intérieur et chargement");
  assert.equal(dom.window.document.querySelectorAll(".signature-pad").length, 2);
  assert.equal(dom.window.document.getElementById("departCompare").hidden, false);
});
