// src/lib/contract-numero.js
//
// Numérotation atomique des contrats (GL-AAAAMMJJ-NNNN) — Lot 2. Remplace le
// compteur Cloudflare KV lecture-puis-écriture qu'utilisait jusqu'ici
// src/lib/reservation-store.js (generateContractNumero) : ce dernier n'avait
// aucune garantie d'unicité stricte en cas de deux écritures quasi
// simultanées (accepté comme compromis "petite agence, faible volume" à
// l'origine — voir AUDIT.md). Le cahier des charges du mini-back-office
// agence l'exige désormais explicitement : "N'utilise pas Workers KV pour un
// compteur nécessitant une garantie d'unicité."
//
// Un seul compteur partagé (table D1 contract_counters, voir
// migrations/0002_clients_rentals.sql), utilisé À LA FOIS par les nouvelles
// locations (src/lib/rentals.js) ET par les contrats manuels historiques
// (src/lib/reservation-store.js) — jamais deux compteurs indépendants pour
// le même format de numéro, qui pourraient sinon produire un doublon.
//
// Atomicité : une seule requête SQL (UPSERT SQLite, `ON CONFLICT ... DO
// UPDATE ... RETURNING`) — aucune fenêtre entre lecture et écriture,
// contrairement au compteur KV précédent.

function pad2(n) {
  return String(n).padStart(2, "0");
}

async function generateContractNumero(env) {
  const now = new Date();
  const datePart = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`;
  const row = await env.AGENCY_DB.prepare(
    "INSERT INTO contract_counters (date_part, seq) VALUES (?, 1) ON CONFLICT(date_part) DO UPDATE SET seq = seq + 1 RETURNING seq"
  ).bind(datePart).first();
  return `GL-${datePart}-${String(row.seq).padStart(4, "0")}`;
}

module.exports = { generateContractNumero };
