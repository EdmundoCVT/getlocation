// Générateur Worker d'archive EDL. Il ne dépend ni du DOM ni du navigateur :
// la finalisation peut donc produire un PDF à partir de la révision stockée.
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const { build } = require("./inspection-document-model.js");
const clean = value => String(value == null ? "" : value).replace(/[\r\n\t]+/g, " ").slice(0, 1500);
function formatClientDate(value) {
  if (!value) return "Date non renseignée";
  // Les valeurs datetime-local représentent déjà une heure métier : ne pas les
  // décaler en les convertissant implicitement dans un autre fuseau.
  const local = /^(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d)(?::\d\d(?:\.\d+)?)?$/.exec(String(value));
  if (local) return `${local[3]}/${local[2]}/${local[1]} ${local[4]}:${local[5]}`;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? clean(value) : date.toLocaleString("fr-FR", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}
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
  page.drawText(`État des lieux ${stage === "retour" ? "retour" : "départ"}`, { x: 40, y, size: 14, font: bold }); y -= 28;
  line("Référence", model.header.reference); line("Date du constat", model.condition.dateHeure); line("Kilométrage", model.condition.km); line("Carburant", model.condition.carburant); line("Clés", model.condition.cles); line("Dommages", model.condition.remarques); line("Médias référencés", model.photos.length);
  // Croquis : une grille par groupe, jamais une page par vue. Les marks sont
  // calculés sur la boîte réelle après conservation du ratio de l'asset.
  async function drawSketchGrid(views, title) {
    if (!views.length) return null;
    const sketch = pdf.addPage([595.28, 841.89]); sketch.drawText(title, { x: 40, y: 800, size: 14, font: bold });
    // Cinq vues en 3 + 2 : plus grandes et sans la zone blanche produite
    // par l'ancienne ligne de quatre suivie d'une unique vue centrale.
    const cells = views.length === 5 ? [[42,510,160,215],[218,510,160,215],[394,510,160,215],[130,210,160,215],[306,210,160,215]] : views.map((_, i) => [42 + (i % 4) * 132, 555 - Math.floor(i / 4) * 295, 122, 165]);
    for (const [index, view] of views.entries()) { const [cx,cy,cw,ch]=cells[index], bytes=await assetBytes(env,view.assetPath), image=bytes&&await embed(pdf,bytes,"image/png"); sketch.drawText(view.label,{x:cx,y:cy+ch+10,size:8,font:bold}); if(!image) continue; const scale=Math.min(cw/image.width,ch/image.height), box={x:cx+(cw-image.width*scale)/2,y:cy+(ch-image.height*scale)/2,width:image.width*scale,height:image.height*scale}; sketch.drawImage(image,box); view.marks.forEach(mark=>{const x=box.x+Number(mark.x||0)/100*box.width,y=box.y+(1-Number(mark.y||0)/100)*box.height;sketch.drawCircle({x,y,size:6,color:rgb(1,.42,0)});sketch.drawText(String(mark.number),{x:x-2,y:y-2.5,size:5.5,font:bold,color:rgb(1,1,1)});}); }
    return sketch;
  }
  let lastSketchPage;
  if (model.sketches.length === 5) lastSketchPage=await drawSketchGrid(model.sketches, "Croquis du véhicule");
  else { await drawSketchGrid(model.sketches.filter(view=>view.surface === "utility-exterior"), "Croquis utilitaire — extérieur"); lastSketchPage=await drawSketchGrid(model.sketches.filter(view=>view.surface === "utility-interior"), "Croquis utilitaire — intérieur"); }
  if (model.damageMarks.length) {
    let damagePage, damageY;
    const newDamagePage=(existing)=>{damagePage=existing||pdf.addPage([595.28,841.89]);damageY=existing?175:800;damagePage.drawText("Détails des dommages",{x:40,y:damageY,size:14,font:bold});damageY-=24;};
    const wrap=(value,max=88)=>{const words=clean(value).split(/\s+/).filter(Boolean),lines=[];let current="";for(const word of words){const next=current?current+" "+word:word;if(next.length>max){if(current)lines.push(current);current=word;}else current=next;}if(current)lines.push(current);return lines.length?lines:["Sans description"];};
    newDamagePage(lastSketchPage);
    for (const mark of model.damageMarks) {
      const heading=[`${mark.number} — ${mark.typeLabel}`,mark.zoneLabel,mark.statusLabel].filter(Boolean).join(" — ");
      const description=wrap(mark.description||"Sans description");
      if(damageY<45+description.length*12)newDamagePage();
      damagePage.drawText(clean(heading),{x:40,y:damageY,size:10,font:bold,color:rgb(.08,.13,.2)});damageY-=15;
      description.forEach(text=>{damagePage.drawText(text,{x:55,y:damageY,size:9,font:regular,color:rgb(.22,.28,.36)});damageY-=12;});damageY-=9;
    }
  }
  // Photos référencées par la révision, sans fallback legacy implicite. Une
  // référence R2 absente est ignorée sans empêcher la finalisation du PDF.
  const photos = [];
  for (const item of model.photos) { const source = await r2Image(env, item), image = source && await embed(pdf, source.bytes, source.type); if (image) photos.push({ item, image }); }
  let lastPhotoPage = null, lastPhotoRows = 0;
  const stageLabel = stage === "retour" ? "Retour" : "Départ";
  for (let i=0;i<photos.length;i+=6) {
    const batch=photos.slice(i,i+6), p=pdf.addPage([595.28,841.89]); p.drawText("Photos",{x:40,y:800,size:14,font:bold});
    for (const [index,entry] of batch.entries()) {
      const { item, image } = entry, col=index%2,row=Math.floor(index/2),x=45+col*255,top=760-row*225,scale=Math.min(240/image.width,165/image.height),height=image.height*scale;
      p.drawImage(image,{x,y:top-height,width:image.width*scale,height});
      p.drawText(clean(`${stageLabel} — ${item.label || "Photo"}`),{x,y:top-height-13,size:8,font:bold});
      // capturedAt est la date métier corrigeable; createdAt ne sert qu'aux
      // médias historiques qui ne possèdent aucune date métier.
      p.drawText(formatClientDate(item.capturedAt || item.createdAt),{x,y:top-height-25,size:8,font:regular,color:rgb(.35,.4,.48)});
    }
    lastPhotoPage=p; lastPhotoRows=Math.ceil(batch.length/2);
  }
  async function drawSignatures(signaturePage, signatureY) {
    signaturePage.drawText(`SIGNATURES — ${stageLabel.toUpperCase()}`, { x: 40, y: signatureY, size: 13, font: bold });
    for (const [index, value] of model.signatures.entries()) {
      const x = index === 0 ? 40 : 310, label = value.role === "client" ? "LOCATAIRE" : "GET LOCATION";
      signaturePage.drawText(label, { x, y: signatureY - 23, size: 10, font: bold });
      signaturePage.drawText(`Nom : ${clean(value.name) || "—"}`, { x, y: signatureY - 39, size: 9, font: regular });
      signaturePage.drawText(`Date : ${formatClientDate(value.displayedAt)}`, { x, y: signatureY - 54, size: 9, font: regular });
      const data = dataImage(value.imageDataUrl), image = data && await embed(pdf, data.bytes, data.type);
      if (image) { const scale = Math.min(220 / image.width, 80 / image.height); signaturePage.drawImage(image, { x, y: signatureY - 150, width: image.width * scale, height: image.height * scale }); }
    }
    signaturePage.drawText(`Archive générée côté serveur le ${new Date().toISOString()}`, { x: 40, y: 35, size: 8, font: regular, color: rgb(.35,.4,.48) });
  }
  // Deux rangées de photos laissent une zone de signature confortable. Avec
  // davantage de photos, une page dédiée conserve les proportions des images.
  if (lastPhotoPage && lastPhotoRows <= 2) await drawSignatures(lastPhotoPage, lastPhotoRows === 1 ? 505 : 280);
  else { const signatures = pdf.addPage([595.28,841.89]); await drawSignatures(signatures, 800); }
  return pdf.save();
}
module.exports = { generateInspectionPdf };
