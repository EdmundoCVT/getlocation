// A standalone, token-free document. No storage, no contract signature reuse.
(function (global) {
  "use strict";
  const CSS = `
    /* Zero page margin prevents browser-added URL/token footers. Document
       padding supplies a consistent safe A4 margin instead. */
    @page { size:A4; margin:0; }
    * { box-sizing:border-box; } body { margin:0; color:#172b43; font:11pt Arial,sans-serif; }
    .page { padding:16mm; break-after:page; page-break-after:always; } .page:last-of-type { break-after:auto; page-break-after:auto; }
    h1 { font-size:24pt; margin:6mm 0; } h2 { font-size:17pt; margin:0 0 5mm; } h3 { font-size:12pt; margin:3mm 0; }
    p { line-height:1.4; white-space:pre-wrap; overflow-wrap:anywhere; } .brand { font-weight:bold; color:#ff6b00; font-size:20pt; }
    .grid { display:grid; grid-template-columns:1fr 1fr; gap:5mm; } dl { margin:0; } dl>div { padding:3mm 0; border-bottom:1px solid #ddd; }
    dt { color:#52627a; font-size:10pt; } dd { margin:1mm 0 0; font-weight:bold; overflow-wrap:anywhere; }
    .inspection-sketch-grid { display:grid; grid-template-columns:1fr 1fr; gap:4mm; }
    .inspection-sketch-view { text-align:center; break-inside:avoid; page-break-inside:avoid; }
    .inspection-sketch-view:last-child { grid-column:1/-1; width:41mm; justify-self:center; }
    .inspection-sketch-canvas { margin:2mm auto; width:100%; } svg { display:block; width:100%; height:auto; }
    .inspection-sketch-outline>g:first-child { fill:none; stroke:#172b43; stroke-width:2; }
    .inspection-sketch-symbol { fill:#b82119; font:bold 13px Arial; stroke:none; } .inspection-sketch-tools { display:none; }
    .photo { margin:0 0 6mm; break-inside:avoid; page-break-inside:avoid; }
    .photo img { width:100%; max-height:100mm; object-fit:contain; display:block; background:#f4f6f8; }
    figcaption { padding:2mm 0; font-size:10pt; overflow-wrap:anywhere; } .import { font-size:9pt; color:#52627a; }
    .signature { break-inside:avoid; border:1px solid #ddd; padding:5mm; margin-bottom:8mm; }
    .signature img { width:100%; height:45mm; object-fit:contain; } .document-tools { margin:12px; padding:12px; background:#f4f6f8; }
    .document-tools button { min-height:44px; padding:10px 20px; } .footer { color:#52627a; font-size:9pt; margin-top:6mm; }
    @media screen { body { background:#e8edf3; } .page { background:white; width:210mm; min-height:277mm; margin:16px auto; padding:16mm; } }
    @media print { .document-tools { display:none; } h1,h2,h3 { break-after:avoid; } }
  `;
  global.InspectionDocument = {
    open() { return global.open("about:blank", "_blank"); },
    async prepare(popup, snapshot, cache) {
      if (!popup) throw new Error("Autorisez l’ouverture du document dans votre navigateur.");
      const doc = popup.document;
      doc.documentElement.lang = "fr"; doc.title = "GET LOCATION — État des lieux " + snapshot.mode + " — " + snapshot.reference;
      doc.head.replaceChildren(); doc.body.replaceChildren();
      const style = doc.createElement("style"); style.textContent = CSS; doc.head.append(style);
      const meta = doc.createElement("meta"); meta.name = "referrer"; meta.content = "no-referrer"; doc.head.append(meta);
      const tools = doc.createElement("div"); tools.className = "document-tools"; tools.textContent = "Préparation des photos et signatures…"; doc.body.append(tools);
      const text = (parent, tag, value, cls) => { const node = doc.createElement(tag); node.textContent = value; if (cls) node.className = cls; parent.append(node); return node; };
      const page = title => { const node = doc.createElement("section"); node.className = "page"; doc.body.append(node); if (title) text(node, "h2", title); return node; };
      const fields = (parent, entries) => { const dl = doc.createElement("dl"); dl.className = "grid"; parent.append(dl); entries.forEach(([label, value]) => { if (value !== "" && value != null) { const row = doc.createElement("div"); text(row, "dt", label); text(row, "dd", String(value)); dl.append(row); } }); };
      const mediaDate = global.InspectionMedia.date;
      const cleanliness = stage => ["propreteExterieure", "propreteInterieure", "propreteChargement"].map((key, index) => [["Propreté extérieure", "Propreté intérieure", "Propreté chargement"][index], stage[key] == null ? null : stage[key] + " / 5"]);
      const stage = snapshot.stage;
      const first = page(); text(first, "div", "GET LOCATION", "brand"); text(first, "h1", "État des lieux de " + snapshot.mode);
      fields(first, [...snapshot.summary, ["Date / heure de l’état des lieux", mediaDate(stage.dateHeure)], ["Agent", stage.agent], ["Kilométrage", stage.km + " km"], ["Carburant", stage.carburant + " %"], ["Nombre de clés", stage.cles], ["Accessoires", stage.clesAccessoires], ...cleanliness(stage), ["Propreté historique", stage.proprete]]);
      if (snapshot.mode === "retour" && snapshot.depart) { text(first, "h3", "Référence au départ"); fields(first, [["Kilométrage départ", snapshot.depart.km + " km"], ["Kilomètres parcourus", stage.km - snapshot.depart.km + " km"], ["Carburant départ", snapshot.depart.carburant + " %"], ...cleanliness(snapshot.depart)]); }
      text(first, "p", snapshot.dirty ? "Document de travail — modifications non enregistrées." : "Document préparé à partir de l’état des lieux enregistré.", "footer");
      const sketchPage = (heading, value) => {
        const sheet = page(heading), holder = document.createElement("div");
        global.createInspectionSketch(holder, { family: snapshot.family, marks: value.marks, readOnly: true }); sheet.append(doc.importNode(holder, true));
        text(sheet, "p", "X Rayure · O Bosse / impact · ● Éclat", "footer");
        return sheet;
      };
      sketchPage("Croquis — " + snapshot.mode, stage);
      // A separate remarks page avoids ever pushing the final top silhouette across pages.
      if (stage.dommages) { const notes = page("Dommages et remarques — " + snapshot.mode); text(notes, "p", stage.dommages); }
      if (snapshot.mode === "retour" && snapshot.depart) { sketchPage("Croquis de référence — départ", snapshot.depart); if (snapshot.depart.dommages) { const notes = page("Dommages déjà présents au départ"); text(notes, "p", snapshot.depart.dommages); } }
      const images = [];
      const photoPages = async (items, heading) => {
        for (let i = 0; i < items.length; i += 2) {
          const sheet = page(heading);
          for (const item of items.slice(i, i + 2)) {
            const url = await cache.get(item), figure = doc.createElement("figure"), image = doc.createElement("img"); figure.className = "photo";
            image.alt = global.InspectionMedia.labels[item.slot] || item.label || "Photo"; image.src = url; figure.append(image); images.push(image);
            text(figure, "figcaption", image.alt + " — Date/heure de la photo : " + mediaDate(item.capturedAt || item.dateHeure));
            if (item.createdAt) text(figure, "p", "Importée le : " + mediaDate(item.createdAt), "import"); sheet.append(figure);
          }
        }
      };
      await photoPages(snapshot.photos, "Photos — " + snapshot.mode);
      if (snapshot.mode === "retour") await photoPages(snapshot.departPhotos, "Photos de référence — départ");
      const signatures = page("Signatures de l’état des lieux de " + snapshot.mode);
      for (const role of ["client", "agence"]) {
        const value = stage.signatures && stage.signatures[role], panel = doc.createElement("div"); panel.className = "signature"; signatures.append(panel);
        text(panel, "h3", role === "client" ? "Client" : "Agence");
        if (value) {
          fields(panel, [["Nom du signataire", value.name], ["Date / heure de signature", value.signedAt ? mediaDate(value.signedAt) : "Non renseignée"]]);
          if (value.imageDataUrl) { const image = doc.createElement("img"); image.alt = "Signature " + role; image.src = value.imageDataUrl; panel.append(image); images.push(image); }
          else text(panel, "p", "Aucune signature graphique enregistrée.");
        } else text(panel, "p", "Signature non renseignée.");
      }
      await Promise.all(images.map(image => global.InspectionMedia.decode(image)));
      if (doc.fonts && doc.fonts.ready) await doc.fonts.ready;
      tools.replaceChildren(); const print = doc.createElement("button"); print.textContent = "Imprimer / Enregistrer en PDF"; print.onclick = () => popup.print(); tools.append(print);
      text(tools, "p", "Document prêt. Le document ne contient aucun lien d’accès sécurisé. Conservez les marges du document et désactivez les en-têtes et pieds de page du navigateur.");
      doc.body.dataset.ready = "true";
      popup.focus(); popup.print();
    }
  };
}(window));
