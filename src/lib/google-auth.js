// src/lib/google-auth.js
//
// Authentification serveur-à-serveur auprès de Google (compte de service,
// Lot 3 — voir CLAUDE.md) : signe un JWT avec la clé privée du compte de
// service (Web Crypto, RS256 — aucune dépendance externe, comme le reste du
// code serveur de ce dépôt) et l'échange contre un jeton d'accès OAuth2.
// Portée limitée à Google Sheets uniquement (principe du moindre
// privilège).
//
// La clé du compte de service (fichier JSON téléchargé depuis Google Cloud)
// est stockée EN ENTIER dans un unique secret Cloudflare
// (GOOGLE_SERVICE_ACCOUNT_KEY) — jamais dans le dépôt, jamais dans les
// journaux, jamais côté navigateur.
//
// Pas de mise en cache du jeton (durée de vie ~1h côté Google) : le volume
// de synchronisation d'une petite agence reste largement sous les limites
// de l'endpoint de jetons Google — même arbitrage de simplicité que
// rate-limiter.js pour la cohérence éventuelle de Cloudflare KV.

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

function base64UrlFromBytes(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlFromString(str) {
  return base64UrlFromBytes(new TextEncoder().encode(str));
}

// Décode le PEM ("-----BEGIN PRIVATE KEY-----...") en octets DER, sans
// dépendance : retire l'en-tête/pied de page et les retours à la ligne,
// puis décode le base64 standard restant.
function pemToDer(pem) {
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----/, "").replace(/-----END PRIVATE KEY-----/, "").replace(/\s+/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function importPrivateKey(pem) {
  const der = pemToDer(pem);
  return crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}

function parseServiceAccountKey(env) {
  if (!env.GOOGLE_SERVICE_ACCOUNT_KEY) return null;
  try {
    const parsed = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_KEY);
    if (!parsed.client_email || !parsed.private_key) return null;
    return parsed;
  } catch (e) {
    return null;
  }
}

async function signAssertion(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: serviceAccount.client_email,
    scope: SHEETS_SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600
  };
  const signingInput = `${base64UrlFromString(JSON.stringify(header))}.${base64UrlFromString(JSON.stringify(claims))}`;
  const key = await importPrivateKey(serviceAccount.private_key);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${base64UrlFromBytes(new Uint8Array(signature))}`;
}

class GoogleAuthError extends Error {
  constructor(message) {
    super(message);
    this.name = "GoogleAuthError";
  }
}

// Renvoie un jeton d'accès Bearer valide ~1h, ou lève GoogleAuthError si la
// configuration est absente/invalide ou si Google refuse l'échange.
async function getAccessToken(env) {
  const serviceAccount = parseServiceAccountKey(env);
  if (!serviceAccount) throw new GoogleAuthError("GOOGLE_SERVICE_ACCOUNT_KEY manquant ou invalide");

  const assertion = await signAssertion(serviceAccount);
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || !json.access_token) {
    throw new GoogleAuthError((json && json.error_description) || `Échec de l'authentification Google (${res.status})`);
  }
  return json.access_token;
}

module.exports = { getAccessToken, GoogleAuthError };
