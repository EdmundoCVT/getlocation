// Document A4 distinct de l'interface : lecture seule, sans URL/tokens ni
// contrôles de saisie. Les mêmes sources privées déjà décodées sont utilisées.
(function (global) {
  "use strict";
  const CSS = `
    @page { size:A4; margin:10mm; }
    * { box-sizing:border-box; } body { margin:0; color:#172b43; font:10pt Arial,sans-serif; }
    .page { min-height:0; padding:4mm 5mm; break-after:page; page-break-after:always; } .page:last-of-type { break-after:auto; page-break-after:auto; }
    h1 { font-size:22pt; margin:2mm 0 3mm; } h2 { font-size:15pt; margin:0 0 3mm; break-after:avoid; page-break-after:avoid; } h3 { font-size:10pt; margin:3mm 0 1.5mm; break-after:avoid; page-break-after:avoid; } p { margin:2mm 0; line-height:1.3; white-space:pre-wrap; overflow-wrap:anywhere; }
    .brand { color:#ff6b00; font-size:18pt; font-weight:bold; letter-spacing:.04em; } .mode { color:#b44b00; font-weight:bold; }
    .grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:2.5mm 5mm; } dl { margin:0; } dl>div { padding:1.5mm 0; border-bottom:1px solid #d9e0ea; } dt { color:#52627a; font-size:8pt; } dd { margin:1mm 0 0; font-weight:bold; overflow-wrap:anywhere; }
    .damage-table { display:grid; gap:1.5mm; break-inside:avoid; page-break-inside:avoid; } .damage-row { display:grid; grid-template-columns:11mm 29mm 29mm 31mm 1fr; gap:2mm; align-items:center; padding:2mm; border-bottom:1px solid #d9e0ea; break-inside:avoid; page-break-inside:avoid; } .damage-head { color:#52627a; font-size:8pt; font-weight:bold; background:#edf2f8; border:0; } .damage-cell { overflow-wrap:anywhere; }
    .sketch-page,.sketch-sheet,.inspection-sketch { break-inside:avoid; page-break-inside:avoid; } .inspection-sketch-grid { display:grid; grid-template-columns:1fr 1fr; gap:3mm 7mm; align-items:start; } .inspection-sketch-view { text-align:center; break-inside:avoid; page-break-inside:avoid; } .inspection-sketch-view h3 { margin:0 0 1mm; } .inspection-sketch-view:last-child { grid-column:1/-1; width:42mm; justify-self:center; } .inspection-sketch-canvas { position:relative; width:100%; line-height:0; } .inspection-reference-image { width:100%; height:auto; display:block; } .inspection-sketch-mark { position:absolute; transform:translate(-50%,-50%); display:inline-flex; align-items:center; justify-content:center; gap:1px; min-width:6mm; min-height:6mm; padding:1px; border:1px solid white; border-radius:50%; background:#b82119; color:#fff; font-weight:bold; line-height:1; } .inspection-sketch-mark.bosse { background:#c95a00; } .inspection-sketch-mark.eclat { background:#0066ff; } .inspection-sketch-mark-number { display:grid; place-items:center; width:3mm; height:3mm; border-radius:50%; background:#fff; color:#172b43; font-size:6pt; } .inspection-sketch-mark-symbol { font-size:7pt; } .inspection-sketch-tools { display:none; }
    .photo-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:4mm; } figure { margin:0; break-inside:avoid; page-break-inside:avoid; } figure h3 { margin:0 0 1mm; font-size:9pt; text-transform:uppercase; } figure img { width:100%; height:48mm; object-fit:contain; display:block; background:#f4f6f8; } figcaption { padding:1.5mm 0 0; font-size:8pt; overflow-wrap:anywhere; } .import { margin:1mm 0 0; font-size:7pt; color:#52627a; }
    .signature-grid { display:grid; grid-template-columns:1fr 1fr; gap:7mm; break-inside:avoid; page-break-inside:avoid; } .signature { break-inside:avoid; page-break-inside:avoid; border:1px solid #d9e0ea; padding:4mm; } .signature img { width:100%; height:38mm; object-fit:contain; display:block; } .footer { color:#52627a; font-size:8pt; margin-top:3mm; }.document-tools { margin:12px; padding:12px; background:#eef3f8; }.document-tools button { min-height:44px; padding:10px 20px; }
    @media screen { body { background:#e8edf3; }.page { width:210mm; min-height:297mm; margin:16px auto; background:#fff; } }
    @media print { .document-tools { display:none!important; } h1,h2,h3 { break-after:avoid; page-break-after:avoid; } }
  `;
  global.InspectionDocument = {
    open() { return global.open("about:blank", "_blank"); },
    async prepare(popup, snapshot, cache) {
      if (!popup) throw new Error("Autorisez l’ouverture du document dans votre navigateur.");
      const doc = popup.document, images = [];
      doc.documentElement.lang = "fr"; doc.title = "GET LOCATION — État des lieux " + snapshot.mode + " — " + snapshot.reference;
      doc.head.replaceChildren(); doc.body.replaceChildren();
      const style = doc.createElement("style"); style.textContent = CSS; doc.head.append(style);
      const meta = doc.createElement("meta"); meta.name = "referrer"; meta.content = "no-referrer"; doc.head.append(meta);
      const tools = doc.createElement("div"); tools.className = "document-tools"; tools.textContent = "Préparation du document…"; doc.body.append(tools);
      const text = (parent, tag, value, className) => { const node = doc.createElement(tag); node.textContent = value == null ? "" : String(value); if (className) node.className = className; parent.append(node); return node; };
      const page = (title, className) => { const node = doc.createElement("section"); node.className = "page" + (className ? " " + className : ""); doc.body.append(node); if (title) text(node, "h2", title); return node; };
      const fields = (parent, entries) => { const dl = doc.createElement("dl"); dl.className = "grid"; parent.append(dl); entries.forEach(([label, value]) => { if (value !== "" && value != null) { const row = doc.createElement("div"); text(row, "dt", label); text(row, "dd", value); dl.append(row); } }); return dl; };
      const readable = global.InspectionMedia.date, stage = snapshot.stage;
      const cleanliness = value => [["Extérieur", value.propreteExterieure == null ? null : value.propreteExterieure + " / 5"], ["Intérieur", value.propreteInterieure == null ? null : value.propreteInterieure + " / 5"], ["Espace de chargement", value.propreteChargement == null ? null : value.propreteChargement + " / 5"]];
      const damageRows = () => {
        const rows = [];
        if (snapshot.mode === "retour" && snapshot.depart && Array.isArray(snapshot.depart.marks)) snapshot.depart.marks.forEach(mark => rows.push({ mark, status: "Existant au départ" }));
        (stage.marks || []).forEach(mark => rows.push({ mark, status: snapshot.mode === "retour" ? "Nouveau au retour" : "Existant" }));
        return rows;
      };
      const first = page(); text(first, "div", "GET LOCATION", "brand"); text(first, "h1", "État des lieux du véhicule"); text(first, "p", snapshot.reference + " · " + snapshot.mode.toUpperCase(), "mode");
      fields(first, [...snapshot.summary, ["Date et heure", readable(stage.dateHeure)], ["Agent", stage.agent], ["Kilométrage", stage.km == null ? null : stage.km + " km"], ["Carburant / charge", stage.carburant == null ? null : stage.carburant + " %"], ["Clés", stage.cles], ["Type de constat", snapshot.mode.toUpperCase()]]);
      text(first, "h3", "Propreté"); fields(first, cleanliness(stage));
      text(first, "h3", "Dommages");
      const table = doc.createElement("div"); table.className = "damage-table"; first.append(table);
      const head = doc.createElement("div"); head.className = "damage-row damage-head"; ["N°", "Statut", "Type", "Zone", "Description"].forEach(value => text(head, "div", value, "damage-cell")); table.append(head);
      const rows = damageRows();
      if (!rows.length) text(first, "p", "Aucun dommage renseigné.");
      rows.forEach((row, index) => { const line = doc.createElement("div"); line.className = "damage-row"; const type = global.InspectionSketch.TYPES.find(item => item.id === row.mark.type); [[index + 1, "N°"], [row.status, "Statut"], [type ? type.label : row.mark.type, "Type"], [global.InspectionSketch.labelFor(row.mark.view), "Zone"], [row.mark.description || "Non renseignée", "Description"]].forEach(([value, label]) => { const cell = text(line, "div", value, "damage-cell"); cell.dataset.label = label; }); table.append(line); });
      text(first, "h3", "Remarques et contrôle"); text(first, "p", stage.dommages || "Aucune remarque."); fields(first, [["Accessoires", stage.clesAccessoires]]);
      const sketchPage = (heading, value) => { const sheet = page(heading, "sketch-page"), holder = document.createElement("div"); holder.className = "sketch-sheet"; global.createInspectionSketch(holder, { marks: value.marks, readOnly: true }); const imported = doc.importNode(holder, true); sheet.append(imported); imported.querySelectorAll(".inspection-reference-image").forEach(image => images.push(image)); text(sheet, "p", "X Rayure · O Bosse / impact · ● Éclat", "footer"); };
      sketchPage("Schéma annoté — " + snapshot.mode, stage);
      if (snapshot.mode === "retour" && snapshot.depart) sketchPage("Schéma de référence — départ", snapshot.depart);
      const photoPages = async (items, heading) => {
        for (let index = 0; index < items.length; index += 9) {
          const sheet = page(heading), grid = doc.createElement("div"); grid.className = "photo-grid"; sheet.append(grid);
          for (const item of items.slice(index, index + 9)) {
            const url = await cache.get(item), figure = doc.createElement("figure"), image = doc.createElement("img"); image.alt = global.InspectionMedia.labels[item.slot] || item.label || "Photo"; image.src = url; images.push(image); text(figure, "h3", image.alt); figure.append(image); text(figure, "figcaption", "Date/heure : " + readable(item.capturedAt || item.dateHeure)); if (item.createdAt) text(figure, "p", "Importée le : " + readable(item.createdAt), "import"); grid.append(figure);
          }
        }
      };
      if (snapshot.photos.length) await photoPages(snapshot.photos, "Photos au " + snapshot.mode);
      if (snapshot.mode === "retour" && snapshot.departPhotos.length) await photoPages(snapshot.departPhotos, "Photos de référence — départ");
      const sign = page("Signatures — " + snapshot.mode), signatures = doc.createElement("div"); signatures.className = "signature-grid"; sign.append(signatures);
      for (const role of ["client", "agence"]) { const value = stage.signatures && stage.signatures[role], panel = doc.createElement("section"); panel.className = "signature"; text(panel, "h3", role === "client" ? "Locataire" : "GET LOCATION"); if (value) { fields(panel, [["Nom", value.name], ["Signé le", value.signedAt ? readable(value.signedAt) : "Non renseigné"]]); if (value.imageDataUrl) { const image = doc.createElement("img"); image.alt = "Signature " + role; image.src = value.imageDataUrl; panel.append(image); images.push(image); } } else text(panel, "p", "Signature non renseignée."); signatures.append(panel); }
      text(sign, "p", snapshot.dirty ? "Document de travail — modifications non enregistrées." : "Document préparé à partir de l’état des lieux enregistré.", "footer");
      await Promise.all(images.map(image => global.InspectionMedia.decode(image))); if (doc.fonts && doc.fonts.ready) await doc.fonts.ready;
      tools.replaceChildren(); const print = doc.createElement("button"); print.textContent = "Imprimer / Enregistrer en PDF"; print.onclick = () => popup.print(); tools.append(print); text(tools, "p", "Document prêt. Il ne contient aucun lien ni jeton d’accès."); doc.body.dataset.ready = "true"; popup.focus(); popup.print();
    }
  };
}(window));
