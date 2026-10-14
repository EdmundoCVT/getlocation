(function (global) {
  "use strict";

  function drawSurface(canvas, onChange) {
    const ctx = canvas.getContext("2d");
    ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.strokeStyle = "#172b43"; ctx.fillStyle = "#172b43";
    let drawing = false, last = null;
    const point = event => {
      const rect = canvas.getBoundingClientRect();
      return { x: (event.clientX - rect.left) * canvas.width / rect.width, y: (event.clientY - rect.top) * canvas.height / rect.height };
    };
    canvas.addEventListener("pointerdown", event => {
      event.preventDefault(); drawing = true; last = point(event); canvas.setPointerCapture(event.pointerId);
      ctx.beginPath(); ctx.arc(last.x, last.y, Math.max(1.5, ctx.lineWidth / 2), 0, Math.PI * 2); ctx.fill(); onChange();
    });
    canvas.addEventListener("pointermove", event => {
      if (!drawing) return; event.preventDefault(); const next = point(event);
      ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(next.x, next.y); ctx.stroke(); last = next; onChange();
    });
    canvas.addEventListener("pointerup", () => { drawing = false; }); canvas.addEventListener("pointercancel", () => { drawing = false; });
    return { ctx, clear: () => ctx.clearRect(0, 0, canvas.width, canvas.height) };
  }

  function drawImage(canvas, source) {
    if (!source) return Promise.resolve();
    const image = new Image(); image.src = source;
    return global.InspectionMedia.decode(image).then(() => {
      const ctx = canvas.getContext("2d"); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    });
  }

  global.createInspectionSignature = function (root, options) {
    const box = document.createElement("div"), title = document.createElement("h3"), label = document.createElement("label"), name = document.createElement("input"), canvas = document.createElement("canvas"), expand = document.createElement("button"), timestamp = document.createElement("p"), displayLabel = document.createElement("label"), display = document.createElement("input"), clear = document.createElement("button");
    box.className = "signature-box"; title.textContent = options.title; label.className = "field"; label.textContent = "Nom du signataire";
    name.id = "signature-" + options.role + "-name"; name.maxLength = 100; name.autocomplete = "name"; label.append(name);
    // 640 × 280 suffit pour un paraphe net dans le PDF et réduit fortement le
    // JSON envoyé par Safari par rapport à l'ancien canevas 960 × 420.
    canvas.className = "signature-pad"; canvas.width = 640; canvas.height = 280; canvas.dataset.role = options.role; canvas.setAttribute("aria-label", options.title + " — zone de signature");
    name.value = options.value && options.value.name || "";
    expand.type = "button"; expand.className = "secondary signature-expand"; expand.textContent = "Signer";
    timestamp.className = "hint signature-time"; displayLabel.className = "field signature-display-time"; displayLabel.textContent = "Date et heure affichées"; display.type = "datetime-local"; display.step = "60"; displayLabel.append(display); clear.type = "button"; clear.className = "danger"; clear.textContent = "Effacer la signature";
    box.append(title, label, canvas, expand, timestamp, displayLabel, clear); root.append(box);

    let imageDataUrl = options.value && options.value.imageDataUrl || "", signedAt = options.value && options.value.signedAt || "", displaySignedAt = options.value && options.value.displaySignedAt || "";
    const update = () => { timestamp.textContent = signedAt ? "Heure réelle interne : " + global.InspectionMedia.date(signedAt) : "Signature non renseignée"; display.disabled = !signedAt; display.value = signedAt ? global.InspectionMedia.local(displaySignedAt || signedAt) : ""; };
    const changed = () => { signedAt = new Date().toISOString(); imageDataUrl = canvas.toDataURL("image/png"); update(); options.onChange(); };
    const surface = drawSurface(canvas, changed);
    let ready = imageDataUrl ? drawImage(canvas, imageDataUrl).catch(() => { timestamp.textContent = "Signature enregistrée illisible — effacez-la explicitement pour la remplacer."; }) : Promise.resolve();

    const dialog = document.getElementById("signatureDialog"), dialogCanvas = document.getElementById("signatureDialogCanvas");
    expand.onclick = async () => {
      if (!dialog || !dialogCanvas || typeof dialog.showModal !== "function") { canvas.scrollIntoView({ behavior: "smooth", block: "center" }); canvas.focus(); return; }
      document.getElementById("signatureDialogTitle").textContent = options.title;
      await ready.catch(() => {}); await drawImage(dialogCanvas, imageDataUrl || canvas.toDataURL("image/png"));
      dialog.dataset.role = options.role; dialog.showModal();
    };

    if (dialog && dialogCanvas && !dialog.dataset.bound) {
      dialog.dataset.bound = "true";
      const dialogSurface = drawSurface(dialogCanvas, () => { dialog.dataset.dirty = "true"; });
      const close = () => { if (dialog.open) dialog.close(); };
      document.getElementById("signatureDialogClose").onclick = close;
      document.getElementById("signatureDialogClear").onclick = () => { dialogSurface.clear(); dialog.dataset.dirty = "true"; };
      document.getElementById("signatureDialogConfirm").onclick = () => {
        const role = dialog.dataset.role;
        const target = root.ownerDocument.querySelector(".signature-pad[data-role='" + role + "']");
        if (target) {
          const targetCtx = target.getContext("2d"); targetCtx.clearRect(0, 0, target.width, target.height); targetCtx.drawImage(dialogCanvas, 0, 0, target.width, target.height);
          target.dispatchEvent(new root.ownerDocument.defaultView.Event("inspection-signature-accepted", { bubbles: true }));
        }
        close();
      };
      dialog.addEventListener("click", event => { if (event.target === dialog) close(); });
    }
    canvas.addEventListener("inspection-signature-accepted", () => { imageDataUrl = canvas.toDataURL("image/png"); signedAt = new Date().toISOString(); update(); options.onChange(); });
    name.oninput = () => { if (!signedAt) signedAt = new Date().toISOString(); update(); options.onChange(); };
    clear.onclick = async () => { await ready.catch(() => {}); surface.clear(); imageDataUrl = ""; signedAt = ""; update(); options.onChange(); };
    display.onchange = async () => {
      if (!signedAt || typeof options.onDisplayChange !== "function") return;
      const previous = displaySignedAt || "", next = display.value === global.InspectionMedia.local(signedAt) ? null : display.value || null;
      display.disabled = true;
      try {
        const accepted = await options.onDisplayChange(next, previous || null);
        if (accepted === false) { display.value = global.InspectionMedia.local(previous || signedAt); return; }
        displaySignedAt = next || "";
      } catch (error) { display.value = global.InspectionMedia.local(previous || signedAt); if (options.onError) options.onError(error); }
      finally { update(); }
    };
    if (options.locked) { name.disabled = true; canvas.style.pointerEvents = "none"; canvas.setAttribute("aria-disabled", "true"); expand.disabled = true; clear.disabled = true; display.disabled = true; displayLabel.title = "Version finalisée : créez une nouvelle révision pour modifier cette date."; }
    update();
    return {
      ready: () => ready,
      get: () => imageDataUrl || name.value.trim() ? { name: name.value.trim(), imageDataUrl, signedAt, ...(displaySignedAt ? { displaySignedAt } : {}) } : null,
      acknowledge: value => { signedAt = value && value.signedAt || ""; displaySignedAt = value && value.displaySignedAt || ""; imageDataUrl = value && value.imageDataUrl || imageDataUrl; update(); }
    };
  };
}(window));
