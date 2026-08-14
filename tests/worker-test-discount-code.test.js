// tests/worker-test-discount-code.test.js
//
// Équivalent de tests/test-discount-code.test.js pour
// src/api/create-payment.js (Cloudflare Worker, Phase B — voir
// DEPLOIEMENT.md). TEST_DISCOUNT_CODE reste un secret Worker (jamais
// présent dans js/data.js, donc jamais exposé au navigateur) qui ramène le
// montant facturé à 0,99 € au lieu du tarif normal.
//
// Fichier séparé de tests/worker-create-payment.test.js (pas de dépendance
// croisée) pour ne pas interférer avec ce fichier.

const test = require("node:test");
const assert = require("node:assert/strict");

const { resolverMontantFacture } = require("../src/api/create-payment.js");

function prixNormal(totalCentimes) {
  return { totalCentimes, total: totalCentimes / 100 };
}

test("sans TEST_DISCOUNT_CODE configurée : le montant normal est toujours renvoyé tel quel", () => {
  const prix = prixNormal(4900); // 49,00 €
  const res = resolverMontantFacture(prix, "NIMPORTEQUOI", undefined);
  assert.deepEqual(res, { totalCentimesFacture: 4900, totalFacture: 49 });
});

test("avec TEST_DISCOUNT_CODE configurée mais un code promo différent saisi : aucun effet", () => {
  const prix = prixNormal(4900);
  const res = resolverMontantFacture(prix, "AUTRE-CODE", "SECRET-INTERNE-1234");
  assert.deepEqual(res, { totalCentimesFacture: 4900, totalFacture: 49 });
});

test("avec TEST_DISCOUNT_CODE configurée et le bon code promo saisi : montant ramené à 0,99 €", () => {
  const prix = prixNormal(4900);
  const res = resolverMontantFacture(prix, "SECRET-INTERNE-1234", "SECRET-INTERNE-1234");
  assert.deepEqual(res, { totalCentimesFacture: 99, totalFacture: 0.99 });
});

test("la comparaison ignore la casse et les espaces superflus", () => {
  const prix = prixNormal(4900);
  const res = resolverMontantFacture(prix, "  secret-interne-1234  ", "SECRET-INTERNE-1234");
  assert.deepEqual(res, { totalCentimesFacture: 99, totalFacture: 0.99 });
});

test("aucun code promo saisi : aucun effet, même si TEST_DISCOUNT_CODE est configurée", () => {
  const prix = prixNormal(4900);
  const res = resolverMontantFacture(prix, null, "SECRET-INTERNE-1234");
  assert.deepEqual(res, { totalCentimesFacture: 4900, totalFacture: 49 });
});
