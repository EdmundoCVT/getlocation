// src/lib/contract-store.js
//
// Persistance des contrats de location sur Cloudflare KV (binding
// CONTRACTS_KV, voir wrangler.jsonc). Contrairement aux réservations
// (src/lib/reservation-store.js), un contrat est un document commercial à
// conserver — aucun TTL n'est appliqué ici.
//
// `rawData` a exactement la forme de lireDonneesFormulaire() dans
// contrat.html : c'est ce qui permet de réutiliser telle quelle la logique
// de préremplissage du formulaire pour "Dupliquer"/"Ouvrir" côté client.

function pad2(n) {
  return String(n).padStart(2, "0");
}

function dateDuJourAAAAMMJJ() {
  const now = new Date();
  return `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`;
}

// Numérotation GL-AAAAMMJJ-NNNN : compteur journalier en KV (clé
// "counter_AAAAMMJJ", préfixe volontairement disjoint de "contract_" pour
// ne jamais apparaître dans list({prefix:"contract_"})). Lecture-puis-
// écriture non atomique : limite acceptée pour un usage mono-utilisateur à
// faible volume (même compromis que RESERVATION_HOLD_MS dans
// reservation-store.js) — un numéro ne sera jamais réutilisé mais deux
// clics strictement simultanés pourraient en théorie obtenir le même
// numéro, cas non réaliste ici.
async function generateContractNumber(env) {
  const datePart = dateDuJourAAAAMMJJ();
  const counterKey = `counter_${datePart}`;
  const current = await env.CONTRACTS_KV.get(counterKey);
  const next = (current ? parseInt(current, 10) : 0) + 1;
  await env.CONTRACTS_KV.put(counterKey, String(next));
  return `GL-${datePart}-${String(next).padStart(4, "0")}`;
}

async function saveContract(env, rawData) {
  const numero = await generateContractNumber(env);
  const record = { numero, createdAt: new Date().toISOString(), rawData };
  await env.CONTRACTS_KV.put(`contract_${numero}`, JSON.stringify(record));
  return record;
}

// Liste les derniers contrats, du plus récent au plus ancien. Implémentation
// volontairement simple (parcours complet des clés préfixées "contract_",
// tri en mémoire) : adaptée à une petite agence à faible volume, pas conçue
// pour un grand nombre de contrats.
async function listRecentContracts(env, limit = 20) {
  const records = [];
  let cursor;
  do {
    const page = await env.CONTRACTS_KV.list({ prefix: "contract_", cursor });
    for (const key of page.keys) {
      const raw = await env.CONTRACTS_KV.get(key.name);
      if (raw) records.push(JSON.parse(raw));
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  // Tri par createdAt décroissant, avec le numéro (lui-même croissant de
  // façon monotone dans le temps, voir generateContractNumber) en
  // départage : deux contrats créés à la même milliseconde ne doivent pas
  // se retrouver dans un ordre indéterminé.
  records.sort((a, b) => {
    const parDate = (b.createdAt || "").localeCompare(a.createdAt || "");
    return parDate !== 0 ? parDate : (b.numero || "").localeCompare(a.numero || "");
  });
  return records.slice(0, limit);
}

module.exports = {
  generateContractNumber,
  saveContract,
  listRecentContracts
};
