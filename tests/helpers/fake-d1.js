// tests/helpers/fake-d1.js
//
// Fausse implémentation minimale de l'interface D1 (prepare/bind/run/first)
// utilisée par src/lib/agency-auth.js — en mémoire, non persistante, ne
// reconnaît QUE les requêtes SQL exactes émises par ce module (pas un moteur
// SQL générique) : suffisant pour ces tests unitaires, même principe que
// fake-kv.js pour KV.

function createFakeD1() {
  const sessions = new Map(); // id -> row
  const loginAttempts = []; // { ip_hash, attempted_at, success }

  function prepare(sql) {
    const norm = sql.replace(/\s+/g, " ").trim();
    return {
      bind(...args) {
        return {
          async run() {
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
            throw new Error("fake-d1: requête .run() non reconnue : " + norm);
          },
          async first() {
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
            throw new Error("fake-d1: requête .first() non reconnue : " + norm);
          },
          async all() {
            throw new Error("fake-d1: .all() non implémenté (non utilisé par agency-auth.js)");
          }
        };
      }
    };
  }

  return { prepare, _raw: { sessions, loginAttempts } };
}

module.exports = { createFakeD1 };
