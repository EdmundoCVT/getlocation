// Front-end V3 only. The existing agency dossier/media APIs remain authoritative.
(function () {
  "use strict";
  const params = new URLSearchParams(location.search), mode = params.get("mode") === "retour" ? "retour" : "depart";
  const legacy = params.get("source") === "legacy", legacyId = params.get("legacyId") || "";
  const token = new URLSearchParams(location.hash.slice(1)).get("agencyToken");
  const $ = id => document.getElementById(id), M = window.InspectionMedia;
  let dossier, reservation, family = "car", sketch, pads = {}, dirty = false, revision = 0, saving = false, pendingCount = 0;
  let media = { depart: [], retour: [] }, editableMedia = new Set(), queue = Promise.resolve();
  const scores = {};
  const api = (url, options = {}) => fetch(url, { ...options, credentials: "same-origin", headers: { ...(token ? { Authorization: "Bearer " + token } : {}), ...options.headers } });
  const json = async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error || "Une erreur est survenue."); return body; };
  const cache = M.createCache(item => api(legacy ? "/api/legacy-inspection-media?id=" + encodeURIComponent(legacyId) + "&key=" + encodeURIComponent(item.key) : "/api/inspection-media?key=" + encodeURIComponent(item.key)));
  const message = value => { $("message").textContent = value; };
  function status() {
    $("saveStatus").textContent = pendingCount ? "Enregistrement des photos…" : saving ? "Enregistrement…" : dirty ? "Modifications non enregistrées" : "Modifications enregistrées";
    $("saveStatus").classList.toggle("unsaved", dirty);
    $("save").disabled = saving; $("finalize").disabled = saving;
    $("photos").querySelectorAll("input,button").forEach(control => { control.disabled = saving || pendingCount > 0; });
  }
  function changed() { dirty = true; revision++; $("reviewStatus").textContent = "Modifications à enregistrer avant finalisation."; status(); }
  function metadataKey() { return "inspection-v3-new-media:" + reservation.id; }
  function rememberMedia() { try { sessionStorage.setItem(metadataKey(), JSON.stringify([...editableMedia])); } catch (_) { /* Storage may be unavailable; old media stay protected. */ } }
  function mutation(task) {
    pendingCount++; status();
    // Serialize media writes: the KV dossier update is read/modify/write.
    const operation = queue.catch(() => {}).then(task);
    queue = operation;
    operation.then(() => {}, error => message(error.message)).finally(() => { pendingCount--; status(); });
    return operation;
  }
  function fieldGrid(root, entries) {
    root.replaceChildren(); entries.forEach(([label, value]) => { const row = document.createElement("div"), dt = document.createElement("dt"), dd = document.createElement("dd"); dt.textContent = label; dd.textContent = value == null || value === "" ? "—" : String(value); row.append(dt, dd); root.append(row); });
  }
  function summaryEntries(r) {
    return [["Locataire", r.conducteur ? [r.conducteur.prenom, r.conducteur.nom].filter(Boolean).join(" ") : ""], ["Téléphone", r.conducteur && r.conducteur.telephone], ["E-mail", r.conducteur && r.conducteur.email], ["Véhicule", r.vehicule && r.vehicule.nom], ["Immatriculation", r.vehicule && r.vehicule.immatriculation], ["Énergie", r.vehicule && (r.vehicule.carburant || r.vehicule.fuel)], ["Contrat / réservation", r.contractNumero || r.id], ["Départ prévu", [r.dateDebut, r.heureDebut].filter(Boolean).join(" ")], ["Retour prévu", [r.dateFin, r.heureFin].filter(Boolean).join(" ")]];
  }
  function openPhoto(url, caption) {
    $("lightboxImage").src = url; $("lightboxImage").alt = caption; $("lightboxCaption").textContent = caption;
    if (!$("lightbox").open) $("lightbox").showModal();
  }
  $("closeLightbox").onclick = () => $("lightbox").close();
  $("mode").textContent = mode === "depart" ? "DÉPART" : "RETOUR";
  $("signatureMode").textContent = mode;
  document.querySelectorAll(".step-nav a").forEach(link => link.onclick = event => {
    event.preventDefault(); document.querySelector(link.getAttribute("href")).scrollIntoView({ behavior: "smooth", block: "start" });
    // Do not replace the authorization fragment with a section anchor.
  });
  window.addEventListener("beforeunload", event => { if (dirty || pendingCount || saving) { event.preventDefault(); event.returnValue = ""; } });
  // Direct browser print must never include the authorization fragment in its footer.
  let printHash;
  window.addEventListener("beforeprint", () => { printHash = location.hash; history.replaceState(null, "", location.pathname + location.search); });
  window.addEventListener("afterprint", () => { if (printHash != null) history.replaceState(null, "", location.pathname + location.search + printHash); printHash = null; });

  async function legacyView() {
    if (!legacyId) throw new Error("État des lieux historique introuvable.");
    const response = await json(await api("/api/legacy-inspection-agency?id=" + encodeURIComponent(legacyId))), view = response.inspection, stage = view[mode] || {};
    $("summary").textContent = "Historique en consultation seule — aucune donnée n’est modifiée."; $("saveStatus").textContent = "Consultation historique";
    fieldGrid($("reservationSummary"), [["Client", view.client && [view.client.prenom, view.client.nom].filter(Boolean).join(" ")], ["Véhicule", view.vehicule], ["Immatriculation", view.immatriculation], ["Contrat", view.contractNumero || view.id], ["Départ", view.dateDebut + " " + (view.heureDebut || "")], ["Retour", view.dateFin + " " + (view.heureFin || "")]]);
    const root = $("legacyContent"); root.hidden = false;
    const section = document.createElement("section"); section.className = "card";
    const heading = document.createElement("h2"); heading.textContent = "État des lieux historique — " + mode; section.append(heading);
    if (legacyId === "res_f0e1a8457204d89acdc4542491ffcb53" && mode === "retour") {
      const recovery = document.createElement("a"); recovery.className = "primary"; recovery.href = "/recuperation-zvezdan.html"; recovery.textContent = "Consulter les photos originales du retour"; section.append(recovery);
    }
    const grid = document.createElement("dl"); grid.className = "legacy-grid";
    fieldGrid(grid, [["Date et heure", stage.dateHeure], ["Kilométrage", stage.km], ["Carburant", stage.carburant], ["Propreté", stage.proprete], ["Nombre de clés", stage.cles], ["Accessoires", stage.accessoires], ["Agent", stage.agent], ["Client signé (EDL)", stage.clientSigne], ["Agence signée (EDL)", stage.agenceSigne], ["Remarques", stage.remarques]]); section.append(grid);
    if ((stage.marques || []).length) { const draw = document.createElement("div"); window.renderLegacyInspectionSketch(draw, stage.marques); section.append(draw); }
    const photos = document.createElement("div"); photos.className = "readonly-photos"; M.renderReadOnly(photos, stage.photos || [], cache, openPhoto); section.append(photos);
    // Contract signatures are deliberately separate from inspection signatures.
    if (view.contractSignature) {
      const title = document.createElement("h3"), label = document.createElement("p"); title.textContent = "Signature du contrat"; label.textContent = M.date(view.contractSignature.signedAt); section.append(title, label);
      if (/^data:image\//.test(view.contractSignature.imageDataUrl || "")) { const image = new Image(); image.alt = "Signature du contrat"; image.src = view.contractSignature.imageDataUrl; image.style.maxWidth = "100%"; section.append(image); }
    }
    root.append(section);
  }

  function cleanliness(stage) {
    const root = $("cleanliness"); root.replaceChildren();
    [["propreteExterieure", "Extérieur"], ["propreteInterieure", "Intérieur"], ...(family === "utility" ? [["propreteChargement", "Chargement"]] : [])].forEach(([key, title]) => {
      scores[key] = stage[key] == null ? null : Number(stage[key]);
      const fieldset = document.createElement("fieldset"), legend = document.createElement("legend"), buttons = document.createElement("div"), value = document.createElement("p");
      fieldset.className = "cleanliness"; fieldset.dataset.field = key; legend.textContent = title; buttons.className = "cleanliness-buttons"; value.className = "cleanliness-value";
      const update = () => { buttons.querySelectorAll("button").forEach(button => button.setAttribute("aria-pressed", Number(button.dataset.score) === scores[key])); value.textContent = scores[key] ? ["Très sale", "Sale", "Correct", "Propre", "Très propre"][scores[key] - 1] + " — " + scores[key] + " / 5" : "Non renseignée"; };
      for (let n = 1; n <= 5; n++) { const button = M.button(String(n), () => { scores[key] = n; update(); changed(); }); button.dataset.score = n; button.setAttribute("aria-label", title + " : " + n + " sur 5"); buttons.append(button); }
      fieldset.append(legend, buttons, value); root.append(fieldset); update();
    });
  }
  function renderDamageTable() {
    const root = $("damageTable"); if (!root || !sketch) return;
    root.replaceChildren();
    const rows = [];
    if (mode === "retour" && dossier.depart && Array.isArray(dossier.depart.marks)) dossier.depart.marks.forEach(mark => rows.push({ mark, status: "Existant au départ", readOnly: true }));
    sketch.getMarks().forEach(mark => rows.push({ mark, status: mode === "retour" ? "Nouveau au retour" : "Existant", readOnly: false }));
    if (!rows.length) { const empty = document.createElement("p"); empty.className = "damage-empty"; empty.textContent = "Aucun dommage repéré sur le schéma."; root.append(empty); return; }
    const head = document.createElement("div"); head.className = "damage-row damage-head";
    ["N°", "Statut", "Type", "Zone", "Description"].forEach(label => { const cell = document.createElement("div"); cell.className = "damage-cell"; cell.textContent = label; head.append(cell); }); root.append(head);
    rows.forEach((row, index) => {
      const item = document.createElement("div"); item.className = "damage-row";
      const info = window.InspectionSketch.TYPES.find(type => type.id === row.mark.type) || window.InspectionSketch.TYPES[0];
      [[String(index + 1), "N°"], [row.status, "Statut"], [info.label, "Type"], [window.InspectionSketch.labelFor(row.mark.view), "Zone"]].forEach(([value, label]) => { const cell = document.createElement("div"); cell.className = "damage-cell"; cell.dataset.label = label; cell.textContent = value; item.append(cell); });
      if (row.readOnly) { const cell = document.createElement("div"); cell.className = "damage-cell"; cell.dataset.label = "Description"; cell.textContent = row.mark.description || "Non renseignée"; item.append(cell); }
      else {
        const label = document.createElement("label"), input = document.createElement("input"); label.className = "field damage-cell"; label.dataset.label = "Description"; input.type = "text"; input.maxLength = 500; input.placeholder = "Ex. Rayure porte avant gauche"; input.value = row.mark.description || ""; input.setAttribute("aria-label", "Description du dommage " + (index + 1));
        input.oninput = () => sketch.setDescription(row.mark.id, input.value); label.append(input); item.append(label);
      }
      root.append(item);
    });
  }
  function renderComparison() {
    if (mode !== "retour") return;
    $("comparisonDetails").hidden = false;
    const root = $("comparison"); root.replaceChildren();
    M.slots.forEach(slot => {
      const a = media.depart.filter(item => item.slot === slot), b = media.retour.filter(item => item.slot === slot); if (!a.length && !b.length) return;
      const card = document.createElement("section"), title = document.createElement("h3"), pair = document.createElement("div"); card.className = "comparison-card"; title.textContent = M.labels[slot]; pair.className = "comparison-pair"; card.append(title, pair);
      [a, b].forEach((items, index) => { const column = document.createElement("div"), caption = document.createElement("strong"), photos = document.createElement("div"); caption.textContent = index ? "Retour" : "Départ"; column.append(caption, photos); M.renderReadOnly(photos, items, cache, openPhoto); pair.append(column); }); root.append(card);
    });
  }
  function renderPhotos() {
    const root = $("photos"); root.replaceChildren();
    M.slots.forEach(slot => {
      const card = document.createElement("section"), title = document.createElement("h3"), sources = document.createElement("div"); card.className = "photo-slot"; card.dataset.slot = slot; title.textContent = M.labels[slot]; sources.className = "photo-sources";
      [["Prendre une photo", true], ["Choisir dans la photothèque", false]].forEach(([text, camera]) => {
        const label = document.createElement("label"), input = document.createElement("input"); label.className = "photo-add"; label.textContent = text; input.type = "file"; input.accept = "image/*"; input.multiple = !camera; input.className = "file-input"; input.setAttribute("aria-label", text + " — " + M.labels[slot]); if (camera) input.setAttribute("capture", "environment"); label.append(input); sources.append(label);
        input.onchange = () => {
          const files = [...(input.files || [])]; input.value = "";
          if (!files.length) return;
          mutation(async () => {
            if (media[mode].length + files.length > 30) throw new Error("Maximum 30 photos par état des lieux. Aucun ancien média ne sera supprimé.");
            for (const file of files) {
              message("Import de " + file.name + "…");
              const form = new FormData(); form.append("stage", mode); form.append("slot", slot); form.append("capturedAt", M.local(new Date())); form.append("file", file);
              const out = await json(await api("/api/inspection-media", { method: "POST", body: form }));
              media[mode].push(out.item); editableMedia.add(out.item.key); rememberMedia(); renderPhotos(); renderComparison();
            }
            message("Photo(s) importée(s) et enregistrée(s).");
          });
        };
      }); card.append(title, sources);
      media[mode].filter(item => item.slot === slot).forEach(item => {
        const photo = document.createElement("div"), field = document.createElement("label"), input = document.createElement("input"), small = document.createElement("p"), actions = document.createElement("div"); photo.className = "photo-item"; photo.dataset.key = item.key;
        field.className = "field"; field.textContent = "Date et heure de la photo"; input.type = "datetime-local"; input.value = M.local(item.capturedAt); field.append(input);
        input.onchange = () => {
          const previous = item.capturedAt, value = input.value; if (!value) { input.value = M.local(previous); message("Indiquez une date et une heure valides."); return; }
          input.disabled = true;
          mutation(async () => {
            try { const out = await json(await api("/api/inspection-media", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: item.key, capturedAt: value }) })); Object.assign(item, out.item); message("Date/heure de la photo enregistrée."); }
            catch (error) { input.value = M.local(previous); throw error; }
            finally { input.disabled = false; }
          });
        };
        small.className = "imported"; small.textContent = item.createdAt ? "Importée le : " + M.date(item.createdAt) : "Date d’import non renseignée";
        actions.className = "photo-actions";
        actions.append(M.button("Agrandir", async () => { try { openPhoto(await cache.get(item), M.labels[slot]); } catch (error) { message(error.message); } }));
        if (editableMedia.has(item.key)) actions.append(M.button("Supprimer", () => {
          if (!confirm("Supprimer cette nouvelle photo ? Les médias historiques restent conservés.")) return;
          mutation(async () => { await json(await api("/api/inspection-media", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: item.key }) })); media[mode] = media[mode].filter(photo => photo.key !== item.key); editableMedia.delete(item.key); rememberMedia(); cache.forget(item.key); renderPhotos(); renderComparison(); message("Nouvelle photo supprimée."); });
        }, "danger"));
        else { const note = document.createElement("small"); note.textContent = "Photo historique conservée"; actions.append(note); }
        photo.append(M.preview(item, cache, openPhoto), field, small, actions); card.append(photo);
      }); root.append(card);
    });
  }
  function readStage() {
    const old = dossier[mode] || {};
    return { dateHeure: $("dateHeure").value, km: Number($("km").value), carburant: Number($("carburant").value), cles: $("cles").value === "" ? null : Number($("cles").value), clesAccessoires: $("clesAccessoires").value, agent: $("agent").value, dommages: $("dommages").value,
      proprete: old.proprete || "", propreteExterieure: scores.propreteExterieure, propreteInterieure: scores.propreteInterieure, propreteChargement: family === "utility" ? scores.propreteChargement : old.propreteChargement || null,
      photosRef: old.photosRef || "", marks: sketch.getMarks(), clientSigne: pads.client.get() && pads.client.get().name || old.clientSigne || "", agenceSigne: pads.agence.get() && pads.agence.get().name || old.agenceSigne || "", signatures: { client: pads.client.get(), agence: pads.agence.get() } };
  }
  async function save(finalize) {
    if (saving || !$("form").reportValidity()) return false;
    if (mode === "retour" && (!dossier.depart || Number($("km").value) < dossier.depart.km)) { message(!dossier.depart ? "Enregistrez d’abord l’état des lieux de départ." : "Le kilométrage retour ne peut pas être inférieur au départ."); return false; }
    saving = true; status();
    try {
      await queue; await Promise.all(Object.values(pads).map(pad => pad.ready()));
      const version = revision, body = readStage();
      const response = await json(await api("/api/contract-dossier-agency", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, action: "update-" + mode }) }));
      dossier = response.dossier;
      if (revision === version) { dirty = false; for (const role of ["client", "agence"]) pads[role].acknowledge(dossier[mode].signatures && dossier[mode].signatures[role]); }
      $("reviewStatus").textContent = finalize && !dirty ? "État des lieux finalisé et enregistré. Une correction reste possible." : "État des lieux enregistré.";
      message(dirty ? "Enregistrement effectué. Vos dernières modifications restent à enregistrer." : "État des lieux enregistré."); return true;
    } catch (error) { message(error.message); return false; }
    finally { saving = false; status(); }
  }
  $("form").onsubmit = event => { event.preventDefault(); save(false); };
  document.addEventListener("inspection-signature-accepted", () => { save(false); });
  $("finalize").onclick = () => save(true);
  async function archiverPdfInspection(bytes) {
    const version = Number(reservation.contractVersion && reservation.contractVersion.version) || 1;
    const form = new FormData();
    form.append("id", reservation.id);
    form.append("kind", mode === "retour" ? "edl-return" : "edl-depart");
    form.append("version", String(version));
    form.append("file", new Blob([bytes], { type: "application/pdf" }), "etat-des-lieux-" + mode + ".pdf");
    const response = await api("/api/agency-drive-pdf", { method: "POST", body: form });
    await json(response);
  }
  $("pdf").onclick = async () => {
    if (!dossier) return;
    $("pdf").disabled = true; message("Création du PDF et chargement de toutes les photos…");
    try {
      await queue; await Promise.all(Object.values(pads).map(pad => pad.ready()));
      if (dirty && !(await save(false))) throw new Error("Enregistrez les modifications avant de télécharger le PDF.");
      const bytes = await window.InspectionDocument.download({ mode, family, reference: reservation.contractNumero || reservation.id, summary: summaryEntries(reservation), stage: readStage(), depart: dossier.depart, photos: [...media[mode]], departPhotos: [...media.depart], dirty }, cache);
      try { await archiverPdfInspection(bytes); message("PDF téléchargé, archivé et mis en attente de synchronisation Drive."); }
      catch (archiveError) { message("PDF téléchargé. Archivage Drive à réessayer : " + archiveError.message); }
    } catch (error) { message("PDF non généré : " + error.message); }
    finally { $("pdf").disabled = false; }
  };
  function fill() {
    const stage = dossier[mode] || {};
    for (let n = 0; n <= 100; n += 10) $("carburant").add(new Option(n + " %", n));
    $("dateHeure").value = M.local(stage.dateHeure) || M.local(new Date()); $("agent").value = stage.agent || ""; $("km").value = stage.km == null ? "" : stage.km;
    $("carburant").value = stage.carburant == null ? 100 : stage.carburant; $("cles").value = stage.cles == null ? "" : stage.cles; $("clesAccessoires").value = stage.clesAccessoires || ""; $("dommages").value = stage.dommages || "";
    $("km").closest("label").firstChild.textContent = "Kilométrage " + mode;
    $("legacyCleanliness").hidden = !stage.proprete; $("legacyCleanliness").textContent = "Propreté historique conservée : " + (stage.proprete || ""); cleanliness(stage);
    sketch = window.createInspectionSketch($("sketch"), { family, marks: stage.marks || [], onChange: reason => { if (reason !== "description") renderDamageTable(); changed(); } });
    renderDamageTable();
    for (const role of ["client", "agence"]) pads[role] = window.createInspectionSignature($("signatures"), { role, title: role === "client" ? "Signature client" : "Signature agence", value: stage.signatures && stage.signatures[role], onChange: changed });
    $("form").querySelectorAll("#information input,#vehicle input,#vehicle select,#dommages").forEach(input => input.addEventListener("input", changed));
    if (mode === "retour" && dossier.depart) {
      const depart = dossier.depart; $("departCompare").hidden = false;
      const values = [["Kilométrage départ", depart.km + " km"], ["Carburant départ", depart.carburant + " %"], ["Propreté extérieure", depart.propreteExterieure == null ? depart.proprete : depart.propreteExterieure + " / 5"], ["Propreté intérieure", depart.propreteInterieure == null ? depart.proprete : depart.propreteInterieure + " / 5"], ["Kilomètres parcourus", stage.km == null ? "—" : stage.km - depart.km + " km"]];
      fieldGrid($("departureValues"), values); $("departDamage").textContent = "Dommages déjà présents au départ : " + (depart.dommages || "Non renseignés");
      window.createInspectionSketch($("departureSketch"), { family, marks: depart.marks || [], readOnly: true }); M.renderReadOnly($("departurePhotos"), media.depart, cache, openPhoto);
      $("km").addEventListener("input", () => { values[4][1] = $("km").value === "" ? "—" : Number($("km").value) - depart.km + " km"; fieldGrid($("departureValues"), values); });
    }
    renderPhotos(); renderComparison(); status();
  }
  async function start() {
    if (legacy) { await legacyView(); return; }
    if (!token) throw new Error("Accès agence requis. Ouvrez l’état des lieux depuis le back-office.");
    const view = await json(await api("/api/contract-dossier-agency")); dossier = view.dossier; reservation = view.reservation;
    media = { depart: dossier.media && dossier.media.depart || [], retour: dossier.media && dossier.media.retour || [] }; family = reservation.vehicule && reservation.vehicule.vehicleFamily === "utility" ? "utility" : "car";
    dirty = !dossier[mode];
    try { editableMedia = new Set(JSON.parse(sessionStorage.getItem(metadataKey()) || "[]")); } catch (_) { editableMedia = new Set(); }
    $("summary").textContent = "État des lieux de " + mode; fieldGrid($("reservationSummary"), summaryEntries(reservation)); $("form").hidden = false; fill();
  }
  start().catch(error => { $("summary").textContent = error.message; $("saveStatus").textContent = "Chargement impossible"; });
}());
