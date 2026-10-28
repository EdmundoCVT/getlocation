const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
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

function extractPdfText(file) {
  try {
    return execFileSync("pdftotext", [file, "-"], { encoding: "utf8" });
  } catch (error) {
    // Some restricted test runners report EPERM after the child process has
    // nevertheless completed successfully and returned its stdout.
    if (error?.status === 0 && error.stdout) return String(error.stdout);
    throw error;
  }
}

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

test("le PDF officiel préfère optimizedKey et reste compatible avec les médias historiques", async () => {
  const requested = [];
  const input = scenario(2, "car", "depart");
  input.media[0].optimizedKey = "photo-0-pdf.jpg";
  input.env = { ...env, DOCUMENTS_BUCKET: { async get(key) { requested.push(key); return env.DOCUMENTS_BUCKET.get(key); } } };
  await generateInspectionPdf(input);
  assert.deepEqual(requested, ["photo-0-pdf.jpg", "photo-1"], "la photo moderne utilise le dérivé, l’ancienne son original");
});

test("un dérivé R2 absent retombe sur l’original sans bloquer le PDF", async () => {
  const requested = [], input = scenario(1, "car", "depart"); input.media[0].optimizedKey = "missing-pdf.jpg";
  input.env = { ...env, DOCUMENTS_BUCKET: { async get(key) { requested.push(key); return key === "missing-pdf.jpg" ? null : env.DOCUMENTS_BUCKET.get(key); } } };
  const output = await generateInspectionPdf(input);
  assert.ok(output.byteLength > 0); assert.deepEqual(requested, ["missing-pdf.jpg", "photo-0"]);
});

test("12 originaux lourds utilisent leurs dérivés et gardent le PDF sous 10 Mo", async () => {
  const heavySize = 3 * 1024 * 1024;
  const heavyJpeg = Buffer.concat([jpeg, Buffer.alloc(heavySize - jpeg.length)]);
  const originalInput = scenario(12, "car", "retour");
  originalInput.env = { ...env, DOCUMENTS_BUCKET: { async get() { return { httpMetadata: { contentType: "image/jpeg" }, async arrayBuffer() { return heavyJpeg; } }; } } };
  const optimizedInput = scenario(12, "car", "retour");
  optimizedInput.media = optimizedInput.media.map((item, index) => ({ ...item, optimizedKey: `photo-${index}-pdf.jpg`, optimizedSize: jpeg.length, optimizedWidth: 1000, optimizedHeight: 750 }));
  optimizedInput.env = { ...env, DOCUMENTS_BUCKET: { async get(key) { return { httpMetadata: { contentType: "image/jpeg" }, async arrayBuffer() { return /-pdf\.jpg$/.test(key) ? jpeg : heavyJpeg; } }; } } };
  const before = await generateInspectionPdf(originalInput), after = await generateInspectionPdf(optimizedInput);
  assert.ok(after.byteLength < 10 * 1024 * 1024, `PDF optimisé : ${after.byteLength} octets`);
  assert.ok(after.byteLength < before.byteLength / 5, `avant ${before.byteLength}, après ${after.byteLength}`);
});

test("1, 5, 10, 20 et 30 photos lourdes utilisent uniquement les dérivés", async () => {
  for (const count of [1, 5, 10, 20, 30]) {
    const requested = [], input = scenario(count, "car", "depart");
    input.media = input.media.map((item, index) => ({ ...item, size: 3 * 1024 * 1024, optimizedKey: `photo-${index}-pdf.jpg`, optimizedSize: jpeg.length }));
    input.env = { ...env, DOCUMENTS_BUCKET: { async get(key) { requested.push(key); return env.DOCUMENTS_BUCKET.get(key); } } };
    const output = await generateInspectionPdf(input);
    assert.equal(requested.length, count); assert.ok(requested.every(key => /-pdf\.jpg$/.test(key)), `${count} dérivés`);
    assert.ok(output.byteLength < 10 * 1024 * 1024, `${count} photos : PDF sous l’objectif de 10 Mo`);
  }
});

test("les PDF clients départ V2 et retour V3 masquent toute indication de version", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "inspection-pdf-version-"));
  try {
    for (const [stage, revision, phase] of [["depart", 2, "DÉPART"], ["retour", 3, "RETOUR"]]) {
      const input = scenario(0, "car", stage); input.revision = revision;
      const file = path.join(directory, `${stage}-v${revision}.pdf`);
      fs.writeFileSync(file, await generateInspectionPdf(input));
      const content = extractPdfText(file);
      assert.match(content, new RegExp(phase));
      assert.doesNotMatch(content, /\bV[1-4]\b/);
      assert.doesNotMatch(content, /\b(?:Version|Révision)\b/i);
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
