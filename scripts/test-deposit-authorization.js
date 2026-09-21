#!/usr/bin/env node
// scripts/test-deposit-authorization.js
//
// Test manuel de bout en bout de l'empreinte bancaire Mollie (captureMode
// "manual") — voir src/lib/deposit-authorizations.js et CLAUDE.md. Réutilise
// le VRAI client Mollie (src/lib/mollie-client.js, celui utilisé en
// production par le Worker Cloudflare) pour créer une préautorisation carte
// de TEST et suivre son statut réel, en dehors de tout Worker — utile car
// certains environnements de développement (dont celui utilisé pour
// préparer cette intégration) n'ont pas d'accès réseau sortant vers l'API
// Mollie (voir DEPLOIEMENT.md, section connue).
//
// Usage :
//   MOLLIE_DEPOSIT_API_KEY=test_xxx node scripts/test-deposit-authorization.js
//
// Refuse intentionnellement de s'exécuter avec une clé qui ne commence pas
// par "test_" : ce script crée une préautorisation carte RÉELLE (mode test
// Mollie) et ne doit jamais être exécuté avec la clé live de production.
//
// Ne fait AUCUNE capture automatique : voir §3 (affiche uniquement le
// résultat de l'autorisation). Débiter/libérer reste une action distincte,
// volontairement non incluse ici (voir cahier des charges §10 : jamais
// d'automatisation du débit).

const { createPayment, getPayment } = require("../src/lib/mollie-client.js");

const apiKey = process.env.MOLLIE_DEPOSIT_API_KEY;

if (!apiKey) {
  console.error('Test API Mollie non exécuté : MOLLIE_DEPOSIT_API_KEY absente de l\'environnement.');
  process.exit(1);
}

if (!apiKey.startsWith("test_")) {
  console.error('Refus de continuer : MOLLIE_DEPOSIT_API_KEY ne commence pas par "test_".');
  console.error("Ce script crée une préautorisation carte réelle et ne doit jamais tourner avec une clé live.");
  process.exit(1);
}

const REDIRECT_URL = process.env.MOLLIE_DEPOSIT_TEST_REDIRECT_URL || "https://www.getlocation.fr/caution-mollie-retour.html";
const WEBHOOK_URL = process.env.MOLLIE_DEPOSIT_TEST_WEBHOOK_URL || "https://www.getlocation.fr/api/mollie-deposit-webhook";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log("=== 1. Création de la préautorisation (captureMode: manual) ===");
  let payment;
  try {
    payment = await createPayment(apiKey, {
      amount: { currency: "EUR", value: "500.00" },
      method: "creditcard",
      captureMode: "manual",
      description: "Empreinte bancaire GET LOCATION - TEST",
      redirectUrl: REDIRECT_URL,
      webhookUrl: WEBHOOK_URL
    });
  } catch (err) {
    console.error("");
    console.error("ÉCHEC de la création du paiement Mollie.");
    console.error("Code HTTP Mollie      :", err.statusCode);
    console.error("Réponse Mollie brute  :", JSON.stringify(err.body, null, 2));
    console.error("Message               :", err.message);
    console.error("");
    console.error("Cause probable : si le code est 422 avec un message évoquant la méthode ou le");
    console.error('mode de capture ("manual capture", "captureMode"...), le profil Mollie');
    console.error("GETLOCATION.FR n'a probablement pas l'option de capture manuelle activée pour");
    console.error("les paiements carte en mode TEST — contactez le support Mollie pour l'activer.");
    process.exitCode = 1;
    return;
  }

  console.log("Paiement créé :", payment.id);
  console.log("Statut initial :", payment.status, "(mode:", payment.mode + ")");
  console.log("Lien de paiement (checkout) à ouvrir dans un navigateur :");
  console.log(" ", payment._links && payment._links.checkout && payment._links.checkout.href);
  console.log("");
  console.log("Utilisez un moyen de paiement de TEST Mollie (voir la documentation Mollie,");
  console.log("section mode test) — jamais une vraie carte.");
  console.log("");

  console.log("=== 2. Attente du résultat (interroge l'API Mollie toutes les 5 s, 5 min max) ===");
  const deadline = Date.now() + 5 * 60 * 1000;
  let last = payment;
  while (Date.now() < deadline) {
    await sleep(5000);
    last = await getPayment(apiKey, payment.id);
    console.log(new Date().toISOString(), "statut :", last.status);
    if (["authorized", "paid", "canceled", "expired", "failed"].includes(last.status)) break;
  }

  console.log("");
  console.log("=== 3. Résultat final ===");
  console.log("Statut Mollie   :", last.status);
  console.log("Réponse complète (à conserver pour vérifier les noms de champs exacts) :");
  console.log(JSON.stringify(last, null, 2));

  if (last.status === "authorized") {
    console.log("");
    console.log("✓ Empreinte AUTORISÉE. Ce script n'a demandé AUCUNE capture — le montant reste");
    console.log("  uniquement bloqué chez le client (comportement recherché, captureMode: manual).");
    if (last.amountCaptured) {
      console.log("  amountCaptured renvoyé par Mollie :", JSON.stringify(last.amountCaptured));
    } else {
      console.log("  (pas de champ amountCaptured tant qu'aucune capture n'a eu lieu — normal.)");
    }
    if (last.captureBefore) {
      console.log("  Date limite de capture (captureBefore) :", last.captureBefore);
    } else {
      console.log("  Aucun champ captureBefore dans la réponse : à vérifier et, si Mollie");
      console.log("  utilise un autre nom, à corriger dans");
      console.log("  src/lib/deposit-authorizations.js#syncFromMolliePayment (commentaire dédié).");
    }
  } else {
    console.log("");
    console.log('Statut final différent de "authorized" — voir le détail ci-dessus pour comprendre');
    console.log("pourquoi (annulé/expiré avant saisie, carte refusée, ou délai de 5 min dépassé).");
  }
}

main();
