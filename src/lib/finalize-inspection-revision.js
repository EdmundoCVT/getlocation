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
  const bytes = await generateInspectionPdf({ id: record.id, stage, revision, snapshot, media: current.media || [] });
  await env.DOCUMENTS_BUCKET.put(key, bytes, { httpMetadata: { contentType: "application/pdf" }, customMetadata: { inspectionId: record.id, stage, revision: String(revision) } });
  const withPdf = setRevisionPdf(record, stage, fallbackSnapshot, fallbackMedia, actor, revision, key);
  const finalized = finalizeInspectionRevision({ ...record, inspectionRevisions: withPdf.inspectionRevisions }, stage, fallbackSnapshot, fallbackMedia, actor, revision, snapshot);
  return { ...finalized, pdfKey: key, idempotent: false };
}
module.exports = { finalizeRevisionWithPdf };
