const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const root = path.join(__dirname, "..");
const page = fs.readFileSync(path.join(root, "etat-des-lieux.html"), "utf8");

async function view({ mode = "retour", legacy = false, family = "utility" } = {}) {
  const requests = [];
  const dom = new JSDOM(page, {
    url: "https://getlocation.fr/etat-des-lieux.html?mode=" + mode + (legacy ? "&source=legacy&legacyId=res_fixture" : "#agencyToken=" + "a".repeat(43)),
    runScripts: "outside-only",
    beforeParse(window) {
      window.HTMLCanvasElement.prototype.getContext = () => ({ beginPath() {}, arc() {}, fill() {}, moveTo() {}, lineTo() {}, stroke() {}, clearRect() {}, drawImage() {} });
      window.fetch = async (url, options) => {
        requests.push({ url, options });
        return { ok: true, json: async () => legacy ? { inspection: { id: "res_fixture", client: { nom: "Historique", prenom: "Client" }, vehicule: "Corsa", depart: { km: 4083, cles: 2, marques: [] } } } : {
          reservation: { id: "res_fixture", contractNumero: "GL-TEST", vehicule: { nom: "Véhicule test", immatriculation: "AA-000-AA", vehicleFamily: family }, conducteur: { prenom: "Jean", nom: "Dupont" }, dateDebut: "2026-10-01", heureDebut: "10:00", dateFin: "2026-10-02", heureFin: "10:00" },
          dossier: { depart: { km: 100, carburant: 100, dommages: "Rayure existante", marks: [{ id: "m1", view: "left", type: "rayure", x: 20, y: 30 }], propreteExterieure: 1, propreteInterieure: 5 }, retour: { km: 120, carburant: 80, agent: "Agent", marks: [], signatures: {}, propreteExterieure: 2, propreteInterieure: 4, propreteChargement: 3 }, media: { depart: [], retour: [] } }
        } };
      };
    }
  });
  for (const script of ["inspection-sketch", "legacy-inspection-sketch", "inspection-media-view", "inspection-signature", "inspection-document", "inspection-page"]) dom.window.eval(fs.readFileSync(path.join(root, "js", script + ".js"), "utf8"));
  await new Promise(resolve => setTimeout(resolve, 0));
  return { dom, doc: dom.window.document, requests };
}

test("V3 : retour affiche cinq vues modifiables et cinq vues de référence, coordonnées conservées", async () => {
  const { dom, doc } = await view();
  assert.equal(doc.querySelectorAll("#sketch .inspection-sketch-view").length, 5);
  assert.equal(doc.querySelectorAll("#departureSketch .inspection-sketch-view").length, 5);
  const mark = doc.querySelector("#departureSketch [data-mark-id=m1]");
  assert.equal(mark.dataset.x, "20"); assert.equal(mark.dataset.y, "30");
  assert.equal(mark.style.left, "20%"); assert.equal(mark.style.top, "30%");
  assert.equal(mark.disabled, true);
  assert.equal(doc.querySelectorAll("#sketch .inspection-reference-image").length, 5);
  assert.match(doc.querySelector("#sketch [data-view=left] img").src, /images\/inspection\/vehicle-left\.png/);
  dom.window.close();
});
test("V3 : propretés indépendantes avec sélection visible et chargement seulement pour utilitaire", async () => {
  const { dom, doc } = await view();
  assert.equal(doc.querySelector("[data-field=propreteExterieure] [aria-pressed=true]").textContent, "2");
  assert.equal(doc.querySelector("[data-field=propreteInterieure] [aria-pressed=true]").textContent, "4");
  doc.querySelector("[data-field=propreteExterieure] [data-score='5']").click();
  assert.equal(doc.querySelector("[data-field=propreteExterieure] [aria-pressed=true]").textContent, "5");
  assert.equal(doc.querySelector("[data-field=propreteInterieure] [aria-pressed=true]").textContent, "4");
  assert.equal(doc.getElementById("saveStatus").textContent, "Modifications non enregistrées"); dom.window.close();
  const car = await view({ family: "car" }); assert.equal(car.doc.querySelectorAll(".cleanliness-buttons").length, 2); car.dom.window.close();
});
test("V3 : chaque emplacement propose caméra et photothèque multiple sans capture", async () => {
  const { dom, doc } = await view(); const cards = doc.querySelectorAll(".photo-slot"); assert.equal(cards.length, 13);
  cards.forEach(card => { assert.equal(card.querySelectorAll("input[type=file]").length, 2); assert.equal(card.querySelector("[capture]").getAttribute("capture"), "environment"); assert.equal(card.querySelector("input:not([capture])").multiple, true); });
  assert.equal(doc.querySelector("[data-slot=tableau-de-bord]").querySelector("h3").textContent, "Tableau de bord");
  assert.equal(doc.querySelectorAll(".signature-pad").length, 2); dom.window.close();
});
test("V3 : tableau des dommages conserve une description facultative dans la marque existante", async () => {
  const { dom, doc } = await view({ mode: "depart" });
  const input = doc.querySelector("#damageTable input"); assert.ok(input); input.value = "Rayure profonde porte avant"; input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  assert.match(doc.querySelector("#damageTable").textContent, /Existant/);
  assert.equal(doc.querySelector("#sketch [data-mark-id]").dataset.x, "20");
  dom.window.close();
});
test("V3 : historique reste en lecture seule et conserve le lecteur existant", async () => {
  const { dom, doc, requests } = await view({ legacy: true, mode: "depart" });
  assert.equal(doc.getElementById("form").hidden, true); assert.equal(doc.getElementById("legacyContent").hidden, false);
  assert.match(doc.getElementById("legacyContent").textContent, /4083/);
  assert.equal(requests.length, 1); assert.match(requests[0].url, /legacy-inspection-agency/); assert.equal(requests[0].options.method, undefined); dom.window.close();
});
test("V3 : impression directe retire le fragment sécurisé jusqu'à afterprint", async () => {
  const { dom } = await view(); const hash = dom.window.location.hash;
  dom.window.dispatchEvent(new dom.window.Event("beforeprint")); assert.equal(dom.window.location.hash, "");
  dom.window.dispatchEvent(new dom.window.Event("afterprint")); assert.equal(dom.window.location.hash, hash); dom.window.close();
});
