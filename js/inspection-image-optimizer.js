// Prépare une copie JPEG légère pour l'interface et les PDF EDL. L'original
// reste envoyé séparément et n'est jamais modifié par ce module.
(function (root, factory) {
  const api = factory(root);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.InspectionImageOptimizer = api;
}(typeof window !== "undefined" ? window : globalThis, function (root) {
  "use strict";

  const DEFAULT_MAX_SIDE = 1920;
  const DEFAULT_QUALITY = 0.76;
  const INPUT_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

  function dimensions(width, height, maxSide = DEFAULT_MAX_SIDE) {
    width = Number(width); height = Number(height); maxSide = Number(maxSide);
    if (!(width > 0 && height > 0 && maxSide > 0)) throw new Error("Dimensions de photo invalides.");
    const scale = Math.min(1, maxSide / Math.max(width, height));
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
  }

  function fileName(name) {
    const base = String(name || "photo").replace(/\.[^.]+$/, "").replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "photo";
    return base + "-pdf.jpg";
  }

  function imageElement(file) {
    return new Promise((resolve, reject) => {
      if (!root.document || !root.URL || typeof root.URL.createObjectURL !== "function") return reject(new Error("Décodage de la photo indisponible."));
      const url = root.URL.createObjectURL(file), image = new root.Image();
      image.onload = () => resolve({ source: image, width: image.naturalWidth, height: image.naturalHeight, release() { root.URL.revokeObjectURL(url); } });
      image.onerror = () => { root.URL.revokeObjectURL(url); reject(new Error("Cette photo ne peut pas être lue sur cet appareil.")); };
      image.src = url;
    });
  }

  async function decoded(file, bitmapFactory) {
    const createBitmap = bitmapFactory || root.createImageBitmap;
    if (typeof createBitmap === "function") {
      try {
        // `from-image` applique l'orientation EXIF avant le redimensionnement.
        const bitmap = await createBitmap(file, { imageOrientation: "from-image" });
        return { source: bitmap, width: bitmap.width, height: bitmap.height, release() { if (typeof bitmap.close === "function") bitmap.close(); } };
      } catch (_) { /* Safari peut décoder un HEIC via <img> sans createImageBitmap. */ }
    }
    return imageElement(file);
  }

  function browserCanvas(width, height) {
    if (!root.document) throw new Error("Optimisation de la photo indisponible.");
    const canvas = root.document.createElement("canvas"); canvas.width = width; canvas.height = height; return canvas;
  }

  function jpegBlob(canvas, quality) {
    if (typeof canvas.convertToBlob === "function") return canvas.convertToBlob({ type: "image/jpeg", quality });
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("La copie optimisée n'a pas pu être créée.")), "image/jpeg", quality));
  }

  async function optimize(file, options = {}) {
    if (!file || !INPUT_TYPES.has(String(file.type || "").toLowerCase())) throw new Error("Format de photo non pris en charge.");
    const maxSide = options.maxSide || DEFAULT_MAX_SIDE;
    let quality = options.quality || DEFAULT_QUALITY;
    const image = await decoded(file, options.createImageBitmap);
    let canvas;
    try {
      let target = dimensions(image.width, image.height, maxSide);
      canvas = (options.createCanvas || browserCanvas)(target.width, target.height);
      const draw = () => {
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) throw new Error("Optimisation de la photo indisponible.");
        context.fillStyle = "#fff"; context.fillRect(0, 0, target.width, target.height);
        context.drawImage(image.source, 0, 0, target.width, target.height);
      };
      draw();
      let blob = await jpegBlob(canvas, quality);
      // Les scènes très détaillées peuvent rester lourdes à 1920 px. On reste
      // dans la plage métier (qualité >= 0,72 et côté long >= 1600 px) au lieu
      // d'envoyer un dérivé de plusieurs mégaoctets.
      if (blob.size > 650 * 1024 && quality > 0.72) { quality = 0.72; blob = await jpegBlob(canvas, quality); }
      if (blob.size > 650 * 1024 && Math.max(target.width, target.height) > 1600) {
        target = dimensions(image.width, image.height, 1600); canvas.width = target.width; canvas.height = target.height; draw(); blob = await jpegBlob(canvas, 0.72); quality = 0.72;
      }
      return {
        blob,
        fileName: fileName(file.name),
        originalWidth: image.width,
        originalHeight: image.height,
        optimizedWidth: target.width,
        optimizedHeight: target.height,
        quality,
        maxSide
      };
    } finally {
      image.release();
      // Libère immédiatement le grand buffer canvas sur iPhone.
      if (canvas) { canvas.width = 1; canvas.height = 1; }
    }
  }

  async function sequential(items, task, progress) {
    const results = [];
    for (let index = 0; index < items.length; index++) {
      if (progress) progress(index + 1, items.length, items[index]);
      results.push(await task(items[index], index));
    }
    return results;
  }

  return { optimize, sequential, dimensions, isSupported: type => INPUT_TYPES.has(String(type || "").toLowerCase()), DEFAULT_MAX_SIDE, DEFAULT_QUALITY };
}));
