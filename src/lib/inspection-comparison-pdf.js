// Comparatif EDL produit uniquement à la demande. Il ne remplace et ne
// modifie jamais les PDF officiels individuels stockés par révision.
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
const CHANGE = rgb(1, 0.96, 0.78);

function present(value) { return value !== null && value !== undefined && value !== ""; }
function clientDate(value) {
  if (!value) return "Non renseigné";
  const local = /^(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d)/.exec(String(value));
  if (local) return `${local[3]}/${local[2]}/${local[1]} ${local[4]}:${local[5]}`;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" });
}
function scalar(value, suffix = "") { return present(value) ? `${value}${suffix}` : "Non renseigné"; }
function marksSummary(model) {
  if (!model.damageMarks.length) return "Aucun dommage renseigné";
  return model.damageMarks.map(mark => `${mark.number}. ${mark.typeLabel} — ${mark.zoneLabel}${mark.description ? ` : ${mark.description}` : ""}`).join("\n");
}
function difference(depart, retour, kind) {
  if (!present(depart) && !present(retour)) return "Non renseigné";
  if (String(depart == null ? "" : depart) === String(retour == null ? "" : retour)) return "Identique";
  if (kind === "km" && Number.isFinite(Number(depart)) && Number.isFinite(Number(retour))) {
    const delta = Number(retour) - Number(depart);
    return `${delta >= 0 ? "+" : ""}${delta} km`;
  }
  return "Valeurs différentes";
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

async function generateInspectionComparisonPdf({ env, id, reference, depart, retour, vehicle, rental }) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const departModel = build({ id, stage: "depart", revision: depart.revision, snapshot: depart.snapshot, media: depart.media, vehicle, rental });
  const retourModel = build({ id, stage: "retour", revision: retour.revision, snapshot: retour.snapshot, media: retour.media, vehicle, rental });
  const pages = [];

  function printable(value) {
    return String(value == null ? "" : value).replace(/\r\n?/g, "\n").replace(/[\t\f]/g, " ").replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, "").split("").map(char => {
      if (char === "\n") return char;
      try { regular.encodeText(char); return char; } catch (_) { return "?"; }
    }).join("");
  }
  function fit(value, font, size, width) {
    const lines = [];
    for (const paragraph of printable(value).split("\n")) {
      let line = "";
      for (const word of (paragraph.trim() || " ").split(/\s+/)) {
        const candidate = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(candidate, size) <= width) { line = candidate; continue; }
        if (line) lines.push(line);
        line = word;
      }
      lines.push(line.trim());
    }
    return lines;
  }
  function text(page, value, x, y, size = 9, font = regular, color = INK) { page.drawText(printable(value), { x, y, size, font, color }); }
  function addPage(title) {
    const page = pdf.addPage(PAGE); pages.push(page);
    text(page, "GET LOCATION", MARGIN, 802, 15, bold, ORANGE);
    text(page, "COMPARATIF ÉTAT DES LIEUX", 355, 804, 9, bold, INK);
    page.drawLine({ start: { x: MARGIN, y: 789 }, end: { x: PAGE[0] - MARGIN, y: 789 }, thickness: 2.5, color: ORANGE });
    text(page, title, MARGIN, 761, 12, bold);
    return { page, y: 734 };
  }
  function drawLines(page, lines, x, y, size = 8, lineHeight = 10, font = regular, color = INK) {
    for (const line of lines) { if (line) text(page, line, x, y, size, font, color); y -= lineHeight; }
  }
  function identity(state) {
    const customer = rental && rental.client || {};
    const clientName = [customer.prenom || customer.firstName, customer.nom || customer.lastName].filter(Boolean).join(" ") || customer.name || "Non renseigné";
    const entries = [["Référence", reference || id], ["Locataire", clientName], ["Véhicule", vehicle && (vehicle.nom || vehicle.name) || "Non renseigné"], ["Immatriculation", vehicle && vehicle.immatriculation || "Non renseigné"], ["Versions", `Départ V${depart.revision} / Retour V${retour.revision}`]];
    const width = (WIDTH - 8) / 2;
    entries.forEach(([label, value], index) => {
      const col = index % 2, x = MARGIN + col * (width + 8), top = state.y;
      state.page.drawRectangle({ x, y: top - 42, width: index === 4 ? WIDTH : width, height: 42, color: PALE, borderColor: BORDER, borderWidth: 0.5 });
      text(state.page, label.toUpperCase(), x + 8, top - 13, 7, bold, MUTED);
      text(state.page, value, x + 8, top - 28, 8.5);
      if (col === 1 || index === 4) state.y -= 49;
    });
    return state;
  }
  const rows = [
    ["Date / heure", clientDate(departModel.condition.dateHeure), clientDate(retourModel.condition.dateHeure), null, departModel.condition.dateHeure, retourModel.condition.dateHeure],
    ["Kilométrage", scalar(departModel.condition.km, " km"), scalar(retourModel.condition.km, " km"), "km", departModel.condition.km, retourModel.condition.km],
    ["Carburant / charge", scalar(departModel.condition.carburant, " %"), scalar(retourModel.condition.carburant, " %"), null, departModel.condition.carburant, retourModel.condition.carburant],
    ["Propreté extérieure", scalar(departModel.condition.propreteExterieure, "/5"), scalar(retourModel.condition.propreteExterieure, "/5"), null, departModel.condition.propreteExterieure, retourModel.condition.propreteExterieure],
    ["Propreté intérieure", scalar(departModel.condition.propreteInterieure, "/5"), scalar(retourModel.condition.propreteInterieure, "/5"), null, departModel.condition.propreteInterieure, retourModel.condition.propreteInterieure],
    ["Espace de chargement", scalar(departModel.condition.propreteChargement, "/5"), scalar(retourModel.condition.propreteChargement, "/5"), null, departModel.condition.propreteChargement, retourModel.condition.propreteChargement],
    ["Clés", scalar(departModel.condition.cles), scalar(retourModel.condition.cles), null, departModel.condition.cles, retourModel.condition.cles],
    ["Accessoires", scalar(departModel.condition.accessoires), scalar(retourModel.condition.accessoires), null, departModel.condition.accessoires, retourModel.condition.accessoires],
    ["Remarques", scalar(departModel.condition.remarques), scalar(retourModel.condition.remarques), null, departModel.condition.remarques, retourModel.condition.remarques],
    ["Dommages", marksSummary(departModel), marksSummary(retourModel), null, marksSummary(departModel), marksSummary(retourModel)]
  ];
  let state = identity(addPage("SYNTHÈSE DÉPART / RETOUR"));
  const columns = [{ x: MARGIN, w: 105 }, { x: MARGIN + 105, w: 155 }, { x: MARGIN + 260, w: 155 }, { x: MARGIN + 415, w: 104 }];
  function header() {
    const labels = ["ÉLÉMENT", `DÉPART V${depart.revision}`, `RETOUR V${retour.revision}`, "DIFFÉRENCE"];
    state.page.drawRectangle({ x: MARGIN, y: state.y - 24, width: WIDTH, height: 24, color: PALE, borderColor: BORDER, borderWidth: 0.5 });
    labels.forEach((label, index) => text(state.page, label, columns[index].x + 5, state.y - 15, 7, bold, MUTED));
    state.y -= 24;
  }
  header();
  rows.forEach((row, index) => {
    const rawDepart = row.length > 4 ? row[4] : row[1], rawRetour = row.length > 5 ? row[5] : row[2];
    const diff = difference(rawDepart, rawRetour, row[3]);
    const values = [row[0], row[1], row[2], diff];
    const lines = values.map((value, col) => fit(value, col === 0 ? bold : regular, 7.6, columns[col].w - 10));
    const height = Math.max(28, 12 + Math.max(...lines.map(item => item.length)) * 10);
    if (state.y - height < 62) { state = addPage("SYNTHÈSE (SUITE)"); header(); }
    state.page.drawRectangle({ x: MARGIN, y: state.y - height, width: WIDTH, height, color: diff === "Identique" ? (index % 2 ? PALE : rgb(1, 1, 1)) : CHANGE, borderColor: BORDER, borderWidth: 0.35 });
    lines.forEach((item, col) => drawLines(state.page, item, columns[col].x + 5, state.y - 13, 7.6, 10, col === 0 ? bold : regular));
    state.y -= height;
  });

  async function photoPages(model, stageLabel) {
    const photos = [];
    for (const item of model.photos) {
      const source = await r2Image(env, item);
      if (!source) continue;
      try { photos.push({ item, image: /png/i.test(source.type) ? await pdf.embedPng(source.bytes) : await pdf.embedJpg(source.bytes) }); } catch (_) { /* média illisible ignoré */ }
    }
    if (!photos.length) return;
    let page, rowTop = 707;
    for (let index = 0; index < photos.length; index += 3) {
      if (!page || rowTop < 250) { page = addPage(`PHOTOS AU ${stageLabel}`).page; rowTop = 707; }
      for (const [col, entry] of photos.slice(index, index + 3).entries()) {
        const x = MARGIN + col * 176, frameW = 167, frameH = 158;
        page.drawRectangle({ x, y: rowTop - frameH, width: frameW, height: frameH, borderColor: BORDER, borderWidth: 0.6 });
        const scale = Math.min((frameW - 4) / entry.image.width, (frameH - 4) / entry.image.height);
        const width = entry.image.width * scale, height = entry.image.height * scale;
        page.drawImage(entry.image, { x: x + (frameW - width) / 2, y: rowTop - frameH + (frameH - height) / 2, width, height });
        drawLines(page, fit(entry.item.label || "Photo", bold, 8, frameW), x, rowTop - frameH - 13, 8, 10, bold);
        text(page, clientDate(entry.item.capturedAt || entry.item.createdAt), x, rowTop - frameH - 34, 7.5, regular, MUTED);
      }
      rowTop -= 225;
    }
  }
  await photoPages(departModel, "DÉPART");
  await photoPages(retourModel, "RETOUR");
  for (const [index, page] of pages.entries()) {
    page.drawLine({ start: { x: MARGIN, y: 49 }, end: { x: PAGE[0] - MARGIN, y: 49 }, thickness: 0.5, color: BORDER });
    text(page, "GET LOCATION — COMPARATIF EDL", MARGIN, 36, 7.2, regular, MUTED);
    text(page, `Page ${index + 1} / ${pages.length}`, PAGE[0] - MARGIN - 52, 36, 7.2, regular, MUTED);
  }
  return pdf.save();
}

module.exports = { generateInspectionComparisonPdf };
