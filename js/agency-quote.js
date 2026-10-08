/* Devis indicatif agence. Ne persiste aucune donnée et n'appelle aucun endpoint. */
(function (root) {
  "use strict";
  const pricing = root.GETLOCATION_PRICING;
  const vehicles = typeof VEHICULES !== "undefined" ? VEHICULES : [];
  const byId = (id) => document.getElementById(id);
  const money = (value) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(value || 0);
  const esc = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const dateFR = (value) => value ? new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", dateStyle: "long" }).format(new Date(value + "T12:00:00Z")) : "—";
  const parisToday = () => {
    const parts = new Intl.DateTimeFormat("en", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const part = (key) => parts.find((x) => x.type === key).value;
    return part("year") + "-" + part("month") + "-" + part("day");
  };

  function calculateTotals({ rentalSubtotal, delivery = 0, returnFee = 0, extras = [], discountType = "amount", discountValue = 0 }) {
    const beforeDiscount = Math.max(0, rentalSubtotal) + Math.max(0, delivery) + Math.max(0, returnFee) + extras.reduce((sum, x) => sum + Math.max(0, x.amount || 0), 0);
    const discount = Math.min(beforeDiscount, discountType === "percent" ? beforeDiscount * Math.min(100, Math.max(0, discountValue)) / 100 : Math.max(0, discountValue));
    return { beforeDiscount, discount, total: Math.round((beforeDiscount - discount) * 100) / 100 };
  }

  function daysBetween(start, startTime, end, endTime) {
    if (pricing && pricing.rentalDays) return pricing.rentalDays(start, startTime, end, endTime);
    const duration = new Date(end + "T" + endTime) - new Date(start + "T" + startTime);
    return duration > 0 ? Math.max(1, Math.ceil(duration / 86400000)) : 0;
  }
  function init() {
    const form = byId("quoteForm");
    if (!form) return;
    const select = byId("q-vehicle");
    vehicles.forEach((vehicle) => {
      const option = document.createElement("option"); option.value = vehicle.id; option.textContent = vehicle.nom; select.appendChild(option);
    });
    const custom = document.createElement("option"); custom.value = "custom"; custom.textContent = "Autre véhicule…"; select.appendChild(custom);
    const now = new Date(); const today = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const nextDay = new Date(today + "T12:00:00Z"); nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const tomorrow = nextDay.toISOString().slice(0, 10);
    byId("q-start").value = today; byId("q-end").value = tomorrow;
    byId("q-deposit").value = String((vehicles.find((v) => v.id === select.value) || {}).caution || 0);

    let manuallyChangedRate = false;
    function updateRate() {
      const isCustom = select.value === "custom";
      byId("q-custom-name-wrap").hidden = !isCustom;
      if (isCustom) { byId("q-rate-mode").value = "custom"; manuallyChangedRate = true; if (!byId("q-daily").value || byId("q-daily").value === "0") byId("q-daily").value = ""; byId("q-deposit").value = "0"; }
      else {
        const vehicle = vehicles.find((v) => v.id === select.value);
        byId("q-rate-mode").value = manuallyChangedRate ? "custom" : "automatic";
        if (vehicle && !manuallyChangedRate) {
          const quote = pricing && pricing.calculateQuote({ vehicleId: vehicle.id, dateDebut: byId("q-start").value, heureDebut: byId("q-start-time").value, dateFin: byId("q-end").value, heureFin: byId("q-end-time").value });
          byId("q-daily").value = String(quote && quote.days ? (quote.rentalSubtotal / quote.days).toFixed(2) : vehicle.prixJour || 0);
        }
        if (vehicle) byId("q-deposit").value = String(vehicle.caution || 0);
      }
      updateDays();
    }
    function updateDays() {
      const days = daysBetween(byId("q-start").value, byId("q-start-time").value, byId("q-end").value, byId("q-end-time").value);
      byId("q-days").textContent = days ? days + (days > 1 ? " jours" : " jour") : "Dates invalides";
      const vehicle = vehicles.find((v) => v.id === select.value);
      if (vehicle && !manuallyChangedRate && pricing) {
        const quote = pricing.calculateQuote({ vehicleId: vehicle.id, dateDebut: byId("q-start").value, heureDebut: byId("q-start-time").value, dateFin: byId("q-end").value, heureFin: byId("q-end-time").value });
        if (quote && quote.days) byId("q-daily").value = (quote.rentalSubtotal / quote.days).toFixed(2);
      }
      if (byId("q-delivery-km").value !== "" && !byId("q-delivery").dataset.manual && pricing) byId("q-delivery").value = pricing.deliveryCost(byId("q-delivery-km").value).toFixed(2);
    }
    select.addEventListener("change", () => { manuallyChangedRate = false; if (select.value === "custom") byId("q-daily").value = ""; updateRate(); });
    byId("q-rate-mode").addEventListener("change", () => { manuallyChangedRate = byId("q-rate-mode").value === "custom"; updateRate(); });
    byId("q-daily").addEventListener("input", () => { manuallyChangedRate = true; byId("q-rate-mode").value = "custom"; });
    ["q-start", "q-end", "q-start-time", "q-end-time", "q-delivery-km"].forEach((id) => byId(id).addEventListener("input", updateDays));
    byId("q-delivery").addEventListener("input", () => { byId("q-delivery").dataset.manual = "true"; });
    byId("q-delivery-km").addEventListener("input", () => { byId("q-delivery").dataset.manual = ""; updateDays(); });
    updateRate();

    function addExtra(label, amount) {
      const row = document.createElement("div"); row.className = "quote-extra-row";
      row.innerHTML = '<div class="field"><label>Option / frais</label><input type="text" maxlength="100" value="' + esc(label || "") + '"></div><div class="field"><label>Montant TTC (€)</label><input type="number" min="0" step="0.01" value="' + esc(amount || "0") + '"></div><button type="button" class="btn btn-sm" aria-label="Supprimer cette ligne">×</button>';
      row.querySelector("button").addEventListener("click", () => row.remove()); byId("q-extras").appendChild(row);
    }
    byId("q-add-extra").addEventListener("click", () => addExtra("", "0"));

    function model() {
      const start = byId("q-start").value, end = byId("q-end").value;
      const startTime = byId("q-start-time").value, endTime = byId("q-end-time").value;
      const days = daysBetween(start, startTime, end, endTime);
      const daily = Number(byId("q-daily").value);
      if (!days || !Number.isFinite(daily) || daily < 0) throw new Error("Vérifiez les dates et le tarif journalier.");
      const vehicle = vehicles.find((v) => v.id === select.value);
      const vehicleName = select.value === "custom" ? byId("q-custom-name").value.trim() : (vehicle ? vehicle.nom : "Véhicule");
      if (!vehicleName) throw new Error("Indiquez le nom du véhicule.");
      const automatic = vehicle && !manuallyChangedRate && pricing && pricing.calculateQuote({ vehicleId: vehicle.id, dateDebut: start, heureDebut: startTime, dateFin: end, heureFin: endTime });
      const rentalSubtotal = automatic && !manuallyChangedRate ? automatic.rentalSubtotal : Math.round(daily * days * 100) / 100;
      const extras = [...byId("q-extras").querySelectorAll(".quote-extra-row")].map((row) => ({ label: row.querySelector('input[type="text"]').value.trim(), amount: Math.max(0, Number(row.querySelector('input[type="number"]').value) || 0) })).filter((x) => x.label && x.amount > 0);
      const delivery = Math.max(0, Number(byId("q-delivery").value) || 0), returnFee = Math.max(0, Number(byId("q-return-fee").value) || 0);
      const totals = calculateTotals({ rentalSubtotal, delivery, returnFee, extras, discountType: byId("q-discount-type").value, discountValue: Math.max(0, Number(byId("q-discount").value) || 0) });
      const todayISO = parisToday();
      const validity = Math.min(90, Math.max(1, Number(byId("q-validity").value) || 7));
      const validityDate = new Date(todayISO + "T12:00:00Z"); validityDate.setUTCDate(validityDate.getUTCDate() + validity);
      return {
        vehicle, vehicleName, start, end, startTime, endTime, days, daily: !manuallyChangedRate && automatic ? automatic.rentalSubtotal / days : daily, rentalSubtotal,
        pickup: byId("q-pickup").value.trim(), returnLocation: byId("q-return").value.trim(), delivery, returnFee, extras,
        total: totals.total, discount: totals.discount, deposit: Math.max(0, Number(byId("q-deposit").value) || 0),
        includedKm: automatic ? automatic.includedKm : 0, customer: byId("q-customer").value.trim(), comments: byId("q-comments").value.trim(),
        created: todayISO, validityDate: validityDate.toISOString().slice(0, 10)
      };
    }
    function plainText(q) {
      return ["GET LOCATION — DEVIS EXPRESS", q.customer ? "Client : " + q.customer : "", "Véhicule : " + q.vehicleName, "Du " + dateFR(q.start) + " à " + q.startTime + " au " + dateFR(q.end) + " à " + q.endTime + " (" + q.days + " jour(s))", q.pickup ? "Prise en charge : " + q.pickup : "", q.returnLocation ? "Retour : " + q.returnLocation : "", "Location : " + money(q.rentalSubtotal), q.delivery ? "Livraison : " + money(q.delivery) : "", q.returnFee ? "Retour : " + money(q.returnFee) : "", ...q.extras.map((x) => x.label + " : " + money(x.amount)), q.discount ? "Remise : −" + money(q.discount) : "", "TOTAL TTC : " + money(q.total), "Dépôt de garantie (séparé) : " + money(q.deposit), q.includedKm ? "Kilométrage inclus : " + q.includedKm + " km" : "", "Créé le " + dateFR(q.created) + " — valable jusqu'au " + dateFR(q.validityDate), "Disponibilité à confirmer — ce devis ne constitue pas une réservation.", "getlocation.fr", q.comments ? "Commentaire : " + q.comments : ""].filter(Boolean).join("\n");
    }
    function render(q) {
      const rows = [['Location (' + q.days + ' jour(s) × ' + money(q.daily) + ')', q.rentalSubtotal], ...(q.delivery ? [['Livraison', q.delivery]] : []), ...(q.returnFee ? [['Frais de retour', q.returnFee]] : []), ...q.extras.map((x) => [x.label, x.amount]), ...(q.discount ? [['Remise', -q.discount]] : [])];
      byId("q-preview").innerHTML = '<div class="quote-brand"><div><strong style="color:#ff6b00;letter-spacing:.08em">GET LOCATION</strong><div>DEVIS EXPRESS</div></div><img src="images/logo-icon.png" alt=""></div>' +
        (q.customer ? '<p><strong>Client :</strong> ' + esc(q.customer) + '</p>' : '') +
        '<h2>' + esc(q.vehicleName) + '</h2><p><strong>Du</strong> ' + esc(dateFR(q.start)) + ' à ' + esc(q.startTime) + ' <strong>au</strong> ' + esc(dateFR(q.end)) + ' à ' + esc(q.endTime) + '<br>' + q.days + ' jour(s)</p>' +
        '<p><strong>Prise en charge :</strong> ' + esc(q.pickup || 'À définir') + '<br><strong>Retour :</strong> ' + esc(q.returnLocation || 'À définir') + '</p>' +
        '<table class="quote-lines">' + rows.map((r) => '<tr><td>' + esc(r[0]) + '</td><td>' + esc(money(r[1])) + '</td></tr>').join('') + '</table>' +
        '<div class="quote-total">TOTAL TTC<strong>' + esc(money(q.total)) + '</strong></div>' +
        '<p><strong>Dépôt de garantie (séparé) :</strong> ' + esc(money(q.deposit)) + (q.includedKm ? '<br><strong>Kilométrage inclus :</strong> ' + q.includedKm + ' km' : '') + '</p>' +
        (q.comments ? '<p><strong>Commentaire :</strong> ' + esc(q.comments) + '</p>' : '') +
        '<p class="quote-warning">Créé le ' + esc(dateFR(q.created)) + ' — valable jusqu’au ' + esc(dateFR(q.validityDate)) + '.<br>Disponibilité à confirmer : ce devis ne constitue pas une réservation et ne bloque aucun véhicule.</p><strong>getlocation.fr</strong>';
      byId("q-preview").hidden = false; byId("q-export-actions").hidden = false;
    }
    function canvasFor(q) {
      const canvas = byId("q-canvas"), width = canvas.width;
      canvas.height = 1300 + q.extras.length * 48 + (q.customer ? 48 : 0) + (q.comments ? 44 : 0) + (q.delivery ? 46 : 0) + (q.returnFee ? 46 : 0) + (q.discount ? 46 : 0) + (q.includedKm ? 46 : 0);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, width, canvas.height); ctx.fillStyle = "#ff6b00"; ctx.fillRect(0, 0, width, 18);
      ctx.fillStyle = "#ff6b00"; ctx.font = "bold 35px Arial"; ctx.fillText("GET LOCATION", 70, 91);
      ctx.fillStyle = "#0066ff"; ctx.font = "bold 25px Arial"; ctx.fillText("DEVIS EXPRESS", 70, 137);
      let y = 205; const line = (text, size = 27, color = "#24242b", bold = false) => { ctx.fillStyle = color; ctx.font = (bold ? "bold " : "") + size + "px Arial"; ctx.fillText(text, 70, y, width - 140); y += size + 22; };
      if (q.customer) line("Client : " + q.customer);
      line(q.vehicleName, 35, "#24242b", true); line("Du " + dateFR(q.start) + " à " + q.startTime + " au " + dateFR(q.end) + " à " + q.endTime + " — " + q.days + " jour(s)", 24);
      line("Prise en charge : " + (q.pickup || "À définir"), 24); line("Retour : " + (q.returnLocation || "À définir"), 24); y += 12;
      const entries = [["Location", q.rentalSubtotal], ...(q.delivery ? [["Livraison", q.delivery]] : []), ...(q.returnFee ? [["Frais de retour", q.returnFee]] : []), ...q.extras.map((x) => [x.label, x.amount]), ...(q.discount ? [["Remise", -q.discount]] : [])];
      entries.forEach(([label, amount]) => { line(label, 24); ctx.textAlign = "right"; ctx.fillStyle = "#24242b"; ctx.font = "24px Arial"; ctx.fillText(money(amount), width - 70, y - 22); ctx.textAlign = "left"; });
      y += 8; ctx.fillStyle = "#0066ff"; ctx.fillRect(55, y, width - 110, 128); y += 45; ctx.fillStyle = "#fff"; ctx.font = "bold 25px Arial"; ctx.fillText("TOTAL TTC", 85, y); ctx.font = "bold 46px Arial"; ctx.fillText(money(q.total), 85, y + 55); y += 135;
      line("Dépôt de garantie (séparé) : " + money(q.deposit), 24); if (q.includedKm) line("Kilométrage inclus : " + q.includedKm + " km", 24);
      if (q.comments) line("Commentaire : " + q.comments, 22);
      y += 8; line("Créé le " + dateFR(q.created) + " — valable jusqu’au " + dateFR(q.validityDate), 20);
      line("Disponibilité à confirmer — ce devis ne constitue pas une réservation.", 20); line("getlocation.fr", 22, "#0066ff", true);
      return canvas;
    }
    let current = null;
    byId("q-preview-btn").addEventListener("click", () => {
      try { current = model(); render(current); byId("q-error").hidden = true; }
      catch (error) { byId("q-error").textContent = error.message; byId("q-error").hidden = false; }
    });
    byId("q-edit").addEventListener("click", () => { byId("q-preview").hidden = true; byId("q-export-actions").hidden = true; });
    function downloadPng(blob) {
      if (!blob) return;
      const url = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = url; link.download = "devis-getlocation.png"; link.click(); URL.revokeObjectURL(url);
    }
    byId("q-copy").addEventListener("click", async () => { if (current && navigator.clipboard) { await navigator.clipboard.writeText(plainText(current)); byId("q-copy").textContent = "Texte copié"; } });
    byId("q-png").addEventListener("click", () => { if (!current) return; canvasFor(current).toBlob(downloadPng, "image/png"); });
    byId("q-share").addEventListener("click", async () => {
      if (!current) return;
      const canvas = canvasFor(current);
      if (canvas.toBlob) canvas.toBlob(async (blob) => {
        if (blob && navigator.share && navigator.canShare) { const file = new File([blob], "devis-getlocation.png", { type: "image/png" }); if (navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: "Devis GET LOCATION" }); return; } }
        downloadPng(blob);
      }, "image/png");
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
  root.GETLOCATION_AGENCY_QUOTE = { daysBetween, calculateTotals };
})(typeof window !== "undefined" ? window : globalThis);
