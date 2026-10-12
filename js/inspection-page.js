// Front-end V3 only. The existing agency dossier/media APIs remain authoritative.
(function () {
  "use strict";
  const params = new URLSearchParams(location.search), mode = params.get("mode") === "retour" ? "retour" : "depart", requestedRevision = Number(params.get("revision"));
  const legacy = params.get("source") === "legacy", legacyId = params.get("legacyId") || "";
  const standaloneId = params.get("standalone") || "";
  const token = new URLSearchParams(location.hash.slice(1)).get("agencyToken");
  const $ = id => document.getElementById(id), M = window.InspectionMedia;
  let dossier, reservation, family = "car", sketch, sketchVehicleType = "car", utilitySketchLegacy = false, pads = {}, dirty = false, revision = 0, inspectionRevision = 0, saving = false, pendingCount = 0, csrfToken = "", finalized = false;
  let media = { depart: [], retour: [] }, editableMedia = new Set(), queue = Promise.resolve();
  const scores = {};
  const api = (url, options = {}) => fetch(url, { ...options, credentials: "same-origin", headers: { ...(token ? { Authorization: "Bearer " + token } : {}), ...(standaloneId && csrfToken ? { "X-Agency-Csrf": csrfToken } : {}), ...options.headers } });
  const mediaUrl = () => standaloneId ? "/api/standalone-inspection-media?id=" + encodeURIComponent(standaloneId) : "/api/inspection-media";
  const mediaReadUrl = key => mediaUrl() + (standaloneId ? "&" : "?") + "key=" + encodeURIComponent(key);
  const json = async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error || "Une erreur est survenue."); return body; };
  const cache = M.createCache(item => api(legacy ? "/api/legacy-inspection-media?id=" + encodeURIComponent(legacyId) + "&key=" + encodeURIComponent(item.key) : mediaReadUrl(item.key)));
  const message = value => { $("message").textContent = value; };
  function status() {
    $("saveStatus").textContent = finalized ? "État des lieux finalisé — seule l’heure affichée des signatures reste modifiable." : pendingCount ? "Enregistrement des photos…" : saving ? "Enregistrement…" : dirty ? "Modifications non enregistrées" : "Modifications enregistrées";
    $("saveStatus").classList.toggle("unsaved", dirty);
    $("save").disabled = saving || finalized; $("finalize").disabled = saving || finalized;
    $("photos").querySelectorAll("input,button").forEach(control => { control.disabled = saving || pendingCount > 0; });
  }
  function changed() { if (finalized) return; dirty = true; revision++; $("reviewStatus").textContent = "Modifications à enregistrer avant finalisation."; status(); }
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
    const departMarks = dossier.depart && (sketchVehicleType === "utility" ? dossier.depart.utilityMarks : dossier.depart.marks);
    if (mode === "retour" && Array.isArray(departMarks)) departMarks.forEach(mark => rows.push({ mark, status: "Existant au départ", readOnly: true }));
    sketch.getMarks().forEach(mark => rows.push({ mark, status: mode === "retour" ? "Nouveau au retour" : "Existant", readOnly: false }));
    if (!rows.length) { const empty = document.createElement("p"); empty.className = "damage-empty"; empty.textContent = "Aucun dommage repéré sur le schéma."; root.append(empty); return; }
    const head = document.createElement("div"); head.className = "damage-row damage-head";
    ["N°", "Statut", "Type", "Zone", "Description"].forEach(label => { const cell = document.createElement("div"); cell.className = "damage-cell"; cell.textContent = label; head.append(cell); }); root.append(head);
    rows.forEach((row, index) => {
      const item = document.createElement("div"); item.className = "damage-row";
      const info = window.InspectionSketch.TYPES.find(type => type.id === row.mark.type) || window.InspectionSketch.TYPES[0];
      const zone = row.mark.surface && row.mark.view ? row.mark.surface + ":" + row.mark.view : (row.mark.surface || row.mark.view);
      [[String(index + 1), "N°"], [row.status, "Statut"], [info.label, "Type"], [window.InspectionSketch.labelFor(zone), "Zone"]].forEach(([value, label]) => { const cell = document.createElement("div"); cell.className = "damage-cell"; cell.dataset.label = label; cell.textContent = value; item.append(cell); });
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
              const form = new FormData(); form.append("stage", mode); form.append("revision", String(inspectionRevision)); form.append("slot", slot); form.append("capturedAt", M.local(new Date())); form.append("file", file);
              const out = await json(await api(mediaUrl(), { method: "POST", body: form }));
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
            try { const out = await json(await api(mediaUrl(), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: item.key, stage: mode, revision: inspectionRevision, capturedAt: value }) })); Object.assign(item, out.item); message("Date/heure de la photo enregistrée."); }
            catch (error) { input.value = M.local(previous); throw error; }
            finally { input.disabled = false; }
          });
        };
        small.className = "imported"; small.textContent = item.createdAt ? "Importée le : " + M.date(item.createdAt) : "Date d’import non renseignée";
        actions.className = "photo-actions";
        actions.append(M.button("Agrandir", async () => { try { openPhoto(await cache.get(item), M.labels[slot]); } catch (error) { message(error.message); } }));
        if (editableMedia.has(item.key)) actions.append(M.button("Supprimer", () => {
          if (!confirm("Supprimer cette nouvelle photo ? Les médias historiques restent conservés.")) return;
          mutation(async () => { await json(await api(mediaUrl(), { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: item.key, stage: mode, revision: inspectionRevision }) })); media[mode] = media[mode].filter(photo => photo.key !== item.key); editableMedia.delete(item.key); rememberMedia(); cache.forget(item.key); renderPhotos(); renderComparison(); message("Nouvelle photo supprimée."); });
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
      photosRef: old.photosRef || "", sketchVehicleType, utilitySketchVersion: sketchVehicleType === "utility" && !utilitySketchLegacy ? "views-v1" : (old.utilitySketchVersion || null), marks: sketchVehicleType === "car" ? sketch.getMarks() : (old.marks || []), utilityMarks: sketchVehicleType === "utility" ? sketch.getMarks() : (old.utilityMarks || []), clientSigne: pads.client.get() && pads.client.get().name || old.clientSigne || "", agenceSigne: pads.agence.get() && pads.agence.get().name || old.agenceSigne || "", signatures: { client: pads.client.get(), agence: pads.agence.get() } };
  }
  async function correctSignatureDisplayTime(role, displaySignedAt) {
    if (finalized && !confirm("Modifier uniquement la date et l’heure affichées de cette signature ? L’heure réelle et la signature resteront inchangées.")) return false;
    const body = { action: "update-signature-display-time", mode, revision: inspectionRevision, role, displaySignedAt };
    const response = standaloneId
      ? await json(await api("/api/standalone-inspections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, id: standaloneId }) }))
      : await json(await api("/api/contract-dossier-agency", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
    dossier = standaloneId ? response.inspection.dossier : response.dossier;
    if (response.revision) { inspectionRevision = response.revision.revision; dossier[mode] = response.revision.snapshot || dossier[mode]; dossier.media = { ...(dossier.media || {}), [mode]: response.revision.media || [] }; }
    for (const currentRole of ["client", "agence"]) pads[currentRole] && pads[currentRole].acknowledge(dossier[mode].signatures && dossier[mode].signatures[currentRole]);
    message("Date et heure affichées de la signature enregistrées.");
    return true;
  }
  async function save(finalize) {
    if (saving || !$("form").reportValidity()) return false;
    if (mode === "retour" && (!dossier.depart || Number($("km").value) < dossier.depart.km)) { message(!dossier.depart ? "Enregistrez d’abord l’état des lieux de départ." : "Le kilométrage retour ne peut pas être inférieur au départ."); return false; }
    saving = true; status();
    try {
      await queue; await Promise.all(Object.values(pads).map(pad => pad.ready()));
      const version = revision, body = readStage();
      const response = standaloneId
        ? await json(await api("/api/standalone-inspections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "update-stage", id: standaloneId, revision: inspectionRevision, stage: body, finalize: Boolean(finalize) }) }))
        : await json(await api("/api/contract-dossier-agency", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, action: "update-" + mode, revision: inspectionRevision, finalize: Boolean(finalize) }) }));
      dossier = standaloneId ? response.inspection.dossier : response.dossier;
      if (response.revision) { inspectionRevision = response.revision.revision; dossier[mode] = response.revision.snapshot || dossier[mode]; dossier.media = { ...(dossier.media || {}), [mode]: response.revision.media || [] }; }
      finalized = Boolean(response.revision ? response.revision.status === "finalized" : dossier[mode] && dossier[mode].finalizedAt);
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
    form.append("revision", String(inspectionRevision));
    form.append("file", new Blob([bytes], { type: "application/pdf" }), "etat-des-lieux-" + mode + ".pdf");
    const response = standaloneId
      ? await api("/api/standalone-inspection-pdf", { method: "POST", body: form })
      : await api("/api/agency-drive-pdf", { method: "POST", body: form });
    await json(response);
  }
  $("pdf").onclick = async () => {
    if (!dossier) return;
    $("pdf").disabled = true; message("Création du PDF et chargement de toutes les photos…");
    try {
      await queue; await Promise.all(Object.values(pads).map(pad => pad.ready()));
      if (dirty && !(await save(false))) throw new Error("Enregistrez les modifications avant de télécharger le PDF.");
      const bytes = await window.InspectionDocument.download({ mode, family, language: reservation.langue === "en" ? "en" : "fr", reference: reservation.contractNumero || reservation.id, summary: summaryEntries(reservation), stage: readStage(), depart: dossier.depart, photos: [...media[mode]], departPhotos: [...media.depart], dirty }, cache);
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
    sketchVehicleType = stage.sketchVehicleType === "utility" ? "utility" : (stage.sketchVehicleType === "car" ? "car" : (family === "utility" ? "utility" : "car"));
    utilitySketchLegacy = sketchVehicleType === "utility" && stage.utilitySketchVersion !== "views-v1" && Array.isArray(stage.utilityMarks) && stage.utilityMarks.length > 0 && stage.utilityMarks.every(mark => !mark.view);
    function mountSketch() {
      sketch = window.createInspectionSketch($("sketch"), { vehicleType: sketchVehicleType, utilityLegacy: utilitySketchLegacy, marks: sketchVehicleType === "utility" ? (stage.utilityMarks || []) : (stage.marks || []), onExpand: view => openPhoto(view.asset, "Schéma utilitaire — " + view.label), onChange: reason => { if (reason !== "description") renderDamageTable(); changed(); } });
      document.querySelectorAll('input[name="sketchVehicleType"]').forEach(input => { input.checked = input.value === sketchVehicleType; });
    }
    document.querySelectorAll('input[name="sketchVehicleType"]').forEach(input => input.onchange = () => {
      const next = input.value; if (next === sketchVehicleType) return;
      const currentMarks = sketch.getMarks();
      if (currentMarks.length && !confirm("Changer le type de véhicule conserve les marques dans leur schéma d’origine. Continuer ?")) { input.checked = false; document.querySelector('input[name="sketchVehicleType"][value="' + sketchVehicleType + '"]').checked = true; return; }
      if (sketchVehicleType === "utility") stage.utilityMarks = currentMarks; else stage.marks = currentMarks;
      sketchVehicleType = next; utilitySketchLegacy = false; mountSketch(); renderDamageTable(); changed();
    });
    mountSketch();
    renderDamageTable();
    finalized = Boolean(stage.finalizedAt);
    for (const role of ["client", "agence"]) pads[role] = window.createInspectionSignature($("signatures"), { role, title: role === "client" ? "Signature client" : "Signature agence", value: stage.signatures && stage.signatures[role], locked: finalized, onChange: changed, onDisplayChange: value => correctSignatureDisplayTime(role, value), onError: error => message(error.message || "Impossible d’enregistrer la date affichée.") });
    if (finalized) $("form").querySelectorAll("#information input,#vehicle input,#vehicle select,#dommages,#sketch input,.cleanliness-buttons button").forEach(control => { control.disabled = true; });
    $("form").querySelectorAll("#information input,#vehicle input,#vehicle select,#dommages").forEach(input => input.addEventListener("input", changed));
    if (mode === "retour" && dossier.depart) {
      const depart = dossier.depart; $("departCompare").hidden = false;
      const values = [["Kilométrage départ", depart.km + " km"], ["Carburant départ", depart.carburant + " %"], ["Propreté extérieure", depart.propreteExterieure == null ? depart.proprete : depart.propreteExterieure + " / 5"], ["Propreté intérieure", depart.propreteInterieure == null ? depart.proprete : depart.propreteInterieure + " / 5"], ["Kilomètres parcourus", stage.km == null ? "—" : stage.km - depart.km + " km"]];
      fieldGrid($("departureValues"), values); $("departDamage").textContent = "Dommages déjà présents au départ : " + (depart.dommages || "Non renseignés");
      const departLegacy = depart.sketchVehicleType === "utility" && depart.utilitySketchVersion !== "views-v1" && Array.isArray(depart.utilityMarks) && depart.utilityMarks.length > 0 && depart.utilityMarks.every(mark => !mark.view);
      window.createInspectionSketch($("departureSketch"), { vehicleType: depart.sketchVehicleType === "utility" ? "utility" : "car", utilityLegacy: departLegacy, marks: (depart.sketchVehicleType === "utility" ? depart.utilityMarks : depart.marks) || [], readOnly: true, onExpand: view => openPhoto(view.asset, "Schéma utilitaire — " + view.label) }); M.renderReadOnly($("departurePhotos"), media.depart, cache, openPhoto);
      $("km").addEventListener("input", () => { values[4][1] = $("km").value === "" ? "—" : Number($("km").value) - depart.km + " km"; fieldGrid($("departureValues"), values); });
    }
    renderPhotos(); renderComparison(); status();
  }
  function standaloneControls(standalone) {
    const summary = $("reservationSummary"); const box = document.createElement("section"); box.className = "card";
    const heading = document.createElement("h2"), note = document.createElement("label"), actions = document.createElement("div");
    heading.textContent = "Association et note interne"; note.className = "field"; note.textContent = "Remarque interne";
    const area = document.createElement("textarea"); area.rows = 3; area.maxLength = 2000; area.value = standalone.internalNote || ""; note.append(area);
    const saveNote = document.createElement("button"), associate = document.createElement("button"); saveNote.type = associate.type = "button"; saveNote.className = "secondary"; associate.className = "outline"; saveNote.textContent = "Enregistrer la remarque"; associate.textContent = standalone.linkedContractNumero ? "Changer le contrat associé" : "Associer à un contrat";
    actions.className = "actions"; actions.append(saveNote, associate); box.append(heading, note, actions); summary.parentNode.insertBefore(box, summary.nextSibling);
    saveNote.onclick = async () => { try { await json(await api("/api/standalone-inspections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "note", id: standaloneId, internalNote: area.value }) })); message("Remarque interne enregistrée."); } catch (error) { message(error.message); } };
    associate.onclick = async () => { try { const query = prompt("Rechercher un contrat par numéro, client, véhicule ou immatriculation :"); if (query === null) return; const found = await json(await api("/api/standalone-inspections?contracts=1&q=" + encodeURIComponent(query))); if (!found.contracts.length) throw new Error("Aucun contrat correspondant."); const choices = found.contracts.map((item, index) => (index + 1) + ". " + (item.contractNumero || item.id) + " — " + [item.client.prenom, item.client.nom].filter(Boolean).join(" ") + " — " + (item.immatriculation || item.vehiculeId || "")).join("\n"); const choice = Number(prompt("Choisissez le contrat :\n" + choices)); const contract = found.contracts[choice - 1]; if (!contract) return; const saved = await json(await api("/api/standalone-inspections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "associate", id: standaloneId, linkedContractId: contract.id }) })); reservation.contractNumero = saved.inspection.linkedContractNumero || null; associate.textContent = "Changer le contrat associé"; message("Contrat " + (reservation.contractNumero || "") + " associé à l’état des lieux."); } catch (error) { message(error.message); } };
  }
  async function start() {
    if (legacy) { await legacyView(); return; }
    if (!token && !standaloneId) throw new Error("Accès agence requis. Ouvrez l’état des lieux depuis le back-office.");
    if (standaloneId) {
      const session = await json(await fetch("/api/agency-session", { credentials: "same-origin" })); csrfToken = session.csrfToken || "";
      if (!csrfToken) throw new Error("Accès agence requis. Ouvrez l’état des lieux depuis le back-office.");
      const view = await json(await api("/api/standalone-inspections?id=" + encodeURIComponent(standaloneId)));
      const standalone = view.inspection;
      if (standalone.mode !== mode) throw new Error("Type d’état des lieux incohérent.");
      dossier = standalone.dossier || { status: "draft", depart: null, retour: null, media: { depart: [], retour: [] } };
      const revisions = standalone.inspectionRevisions && standalone.inspectionRevisions[mode] || [];
      const current = revisions.find(item => item.revision === requestedRevision) || revisions[revisions.length - 1];
      if (current) { inspectionRevision = current.revision; dossier[mode] = current.snapshot || dossier[mode]; dossier.media = { ...(dossier.media || {}), [mode]: current.media || [] }; }
      if (standalone.status === "finalized" && dossier[mode] && !dossier[mode].finalizedAt) dossier[mode].finalizedAt = standalone.updatedAt || new Date().toISOString();
      reservation = { id: standalone.id, contractVersion: { version: 1 }, contractNumero: standalone.linkedContractNumero || null, vehicule: standalone.vehicule || {}, conducteur: standalone.client || {}, langue: "fr" };
      window.__standaloneInspection = standalone;
    } else {
      const view = await json(await api("/api/contract-dossier-agency")); dossier = view.dossier; reservation = view.reservation;
      const revisions = view.inspectionRevisions && view.inspectionRevisions[mode] || [];
      const current = revisions.find(item => item.revision === requestedRevision) || revisions[revisions.length - 1];
      if (current) { inspectionRevision = current.revision; dossier[mode] = current.snapshot || dossier[mode]; dossier.media = { ...(dossier.media || {}), [mode]: current.media || [] }; }
    }
    if (!inspectionRevision) inspectionRevision = 1;
    media = { depart: dossier.media && dossier.media.depart || [], retour: dossier.media && dossier.media.retour || [] }; family = reservation.vehicule && reservation.vehicule.vehicleFamily === "utility" ? "utility" : "car";
    dirty = !dossier[mode];
    try { editableMedia = new Set(JSON.parse(sessionStorage.getItem(metadataKey()) || "[]")); } catch (_) { editableMedia = new Set(); }
    $("summary").textContent = standaloneId ? "État des lieux indépendant de " + mode : "État des lieux de " + mode; fieldGrid($("reservationSummary"), standaloneId ? [["Client", [reservation.conducteur.prenom, reservation.conducteur.nom].filter(Boolean).join(" ")], ["Téléphone", reservation.conducteur.telephone], ["Véhicule", reservation.vehicule.nom], ["Immatriculation", reservation.vehicule.immatriculation], ["Contrat associé", reservation.contractNumero || "Non associé"], ["Référence EDL", reservation.id]] : summaryEntries(reservation)); if (standaloneId) standaloneControls(window.__standaloneInspection); $("form").hidden = false; fill();
  }
  start().catch(error => { $("summary").textContent = error.message; $("saveStatus").textContent = "Chargement impossible"; });
}());
