const MAX_ORIGINAL_BYTES = 8 * 1024 * 1024;
const MAX_OPTIMIZED_BYTES = 2 * 1024 * 1024;
const ORIGINAL_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

function extension(type) {
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  if (type === "image/heic") return "heic";
  if (type === "image/heif") return "heif";
  return "jpg";
}

function dimension(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 && number <= 50000 ? number : null;
}

function validateOriginal(file) {
  return Boolean(file && typeof file.arrayBuffer === "function" && ORIGINAL_TYPES.has(file.type) && file.size > 0 && file.size <= MAX_ORIGINAL_BYTES);
}

function validateOptimized(file) {
  return Boolean(file && typeof file.arrayBuffer === "function" && file.type === "image/jpeg" && file.size > 0 && file.size <= MAX_OPTIMIZED_BYTES);
}

async function storeInspectionMediaFiles({ env, prefix, form, customMetadata }) {
  const original = form.get("file");
  const optimized = form.get("optimizedFile");
  if (!validateOriginal(original)) { const error = new Error("Format non accepté ou photo trop volumineuse (8 Mo max.)"); error.status = 400; throw error; }
  if (optimized && !validateOptimized(optimized)) { const error = new Error("Copie optimisée invalide ou trop volumineuse (2 Mo max.)"); error.status = 400; throw error; }

  const stem = `${Date.now()}-${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const key = `${prefix}${stem}.${extension(original.type)}`;
  const optimizedKey = optimized ? `${prefix}${stem}-pdf.jpg` : null;
  const originalBytes = await original.arrayBuffer();
  const optimizedBytes = optimized ? await optimized.arrayBuffer() : null;
  if (originalBytes.byteLength > MAX_ORIGINAL_BYTES || (optimizedBytes && optimizedBytes.byteLength > MAX_OPTIMIZED_BYTES)) { const error = new Error("Photo trop volumineuse"); error.status = 400; throw error; }

  const baseMetadata = Object.fromEntries(Object.entries(customMetadata || {}).map(([name, value]) => [name, String(value)]));
  await env.DOCUMENTS_BUCKET.put(key, originalBytes, { httpMetadata: { contentType: original.type }, customMetadata: { ...baseMetadata, variant: "original", ...(optimizedKey ? { optimizedKey } : {}) } });
  try {
    if (optimizedKey) await env.DOCUMENTS_BUCKET.put(optimizedKey, optimizedBytes, { httpMetadata: { contentType: "image/jpeg" }, customMetadata: { ...baseMetadata, variant: "pdf", originalKey: key } });
  } catch (error) {
    await env.DOCUMENTS_BUCKET.delete(key).catch(() => undefined);
    throw error;
  }

  const metadata = {
    key,
    ...(optimizedKey ? { optimizedKey } : {}),
    originalName: String(original.name || "photo").slice(0, 180),
    contentType: original.type,
    size: originalBytes.byteLength,
    ...(optimizedBytes ? { optimizedSize: optimizedBytes.byteLength } : {})
  };
  for (const name of ["originalWidth", "originalHeight", "optimizedWidth", "optimizedHeight"]) {
    const value = dimension(form.get(name));
    if (value) metadata[name] = value;
  }
  return { item: metadata, keys: [key, optimizedKey].filter(Boolean) };
}

async function removeStoredFiles(bucket, keys) {
  await Promise.all((keys || []).filter(Boolean).map(key => bucket.delete(key).catch(() => undefined)));
}

function allMedia(container, fallbackMedia) {
  const media = [];
  for (const revisions of Object.values(container && container.inspectionRevisions || {})) {
    if (Array.isArray(revisions)) for (const revision of revisions) if (Array.isArray(revision && revision.media)) media.push(...revision.media);
  }
  if (Array.isArray(fallbackMedia)) media.push(...fallbackMedia);
  else if (fallbackMedia && typeof fallbackMedia === "object") for (const list of Object.values(fallbackMedia)) if (Array.isArray(list)) media.push(...list);
  return media;
}

function mediaObjectKey(container, requestedKey, variant, fallbackMedia) {
  const item = allMedia(container, fallbackMedia).find(media => media && (media.key === requestedKey || media.optimizedKey === requestedKey));
  if (!item) return requestedKey;
  return variant === "original" ? item.key : (item.optimizedKey || item.key);
}

module.exports = { MAX_ORIGINAL_BYTES, MAX_OPTIMIZED_BYTES, ORIGINAL_TYPES, storeInspectionMediaFiles, removeStoredFiles, mediaObjectKey };
