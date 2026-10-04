// Offline PDF rendering fixture: real source diagrams, embedded image data,
// departure/return marks and both signatures. Never reads production KV/R2.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const { PDFDocument } = require("pdf-lib");
const root = path.join(__dirname, "..");
const output = process.argv[2] || "/tmp/getlocation-inspection-pdf";
fs.mkdirSync(output, { recursive: true });
const jpeg = fs.readFileSync(path.join(root, "images/opel-corsa-fleet.jpg"));
global.window = global;
global.PDFLib = require("pdf-lib");
global.Image = class { set src(value) { this._src = value; } get naturalWidth() { return 480; } get naturalHeight() { return 640; } };
global.document = { createElement() { return { width: 0, height: 0, getContext() { return { fillRect() {}, drawImage() {} }; }, toDataURL() { return "data:image/jpeg;base64," + jpeg.toString("base64"); } }; } };
global.fetch = async asset => {
  const file = path.join(root, String(asset).replace(/^\//, ""));
  return { ok: fs.existsSync(file), arrayBuffer: async () => fs.readFileSync(file) };
};
global.InspectionMedia = {
  date: value => value ? new Date(value).toLocaleString("fr-FR", { timeZone: "Europe/Paris" }) : "Non renseignee",
  decode: async image => image,
  labels: { avant: "Avant", arriere: "Arriere", gauche: "Cote gauche", droite: "Cote droit", interieur: "Interieur" }
};
vm.runInThisContext(fs.readFileSync(path.join(root, "js/inspection-sketch.js"), "utf8"));
vm.runInThisContext(fs.readFileSync(path.join(root, "js/inspection-document.js"), "utf8"));
const mark = (view, i) => ({ id: "m" + i, view, type: i % 2 ? "rayure" : "bosse", x: 28 + i * 7, y: 42, description: "Constat sur " + view });
const views = ["left", "front", "right", "rear", "top"];
const signature = name => ({ name, signedAt: "2026-10-04T09:30:00Z", imageDataUrl: "data:image/jpeg;base64," + jpeg.toString("base64") });
const depart = {
  dateHeure: "2026-10-01T09:45", agent: "Agent GET LOCATION", km: 4083, carburant: 90, cles: 2,
  propreteExterieure: 2, propreteInterieure: 4, propreteChargement: 5,
  dommages: "Rayure profil conducteur et eclat a l'avant.", marks: views.map(mark),
  signatures: { client: signature("Client Exemple"), agence: signature("Agent Exemple") }
};
const retour = {
  ...depart, dateHeure: "2026-10-08T18:20", km: 4500, carburant: 70,
  dommages: "Nouvelle marque au retour.", marks: [mark("rear", 6), mark("top", 7)]
};
const photo = (stage, i) => ({ key: stage + i, slot: views[i % views.length] === "top" ? "interieur" : ["gauche","avant","droite","arriere"][i%4], capturedAt: "2026-10-01T08:20:00Z" });
const cache = { get: async () => "data:image/jpeg;base64," + jpeg.toString("base64") };
(async () => {
  for (const mode of ["depart", "retour"]) {
    const data = await global.InspectionDocument.generate({
      mode, reference: "GL-TEST-0001", summary: [["Client", "Client Exemple"],["Vehicule", "Opel Corsa"],["Immatriculation", "AA-000-AA"],["Depart prevu", "01/10/2026"],["Retour prevu", "08/10/2026"]],
      stage: mode === "depart" ? depart : retour, depart,
      photos: Array.from({length:mode === "depart" ? 7 : 5},(_,i)=>photo(mode,i)),
      departPhotos: Array.from({length:7},(_,i)=>photo("depart",i))
    }, cache);
    const target = path.join(output, mode + ".pdf"); fs.writeFileSync(target, data);
    const parsed = await PDFDocument.load(data);
    assert.ok(parsed.getPageCount() >= 3);
    console.log(mode, parsed.getPageCount(), target);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
