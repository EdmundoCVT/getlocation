// src/lib/agency-auth.js
//
// Authentification agence (Edmundo/Antonio) par code personnel — Lot 1 du
// mini-back-office agence (voir CLAUDE.md). Protège UNIQUEMENT la vue
// AGENCE de contrat.html (ownerView, création/modification/historique des
// contrats manuels) — les jetons par réservation existants
// (contract-dossier-agency.js, agency-document-token.js) restent inchangés,
// ils protègent déjà correctement l'accès à UN dossier précis.
//
// Deux codes vivent EXCLUSIVEMENT dans des secrets Cloudflare
// (AGENCY_CODE_EDMUNDO, AGENCY_CODE_ANTONIO) — jamais en base D1, jamais
// dans le dépôt, jamais dans un journal. Un secret dédié
// (AGENCY_AUTH_PEPPER, volontairement DISTINCT de DOCUMENT_TOKEN_PEPPER
// pour ne pas mélanger les domaines de sécurité — une fuite de l'un ne
// compromet pas l'autre) sert à :
//   - hacher les codes pour détecter une rotation SANS jamais stocker le
//     code lui-même (voir matchOperator / resolveAgencySession) ;
//   - hacher les jetons de session opaques (le jeton brut n'est jamais
//     stocké, seule son empreinte va en D1) ;
//   - hacher les adresses IP dans login_attempts (jamais l'IP en clair) ;
//   - dériver de façon déterministe le jeton CSRF de chaque session, sans
//     avoir à le stocker séparément : recalculable à tout moment à partir
//     du hash de session déjà en D1 + du pepper, donc automatiquement
//     invalidé dès que la session l'est (révocation, expiration, rotation
//     de code) — voir deriveCsrfToken.
//
// Pas de table "operators" en D1 : voir migrations/0001_agency_auth.sql.

const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours, expiration ABSOLUE
const LOGIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_ATTEMPT_MAX = 5; // tentatives échouées autorisées par IP sur la fenêtre
const LOGIN_ATTEMPTS_RETENTION_MS = 24 * 60 * 60 * 1000; // purge après 24h

const SESSION_COOKIE_NAME = "agency_session";

const OPERATORS = [
  { name: "Edmundo", secretName: "AGENCY_CODE_EDMUNDO" },
  { name: "Antonio", secretName: "AGENCY_CODE_ANTONIO" }
];

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function hex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function generateOpaqueToken() {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

async function hmacHex(prefixedValue, pepper) {
  if (!pepper || typeof pepper !== "string") throw new Error("AGENCY_AUTH_PEPPER manquant");
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(pepper), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(prefixedValue));
  return hex(new Uint8Array(signature));
}

function hashCode(code, pepper) {
  return hmacHex(`agency-code:${code}`, pepper);
}

function hashSessionToken(token, pepper) {
  return hmacHex(`agency-session:${token}`, pepper);
}

function hashIp(ip, pepper) {
  return hmacHex(`agency-ip:${ip}`, pepper);
}

// Jeton CSRF dérivé du hash de session, jamais stocké séparément : toute
// révocation/expiration/rotation de code invalide ce jeton EN MÊME TEMPS
// que la session, sans bookkeeping supplémentaire.
function deriveCsrfToken(sessionIdHash, pepper) {
  return hmacHex(`agency-csrf:${sessionIdHash}`, pepper);
}

// Comparaison résistante aux attaques temporelles pour deux chaînes hex de
// longueur attendue égale (sorties de hmacHex, toujours 64 caractères) —
// jamais de comparaison directe `===` sur un secret ou son empreinte.
function timingSafeEqualHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function clientIp(request) {
  return (
    request.headers.get("cf-connecting-ip") ||
    (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    "unknown"
  );
}

function getAllowedOrigins(request, env) {
  const origins = new Set(["https://getlocation.fr", "https://www.getlocation.fr", new URL(request.url).origin]);
  if (env.ALLOWED_ORIGINS) {
    env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean).forEach((o) => origins.add(o));
  }
  return origins;
}

// Vérification STRICTE de l'origine (contrairement aux endpoints existants
// qui se contentent d'omettre l'en-tête CORS pour une origine inconnue) :
// ici une origine absente OU non reconnue REJETTE la requête. Réservé aux
// requêtes d'écriture (voir requireAgencySession, { requireOrigin: true }) —
// jamais appliqué à une lecture GET, où l'en-tête Origin est souvent absent
// même pour une requête same-origin légitime (voir OWASP : vérification
// d'origine pertinente seulement pour les opérations qui changent un état).
function hasAllowedOrigin(request, env) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  return getAllowedOrigins(request, env).has(origin);
}

function parseCookies(request) {
  const header = request.headers.get("cookie") || "";
  const cookies = {};
  header.split(";").forEach((part) => {
    const idx = part.indexOf("=");
    if (idx === -1) return;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (name) cookies[name] = decodeURIComponent(value);
  });
  return cookies;
}

// SameSite=Lax (pas Strict) : autorise l'ouverture normale d'un lien
// contrat.html depuis un e-mail/SMS tout en bloquant déjà, à lui seul,
// l'attachement du cookie sur une requête fetch/XHR cross-site (donc sur
// toute tentative CSRF via JS depuis un autre site) — la vérification
// d'origine + le jeton CSRF dérivé ci-dessus ajoutent une deuxième et
// troisième couche pour les écritures.
function sessionCookieHeader(token, maxAgeSeconds) {
  return [`${SESSION_COOKIE_NAME}=${token}`, "Path=/", "HttpOnly", "Secure", "SameSite=Lax", `Max-Age=${maxAgeSeconds}`].join("; ");
}

function clearSessionCookieHeader() {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

// Ne révèle jamais lequel des deux codes a failli correspondre : un seul
// verdict (opérateur trouvé ou null). Parcourt TOUJOURS les deux entrées
// (pas de `break` au premier match) pour que le temps total ne dépende
// jamais de la position de l'opérateur qui correspond.
async function matchOperator(code, env) {
  if (!code || typeof code !== "string" || code.length < 3 || code.length > 64) return null;
  const submittedHash = await hashCode(code, env.AGENCY_AUTH_PEPPER);
  let match = null;
  for (const op of OPERATORS) {
    const secret = env[op.secretName];
    if (!secret) continue;
    const expectedHash = await hashCode(secret, env.AGENCY_AUTH_PEPPER);
    if (timingSafeEqualHex(submittedHash, expectedHash)) match = { name: op.name, codeHash: expectedHash };
  }
  return match;
}

async function countRecentFailedAttempts(env, ipHash) {
  const since = new Date(Date.now() - LOGIN_ATTEMPT_WINDOW_MS).toISOString();
  const row = await env.AGENCY_DB.prepare(
    "SELECT COUNT(*) as count FROM login_attempts WHERE ip_hash = ? AND success = 0 AND attempted_at > ?"
  ).bind(ipHash, since).first();
  return row ? Number(row.count) || 0 : 0;
}

async function recordLoginAttempt(env, ipHash, success) {
  await env.AGENCY_DB.prepare(
    "INSERT INTO login_attempts (ip_hash, attempted_at, success) VALUES (?, ?, ?)"
  ).bind(ipHash, new Date().toISOString(), success ? 1 : 0).run();
}

async function createSession(env, operatorName, codeHash) {
  const token = generateOpaqueToken();
  const id = await hashSessionToken(token, env.AGENCY_AUTH_PEPPER);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_LIFETIME_MS);
  await env.AGENCY_DB.prepare(
    "INSERT INTO sessions (id, operator, code_hash, created_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, ?, NULL)"
  ).bind(id, operatorName, codeHash, now.toISOString(), expiresAt.toISOString()).run();
  return { token, id, expiresAt };
}

async function revokeSessionById(env, id) {
  await env.AGENCY_DB.prepare("UPDATE sessions SET revoked_at = ? WHERE id = ?").bind(new Date().toISOString(), id).run();
}

function jsonError(status, message) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

// Résout la session à partir du cookie de la requête. Renvoie null si
// absente, invalide, expirée, révoquée, ou si le code de l'opérateur a été
// remplacé depuis (auquel cas la session est aussi révoquée immédiatement,
// pas seulement ignorée) — jamais de détail sur la raison précise renvoyé
// au client (voir requireAgencySession).
async function resolveAgencySession(request, env) {
  if (!env.AGENCY_AUTH_PEPPER || !env.AGENCY_DB) return null;
  const token = parseCookies(request)[SESSION_COOKIE_NAME];
  if (!token) return null;

  const id = await hashSessionToken(token, env.AGENCY_AUTH_PEPPER);
  const row = await env.AGENCY_DB.prepare(
    "SELECT id, operator, code_hash, expires_at, revoked_at FROM sessions WHERE id = ?"
  ).bind(id).first();
  if (!row || row.revoked_at) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) return null;

  const op = OPERATORS.find((o) => o.name === row.operator);
  const currentSecret = op ? env[op.secretName] : null;
  if (!currentSecret) return null;
  const currentHash = await hashCode(currentSecret, env.AGENCY_AUTH_PEPPER);
  if (!timingSafeEqualHex(currentHash, row.code_hash)) {
    // Code remplacé depuis l'émission de cette session : révoquée
    // immédiatement, pas seulement ignorée (voir cahier des charges :
    // "invalider les sessions si le code d'un opérateur est remplacé").
    await revokeSessionById(env, id);
    return null;
  }

  const csrfToken = await deriveCsrfToken(id, env.AGENCY_AUTH_PEPPER);
  return { operator: row.operator, sessionId: id, csrfToken };
}

// À utiliser par tout endpoint protégé.
// - requireOrigin : à activer sur toute opération d'écriture (POST) —
//   jamais sur une lecture GET (voir hasAllowedOrigin).
// - requireCsrf : à activer sur toute opération d'écriture — le jeton doit
//   être fourni dans l'en-tête X-Agency-Csrf.
// Renvoie { session } en cas de succès, { error: Response } sinon (401 si
// pas de session valide, 403 si origine ou CSRF invalide).
async function requireAgencySession(request, env, { requireCsrf = false, requireOrigin = false } = {}) {
  if (requireOrigin && !hasAllowedOrigin(request, env)) {
    return { error: jsonError(403, "Origine non autorisée") };
  }
  const session = await resolveAgencySession(request, env);
  if (!session) {
    return { error: jsonError(401, "Session agence invalide ou expirée") };
  }
  if (requireCsrf) {
    const header = request.headers.get("x-agency-csrf") || "";
    if (!timingSafeEqualHex(header, session.csrfToken)) {
      return { error: jsonError(403, "Jeton CSRF invalide") };
    }
  }
  return { session };
}

// Purge quotidienne (voir scheduled-tasks.js) : sessions expirées ou
// révoquées, tentatives de connexion de plus de 24h. N'affecte jamais une
// session encore valide.
async function purgeAgencyAuthData(env) {
  if (!env.AGENCY_DB) return;
  const now = new Date().toISOString();
  await env.AGENCY_DB.prepare("DELETE FROM sessions WHERE expires_at < ? OR revoked_at IS NOT NULL").bind(now).run();
  const attemptsCutoff = new Date(Date.now() - LOGIN_ATTEMPTS_RETENTION_MS).toISOString();
  await env.AGENCY_DB.prepare("DELETE FROM login_attempts WHERE attempted_at < ?").bind(attemptsCutoff).run();
}

module.exports = {
  SESSION_COOKIE_NAME,
  LOGIN_ATTEMPT_MAX,
  LOGIN_ATTEMPT_WINDOW_MS,
  OPERATORS,
  clientIp,
  hashIp,
  hashCode,
  timingSafeEqualHex,
  matchOperator,
  countRecentFailedAttempts,
  recordLoginAttempt,
  createSession,
  revokeSessionById,
  resolveAgencySession,
  requireAgencySession,
  deriveCsrfToken,
  sessionCookieHeader,
  clearSessionCookieHeader,
  purgeAgencyAuthData,
  hasAllowedOrigin
};
