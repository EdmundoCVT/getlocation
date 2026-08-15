// src/lib/document-retention.js
//
// Purge quotidienne RGPD des documents d'identité (permis, pièce
// d'identité, documents et informations du second conducteur) 30 jours
// après la restitution du véhicule — décision validée à la suite de la
// revue de sécurité des PR #3-8 (finding "haute" : aucune suppression
// automatique n'existait). Voir reservation-store.js pour
// PAID_RETENTION_AFTER_RETURN_MS (même valeur, seule source de vérité).
//
// Ne touche JAMAIS au statut de paiement ni à quoi que ce soit de
// nécessaire à la comptabilité, au paiement ou à la preuve contractuelle :
// conducteur principal, dates, prix, options, CGL... Seuls les champs
// documentaires post-paiement sont concernés (documentFiles, documentsData,
// documentAccess, agencyDocumentAccess) — updateReservationDocuments()
// (reservation-store.js) refuse déjà toute réservation qui n'est pas
// "paid" et ne modifie jamais `status`.
//
// Idempotente : une réservation dont documentsPurgedAt est déjà renseigné
// n'est plus jamais retraitée. En cas d'échec de suppression d'un ou
// plusieurs objets R2, la purge N'EST PAS marquée terminée : seuls les
// fichiers réellement supprimés sont retirés de documentFiles, les autres
// restent en place pour être retentés le lendemain (même déclencheur,
// documentsPurgedAt toujours absent).

const {
  listReservations,
  updateReservationDocuments,
  PAID_RETENTION_AFTER_RETURN_MS
} = require("./reservation-store.js");
const { deletePrivateDocument } = require("./document-store.js");

function returnMs(reservation) {
  return new Date(
    reservation.periodeFin || `${reservation.dateFin}T${reservation.heureFin || "00:00"}:00`
  ).getTime();
}

// N'importe quoi de plus qu'une réservation payée, dont un dossier a
// effectivement été soumis (documentsStatus === "submitted" — une
// réservation dont le client n'a jamais rien envoyé n'a pas de "documents"
// à purger), pas déjà purgée, et dont la restitution remonte à au moins
// PAID_RETENTION_AFTER_RETURN_MS.
function shouldPurgeDocuments(reservation, nowMs) {
  if (!reservation || reservation.status !== "paid") return false;
  if (reservation.documentsStatus !== "submitted") return false;
  if (reservation.documentsPurgedAt) return false;
  const returned = returnMs(reservation);
  if (!Number.isFinite(returned)) return false;
  return nowMs - returned >= PAID_RETENTION_AFTER_RETURN_MS;
}

// deleteDocument est injectable pour les tests (simuler un échec R2 sans
// vrai bucket). Le résultat de CHAQUE suppression est vérifié : deletePrivateDocument
// rejette en cas d'échec réel (R2 indisponible, etc.) — une suppression d'une
// clé déjà absente résout normalement (comportement idempotent standard de
// R2), ce qui est le comportement souhaité ici.
async function purgeReservationDocuments(env, reservation, nowMs, deleteDocument = deletePrivateDocument) {
  const files = Array.isArray(reservation.documentFiles) ? reservation.documentFiles : [];
  const remaining = [];

  for (const file of files) {
    try {
      await deleteDocument(env, file.key);
    } catch (err) {
      // Jamais de nom de fichier original (il n'existe pas : les clés R2
      // sont générées aléatoirement, voir document-store.js) ni de donnée
      // personnelle — uniquement la référence de réservation et le type de
      // pièce concerné.
      console.error("[document-retention] Échec de suppression R2 :", reservation.id, file.type);
      remaining.push(file);
    }
  }

  if (remaining.length) {
    // Purge partielle : ne marque rien comme terminé. Seuls les fichiers
    // déjà supprimés disparaissent de la liste, pour que demain ne
    // retente que ce qui a réellement échoué.
    await updateReservationDocuments(env, reservation.id, { documentFiles: remaining });
    return false;
  }

  await updateReservationDocuments(env, reservation.id, {
    documentFiles: [],
    documentsData: null,
    documentAccess: null,
    agencyDocumentAccess: null,
    documentsPurgedAt: new Date(nowMs).toISOString()
  });
  return true;
}

async function runDocumentRetentionPurge(env, nowMs = Date.now(), purge = purgeReservationDocuments) {
  const reservations = await listReservations(env);
  let purged = 0;
  let failed = 0;
  for (const reservation of reservations) {
    if (!shouldPurgeDocuments(reservation, nowMs)) continue;
    const ok = await purge(env, reservation, nowMs);
    if (ok) purged += 1;
    else failed += 1;
  }
  return { scanned: reservations.length, purged, failed };
}

module.exports = {
  shouldPurgeDocuments,
  purgeReservationDocuments,
  runDocumentRetentionPurge
};
