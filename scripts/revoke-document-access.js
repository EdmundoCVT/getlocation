#!/usr/bin/env node
// scripts/revoke-document-access.js
//
// Script administratif MANUEL — pas d'endpoint public, pas de back-office.
// Révoque le lien documentaire client et/ou agence d'une réservation
// donnée, en cas de fuite suspectée d'un lien (transfert d'e-mail, capture
// d'écran, boîte mail compromise) — voir la revue de sécurité des PR #3-8
// (finding "moyenne" : la révocation était vérifiée par le code mais
// jamais atteignable en pratique, faute d'outil pour l'actionner).
//
// N'utilise QUE l'outillage Cloudflare déjà en place dans ce projet
// (`wrangler kv key get/put --remote`, voir DEPLOIEMENT.md) — aucune
// nouvelle dépendance, aucun accès direct à l'API Cloudflare.
//
// N'affiche JAMAIS un jeton (brut ou empreinte) ni une donnée personnelle
// (conducteur, adresse, permis...) — uniquement l'identifiant de
// réservation et l'état des accès (révoqué / actif / absent).
//
// Usage :
//   node scripts/revoke-document-access.js <res_xxxxxxxx...> <client|agency|both>
//
// Documentation complète : voir DEPLOIEMENT.md, section "Révocation
// manuelle d'un lien documentaire".

const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");

const RESERVATION_ID_PATTERN = /^res_[a-f0-9]{32}$/;
const VALID_TARGETS = new Set(["client", "agency", "both"]);

function validateReservationId(id) {
  return typeof id === "string" && RESERVATION_ID_PATTERN.test(id);
}

// Fonction pure, testable sans wrangler ni accès réseau : calcule ce qui
// doit changer, sans jamais rien écrire elle-même. `now` est injectable
// pour les tests.
function computeRevocationPatch(reservation, target, now = new Date().toISOString()) {
  if (!reservation || typeof reservation !== "object") {
    throw new Error("Réservation introuvable");
  }
  if (!VALID_TARGETS.has(target)) {
    throw new Error("Cible invalide : attendu client, agency ou both");
  }

  const patch = {};
  const revoked = [];
  const alreadyRevoked = [];
  const absent = [];

  function handle(field, label) {
    const access = reservation[field];
    if (!access) {
      absent.push(label);
      return;
    }
    if (access.revokedAt) {
      alreadyRevoked.push(label);
      return;
    }
    patch[field] = { ...access, revokedAt: now };
    revoked.push(label);
  }

  if (target === "client" || target === "both") handle("documentAccess", "client");
  if (target === "agency" || target === "both") handle("agencyDocumentAccess", "agency");

  return { patch, revoked, alreadyRevoked, absent, changed: revoked.length > 0 };
}

function readReservation(reservationId) {
  let raw;
  try {
    raw = execFileSync(
      "npx",
      ["wrangler", "kv", "key", "get", reservationId, "--binding=RESERVATIONS_KV", "--remote"],
      { encoding: "utf8" }
    );
  } catch (err) {
    throw new Error("Réservation introuvable ou erreur d'accès KV (identifiant invalide ?)");
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error("Réponse KV illisible pour cet identifiant");
  }
}

// Écrit via un fichier temporaire (--path) plutôt que d'injecter le JSON en
// argument de ligne de commande : évite tout problème d'échappement shell
// avec des données arbitraires. Remarque documentée dans DEPLOIEMENT.md :
// `wrangler kv key put` sans `--expiration-ttl` explicite réinitialise la
// durée de vie technique de la clé (aucun impact fonctionnel — le prochain
// écrit normal du Worker recalcule le TTL correct, voir
// reservation-store.js#reservationTtlSeconds).
function writeReservation(reservationId, reservation) {
  const tmpFile = path.join(os.tmpdir(), `revoke-${reservationId}-${Date.now()}.json`);
  fs.writeFileSync(tmpFile, JSON.stringify(reservation), "utf8");
  try {
    execFileSync(
      "npx",
      ["wrangler", "kv", "key", "put", reservationId, "--path", tmpFile, "--binding=RESERVATIONS_KV", "--remote"],
      { encoding: "utf8" }
    );
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }
}

function confirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim() === "CONFIRMER");
    });
  });
}

async function main() {
  const [reservationId, target] = process.argv.slice(2);

  if (!validateReservationId(reservationId)) {
    console.error("Identifiant de réservation invalide (attendu : res_ suivi de 32 caractères hexadécimaux).");
    process.exitCode = 1;
    return;
  }
  if (!VALID_TARGETS.has(target)) {
    console.error("Cible invalide : indiquer client, agency ou both.");
    process.exitCode = 1;
    return;
  }

  let reservation;
  try {
    reservation = readReservation(reservationId);
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
    return;
  }

  const { patch, revoked, alreadyRevoked, absent, changed } = computeRevocationPatch(reservation, target);

  console.log(`Réservation : ${reservationId}`);
  if (revoked.length) console.log(`À révoquer maintenant : ${revoked.join(", ")}`);
  if (alreadyRevoked.length) console.log(`Déjà révoqué (aucune action) : ${alreadyRevoked.join(", ")}`);
  if (absent.length) console.log(`Aucun accès émis pour : ${absent.join(", ")}`);

  if (!changed) {
    console.log("Rien à faire — opération idempotente, aucune écriture effectuée.");
    return;
  }

  const ok = await confirm(
    `Cette action modifie des données de PRODUCTION. Tapez CONFIRMER pour révoquer (${revoked.join(", ")}) : `
  );
  if (!ok) {
    console.log("Annulé — aucune écriture effectuée.");
    return;
  }

  writeReservation(reservationId, { ...reservation, ...patch });
  console.log(`Révocation appliquée : ${revoked.join(", ")}.`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message || String(err));
    process.exitCode = 1;
  });
}

module.exports = { validateReservationId, computeRevocationPatch };
