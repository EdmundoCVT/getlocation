// Jeton d'accès au futur formulaire documentaire.
//
// Le jeton brut n'est jamais persisté : seule une empreinte HMAC-SHA-256,
// renforcée par DOCUMENT_TOKEN_PEPPER, est enregistrée dans KV. Le jeton
// brut est transmis une seule fois à l'e-mail de confirmation, dans le
// fragment d'URL (#token=...), qui n'est pas envoyé au serveur par le
// navigateur.

const DOCUMENT_TOKEN_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000;

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function generateDocumentToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return bytesToBase64Url(bytes);
}

async function hashDocumentToken(token, pepper) {
  if (!pepper || typeof pepper !== "string") {
    throw new Error("DOCUMENT_TOKEN_PEPPER manquant");
  }
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(token));
  return bytesToHex(new Uint8Array(signature));
}

function documentTokenExpiresAt(reservation, paidAt) {
  const paidAtMs = new Date(paidAt).getTime();
  const baseMs = Number.isFinite(paidAtMs) ? paidAtMs : Date.now();
  const fourteenDaysMs = baseMs + DOCUMENT_TOKEN_LIFETIME_MS;
  const rentalStartMs = reservation && reservation.periodeDebut
    ? new Date(reservation.periodeDebut).getTime()
    : reservation && reservation.dateDebut && reservation.heureDebut
      ? new Date(`${reservation.dateDebut}T${reservation.heureDebut}:00`).getTime()
      : NaN;
  const expiresMs = Number.isFinite(rentalStartMs)
    ? Math.min(fourteenDaysMs, rentalStartMs)
    : fourteenDaysMs;
  return new Date(expiresMs).toISOString();
}

async function issueDocumentAccess(env, reservation, paidAt) {
  if (!env || !env.DOCUMENT_TOKEN_PEPPER) return null;
  const token = generateDocumentToken();
  const tokenHash = await hashDocumentToken(token, env.DOCUMENT_TOKEN_PEPPER);
  const createdAt = paidAt || new Date().toISOString();
  return {
    token,
    stored: {
      tokenHash,
      createdAt,
      expiresAt: documentTokenExpiresAt(reservation, createdAt),
      revokedAt: null
    }
  };
}

module.exports = {
  generateDocumentToken,
  hashDocumentToken,
  documentTokenExpiresAt,
  issueDocumentAccess
};
