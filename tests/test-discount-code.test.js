// tests/test-discount-code.test.js
//
// TEST_DISCOUNT_CODE (voir netlify/functions/create-payment.js et
// DEPLOIEMENT.md) : un code secret configuré côté Netlify (jamais présent
// dans js/data.js, donc jamais exposé au navigateur) qui ramène le montant
// facturé à 0,10 € au lieu du tarif normal. Sert à valider en conditions
// réelles (Mollie live) le parcours paiement + email de confirmation sans
// payer le plein tarif à chaque test.
//
// Fichier séparé de tests/create-payment.test.js (pas de dépendance
// croisée) pour ne pas interférer avec ce fichier.

const test = require("node:test");
const assert = require("node:assert/strict");

const { resolverMontantFacture } = require("../netlify/functions/create-payment.js");

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

test("avec TEST_DISCOUNT_CODE configurée et le bon code promo saisi : montant ramené à 0,10 €", () => {
  const prix = prixNormal(4900);
  const res = resolverMontantFacture(prix, "SECRET-INTERNE-1234", "SECRET-INTERNE-1234");
  assert.deepEqual(res, { totalCentimesFacture: 10, totalFacture: 0.1 });
});

test("la comparaison ignore la casse et les espaces superflus", () => {
  const prix = prixNormal(4900);
  const res = resolverMontantFacture(prix, "  secret-interne-1234  ", "SECRET-INTERNE-1234");
  assert.deepEqual(res, { totalCentimesFacture: 10, totalFacture: 0.1 });
});

test("aucun code promo saisi : aucun effet, même si TEST_DISCOUNT_CODE est configurée", () => {
  const prix = prixNormal(4900);
  const res = resolverMontantFacture(prix, null, "SECRET-INTERNE-1234");
  assert.deepEqual(res, { totalCentimesFacture: 4900, totalFacture: 49 });
});
