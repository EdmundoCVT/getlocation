// Générateur Worker d'archive EDL. Il ne dépend ni du DOM ni du navigateur :
// la finalisation peut donc produire un PDF à partir de la révision stockée.
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const { build } = require("./inspection-document-model.js");
const clean = value => String(value == null ? "" : value).replace(/[\r\n\t]+/g, " ").slice(0, 1500);
async function assetBytes(env, path) { if (!env.ASSETS) return null; const response = await env.ASSETS.fetch(new Request(`https://getlocation.local${path}`)); return response.ok ? new Uint8Array(await response.arrayBuffer()) : null; }
async function r2Image(env, item) { try { const object = await env.DOCUMENTS_BUCKET.get(item.key); if (!object) return null; const type = (object.httpMetadata && object.httpMetadata.contentType) || item.contentType || ""; if (!/^image\/(jpeg|png)$/i.test(type)) return null; return { bytes: new Uint8Array(await object.arrayBuffer()), type }; } catch (_) { return null; } }
async function embed(pdf, bytes, type) { try { return /png/i.test(type || "") ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes); } catch (_) { return null; } }
function dataImage(value) { const match = /^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=]+)$/i.exec(value || ""); if (!match) return null; try { const raw = atob(match[2]); return { bytes: Uint8Array.from(raw, char => char.charCodeAt(0)), type: match[1] }; } catch (_) { return null; } }
async function generateInspectionPdf({ env, id, stage, revision, snapshot, media, vehicle, rental, vehicleFamily }) {
  const pdf = await PDFDocument.create(); const regular = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const model = build({ id, stage, revision, snapshot, media, vehicle, rental, vehicleFamily, reference: id });
  const page = pdf.addPage([595.28, 841.89]); let y = 800;
  const line = (label, value) => { page.drawText(`${label}: ${clean(value) || "—"}`, { x: 40, y, size: 10, font: regular, color: rgb(.08,.13,.2) }); y -= 18; };
  page.drawText("GET LOCATION", { x: 40, y, size: 18, font: bold, color: rgb(1,.42,0) }); y -= 30;
  page.drawText(`État des lieux ${stage === "retour" ? "retour" : "départ"} — V${revision}`, { x: 40, y, size: 14, font: bold }); y -= 28;
  line("Référence", model.header.reference); line("Date du constat", model.condition.dateHeure); line("Kilométrage", model.condition.km); line("Carburant", model.condition.carburant); line("Clés", model.condition.cles); line("Dommages", model.condition.remarques); line("Médias référencés", model.photos.length);
  y -= 8; page.drawText("Signatures", { x: 40, y, size: 12, font: bold }); y -= 20;
  for (const value of model.signatures) { line(value.role === "client" ? "Client" : "Agence", `${value.name || "—"} — ${value.displayedAt || "—"}`); const data = dataImage(value.imageDataUrl); const image = data && await embed(pdf, data.bytes, data.type); if (image) { const scale = Math.min(180 / image.width, 55 / image.height); page.drawImage(image, { x: 280, y: y + 3, width: image.width * scale, height: image.height * scale }); } }
  // Croquis : une grille par groupe, jamais une page par vue. Les marks sont
  // calculés sur la boîte réelle après conservation du ratio de l'asset.
  async function drawSketchGrid(views, title) {
    if (!views.length) return;
    const sketch = pdf.addPage([595.28, 841.89]); sketch.drawText(title, { x: 40, y: 800, size: 14, font: bold });
    const cells = views.length === 5 ? [[42,555,122,165],[174,555,122,165],[306,555,122,165],[438,555,122,165],[236,260,122,165]] : views.map((_, i) => [42 + (i % 4) * 132, 555 - Math.floor(i / 4) * 295, 122, 165]);
    for (const [index, view] of views.entries()) { const [cx,cy,cw,ch]=cells[index], bytes=await assetBytes(env,view.assetPath), image=bytes&&await embed(pdf,bytes,"image/png"); sketch.drawText(view.label,{x:cx,y:cy+ch+10,size:8,font:bold}); if(!image) continue; const scale=Math.min(cw/image.width,ch/image.height), box={x:cx+(cw-image.width*scale)/2,y:cy+(ch-image.height*scale)/2,width:image.width*scale,height:image.height*scale}; sketch.drawImage(image,box); view.marks.forEach((mark,markIndex)=>{const x=box.x+Number(mark.x||0)/100*box.width,y=box.y+(1-Number(mark.y||0)/100)*box.height;sketch.drawCircle({x,y,size:6,color:rgb(1,.42,0)});sketch.drawText(String(markIndex+1),{x:x-2,y:y-2.5,size:5.5,font:bold,color:rgb(1,1,1)});}); }
  }
  if (model.sketches.length === 5) await drawSketchGrid(model.sketches, "Croquis du véhicule");
  else { await drawSketchGrid(model.sketches.filter(view=>view.surface === "utility-exterior"), "Croquis utilitaire — extérieur"); await drawSketchGrid(model.sketches.filter(view=>view.surface === "utility-interior"), "Croquis utilitaire — intérieur"); }
  // Photos référencées par la révision, sans fallback legacy implicite.
  for (let i=0;i<model.photos.length;i+=6) { const p=pdf.addPage([595.28,841.89]); p.drawText("Photos",{x:40,y:800,size:14,font:bold}); for (const [index,item] of model.photos.slice(i,i+6).entries()) { const source=await r2Image(env,item), image=source&&await embed(pdf,source.bytes,source.type); if(!image)continue; const col=index%2,row=Math.floor(index/2),x=45+col*255,top=760-row*225,scale=Math.min(240/image.width,180/image.height); p.drawImage(image,{x,y:top-image.height*scale,width:image.width*scale,height:image.height*scale}); p.drawText(clean(item.slot||"Photo"),{x,y:top-195,size:8,font:regular}); } }
  page.drawText(`Archive générée côté serveur le ${new Date().toISOString()}`, { x: 40, y: 35, size: 8, font: regular, color: rgb(.35,.4,.48) });
  return pdf.save();
}
module.exports = { generateInspectionPdf };
