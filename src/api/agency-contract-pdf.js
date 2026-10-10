// Consultation agence d'un PDF de contrat déjà archivé dans R2.
// La clé R2 reste exclusivement côté serveur : l'identifiant du dossier ne
// permet jamais de choisir arbitrairement un objet du bucket.
const { requireAgencySession } = require("../lib/agency-auth.js");
const { getReservation, contractVersionInfo } = require("../lib/reservation-store.js");

const ID = /^res_[a-f0-9]{32}$/;

function json(status, error) {
  return new Response(JSON.stringify({ error }), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

function pdfForReservation(reservation) {
  const version = contractVersionInfo(reservation).version;
  const signed = reservation && reservation.contractDossier && reservation.contractDossier.status === "signed";
  const kind = signed ? "contract-signed" : "contract-draft";
  const sourceKey = `${kind}-v${version}`;
  const file = Array.isArray(reservation.drivePdfFiles) && reservation.drivePdfFiles.find((item) => item && item.sourceKey === sourceKey && item.key);
  return { file, kind, version, signed };
}

function filename(reservation, pdf) {
  const numero = String(reservation.contractNumero || reservation.id).replace(/[^A-Za-z0-9_-]/g, "_");
  return `${numero}-V${pdf.version}${pdf.signed ? "-SIGNE" : ""}.pdf`;
}

async function handleAgencyContractPdf(request, env) {
  if (request.method !== "GET") return json(405, "Méthode non autorisée");
  const auth = await requireAgencySession(request, env);
  if (auth.error) return auth.error;
  if (!env.DOCUMENTS_BUCKET) return json(503, "Stockage documentaire indisponible");

  const url = new URL(request.url);
  const id = url.searchParams.get("id") || "";
  if (!ID.test(id)) return json(400, "Identifiant de contrat invalide");
  const reservation = await getReservation(env, id);
  if (!reservation || !["paid", "manual_contract", "contract_version"].includes(reservation.status)) return json(404, "Contrat introuvable");

  const pdf = pdfForReservation(reservation);
  if (!pdf.file) return json(404, pdf.signed ? "PDF signé historique non archivé" : "PDF non archivé");
  const object = await env.DOCUMENTS_BUCKET.get(pdf.file.key);
  if (!object) return json(404, "PDF non archivé");

  const download = url.searchParams.get("download") === "1";
  const disposition = `${download ? "attachment" : "inline"}; filename="${filename(reservation, pdf)}"`;
  return new Response(object.body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": disposition,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

module.exports = { handleAgencyContractPdf, pdfForReservation, filename };
