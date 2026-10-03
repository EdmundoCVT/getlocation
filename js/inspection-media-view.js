// Private media are fetched with the existing authorization, then decoded into
// data URLs: unlike blob URLs, these remain valid in the separate print document
// and comply with the site's img-src 'self' data: policy.
(function (global) {
  "use strict";
  const labels = { avant: "Avant", arriere: "Arrière", gauche: "Côté gauche", droite: "Côté droit", "avant-gauche": "3/4 avant gauche", "avant-droit": "3/4 avant droit", "arriere-gauche": "3/4 arrière gauche", "arriere-droit": "3/4 arrière droit", interieur: "Intérieur", "tableau-de-bord": "Tableau de bord", jante: "Jante / roue", dommage: "Détail dommage", autre: "Autre" };
  function local(value) {
    if (!value) return "";
    // Preserve business datetime-local values, without inventing a timezone.
    if (/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value)) return value;
    const d = new Date(value); if (Number.isNaN(d.getTime())) return "";
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0") + "T" + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }
  function date(value) { if (!value) return "Non renseignée"; const d = new Date(value); return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString("fr-FR"); }
  function decode(image) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Délai de chargement de la photo dépassé.")), 20000);
      const done = () => { clearTimeout(timeout); image.naturalWidth ? resolve(image) : reject(new Error("Photo illisible.")); };
      const fail = () => { clearTimeout(timeout); reject(new Error("Photo illisible.")); };
      if (image.decode) image.decode().then(done, fail);
      else if (image.complete) done(); else { image.onload = done; image.onerror = fail; }
    });
  }
  function createCache(fetchMedia) {
    const entries = new Map();
    return {
      get(item) {
        const key = item.key || item.dataUrl;
        if (!key) return Promise.reject(new Error("Référence photo absente."));
        if (!entries.has(key)) {
          const promise = (item.dataUrl ? Promise.resolve(item.dataUrl) : fetchMedia(item).then(response => {
            if (!response.ok) throw new Error("Photo inaccessible (" + response.status + ").");
            return response.blob();
          }).then(blob => new Promise((resolve, reject) => {
            const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error("Lecture de la photo impossible.")); reader.readAsDataURL(blob);
          }))).then(async url => {
            if (!/^data:image\//.test(url)) throw new Error("Le fichier n’est pas une image.");
            const image = new Image(); image.src = url; await decode(image); return url;
          }).catch(error => { entries.delete(key); throw error; });
          entries.set(key, promise);
        }
        return entries.get(key);
      },
      forget(key) { entries.delete(key); }
    };
  }
  function button(text, action, className) { const el = document.createElement("button"); el.type = "button"; el.textContent = text; el.className = className || "outline"; el.onclick = action; return el; }
  function preview(item, cache, open) {
    const wrap = document.createElement("div"); wrap.className = "photo-preview";
    const placeholder = document.createElement("p"); placeholder.className = "photo-placeholder"; placeholder.textContent = "Chargement de la photo…"; wrap.append(placeholder);
    const load = async () => {
      placeholder.textContent = "Chargement de la photo…"; wrap.replaceChildren(placeholder);
      try {
        const url = await cache.get(item), image = new Image(); image.alt = labels[item.slot] || item.label || "Photo historique"; image.src = url; await decode(image);
        const zoom = button("", () => open(url, image.alt)); zoom.className = "photo-zoom"; zoom.setAttribute("aria-label", "Agrandir — " + image.alt); zoom.append(image); wrap.replaceChildren(zoom);
      } catch (error) { placeholder.textContent = error.message; wrap.replaceChildren(placeholder, button("Réessayer", load)); }
    };
    load(); return wrap;
  }
  function renderReadOnly(root, items, cache, open) {
    root.replaceChildren();
    if (!items.length) { const p = document.createElement("p"); p.textContent = "Aucune photo enregistrée."; root.append(p); }
    items.forEach(item => {
      const figure = document.createElement("figure"), caption = document.createElement("figcaption"); figure.className = "photo-item";
      caption.textContent = (labels[item.slot] || item.label || "Photo") + " · Date/heure de la photo : " + date(item.capturedAt || item.dateHeure) + (item.createdAt ? " · Importée le : " + date(item.createdAt) : "");
      figure.append(preview(item, cache, open), caption); root.append(figure);
    });
  }
  global.InspectionMedia = { labels, slots: Object.keys(labels), local, date, decode, createCache, preview, renderReadOnly, button };
}(window));
