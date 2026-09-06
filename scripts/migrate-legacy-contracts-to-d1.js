// scripts/migrate-legacy-contracts-to-d1.js
//
// Reprise CONTRÔLÉE des contrats manuels historiques (Cloudflare KV,
// RESERVATIONS_KV, status "manual_contract" — voir src/lib/reservation-
// store.js) vers les nouvelles tables D1 clients/rentals (Lot 2, voir
// CLAUDE.md). NE MODIFIE JAMAIS RESERVATIONS_KV (lecture d'un export local
// uniquement) : entièrement réversible — en cas de souci, il suffit de ne
// pas exécuter le SQL généré, ou de supprimer les lignes insérées (id
// stables, voir plus bas).
//
// Ce script ne se connecte à AUCUNE base en direct (KV et D1 ne sont
// accessibles depuis l'extérieur du Worker que via l'API/CLI Cloudflare,
// jamais par une connexion réseau directe depuis un script Node) : il
// transforme un EXPORT LOCAL des contrats manuels en un fichier .sql
// d'INSERT à relire puis exécuter vous-même. Procédure complète :
//
//   1. Exporter les contrats manuels depuis KV (nécessite `wrangler login`) :
//        wrangler kv key list --binding=RESERVATIONS_KV --remote > keys.json
//      Puis, pour chaque clé "res_..." (un script séparé, volontairement PAS
//      fourni ici pour ne pas enchaîner des appels réseau sans supervision),
//      `wrangler kv key get --binding=RESERVATIONS_KV --remote <clé>` et ne
//      garder que les enregistrements dont status === "manual_contract".
//      Rassembler ces enregistrements JSON dans un tableau, dans un fichier
//      local (ex. legacy-manual-contracts.json).
//   2. node scripts/migrate-legacy-contracts-to-d1.js legacy-manual-contracts.json > migration-lot2.sql
//   3. RELIRE migration-lot2.sql (c'est le but de cette étape manuelle — ne
//      jamais enchaîner automatiquement génération + exécution).
//   4. wrangler d1 execute getlocation-agency --remote --file=migration-lot2.sql
//
// Dédoublonnage : un même client (même téléphone OU même email normalisé)
// à travers plusieurs contrats manuels historiques n'est créé qu'UNE fois
// dans ce lot de migration — mais ne fusionne jamais avec un client déjà
// présent en D1 (ce script suppose une base D1 vierge de ces clients ;
// exécuter buildMigrationPlan() une seconde fois sur les mêmes données
// créerait des doublons, voir avertissement en fin de fichier).

const { normalizePhone, normalizeEmail } = require("../src/lib/clients.js");

function sqlString(value) {
  if (value === null || value === undefined || value === "") return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlNumber(value) {
  return Number.isFinite(value) ? String(value) : "NULL";
}

function generateId(prefix, seed) {
  // Déterministe (pas crypto.getRandomValues) : deux exécutions sur le même
  // export produisent les mêmes id, ce qui rend une ré-exécution accidentelle
  // détectable (conflit de clé primaire) plutôt que silencieusement
  // dupliquée.
  const hash = require("crypto").createHash("sha256").update(`${prefix}:${seed}`).digest("hex").slice(0, 32);
  return `${prefix}_${hash}`;
}

// Sépare un "datetime-local" ("2026-08-13T10:00") en {date, heure}. Renvoie
// des chaînes vides si le format est inattendu (jamais d'exception qui
// interromprait toute la planification pour un seul enregistrement).
function splitDateHeure(value) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(value || "");
  return m ? { date: m[1], heure: m[2] } : { date: "", heure: "" };
}

// Construit le plan de migration à partir des enregistrements KV bruts
// (status === "manual_contract" déjà filtré par l'appelant, voir CLI plus
// bas) — fonction PURE, testable sans aucune infrastructure.
function buildMigrationPlan(legacyRecords) {
  const clientsByKey = new Map(); // phone_normalized||email_normalized -> client planifié
  const clients = [];
  const rentals = [];
  const skipped = [];

  for (const record of legacyRecords) {
    if (!record || record.status !== "manual_contract") {
      skipped.push({ id: record && record.id, reason: "status différent de manual_contract" });
      continue;
    }
    if (!record.vehiculeId || !record.depart || !record.retour || !record.nom || !record.prenom) {
      skipped.push({ id: record.id, reason: "champs minimaux manquants (véhicule, dates, identité)" });
      continue;
    }

    const phoneNormalized = normalizePhone(record.tel);
    const emailNormalized = normalizeEmail(record.email);
    const dedupeKey = phoneNormalized || emailNormalized || `sans-contact:${record.id}`;

    let client = clientsByKey.get(dedupeKey);
    if (!client) {
      client = {
        id: generateId("clt", `legacy:${dedupeKey}`),
        firstName: record.prenom,
        lastName: record.nom,
        phoneRaw: record.tel || "",
        phoneNormalized,
        emailRaw: record.email || "",
        emailNormalized,
        birthDate: record.naissance || "",
        postalAddress: [record.adresse, record.codePostal, record.ville].filter(Boolean).join(" "),
        permitNumber: record.permis || "",
        createdAt: record.createdAt || new Date().toISOString()
      };
      clientsByKey.set(dedupeKey, client);
      clients.push(client);
    }

    const debut = splitDateHeure(record.depart);
    const fin = splitDateHeure(record.retour);
    rentals.push({
      id: generateId("rnt", `legacy:${record.id}`),
      clientId: client.id,
      contractNumero: record.contractNumero || null,
      vehiculeId: record.vehiculeId,
      immatriculation: record.immat || "",
      dateDebut: debut.date,
      heureDebut: debut.heure,
      dateFin: fin.date,
      heureFin: fin.heure,
      kmDepart: Number.isFinite(Number(record.kmDepart)) ? Number(record.kmDepart) : null,
      kmRetour: Number.isFinite(Number(record.kmRetour)) ? Number(record.kmRetour) : null,
      status: record.contractNumero ? "contrat_genere" : "brouillon",
      notes: record.notes || "",
      createdAt: record.createdAt || new Date().toISOString(),
      updatedAt: record.updatedAt || record.createdAt || new Date().toISOString(),
      createdBy: record.createdBy || "migration-lot2",
      updatedBy: record.updatedBy || record.createdBy || "migration-lot2"
    });
  }

  return { clients, rentals, skipped };
}

function planToSql({ clients, rentals }) {
  const lines = [
    "-- Généré par scripts/migrate-legacy-contracts-to-d1.js — RELIRE avant exécution.",
    "-- N'exécute rien ici : voir l'en-tête de ce fichier pour la procédure complète.",
    "BEGIN TRANSACTION;"
  ];
  for (const c of clients) {
    lines.push(
      `INSERT INTO clients (id, first_name, last_name, phone_normalized, phone_raw, email_normalized, email_raw, birth_date, postal_address, permit_number, permit_date, marketing_consent, notes, created_at, updated_at, created_by, updated_by) VALUES (${sqlString(c.id)}, ${sqlString(c.firstName)}, ${sqlString(c.lastName)}, ${sqlString(c.phoneNormalized)}, ${sqlString(c.phoneRaw)}, ${sqlString(c.emailNormalized)}, ${sqlString(c.emailRaw)}, ${sqlString(c.birthDate)}, ${sqlString(c.postalAddress)}, ${sqlString(c.permitNumber)}, NULL, 0, NULL, ${sqlString(c.createdAt)}, ${sqlString(c.createdAt)}, 'migration-lot2', 'migration-lot2');`
    );
  }
  for (const r of rentals) {
    lines.push(
      `INSERT INTO rentals (id, client_id, contract_numero, vehicule_id, immatriculation, date_debut, heure_debut, date_fin, heure_fin, lieu_prise, lieu_retour, adresse_prise, adresse_retour, km_depart, km_retour, price_total_cents, status, notes, created_at, updated_at, created_by, updated_by) VALUES (${sqlString(r.id)}, ${sqlString(r.clientId)}, ${sqlString(r.contractNumero)}, ${sqlString(r.vehiculeId)}, ${sqlString(r.immatriculation)}, ${sqlString(r.dateDebut)}, ${sqlString(r.heureDebut)}, ${sqlString(r.dateFin)}, ${sqlString(r.heureFin)}, NULL, NULL, NULL, NULL, ${sqlNumber(r.kmDepart)}, ${sqlNumber(r.kmRetour)}, NULL, ${sqlString(r.status)}, ${sqlString(r.notes)}, ${sqlString(r.createdAt)}, ${sqlString(r.updatedAt)}, ${sqlString(r.createdBy)}, ${sqlString(r.updatedBy)});`
    );
  }
  lines.push("COMMIT;");
  return lines.join("\n");
}

if (require.main === module) {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("Usage : node scripts/migrate-legacy-contracts-to-d1.js <export-contrats-manuels.json>");
    console.error("Voir l'en-tête de ce fichier pour la procédure complète d'export depuis KV.");
    process.exit(1);
  }
  const legacyRecords = JSON.parse(require("fs").readFileSync(inputPath, "utf8"));
  const plan = buildMigrationPlan(legacyRecords);
  console.error(`# ${plan.clients.length} client(s), ${plan.rentals.length} location(s), ${plan.skipped.length} ignoré(s) (voir stderr ci-dessous)`);
  for (const s of plan.skipped) console.error(`# ignoré ${s.id || "(id inconnu)"} : ${s.reason}`);
  console.log(planToSql(plan));
}

module.exports = { buildMigrationPlan, planToSql };
