const AGENCY_TOKEN_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function hex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function generateAgencyDocumentToken() {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

async function hashAgencyDocumentToken(token, pepper) {
  if (!pepper || typeof pepper !== "string") throw new Error("DOCUMENT_TOKEN_PEPPER manquant");
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(pepper), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`agency:${token}`));
  return hex(new Uint8Array(signature));
}

async function issueAgencyDocumentAccess(env) {
  if (!env || !env.DOCUMENT_TOKEN_PEPPER) return null;
  const token = generateAgencyDocumentToken();
  const tokenHash = await hashAgencyDocumentToken(token, env.DOCUMENT_TOKEN_PEPPER);
  const createdAt = new Date().toISOString();
  return {
    token,
    stored: {
      tokenHash,
      createdAt,
      expiresAt: new Date(Date.now() + AGENCY_TOKEN_LIFETIME_MS).toISOString(),
      revokedAt: null
    }
  };
}

module.exports = { generateAgencyDocumentToken, hashAgencyDocumentToken, issueAgencyDocumentAccess };
