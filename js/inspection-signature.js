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
    const box = document.createElement("div"), title = document.createElement("h3"), label = document.createElement("label"), name = document.createElement("input"), canvas = document.createElement("canvas"), expand = document.createElement("button"), timestamp = document.createElement("p"), clear = document.createElement("button");
    box.className = "signature-box"; title.textContent = options.title; label.className = "field"; label.textContent = "Nom du signataire";
    name.id = "signature-" + options.role + "-name"; name.maxLength = 100; name.autocomplete = "name"; label.append(name);
    canvas.className = "signature-pad"; canvas.width = 960; canvas.height = 420; canvas.dataset.role = options.role; canvas.setAttribute("aria-label", options.title + " — zone de signature");
    expand.type = "button"; expand.className = "secondary signature-expand"; expand.textContent = "Signer en plein écran";
    timestamp.className = "hint signature-time"; clear.type = "button"; clear.className = "danger"; clear.textContent = "Effacer la signature";
    box.append(title, label, canvas, expand, timestamp, clear); root.append(box);

    let imageDataUrl = options.value && options.value.imageDataUrl || "", signedAt = options.value && options.value.signedAt || "";
    const update = () => { timestamp.textContent = signedAt ? "Signée le : " + global.InspectionMedia.date(signedAt) : "Signature non renseignée"; };
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
          target.dispatchEvent(new root.ownerDocument.defaultView.Event("inspection-signature-accepted"));
        }
        close();
      };
      dialog.addEventListener("click", event => { if (event.target === dialog) close(); });
    }
    canvas.addEventListener("inspection-signature-accepted", () => { imageDataUrl = canvas.toDataURL("image/png"); signedAt = new Date().toISOString(); update(); options.onChange(); });
    name.oninput = () => { signedAt = new Date().toISOString(); update(); options.onChange(); };
    clear.onclick = async () => { await ready.catch(() => {}); surface.clear(); imageDataUrl = ""; signedAt = ""; update(); options.onChange(); };
    update();
    return {
      ready: () => ready,
      get: () => imageDataUrl || name.value.trim() ? { name: name.value.trim(), imageDataUrl, signedAt } : null,
      acknowledge: value => { signedAt = value && value.signedAt || ""; imageDataUrl = value && value.imageDataUrl || imageDataUrl; update(); }
    };
  };
}(window));
