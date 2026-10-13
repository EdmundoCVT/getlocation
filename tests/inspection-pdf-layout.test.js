const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PDFDocument } = require("pdf-lib");
const { generateInspectionPdf } = require("../src/lib/inspection-pdf-server.js");

const root = path.join(__dirname, "..");
const jpeg = fs.readFileSync(path.join(root, "images/opel-corsa.jpg"));
const imageDataUrl = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
const env = {
  ASSETS: { async fetch(request) {
    const file = path.join(root, new URL(request.url).pathname);
    return fs.existsSync(file) ? new Response(fs.readFileSync(file), { headers: { "content-type": "image/png" } }) : new Response(null, { status: 404 });
  } },
  DOCUMENTS_BUCKET: { async get() { return { httpMetadata: { contentType: "image/jpeg" }, async arrayBuffer() { return jpeg; } }; } }
};
const signatures = {
  client: { name: "Client Test", signedAt: "2026-10-13T10:00", displaySignedAt: "2026-10-13T09:30", imageDataUrl },
  agence: { name: "GET LOCATION", signedAt: "2026-10-13T10:05", imageDataUrl }
};
function scenario(count, family, stage) {
  return {
    env, id: "edl_test", stage, revision: 5,
    vehicleFamily: family,
    vehicle: { nom: family === "utility" ? "Toyota Proace" : "Peugeot 3008", immatriculation: "AB-123-CD" },
    rental: { reference: "GL-20261013-0001", client: { prenom: "Jeanne", nom: "Martin" } },
    snapshot: {
      dateHeure: "2026-10-13T10:00", km: 0, carburant: 0, cles: 0,
      clesAccessoires: "Triangle et gilet", agent: "Agence Paris",
      propreteExterieure: 4, propreteInterieure: 3,
      propreteChargement: family === "utility" ? 2 : null,
      dommages: "Constat sans réserve supplémentaire.", signatures,
      sketchVehicleType: family,
      marks: family === "car" ? [{ view: "left", type: "rayure", x: 20, y: 30, description: "Rayure longue avec description détaillée. ".repeat(25) }] : [],
      utilityMarks: family === "utility" ? [{ surface: "utility-interior", view: "floor", type: "bosse", x: 25, y: 40, description: "Choc sur plancher" }] : []
    },
    media: Array.from({ length: count }, (_, i) => ({ key: `photo-${i}`, label: `Photo ${i + 1}`, capturedAt: "2026-10-13T09:30", contentType: "image/jpeg" }))
  };
}

for (const family of ["car", "utility"]) for (const stage of ["depart", "retour"]) for (const count of [0, 3, 10, 20]) {
  test(`PDF ${family} ${stage} avec ${count} photos conserve une pagination compacte`, async () => {
    const bytes = await generateInspectionPdf(scenario(count, family, stage));
    const pdf = await PDFDocument.load(bytes);
    const expected = 1 + (family === "utility" ? 2 : 1) + Math.ceil(count / 9);
    assert.ok(pdf.getPageCount() >= expected && pdf.getPageCount() <= expected + (count === 0 ? 1 : 0), "une première page chargée peut nécessiter une page de signatures");
    assert.ok(pdf.getPages().every(page => page.getWidth() > 590 && page.getHeight() > 840));
  });
}

test("une photo R2 manquante n'empêche pas le PDF officiel", async () => {
  const input = scenario(3, "car", "depart");
  input.env = { ...env, DOCUMENTS_BUCKET: { async get(key) { return key === "photo-1" ? null : env.DOCUMENTS_BUCKET.get(key); } } };
  const pdf = await PDFDocument.load(await generateInspectionPdf(input));
  assert.equal(pdf.getPageCount(), 3);
});
