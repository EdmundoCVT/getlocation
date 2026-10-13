const { getInspectionRevision, setRevisionPdf, finalizeInspectionRevision, revisionPdfKey } = require("./inspection-revisions.js");
const { generateInspectionPdf } = require("./inspection-pdf-server.js");

// Ordre volontaire : R2 puis état finalisé. Si la génération ou R2 échoue,
// le brouillon est conservé et aucune finalisation trompeuse n'est écrite.
async function finalizeRevisionWithPdf({ env, record, stage, revision, snapshot, fallbackSnapshot, fallbackMedia, actor, standalone }) {
  if (!env.DOCUMENTS_BUCKET) { const error = new Error("Stockage PDF indisponible"); error.status = 503; throw error; }
  const current = getInspectionRevision(record, stage, fallbackSnapshot, fallbackMedia, actor, revision);
  if (!current) { const error = new Error("Révision introuvable"); error.status = 404; throw error; }
  if (current.status === "finalized") return { inspectionRevisions: record.inspectionRevisions, revision: current, idempotent: true };
  const key = revisionPdfKey(record.id, stage, revision, standalone);
  const bytes = await generateInspectionPdf({ env, id: record.id, stage, revision, snapshot, media: current.media || [] });
  await env.DOCUMENTS_BUCKET.put(key, bytes, { httpMetadata: { contentType: "application/pdf" }, customMetadata: { inspectionId: record.id, stage, revision: String(revision) } });
  // Répare les brouillons produits avant la séparation des flux : ils pouvaient
  // contenir un PDF navigateur provisoire. Un brouillon n'est jamais une archive
  // officielle; le renderer Worker le remplace donc lors de la finalisation.
  const revisions = (record.inspectionRevisions && record.inspectionRevisions[stage] || []).map(item => item.revision === Number(revision) && item.status === "draft" ? { ...item, pdfKey: null, pdfArchivedAt: null } : item);
  const normalized = current.pdfKey ? { ...record, inspectionRevisions: { ...(record.inspectionRevisions || {}), [stage]: revisions } } : record;
  const withPdf = setRevisionPdf(normalized, stage, fallbackSnapshot, fallbackMedia, actor, revision, key);
  const finalized = finalizeInspectionRevision({ ...normalized, inspectionRevisions: withPdf.inspectionRevisions }, stage, fallbackSnapshot, fallbackMedia, actor, revision, snapshot);
  return { ...finalized, pdfKey: key, idempotent: false };
}
module.exports = { finalizeRevisionWithPdf };
