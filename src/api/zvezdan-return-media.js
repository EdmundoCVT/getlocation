// Récupération forensique temporaire des originaux R2 du retour Zvezdan.
// Lecture seule, strictement limitée au dossier demandé et à une session agence.
const { requireAgencySession } = require("../lib/agency-auth.js");
const { ZVEZDAN_LEGACY_ID } = require("./legacy-inspection-agency.js");

const PREFIX = `inspection/${ZVEZDAN_LEGACY_ID}/retour/`;

function headers(request) {
  return { "Content-Type": "application/json", "Cache-Control": "no-store", Vary: "Cookie" };
}

function iso(value) {
  return value && typeof value.toISOString === "function" ? value.toISOString() : value || null;
}

function decodeAscii(bytes, offset, count) {
  return new TextDecoder("ascii").decode(bytes.slice(offset, offset + count)).replace(/\0+$/, "").trim() || null;
}

// Analyse minimale et non destructive de l'APP1 Exif d'un JPEG. Aucune
// métadonnée n'est réécrite : seules les balises demandées sont lues.
function parseJpegExif(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return { available: false, reason: "Fichier non JPEG ou EXIF absent" };
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2 || offset + 2 + length > bytes.length) break;
    if (marker === 0xe1 && bytes[offset + 4] === 0x45 && bytes[offset + 5] === 0x78 && bytes[offset + 6] === 0x69 && bytes[offset + 7] === 0x66 && bytes[offset + 8] === 0 && bytes[offset + 9] === 0) {
      const base = offset + 10;
      if (base + 8 > bytes.length) break;
      const order = String.fromCharCode(bytes[base], bytes[base + 1]);
      if (order !== "II" && order !== "MM") break;
      const little = order === "II";
      const view = new DataView(buffer);
      const u16 = (position) => view.getUint16(position, little);
      const u32 = (position) => view.getUint32(position, little);
      if (u16(base + 2) !== 42) break;
      const typeSize = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8 };
      const fields = {};
      function readIfd(position) {
        if (position < base || position + 2 > bytes.length) return;
        const count = u16(position);
        for (let index = 0; index < count; index += 1) {
          const entry = position + 2 + index * 12;
          if (entry + 12 > bytes.length) return;
          const tag = u16(entry), type = u16(entry + 2), values = u32(entry + 4), size = (typeSize[type] || 0) * values;
          const data = size <= 4 ? entry + 8 : base + u32(entry + 8);
          if (!size || data < base || data + size > bytes.length) continue;
          if (tag === 0x0110) fields.model = decodeAscii(bytes, data, values);
          if (tag === 0x0112 && type === 3) fields.orientation = u16(data);
          if (tag === 0x0132) fields.modifyDate = decodeAscii(bytes, data, values);
          if (tag === 0x9003) fields.dateTimeOriginal = decodeAscii(bytes, data, values);
          if (tag === 0x9004) fields.createDate = decodeAscii(bytes, data, values);
          if (tag === 0x8769 && type === 4) readIfd(base + u32(entry + 8));
        }
      }
      readIfd(base + u32(base + 4));
      return { available: Object.keys(fields).length > 0, ...fields };
    }
    offset += 2 + length;
  }
  return { available: false, reason: "EXIF absent" };
}

async function listObjects(bucket) {
  const objects = [];
  let cursor;
  do {
    const page = await bucket.list({ prefix: PREFIX, cursor });
    objects.push(...(page.objects || []));
    cursor = page.truncated ? page.cursor : null;
  } while (cursor);
  return objects;
}

async function manifest(request, env) {
  if (!env.DOCUMENTS_BUCKET) return new Response(JSON.stringify({ error: "Stockage indisponible" }), { status: 503, headers: headers(request) });
  const objects = await listObjects(env.DOCUMENTS_BUCKET);
  const photos = [];
  for (const object of objects) {
    const file = await env.DOCUMENTS_BUCKET.get(object.key);
    let exif = { available: false, reason: "Objet introuvable" };
    if (file) {
      try { exif = parseJpegExif(await new Response(file.body).arrayBuffer()); } catch (_) { exif = { available: false, reason: "EXIF illisible" }; }
    }
    photos.push({ key: object.key, size: Number.isFinite(object.size) ? object.size : null, uploaded: iso(object.uploaded), exif });
  }
  return new Response(JSON.stringify({ id: ZVEZDAN_LEGACY_ID, prefix: PREFIX, count: photos.length, photos }), { status: 200, headers: headers(request) });
}

function filename(key) {
  return key.slice(key.lastIndexOf("/") + 1).replace(/[^A-Za-z0-9._-]/g, "_") || "photo-originale";
}

async function original(request, env, key, download) {
  if (!key.startsWith(PREFIX) || !env.DOCUMENTS_BUCKET) return new Response(null, { status: 404 });
  const object = await env.DOCUMENTS_BUCKET.get(key);
  if (!object) return new Response(null, { status: 404 });
  const responseHeaders = new Headers();
  object.writeHttpMetadata(responseHeaders);
  responseHeaders.set("Cache-Control", "private, no-store");
  responseHeaders.set("X-Content-Type-Options", "nosniff");
  if (download) responseHeaders.set("Content-Disposition", `attachment; filename="${filename(key)}"`);
  return new Response(object.body, { status: 200, headers: responseHeaders });
}

async function handleZvezdanReturnMedia(request, env) {
  if (request.method !== "GET") return new Response(JSON.stringify({ error: "Méthode non autorisée" }), { status: 405, headers: headers(request) });
  const auth = await requireAgencySession(request, env);
  if (auth.error) return auth.error;
  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  return key ? original(request, env, key, url.searchParams.get("download") === "1") : manifest(request, env);
}

module.exports = { handleZvezdanReturnMedia, parseJpegExif, PREFIX };
