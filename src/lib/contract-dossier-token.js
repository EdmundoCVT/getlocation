// src/lib/contract-dossier-token.js
//
// Jetons d'accès au "dossier contrat" (contrat.html en mode sécurisé,
// tableau remise/restitution) — même schéma HMAC que
// src/lib/agency-document-token.js et src/lib/document-access-token.js,
// avec DEUX espaces de jetons distincts (préfixe différent dans le HMAC,
// comme agency-document-token.js le fait déjà pour se distinguer de
// document-access-token.js) :
//   - jeton AGENCE : lit/écrit le dossier (champs contrat, remise, retour) ;
//   - jeton CLIENT : lecture seule du récapitulatif + signature, jamais
//     d'écriture sur remise/retour.
// Le jeton brut n'est jamais stocké : seule son empreinte HMAC-SHA-256 va en
// KV (voir src/lib/reservation-store.js, saveContractDossierAccessIndex).
// Réutilise le secret DOCUMENT_TOKEN_PEPPER déjà configuré (aucun nouveau
// secret Cloudflare à créer), comme agency-document-token.js.

// Durée de vie du jeton AGENCE : doit rester valide de la préparation du
// contrat jusqu'à la restitution du véhicule, potentiellement des semaines
// après le paiement si la réservation a été faite longtemps à l'avance —
// expire donc après la fin de location (+ marge), jamais un délai fixe
// depuis le paiement seul (voir documentTokenExpiresAt() dans
// document-access-token.js pour un principe simple analogue).
const AGENCY_DOSSIER_BUFFER_APRES_RETOUR_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours après restitution
const AGENCY_DOSSIER_DUREE_MIN_MS = 60 * 24 * 60 * 60 * 1000; // 60 jours plancher depuis le paiement

// Durée de vie du jeton CLIENT (vérification + signature) : fenêtre fixe,
// généreuse, indépendante des dates de location — l'agence peut à tout
// moment régénérer un nouveau lien via l'action "envoyer au client" du
// dossier agence si besoin (pas de script de révocation dédié nécessaire).
const CLIENT_SIGNING_TOKEN_DUREE_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function hex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function generateContractDossierToken() {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

async function hmacHex(prefixedValue, pepper) {
  if (!pepper || typeof pepper !== "string") throw new Error("DOCUMENT_TOKEN_PEPPER manquant");
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(pepper), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(prefixedValue));
  return hex(new Uint8Array(signature));
}

function hashContractAgencyToken(token, pepper) {
  return hmacHex(`contract-agency:${token}`, pepper);
}

function hashContractClientToken(token, pepper) {
  return hmacHex(`contract-client:${token}`, pepper);
}

// Reprend le même repli que documentTokenExpiresAt() : périodeFin si
// disponible, sinon reconstruit depuis dateFin/heureFin, sinon (données de
// réservation incomplètes) applique uniquement le plancher depuis le paiement.
function contractAgencyTokenExpiresAt(reservation, paidAt) {
  const paidAtMs = new Date(paidAt).getTime();
  const retourISO = reservation.periodeFin
    || (reservation.dateFin && reservation.heureFin ? `${reservation.dateFin}T${reservation.heureFin}:00` : null);
  const retourMs = retourISO ? new Date(retourISO).getTime() : NaN;
  const viaRetour = Number.isFinite(retourMs) ? retourMs + AGENCY_DOSSIER_BUFFER_APRES_RETOUR_MS : -Infinity;
  const viaPlancher = paidAtMs + AGENCY_DOSSIER_DUREE_MIN_MS;
  return new Date(Math.max(viaRetour, viaPlancher)).toISOString();
}

async function issueContractAgencyAccess(env, reservation, paidAt) {
  if (!env || !env.DOCUMENT_TOKEN_PEPPER) return null;
  const token = generateContractDossierToken();
  const tokenHash = await hashContractAgencyToken(token, env.DOCUMENT_TOKEN_PEPPER);
  return {
    token,
    stored: {
      tokenHash,
      createdAt: new Date().toISOString(),
      expiresAt: contractAgencyTokenExpiresAt(reservation, paidAt),
      revokedAt: null
    }
  };
}

async function issueContractClientAccess(env) {
  if (!env || !env.DOCUMENT_TOKEN_PEPPER) return null;
  const token = generateContractDossierToken();
  const tokenHash = await hashContractClientToken(token, env.DOCUMENT_TOKEN_PEPPER);
  return {
    token,
    stored: {
      tokenHash,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + CLIENT_SIGNING_TOKEN_DUREE_MS).toISOString(),
      revokedAt: null
    }
  };
}

module.exports = {
  generateContractDossierToken,
  hashContractAgencyToken,
  hashContractClientToken,
  contractAgencyTokenExpiresAt,
  issueContractAgencyAccess,
  issueContractClientAccess
};
