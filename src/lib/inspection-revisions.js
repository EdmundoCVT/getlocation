// Moteur commun de révisions EDL. Les snapshots sont volontairement
// indépendants du document vivant : une V1 finalisée ne peut jamais être
// modifiée par la préparation d'une V2.
const STAGES = new Set(["depart", "retour"]);
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function validStage(stage) { return STAGES.has(stage); }
function legacyRevision(stage, snapshot, media, actor) {
  if (!snapshot) return [];
  const finalized = Boolean(snapshot.finalizedAt || snapshot.completedAt);
  return [{ revision: 1, status: finalized ? "finalized" : "draft", snapshot: clone(snapshot), media: clone(media || []), pdfKey: null, finalizedAt: snapshot.finalizedAt || (finalized ? snapshot.completedAt : null), createdAt: snapshot.completedAt || null, createdBy: actor || null, basedOnRevision: null, legacy: true }];
}
function listInspectionRevisions(container, stage, fallbackSnapshot, fallbackMedia, actor) {
  if (!validStage(stage)) return [];
  const stored = container && container.inspectionRevisions && container.inspectionRevisions[stage];
  return Array.isArray(stored) && stored.length ? clone(stored) : legacyRevision(stage, fallbackSnapshot, fallbackMedia, actor);
}
function latestInspectionRevision(container, stage, fallbackSnapshot, fallbackMedia, actor) {
  const revisions = listInspectionRevisions(container, stage, fallbackSnapshot, fallbackMedia, actor);
  return revisions.length ? revisions[revisions.length - 1] : null;
}
function materializeInspectionRevisions(container, stage, fallbackSnapshot, fallbackMedia, actor) {
  const revisions = listInspectionRevisions(container, stage, fallbackSnapshot, fallbackMedia, actor);
  return { ...(container && container.inspectionRevisions || {}), [stage]: revisions };
}
function createInspectionRevision(container, stage, fallbackSnapshot, fallbackMedia, actor, baseRevision) {
  const revisions = listInspectionRevisions(container, stage, fallbackSnapshot, fallbackMedia, actor);
  const base = revisions.find(item => item.revision === Number(baseRevision)) || revisions[revisions.length - 1];
  if (!base || base.status !== "finalized") throw new Error("La révision source doit être finalisée");
  const now = new Date().toISOString();
  // Décision de sécurité : une signature ne se propage jamais comme
  // signature de la correction. V2 garde le reste du constat et les
  // références média, mais exige de nouvelles signatures si nécessaire.
  const snapshot = clone(base.snapshot);
  if (snapshot && snapshot.signatures) snapshot.signatures = { client: null, agence: null };
  if (snapshot) { delete snapshot.completedAt; delete snapshot.finalizedAt; }
  const next = { revision: Math.max(...revisions.map(item => item.revision)) + 1, status: "draft", snapshot, media: clone(base.media || []), pdfKey: null, finalizedAt: null, createdAt: now, createdBy: actor || null, basedOnRevision: base.revision };
  return { revisions: [...revisions, next], revision: next };
}
function revisionMediaPrefix(id, stage, revision, standalone) { return (standalone ? "inspection-standalone/" : "inspection/") + id + "/" + stage + "/v" + revision + "/"; }
function revisionPdfKey(id, stage, revision, standalone) { return (standalone ? "inspection-pdf-standalone/" : "inspection-pdf/") + id + "/" + stage + "/v" + revision + ".pdf"; }
module.exports = { listInspectionRevisions, latestInspectionRevision, materializeInspectionRevisions, createInspectionRevision, revisionMediaPrefix, revisionPdfKey };
