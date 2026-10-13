// Métadonnées légères destinées aux listes agence. Les snapshots, signatures
// base64 et médias restent exclusivement dans les réponses d'éditeur.
function summarizeRevision(revision) {
  if (!revision || typeof revision !== "object") return null;
  return {
    revision: Number(revision.revision),
    status: revision.status === "finalized" ? "finalized" : "draft",
    createdAt: revision.createdAt || null,
    updatedAt: revision.updatedAt || null,
    createdBy: revision.createdBy || null,
    finalizedAt: revision.finalizedAt || null,
    finalizedBy: revision.finalizedBy || null,
    basedOnRevision: Number.isInteger(Number(revision.basedOnRevision)) ? Number(revision.basedOnRevision) : null,
    pdfKey: revision.pdfKey || null
  };
}

function summarizeInspectionRevisions(revisions) {
  return Object.fromEntries(Object.entries(revisions || {}).map(([stage, list]) => [stage, Array.isArray(list) ? list.map(summarizeRevision).filter(Boolean) : []]));
}

module.exports = { summarizeInspectionRevisions };
