const test = require("node:test");
const assert = require("node:assert/strict");
const optimizer = require("../js/inspection-image-optimizer.js");

test("optimisation EDL : dimensions paysage, portrait et petites images conservent leur ratio", () => {
  assert.deepEqual(optimizer.dimensions(4032, 3024), { width: 1920, height: 1440 });
  assert.deepEqual(optimizer.dimensions(3024, 4032), { width: 1440, height: 1920 });
  assert.deepEqual(optimizer.dimensions(1170, 2532), { width: 887, height: 1920 });
  assert.deepEqual(optimizer.dimensions(1200, 900), { width: 1200, height: 900 });
});

test("optimisation EDL : les cas véhicule, rayure, impact et photo sombre gardent une définition de preuve", () => {
  const fixtures = [
    { name: "vue véhicule paysage", width: 4032, height: 3024 },
    { name: "rayure fine portrait", width: 3024, height: 4032 },
    { name: "impact carrosserie", width: 4000, height: 3000 },
    { name: "photo sombre smartphone", width: 3840, height: 2160 }
  ];
  for (const fixture of fixtures) {
    const output = optimizer.dimensions(fixture.width, fixture.height);
    assert.equal(Math.max(output.width, output.height), 1920, fixture.name);
    assert.ok(Math.min(output.width, output.height) >= 1080, fixture.name + " reste lisible");
    assert.ok(Math.abs(output.width / output.height - fixture.width / fixture.height) < 0.002, fixture.name + " conserve son ratio");
  }
});

test("optimisation EDL : createImageBitmap applique l’orientation EXIF et produit un JPEG à 0,76", async () => {
  let bitmapOptions, canvasSize, jpegOptions, closed = false;
  const file = new File(["heic-original"], "iphone.heic", { type: "image/heic" });
  const result = await optimizer.optimize(file, {
    async createImageBitmap(_, options) { bitmapOptions = options; return { width: 3024, height: 4032, close() { closed = true; } }; },
    createCanvas(width, height) {
      canvasSize = [width, height];
      return {
        width, height,
        getContext() { return { fillStyle: "", fillRect() {}, drawImage() {} }; },
        toBlob(callback, type, quality) { jpegOptions = [type, quality]; callback(new Blob(["jpeg-optimized"], { type })); }
      };
    }
  });
  assert.deepEqual(bitmapOptions, { imageOrientation: "from-image" });
  assert.deepEqual(canvasSize, [1440, 1920]);
  assert.deepEqual(jpegOptions, ["image/jpeg", 0.76]);
  assert.equal(result.blob.type, "image/jpeg"); assert.equal(result.fileName, "iphone-pdf.jpg"); assert.equal(closed, true);
});

test("optimisation EDL : une scène très détaillée reste entre 1600 px et qualité 0,72", async () => {
  const qualities = [], sizes = [900 * 1024, 800 * 1024, 480 * 1024];
  const canvas = {
    width: 0, height: 0,
    getContext() { return { fillStyle: "", fillRect() {}, drawImage() {} }; },
    toBlob(callback, type, quality) { qualities.push(quality); callback(new Blob([new Uint8Array(sizes.shift())], { type })); }
  };
  const result = await optimizer.optimize(new File(["jpeg"], "detail.jpg", { type: "image/jpeg" }), {
    async createImageBitmap() { return { width: 4032, height: 3024, close() {} }; },
    createCanvas(width, height) { canvas.width = width; canvas.height = height; return canvas; }
  });
  assert.deepEqual(qualities, [0.76, 0.72, 0.72]);
  assert.deepEqual([result.optimizedWidth, result.optimizedHeight], [1600, 1200]);
  assert.equal(result.blob.size, 480 * 1024);
});

for (const count of [1, 5, 10, 20, 30]) {
  test(`optimisation EDL : ${count} photos sont traitées strictement en séquence`, async () => {
    let active = 0, maxActive = 0, progress = 0;
    const output = await optimizer.sequential(Array.from({ length: count }, (_, index) => index), async value => {
      active++; maxActive = Math.max(maxActive, active); await Promise.resolve(); active--; return value + 1;
    }, current => { progress = current; });
    assert.equal(maxActive, 1, "un seul grand bitmap reste en mémoire sur iPhone");
    assert.equal(progress, count); assert.equal(output.length, count);
  });
}

test("optimisation EDL : formats déjà acceptés, dont HEIC/HEIF, restent reconnus", () => {
  for (const type of ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]) assert.equal(optimizer.isSupported(type), true);
  assert.equal(optimizer.isSupported("application/pdf"), false);
});
