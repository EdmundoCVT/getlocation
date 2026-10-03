(function (global) {
  "use strict";
  global.createInspectionSignature = function (root, options) {
    const box = document.createElement("div"), title = document.createElement("h3"), label = document.createElement("label"), name = document.createElement("input"), canvas = document.createElement("canvas"), timestamp = document.createElement("p"), clear = document.createElement("button");
    box.className = "signature-box"; title.textContent = options.title; label.className = "field"; label.textContent = "Nom du signataire";
    name.id = "signature-" + options.role + "-name"; name.maxLength = 100; name.autocomplete = "name"; label.append(name);
    canvas.className = "signature-pad"; canvas.width = 640; canvas.height = 260; canvas.dataset.role = options.role; canvas.setAttribute("aria-label", options.title + " — zone de signature");
    timestamp.className = "hint"; clear.type = "button"; clear.className = "danger"; clear.textContent = "Effacer la signature";
    box.append(title, label, canvas, timestamp, clear); root.append(box);
    const ctx = canvas.getContext("2d"); ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.strokeStyle = "#172b43"; ctx.fillStyle = "#172b43";
    let imageDataUrl = options.value && options.value.imageDataUrl || "", signedAt = options.value && options.value.signedAt || "", drawing = false, last;
    name.value = options.value && options.value.name || "";
    const update = () => { timestamp.textContent = signedAt ? "Signée le : " + global.InspectionMedia.date(signedAt) : "Signature non renseignée"; };
    const changed = () => { signedAt = new Date().toISOString(); update(); options.onChange(); };
    const point = e => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * canvas.width / r.width, y: (e.clientY - r.top) * canvas.height / r.height }; };
    let ready = Promise.resolve();
    if (imageDataUrl) {
      const image = new Image(); image.src = imageDataUrl;
      ready = global.InspectionMedia.decode(image).then(() => ctx.drawImage(image, 0, 0, canvas.width, canvas.height));
      // Do not silently replace an unreadable saved signature with an empty pad.
      ready.catch(() => { timestamp.textContent = "Signature enregistrée illisible — effacez-la explicitement pour la remplacer."; });
    }
    canvas.onpointerdown = async e => {
      e.preventDefault(); await ready.catch(() => {}); drawing = true; last = point(e); canvas.setPointerCapture(e.pointerId);
      ctx.beginPath(); ctx.arc(last.x, last.y, 1.5, 0, Math.PI * 2); ctx.fill(); imageDataUrl = canvas.toDataURL("image/png"); changed();
    };
    canvas.onpointermove = e => { if (!drawing) return; e.preventDefault(); const next = point(e); ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(next.x, next.y); ctx.stroke(); last = next; imageDataUrl = canvas.toDataURL("image/png"); };
    canvas.onpointerup = canvas.onpointercancel = () => { drawing = false; };
    name.oninput = changed;
    clear.onclick = async () => { await ready.catch(() => {}); ctx.clearRect(0, 0, canvas.width, canvas.height); imageDataUrl = ""; signedAt = ""; update(); options.onChange(); };
    update();
    return { ready: () => ready, get: () => imageDataUrl || name.value.trim() ? { name: name.value.trim(), imageDataUrl, signedAt } : null, acknowledge: value => { signedAt = value && value.signedAt || ""; update(); } };
  };
}(window));
