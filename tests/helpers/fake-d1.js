// tests/helpers/fake-d1.js
//
// Fausse implémentation de l'interface D1 (prepare/bind/run/first/all) en
// mémoire, non persistante. Deux niveaux :
//   1. Requêtes SQL EXACTES du Lot 1 (sessions/login_attempts, voir
//      src/lib/agency-auth.js) — inchangées, vérifiées en premier.
//   2. Un petit moteur GÉNÉRIQUE (Lot 2) qui reconnaît la forme des
//      requêtes simples émises par src/lib/clients.js, rentals.js,
//      payments.js, deposits.js (INSERT entièrement paramétré, UPDATE ...
//      SET ... WHERE id = ?, SELECT * FROM table WHERE col = ?) — pas un
//      moteur SQL complet, seulement ce que ces modules émettent réellement
//      (même esprit que le reste de ce fichier). audit_log et
//      contract_counters restent des cas particuliers explicites (pas de
//      colonne "id" au sens d'une clé simple, ou sémantique d'UPSERT).

function createFakeD1() {
  const sessions = new Map(); // id -> row
  const loginAttempts = []; // { ip_hash, attempted_at, success }
  const auditLog = []; // { id, actor, event_type, entity_type, entity_id, metadata, created_at }
  const contractCounters = new Map(); // date_part -> seq

  // Tables génériques (Lot 2 + Lot 3) : clé = nom de table, valeur = Map(id -> row).
  const tables = {
    clients: new Map(),
    rentals: new Map(),
    payments: new Map(),
    deposits: new Map(),
    sheet_sync_outbox: new Map()
  };

  function genericInsert(norm, args) {
    const m = /^INSERT INTO (\w+) \(([^)]+)\) VALUES \(([^)]+)\)$/.exec(norm);
    if (!m) return undefined;
    const [, table, colsRaw, valsRaw] = m;
    if (!tables[table]) return undefined;
    const placeholders = valsRaw.split(",").map((s) => s.trim());
    if (!placeholders.every((p) => p === "?")) return undefined; // laisse un cas particulier gérer les valeurs littérales
    const columns = colsRaw.split(",").map((s) => s.trim());
    const row = {};
    columns.forEach((col, i) => { row[col] = args[i]; });
    if (!row.id) throw new Error("fake-d1: INSERT générique sans colonne id : " + norm);
    tables[table].set(row.id, row);
    return { success: true };
  }

  // Chaque segment "col = ?" consomme un argument positionnel ; un segment
  // "col = col + N" (ex. attempt_count = attempt_count + 1, voir
  // sheet-sync-outbox.js) est calculé directement sans consommer
  // d'argument — comme le ferait réellement D1/SQLite.
  function genericUpdate(norm, args) {
    const m = /^UPDATE (\w+) SET (.+) WHERE id = \?$/.exec(norm);
    if (!m) return undefined;
    const [, table, setClause] = m;
    if (!tables[table]) return undefined;
    const id = args[args.length - 1];
    const row = tables[table].get(id);
    if (row) {
      let argIndex = 0;
      for (const segment of setClause.split(",").map((s) => s.trim())) {
        const eq = segment.indexOf("=");
        const col = segment.slice(0, eq).trim();
        const rhs = segment.slice(eq + 1).trim();
        if (rhs === "?") {
          row[col] = args[argIndex++];
        } else {
          const incr = /^(\w+)\s*\+\s*(\d+)$/.exec(rhs);
          if (!incr || incr[1] !== col) throw new Error("fake-d1: expression SET non reconnue : " + segment);
          row[col] = (Number(row[col]) || 0) + Number(incr[2]);
        }
      }
    }
    return { success: true };
  }

  function genericSelectFirst(norm, args) {
    const m = /^SELECT \* FROM (\w+) WHERE (\w+) = \?$/.exec(norm);
    if (!m) return undefined;
    const [, table, col] = m;
    if (!tables[table]) return undefined;
    for (const row of tables[table].values()) if (row[col] === args[0]) return row;
    return null;
  }

  function genericSelectAll(norm, args) {
    const m = /^SELECT \* FROM (\w+) WHERE (\w+) = \?(?: ORDER BY (\w+) (ASC|DESC))?$/.exec(norm);
    if (!m) return undefined;
    const [, table, col, orderCol, dir] = m;
    if (!tables[table]) return undefined;
    let rows = [...tables[table].values()].filter((row) => row[col] === args[0]);
    if (orderCol) {
      rows = rows.slice().sort((a, b) => {
        if (a[orderCol] === b[orderCol]) return 0;
        const cmp = a[orderCol] < b[orderCol] ? -1 : 1;
        return dir === "DESC" ? -cmp : cmp;
      });
    }
    return { results: rows };
  }

  function prepare(sql) {
    const norm = sql.replace(/\s+/g, " ").trim();
    return {
      bind(...args) {
        return {
          async run() {
            // ---- Lot 1 (sessions / login_attempts), inchangé ----
            if (norm.startsWith("INSERT INTO sessions")) {
              const [id, operator, code_hash, created_at, expires_at] = args;
              sessions.set(id, { id, operator, code_hash, created_at, expires_at, revoked_at: null });
              return { success: true };
            }
            if (norm.startsWith("UPDATE sessions SET revoked_at")) {
              const [revoked_at, id] = args;
              const row = sessions.get(id);
              if (row) row.revoked_at = revoked_at;
              return { success: true };
            }
            if (norm.startsWith("DELETE FROM sessions")) {
              const [now] = args;
              for (const [id, row] of sessions) {
                if (row.revoked_at || new Date(row.expires_at).getTime() < new Date(now).getTime()) sessions.delete(id);
              }
              return { success: true };
            }
            if (norm.startsWith("INSERT INTO login_attempts")) {
              const [ip_hash, attempted_at, success] = args;
              loginAttempts.push({ ip_hash, attempted_at, success });
              return { success: true };
            }
            if (norm.startsWith("DELETE FROM login_attempts")) {
              const [cutoff] = args;
              for (let i = loginAttempts.length - 1; i >= 0; i--) {
                if (new Date(loginAttempts[i].attempted_at).getTime() < new Date(cutoff).getTime()) loginAttempts.splice(i, 1);
              }
              return { success: true };
            }
            // ---- Lot 2 : cas particuliers (pas de forme générique) ----
            if (norm.startsWith("INSERT INTO audit_log")) {
              const [actor, event_type, entity_type, entity_id, metadata, created_at] = args;
              auditLog.push({ id: auditLog.length + 1, actor, event_type, entity_type, entity_id, metadata, created_at });
              return { success: true };
            }
            // ---- Lot 2 : moteur générique ----
            const generic = genericInsert(norm, args) ?? genericUpdate(norm, args);
            if (generic !== undefined) return generic;
            throw new Error("fake-d1: requête .run() non reconnue : " + norm);
          },
          async first() {
            // ---- Lot 1, inchangé ----
            if (norm.startsWith("SELECT id, operator, code_hash, expires_at, revoked_at FROM sessions")) {
              const [id] = args;
              return sessions.get(id) || null;
            }
            if (norm.startsWith("SELECT COUNT(*) as count FROM login_attempts")) {
              const [ip_hash, since] = args;
              const count = loginAttempts.filter(
                (a) => a.ip_hash === ip_hash && a.success === 0 && new Date(a.attempted_at).getTime() > new Date(since).getTime()
              ).length;
              return { count };
            }
            // ---- Lot 2 : compteur atomique (UPSERT + RETURNING), voir
            // src/lib/contract-numero.js. Émule la sémantique D1/SQLite —
            // suffisant en test (un seul thread JS, pas de concurrence
            // réelle à reproduire ici, seulement le format et l'incrément).
            if (norm.startsWith("INSERT INTO contract_counters")) {
              const [datePart] = args;
              const seq = (contractCounters.get(datePart) || 0) + 1;
              contractCounters.set(datePart, seq);
              return { seq };
            }
            // ---- Lot 2 : moteur générique ----
            const generic = genericSelectFirst(norm, args);
            if (generic !== undefined) return generic;
            throw new Error("fake-d1: requête .first() non reconnue : " + norm);
          },
          async all() {
            // ---- Lot 2 : recherche client par nom (seule requête LIKE) ----
            if (norm.startsWith("SELECT * FROM clients WHERE last_name LIKE ? OR first_name LIKE ?")) {
              const [lastLike, firstLike] = args;
              const needle = (s) => String(s || "").replace(/%/g, "").toLowerCase();
              const lastNeedle = needle(lastLike);
              const firstNeedle = needle(firstLike);
              const results = [...tables.clients.values()].filter(
                (c) =>
                  (lastNeedle && String(c.last_name || "").toLowerCase().includes(lastNeedle)) ||
                  (firstNeedle && String(c.first_name || "").toLowerCase().includes(firstNeedle))
              );
              return { results };
            }
            const generic = genericSelectAll(norm, args);
            if (generic !== undefined) return generic;
            throw new Error("fake-d1: requête .all() non reconnue : " + norm);
          }
        };
      }
    };
  }

  return {
    prepare,
    _raw: { sessions, loginAttempts, auditLog, contractCounters, ...tables }
  };
}

module.exports = { createFakeD1 };
