// Générateur Worker d'archive EDL. Il ne dépend ni du DOM ni du navigateur :
// la finalisation peut donc produire un PDF à partir de la révision stockée.
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const clean = value => String(value == null ? "" : value).replace(/[\r\n\t]+/g, " ").slice(0, 1500);
async function generateInspectionPdf({ id, stage, revision, snapshot, media }) {
  const pdf = await PDFDocument.create(); const regular = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([595.28, 841.89]); let y = 800;
  const line = (label, value) => { page.drawText(`${label}: ${clean(value) || "—"}`, { x: 40, y, size: 10, font: regular, color: rgb(.08,.13,.2) }); y -= 18; };
  page.drawText("GET LOCATION", { x: 40, y, size: 18, font: bold, color: rgb(1,.42,0) }); y -= 30;
  page.drawText(`État des lieux ${stage === "retour" ? "retour" : "départ"} — V${revision}`, { x: 40, y, size: 14, font: bold }); y -= 28;
  line("Référence", id); line("Date du constat", snapshot && snapshot.dateHeure); line("Kilométrage", snapshot && snapshot.km); line("Carburant", snapshot && snapshot.carburant); line("Clés", snapshot && snapshot.cles); line("Dommages", snapshot && snapshot.dommages); line("Médias référencés", Array.isArray(media) ? media.length : 0);
  const signatures = snapshot && snapshot.signatures || {};
  y -= 8; page.drawText("Signatures", { x: 40, y, size: 12, font: bold }); y -= 20;
  ["client", "agence"].forEach(role => line(role === "client" ? "Client" : "Agence", signatures[role] && `${signatures[role].name || "—"} — ${signatures[role].displaySignedAt || signatures[role].signedAt || "—"}`));
  page.drawText(`Archive générée côté serveur le ${new Date().toISOString()}`, { x: 40, y: 35, size: 8, font: regular, color: rgb(.35,.4,.48) });
  return pdf.save();
}
module.exports = { generateInspectionPdf };
