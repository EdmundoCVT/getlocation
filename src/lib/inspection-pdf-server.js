// Rendu officiel des nouvelles révisions EDL. Les PDF déjà archivés sont lus
// depuis R2 par les routes dédiées et ne passent jamais dans ce renderer.
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const { build } = require("./inspection-document-model.js");

const PAGE = [595.28, 841.89];
const MARGIN = 38;
const WIDTH = PAGE[0] - MARGIN * 2;
const ORANGE = rgb(1, 0.42, 0);
const INK = rgb(0.08, 0.13, 0.2);
const MUTED = rgb(0.34, 0.4, 0.48);
const BORDER = rgb(0.78, 0.82, 0.87);
const PALE = rgb(0.965, 0.972, 0.98);

function formatClientDate(value) {
  if (!value) return "—";
  // Une date datetime-local est une heure métier, sans conversion de fuseau.
  const local = /^(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d)(?::\d\d(?:\.\d+)?)?$/.exec(String(value));
  if (local) return `${local[3]}/${local[2]}/${local[1]} ${local[4]}:${local[5]}`;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("fr-FR", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}
async function assetBytes(env, path) {
  if (!env.ASSETS) return null;
  const response = await env.ASSETS.fetch(new Request(`https://getlocation.local${path}`));
  return response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
}
async function r2Image(env, item) {
  try {
    const object = await env.DOCUMENTS_BUCKET.get(item.key);
    if (!object) return null;
    const type = object.httpMetadata && object.httpMetadata.contentType || item.contentType || "";
    if (!/^image\/(jpeg|png)$/i.test(type)) return null;
    return { bytes: new Uint8Array(await object.arrayBuffer()), type };
  } catch (_) { return null; }
}
async function embed(pdf, bytes, type) {
  try { return /png/i.test(type || "") ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes); }
  catch (_) { return null; }
}
function dataImage(value) {
  const match = /^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=]+)$/i.exec(value || "");
  if (!match) return null;
  try { const raw = atob(match[2]); return { bytes: Uint8Array.from(raw, char => char.charCodeAt(0)), type: match[1] }; }
  catch (_) { return null; }
}

async function generateInspectionPdf({ env, id, stage, revision, snapshot, media, vehicle, rental, vehicleFamily }) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const model = build({ id, stage, revision, snapshot, media, vehicle, rental, vehicleFamily });
  const phase = stage === "retour" ? "RETOUR" : "DÉPART";
  const pages = [];

  // Les polices standard ne couvrent pas tous les caractères Unicode. Une
  // substitution visible évite qu'une remarque libre fasse échouer l'archive.
  function printable(value) {
    return String(value == null ? "" : value).replace(/\r\n?/g, "\n").replace(/[\t\f]/g, " ").replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, "").split("").map(char => {
      if (char === "\n") return char;
      try { regular.encodeText(char); return char; } catch (_) { return "?"; }
    }).join("");
  }
  function fitLines(value, font, size, width) {
    const lines = [];
    for (const paragraph of printable(value).split("\n")) {
      if (!paragraph.trim()) { lines.push(""); continue; }
      let line = "";
      for (const word of paragraph.trim().split(/\s+/)) {
        const candidate = line ? line + " " + word : word;
        if (font.widthOfTextAtSize(candidate, size) <= width) { line = candidate; continue; }
        if (line) { lines.push(line); line = ""; }
        for (const char of word) {
          if (line && font.widthOfTextAtSize(line + char, size) > width) { lines.push(line); line = ""; }
          line += char;
        }
      }
      lines.push(line);
    }
    return lines;
  }
  function text(page, value, x, y, size = 9, font = regular, color = INK) {
    page.drawText(printable(value), { x, y, size, font, color });
  }
  function multiline(page, lines, x, y, size, lineHeight, font = regular, color = INK) {
    for (const line of lines) { if (line) text(page, line, x, y, size, font, color); y -= lineHeight; }
    return y;
  }
  function addPage(title, first = false) {
    const page = pdf.addPage(PAGE);
    pages.push(page);
    text(page, "GET LOCATION", MARGIN, 802, 15, bold, ORANGE);
    text(page, "ÉTAT DES LIEUX DU VÉHICULE", 337, 804, 9, bold, INK);
    page.drawLine({ start: { x: MARGIN, y: 789 }, end: { x: PAGE[0] - MARGIN, y: 789 }, thickness: 2.5, color: ORANGE });
    if (first) {
      text(page, model.header.reference, MARGIN, 767, 9, bold);
      // Le numéro de révision reste une métadonnée interne (R2, Drive,
      // historique) et ne doit jamais apparaître dans le document client.
      text(page, phase, phase === "RETOUR" ? 500 : 494, 767, 9, bold, ORANGE);
      if (model.condition.dateHeure) text(page, `Constat du ${formatClientDate(model.condition.dateHeure)}`, MARGIN, 752, 8, regular, MUTED);
      return { page, y: model.condition.dateHeure ? 725 : 739 };
    }
    text(page, title, MARGIN, 761, 12, bold);
    return { page, y: 734 };
  }
  function heading(state, label, minSpace = 54) {
    if (state.y < minSpace + 54) state = addPage(label + " (suite)");
    text(state.page, label.toUpperCase(), MARGIN, state.y, 10, bold, INK);
    state.page.drawLine({ start: { x: MARGIN, y: state.y - 6 }, end: { x: PAGE[0] - MARGIN, y: state.y - 6 }, thickness: 0.7, color: ORANGE });
    state.y -= 23;
    return state;
  }
  function hasValue(value) { return value !== null && value !== undefined && value !== ""; }
  function fields(state, label, entries) {
    const visible = entries.filter(([, value]) => hasValue(value));
    if (!visible.length) return state;
    state = heading(state, label);
    const gap = 6, width = (WIDTH - gap * 2) / 3;
    for (let i = 0; i < visible.length; i += 3) {
      const row = visible.slice(i, i + 3);
      const contents = row.map(([, value]) => fitLines(value, regular, 8.6, width - 16));
      const height = Math.max(45, ...contents.map(lines => 24 + lines.length * 11));
      if (state.y - height < 60) state = heading(addPage(label + " (suite)"), label, height);
      row.forEach(([name], col) => {
        const x = MARGIN + col * (width + gap), bottom = state.y - height;
        state.page.drawRectangle({ x, y: bottom, width, height, color: PALE, borderColor: BORDER, borderWidth: 0.55 });
        text(state.page, name.toUpperCase(), x + 8, state.y - 13, 7, bold, MUTED);
        multiline(state.page, contents[col], x + 8, state.y - 27, 8.6, 11);
      });
      state.y -= height + gap;
    }
    state.y -= 10;
    return state;
  }
  function score(value) { return hasValue(value) ? `${value}/5` : null; }
  function drawDamages(state) {
    if (!model.damageMarks.length) return state;
    state = heading(state, "Détails des dommages", 85);
    const columns = [
      { x: MARGIN + 6, w: 23, label: "N°" },
      { x: MARGIN + 33, w: 76, label: "TYPE" },
      { x: MARGIN + 113, w: 94, label: "ZONE" },
      { x: MARGIN + 211, w: 201, label: "DESCRIPTION" },
      { x: MARGIN + 416, w: 99, label: "STATUT" }
    ];
    function tableHeader() {
      state.page.drawRectangle({ x: MARGIN, y: state.y - 22, width: WIDTH, height: 22, color: PALE, borderColor: BORDER, borderWidth: 0.5 });
      for (const column of columns) text(state.page, column.label, column.x, state.y - 14, 7.2, bold, MUTED);
      state.y -= 22;
    }
    tableHeader();
    for (const [index, mark] of model.damageMarks.entries()) {
      const values = [mark.number, mark.typeLabel, mark.zoneLabel, mark.description || "Sans description", mark.statusLabel || ""];
      const lines = values.map((value, col) => fitLines(value, regular, 8.1, columns[col].w - 3));
      const height = Math.max(27, ...lines.map(item => 11 + item.length * 10.5));
      if (state.y - height < 59) {
        state = heading(addPage("Dommages (suite)"), "Détails des dommages (suite)", height + 25);
        tableHeader();
      }
      state.page.drawRectangle({ x: MARGIN, y: state.y - height, width: WIDTH, height, color: index % 2 ? PALE : rgb(1, 1, 1), borderColor: BORDER, borderWidth: 0.35 });
      lines.forEach((item, col) => multiline(state.page, item, columns[col].x, state.y - 13, 8.1, 10.5));
      state.y -= height;
    }
    state.y -= 15;
    return state;
  }
  function remarks(state, value) {
    if (!hasValue(value)) return state;
    state = heading(state, "Remarques et réserves");
    const lines = fitLines(value, regular, 9, WIDTH - 20);
    for (const line of lines) {
      if (state.y < 68) state = heading(addPage("Remarques (suite)"), "Remarques et réserves (suite)");
      if (line) text(state.page, line, MARGIN + 10, state.y, 9);
      state.y -= 13;
    }
    state.y -= 10;
    return state;
  }

  let state = addPage(null, true);
  const customer = model.rental.client || {};
  const clientName = [customer.prenom || customer.firstName, customer.nom || customer.lastName].filter(Boolean).join(" ");
  state = fields(state, "Informations générales", [
    ["Locataire", clientName || customer.name],
    ["Véhicule", model.vehicle.nom || model.vehicle.name],
    ["Immatriculation", model.vehicle.immatriculation],
    ["Date et heure", hasValue(model.condition.dateHeure) ? formatClientDate(model.condition.dateHeure) : null],
    ["Agent", model.condition.agent],
    ["Kilométrage", hasValue(model.condition.km) ? model.condition.km + " km" : null],
    ["Carburant / charge", hasValue(model.condition.carburant) ? model.condition.carburant + " %" : null],
    ["Clés", model.condition.cles],
    ["Accessoires", model.condition.accessoires]
  ]);
  state = fields(state, "Propreté", [
    ["Extérieur", score(model.condition.propreteExterieure)],
    ["Intérieur", score(model.condition.propreteInterieure)],
    ["Espace de chargement", score(model.condition.propreteChargement)],
    ["État général", model.condition.proprete]
  ]);
  state = drawDamages(state);
  state = remarks(state, model.condition.remarques);

  // Les cinq vues voiture et les groupes utilitaire conservent leurs boîtes
  // et leurs coordonnées relatives; seule leur présentation change.
  async function drawSketchGrid(views, title) {
    if (!views.length) return;
    const sketch = addPage(title).page;
    const cells = views.length === 5
      ? [[42, 510, 160, 215], [218, 510, 160, 215], [394, 510, 160, 215], [130, 210, 160, 215], [306, 210, 160, 215]]
      : views.map((_, i) => [42 + (i % 4) * 132, 555 - Math.floor(i / 4) * 295, 122, 165]);
    for (const [index, view] of views.entries()) {
      const [cx, cy, cw, ch] = cells[index];
      const bytes = await assetBytes(env, view.assetPath);
      const image = bytes && await embed(pdf, bytes, "image/png");
      text(sketch, view.label, cx, cy + ch + 10, 8, bold);
      if (!image) continue;
      const scale = Math.min(cw / image.width, ch / image.height);
      const box = { x: cx + (cw - image.width * scale) / 2, y: cy + (ch - image.height * scale) / 2, width: image.width * scale, height: image.height * scale };
      sketch.drawImage(image, box);
      // Deux assets intérieurs historiques embarquent encore en haut un
      // ancien titre numéroté et tronqué. Le libellé est désormais rendu par
      // le PDF au-dessus de chaque vue : masquer uniquement cette marge évite
      // le doublon sans toucher au croquis ni aux coordonnées des repères.
      if (view.id === "right-wall" || view.id === "rear-doors") {
        const titleMask = view.id === "right-wall"
          ? { x: 0.28, width: 0.44 }
          : { x: 0.18, width: 0.64 };
        sketch.drawRectangle({ x: box.x + box.width * titleMask.x, y: box.y + box.height * 0.88, width: box.width * titleMask.width, height: box.height * 0.12, color: rgb(1, 1, 1) });
      }
      for (const mark of view.marks) {
        const x = box.x + Number(mark.x || 0) / 100 * box.width;
        const y = box.y + (1 - Number(mark.y || 0) / 100) * box.height;
        sketch.drawCircle({ x, y, size: 6, color: ORANGE });
        text(sketch, mark.number, x - 2, y - 2.5, 5.5, bold, rgb(1, 1, 1));
      }
    }
  }
  if (model.sketches.length === 5) await drawSketchGrid(model.sketches, "CROQUIS DU VÉHICULE");
  else {
    await drawSketchGrid(model.sketches.filter(view => view.surface === "utility-exterior"), "CROQUIS UTILITAIRE — EXTÉRIEUR");
    await drawSketchGrid(model.sketches.filter(view => view.surface === "utility-interior"), "CROQUIS UTILITAIRE — INTÉRIEUR");
  }

  const photos = [];
  for (const item of model.photos) {
    const source = await r2Image(env, item);
    const image = source && await embed(pdf, source.bytes, source.type);
    if (image) photos.push({ item, image });
  }
  let signaturePage = null, signatureY = null;
  let photoPage = null, rowTop = 707, photoPageCount = 0;
  for (let i = 0; i < photos.length; i += 3) {
    const row = photos.slice(i, i + 3);
    const captions = row.map(entry => fitLines(entry.item.label || "Photo", bold, 8, 167));
    const footprint = 158 + 15 + Math.max(...captions.map(lines => lines.length)) * 10 + 8;
    if (!photoPage || rowTop - footprint < 70) {
      photoPage = addPage(`PHOTOS AU ${phase}${photoPageCount ? " (SUITE)" : ""}`).page;
      photoPageCount++;
      rowTop = 707;
    }
    for (const [col, entry] of row.entries()) {
      const { item, image } = entry;
      const x = MARGIN + col * 176, top = rowTop, frameW = 167, frameH = 158;
      photoPage.drawRectangle({ x, y: top - frameH, width: frameW, height: frameH, borderColor: BORDER, borderWidth: 0.6 });
      const scale = Math.min((frameW - 4) / image.width, (frameH - 4) / image.height);
      const width = image.width * scale, height = image.height * scale;
      photoPage.drawImage(image, { x: x + (frameW - width) / 2, y: top - frameH + (frameH - height) / 2, width, height });
      const caption = captions[col];
      multiline(photoPage, caption, x, top - frameH - 13, 8, 10, bold);
      text(photoPage, formatClientDate(item.capturedAt || item.createdAt), x, top - frameH - 15 - caption.length * 10, 7.5, regular, MUTED);
    }
    rowTop -= Math.max(220, footprint + 10);
    if (i + row.length === photos.length && rowTop >= 234) { signaturePage = photoPage; signatureY = rowTop - 5; }
  }

  async function drawSignatures(page, top) {
    text(page, `SIGNATURES — ${phase}`, MARGIN, top, 11, bold);
    page.drawLine({ start: { x: MARGIN, y: top - 8 }, end: { x: PAGE[0] - MARGIN, y: top - 8 }, thickness: 0.7, color: ORANGE });
    for (const [index, value] of model.signatures.entries()) {
      const x = index ? 304 : MARGIN, width = 253, y = top - 164;
      page.drawRectangle({ x, y, width, height: 145, color: PALE, borderColor: BORDER, borderWidth: 0.6 });
      text(page, value.role === "client" ? "LOCATAIRE" : "GET LOCATION", x + 9, top - 36, 8, bold, MUTED);
      const names = fitLines(value.name || "—", regular, 8.5, width - 18).slice(0, 2);
      multiline(page, names, x + 9, top - 51, 8.5, 10);
      text(page, formatClientDate(value.displayedAt), x + 9, top - 73, 8, regular, MUTED);
      const data = dataImage(value.imageDataUrl), image = data && await embed(pdf, data.bytes, data.type);
      if (image) {
        const scale = Math.min((width - 20) / image.width, 62 / image.height);
        page.drawImage(image, { x: x + 9, y: y + 8, width: image.width * scale, height: image.height * scale });
      }
    }
  }
  if (!signaturePage && !photos.length && state.y >= 230) { signaturePage = state.page; signatureY = state.y - 7; }
  if (!signaturePage) { signaturePage = addPage("SIGNATURES").page; signatureY = 705; }
  await drawSignatures(signaturePage, signatureY);

  for (const [index, page] of pages.entries()) {
    page.drawLine({ start: { x: MARGIN, y: 49 }, end: { x: PAGE[0] - MARGIN, y: 49 }, thickness: 0.5, color: BORDER });
    text(page, "GET LOCATION — ÉTAT DES LIEUX", MARGIN, 36, 7.2, regular, MUTED);
    text(page, `Page ${index + 1} / ${pages.length}`, PAGE[0] - MARGIN - 52, 36, 7.2, regular, MUTED);
  }
  return pdf.save();
}

module.exports = { generateInspectionPdf };
