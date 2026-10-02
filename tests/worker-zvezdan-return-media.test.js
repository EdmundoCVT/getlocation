const test = require("node:test");
const assert = require("node:assert/strict");

const { makeAgencyEnv, loginAgency, agencyRequest } = require("./helpers/agency-session.js");
const { createFakeKv } = require("./helpers/fake-kv.js");
const { handleZvezdanReturnMedia, parseJpegExif, PREFIX } = require("../src/api/zvezdan-return-media.js");

function writeAscii(bytes, offset, value) {
  for (let i = 0; i < value.length; i += 1) bytes[offset + i] = value.charCodeAt(i);
}

function jpegWithExif() {
  const tiff = new Uint8Array(230);
  const view = new DataView(tiff.buffer);
  writeAscii(tiff, 0, "II");
  view.setUint16(2, 42, true); view.setUint32(4, 8, true);
  view.setUint16(8, 4, true);
  // Model: ASCII at byte 70.
  view.setUint16(10, 0x0110, true); view.setUint16(12, 2, true); view.setUint32(14, 7, true); view.setUint32(18, 70, true);
  // Orientation: inline SHORT.
  view.setUint16(22, 0x0112, true); view.setUint16(24, 3, true); view.setUint32(26, 1, true); view.setUint16(30, 6, true);
  // ModifyDate: ASCII at byte 80.
  view.setUint16(34, 0x0132, true); view.setUint16(36, 2, true); view.setUint32(38, 20, true); view.setUint32(42, 80, true);
  // Exif IFD: byte 120.
  view.setUint16(46, 0x8769, true); view.setUint16(48, 4, true); view.setUint32(50, 1, true); view.setUint32(54, 120, true);
  view.setUint32(58, 0, true);
  writeAscii(tiff, 70, "iPhone\0");
  writeAscii(tiff, 80, "2026:09:25 19:30:00\0");
  view.setUint16(120, 2, true);
  view.setUint16(122, 0x9003, true); view.setUint16(124, 2, true); view.setUint32(126, 20, true); view.setUint32(130, 150, true);
  view.setUint16(134, 0x9004, true); view.setUint16(136, 2, true); view.setUint32(138, 20, true); view.setUint32(142, 180, true);
  view.setUint32(146, 0, true);
  writeAscii(tiff, 150, "2026:09:25 19:00:00\0");
  writeAscii(tiff, 180, "2026:09:25 19:00:01\0");
  const payload = new Uint8Array(6 + tiff.length); writeAscii(payload, 0, "Exif\0\0"); payload.set(tiff, 6);
  const jpeg = new Uint8Array(2 + 2 + 2 + payload.length + 2);
  jpeg.set([0xff, 0xd8, 0xff, 0xe1], 0); new DataView(jpeg.buffer).setUint16(4, payload.length + 2, false); jpeg.set(payload, 6); jpeg.set([0xff, 0xd9], 6 + payload.length);
  return jpeg;
}

function fakeBucket() {
  const objects = new Map();
  return {
    writes: 0,
    async put(key, body, options = {}) { this.writes += 1; objects.set(key, { body, options }); },
    async get(key) {
      const object = objects.get(key); if (!object) return null;
      return { body: new Blob([object.body]).stream(), writeHttpMetadata(headers) { headers.set("content-type", object.options.contentType || "image/jpeg"); } };
    },
    async list({ prefix = "" } = {}) { return { objects: [...objects.entries()].filter(([key]) => key.startsWith(prefix)).map(([key, object]) => ({ key, size: object.body.byteLength || object.body.length, uploaded: new Date("2026-09-25T19:30:00.000Z") })), truncated: false }; }
  };
}

test("analyse EXIF JPEG : dates, appareil et orientation sont lus sans transformation", () => {
  const exif = parseJpegExif(jpegWithExif().buffer);
  assert.deepEqual(exif, { available: true, model: "iPhone", orientation: 6, modifyDate: "2026:09:25 19:30:00", dateTimeOriginal: "2026:09:25 19:00:00", createDate: "2026:09:25 19:00:01" });
  assert.equal(parseJpegExif(new Uint8Array([1, 2, 3]).buffer).available, false);
});

test("récupération Zvezdan : session obligatoire, manifest R2 privé et téléchargement original exact", async () => {
  const bucket = fakeBucket();
  const env = makeAgencyEnv({ RESERVATIONS_KV: createFakeKv(), DOCUMENTS_BUCKET: bucket });
  const session = await loginAgency(env);
  const key = PREFIX + "retour-original.jpg";
  const original = jpegWithExif();
  await bucket.put(key, original, { contentType: "image/jpeg" });
  const writesBefore = bucket.writes;

  const noSession = await handleZvezdanReturnMedia(agencyRequest("https://getlocation.fr/api/zvezdan-return-media"), env);
  assert.equal(noSession.status, 401);
  const noPost = await handleZvezdanReturnMedia(agencyRequest("https://getlocation.fr/api/zvezdan-return-media", { session, method: "POST" }), env);
  assert.equal(noPost.status, 405);

  const manifest = await handleZvezdanReturnMedia(agencyRequest("https://getlocation.fr/api/zvezdan-return-media", { session }), env);
  assert.equal(manifest.status, 200);
  const listed = await manifest.json();
  assert.equal(listed.count, 1);
  assert.equal(listed.photos[0].key, key);
  assert.equal(listed.photos[0].exif.dateTimeOriginal, "2026:09:25 19:00:00");
  assert.ok(!JSON.stringify(listed).includes("data:image"));

  const file = await handleZvezdanReturnMedia(agencyRequest(`https://getlocation.fr/api/zvezdan-return-media?key=${encodeURIComponent(key)}&download=1`, { session }), env);
  assert.equal(file.status, 200);
  assert.match(file.headers.get("content-disposition"), /attachment; filename="retour-original\.jpg"/);
  assert.deepEqual(new Uint8Array(await new Response(file.body).arrayBuffer()), original, "le flux téléchargé est l'original R2 exact");
  const foreign = await handleZvezdanReturnMedia(agencyRequest("https://getlocation.fr/api/zvezdan-return-media?key=inspection%2Fother%2Fretour%2Fphoto.jpg", { session }), env);
  assert.equal(foreign.status, 404);
  assert.equal(bucket.writes, writesBefore, "GET/EXIF ne réécrit jamais R2");
});
