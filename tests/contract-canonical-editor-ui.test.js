const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "..", "contrat.html"), "utf8");

test("V1/V2/V3 utilisent le formulaire canonique de création", () => {
  assert.equal((html.match(/id="ownerForm"/g) || []).length, 1);
  assert.match(html, /var editVersionId = params\.get\('editVersionId'\)/);
  assert.match(html, /chargerVersionDansFormulaire\(versionId\)/);
  assert.match(html, /remplirFormulaire\(body\.form,true\)/);
  assert.match(html, /action:'save-form',id:contratEnCoursId,rawData:lireDonneesFormulaire\(\)/);
});

test("les anciennes cartes d'édition parallèles ne sont plus visibles", () => {
  assert.match(html, /class="card hidden" id="dfVersionDataCard" aria-hidden="true"/);
  assert.match(html, /class="card hidden" id="dfLegacyFieldsCard" aria-hidden="true"/);
  assert.match(html, /class="card hidden" id="dfLegacyLanguageCard" aria-hidden="true"/);
});

test("le formulaire canonique couvre retour, dépôt et signature de version", () => {
  for (const id of ["lieuRetour", "cautionContractuelle", "dfSignaturePad", "df-displaySignedAt", "dfFinalizeVersionBtn"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /ouvrirEditeurVersion\(entry\)/);
  assert.match(html, /Créer V/);
});

test("le rendu des anciens kilométrages incomplets est protégé", () => {
  assert.match(html, /Number\(view\.contractMileage\.kilometresInclusTotal \|\| 0\)\.toLocaleString/);
});
