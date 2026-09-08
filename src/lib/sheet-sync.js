// src/lib/sheet-sync.js
//
// Synchronisation d'une location vers l'onglet "Réservations" du Google
// Sheet (Lot 3, voir CLAUDE.md). Google Sheets reste l'outil de
// planning/pilotage ; D1 reste la source fiable — cette synchronisation
// n'est jamais dans le chemin critique d'une écriture D1 (voir
// sheet-sync-outbox.js, appelée en best-effort après coup).
//
// Règles absolues respectées ici :
// - lecture dynamique des en-têtes AVANT toute écriture, refus propre si la
//   structure a changé (voir verifyHeaders) ;
// - identifiant stable pour retrouver une ligne (jamais le numéro de
//   ligne) : la colonne "N° résa", TOUJOURS présente dès la création de la
//   location (dérivée de son id interne, même format GL-<8 derniers hex>
//   que la référence déjà affichée aux clients en ligne — voir js/app.js).
//   PAS "Num contrat" : cette colonne reste vide tant que le contrat n'est
//   pas généré (voir rentals.js, generateRentalContract), donc inutilisable
//   comme clé avant ce moment-là ;
// - jamais d'écrasement d'une formule existante, ni d'une valeur hors
//   liste de validation, sur une ligne déjà existante (voir
//   computeWritableRuns) — une ligne nouvellement ajoutée n'a par
//   construction ni formule ni validation à préserver.

const { getVehiculeParId, dureeEnHeures, joursFacturablesDepuisHeures } = require("../../js/data.js");
const { getRentalById } = require("./rentals.js");
const { getClientById } = require("./clients.js");
const { listPaymentsForRental, summarizePayments } = require("./payments.js");
const { getDepositForRental } = require("./deposits.js");
const { getValues, updateValues, appendValues, getRowMeta } = require("./google-sheets-client.js");

const SHEET_NAME = "Réservations";
const LAST_COLUMN = "W"; // 23 colonnes, voir EXPECTED_HEADERS
const MAX_SCAN_ROWS = 5000; // largement suffisant pour une petite agence

// Ordre exact confirmé sur la copie de test (voir compte rendu du Lot 0) —
// l'entrée vide représente la colonne sans en-tête ("moyen de paiement de
// la caution", confirmé par l'utilisateur).
const EXPECTED_HEADERS = [
  "N° résa", "Num contrat", "Prénom client", "Nom client", "Téléphone", "Véhicule",
  "Date début", "Heure début", "Date fin", "Heure fin", "Nb jours",
  "Tarif / jour (€)", "Tarif total (€)", "Acompte versé (€)", "Solde restant (€)",
  "Moyen de paiement Location", "Caution", "", "Caution retenue", "Raisons",
  "Statut paiement", "Source", "Notes"
];

const METHODE_LABELS = { carte: "Carte bancaire", especes: "Espèces", virement: "Virement" };
const STATUT_PAIEMENT_LABELS = { impaye: "Impayé", partiel: "Partiel", solde: "Soldé" };

class SheetStructureError extends Error {
  constructor(message) {
    super(message);
    this.name = "SheetStructureError";
  }
}

function colLetter(index) {
  return String.fromCharCode("A".charCodeAt(0) + index);
}

// Même formule que la référence de réservation déjà affichée aux clients en
// ligne (voir js/app.js) — réappropriée ici comme clé d'idempotence stable.
function shortRef(rentalId) {
  return `GL-${rentalId.slice(-8).toUpperCase()}`;
}

function formatDateFR(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

function euros(cents) {
  return Number.isFinite(cents) ? cents / 100 : "";
}

async function verifyHeaders(env) {
  const rows = await getValues(env, SHEET_NAME, `A1:${LAST_COLUMN}1`);
  const headerRow = rows[0] || [];
  const normalized = EXPECTED_HEADERS.map((_, i) => (headerRow[i] !== undefined ? String(headerRow[i]) : ""));
  const mismatch = EXPECTED_HEADERS.findIndex((expected, i) => expected !== normalized[i]);
  if (mismatch !== -1) {
    throw new SheetStructureError(
      `Structure de l'onglet "${SHEET_NAME}" différente de celle attendue (colonne ${colLetter(mismatch)} : attendu "${EXPECTED_HEADERS[mismatch]}", trouvé "${normalized[mismatch]}"). Synchronisation refusée.`
    );
  }
}

function buildRowValues({ rental, client, vehicule, paymentsSummary, methodesUtilisees, deposit }) {
  const retenue = deposit && (deposit.status === "retenue_partielle" || deposit.status === "retenue_totale");
  return [
    shortRef(rental.id),
    rental.contractNumero || "",
    client ? client.firstName : "",
    client ? client.lastName : "",
    client ? client.phone : "",
    vehicule ? vehicule.nom : rental.vehiculeId,
    formatDateFR(rental.dateDebut),
    rental.heureDebut || "",
    formatDateFR(rental.dateFin),
    rental.heureFin || "",
    joursFacturablesDepuisHeures(dureeEnHeures(rental.dateDebut, rental.heureDebut, rental.dateFin, rental.heureFin)),
    vehicule ? vehicule.prixJour : "",
    Number.isFinite(rental.priceTotalCents) ? euros(rental.priceTotalCents) : "",
    euros(paymentsSummary.totalPaidCents),
    euros(paymentsSummary.balanceCents),
    methodesUtilisees.map((m) => METHODE_LABELS[m] || m).join(" + "),
    deposit ? euros(deposit.amountRequestedCents) : "",
    deposit ? METHODE_LABELS[deposit.method] || deposit.method : "",
    retenue ? euros(deposit.retainedAmountCents) : "",
    retenue ? deposit.retainedReason || "" : "",
    STATUT_PAIEMENT_LABELS[paymentsSummary.status] || "",
    "Agence",
    rental.notes || ""
  ];
}

async function findExistingRow(env, ref) {
  const rows = await getValues(env, SHEET_NAME, `A2:A${MAX_SCAN_ROWS}`);
  const index = rows.findIndex((row) => row[0] === ref);
  return index === -1 ? null : index + 2; // +2 : ligne 1 = en-têtes, tableau 0-indexé
}

// Regroupe les colonnes qui peuvent être écrites en plages contiguës, en
// sautant toute cellule protégée (formule existante, ou valeur hors liste
// de validation) — jamais un `null`/vide envoyé à la place, qui effacerait
// la cellule au lieu de la laisser intacte.
function computeWritableRuns(values, rowMeta) {
  const writable = values.map((value, i) => {
    const cell = rowMeta[i];
    if (cell && cell.userEnteredValue && cell.userEnteredValue.formulaValue) return false;
    const validation = cell && cell.dataValidation && cell.dataValidation.condition;
    if (validation && validation.type === "ONE_OF_LIST") {
      const allowed = (validation.values || []).map((v) => (v.userEnteredValue || "").toLowerCase());
      if (String(value).toLowerCase() && !allowed.includes(String(value).toLowerCase())) return false;
    }
    return true;
  });

  const runs = [];
  let current = null;
  writable.forEach((ok, i) => {
    if (!ok) { current = null; return; }
    if (current) current.values.push(values[i]);
    else { current = { startIndex: i, values: [values[i]] }; runs.push(current); }
  });
  return runs;
}

// Synchronise UNE location (état courant en D1) vers la copie configurée
// (env.GOOGLE_SHEETS_SPREADSHEET_ID — jamais la production sans
// autorisation explicite, voir CLAUDE.md). Jette en cas d'échec (structure
// invalide, erreur réseau/API Google) — voir sheet-sync-outbox.js pour la
// gestion des tentatives.
async function syncRentalToSheet(env, rentalId) {
  const rental = await getRentalById(env, rentalId);
  if (!rental) throw new Error("Location introuvable, synchronisation annulée");

  const [client, payments, deposit] = await Promise.all([
    getClientById(env, rental.clientId),
    listPaymentsForRental(env, rental.id),
    getDepositForRental(env, rental.id)
  ]);
  const vehicule = getVehiculeParId(rental.vehiculeId);
  const paymentsSummary = summarizePayments(payments, rental.priceTotalCents || 0);
  const methodesUtilisees = [...new Set(payments.filter((p) => p.status === "valide").map((p) => p.method))];

  await verifyHeaders(env);

  const ref = shortRef(rental.id);
  const values = buildRowValues({ rental, client, vehicule, paymentsSummary, methodesUtilisees, deposit });
  const existingRow = await findExistingRow(env, ref);

  if (existingRow === null) {
    await appendValues(env, SHEET_NAME, [values]);
    return { action: "created", row: null };
  }

  const rowMeta = await getRowMeta(env, SHEET_NAME, existingRow, LAST_COLUMN);
  const runs = computeWritableRuns(values, rowMeta);
  for (const run of runs) {
    const startCol = colLetter(run.startIndex);
    const endCol = colLetter(run.startIndex + run.values.length - 1);
    await updateValues(env, SHEET_NAME, `${startCol}${existingRow}:${endCol}${existingRow}`, [run.values]);
  }
  const skipped = values.length - runs.reduce((n, r) => n + r.values.length, 0);
  return { action: "updated", row: existingRow, skippedCells: skipped };
}

module.exports = {
  SHEET_NAME,
  EXPECTED_HEADERS,
  SheetStructureError,
  shortRef,
  verifyHeaders,
  buildRowValues,
  computeWritableRuns,
  syncRentalToSheet
};
