// tests/contrat-lien-court-manuel.test.js
//
// Garde-fou pour le bug signalé le 12/09/2026, persistant même après le
// correctif "lien seul" (tests/contrat-whatsapp-lien-seul.test.js) : le
// lien manuel `?data=...` embarque tout le formulaire encodé en base64
// (souvent >1000 caractères sans espace), que WhatsApp ne reconnaît alors
// comme cliquable que sur son tout début une fois collé dans un message
// (capture d'écran utilisateur : seul "https://getlocation.fr/contrat?data"
// est souligné, le reste du texte reste brut).
//
// Corrigé en ajoutant un lien COURT (jeton, voir
// src/api/contract-manual-link.js) émis dès qu'un contrat manuel est
// enregistré côté serveur (bouton "Générer/Mettre à jour le contrat
// officiel"), utilisé ensuite par TOUS les moyens de partage
// (copier/WhatsApp/SMS/e-mail/partage natif/ouverture directe) tant que les
// données du formulaire n'ont pas changé depuis — voir regenererLien() et
// mettreAJourLienCourt(). Le lien `?data=` reste utilisé tel quel tant
// qu'aucun contrat n'a encore été généré (rien ne change pour ce cas, pas
// de régression).
//
// Vérifié directement sur le code source (comme
// tests/contrat-whatsapp-lien-seul.test.js) : reproduire le flux complet
// nécessiterait toute la vue AGENCE authentifiée de contrat.html, disproportionné
// ici pour vérifier quelle URL alimente les boutons de partage.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "contrat.html"), "utf8");

test("regenererLien() : préfère le lien court (contratOfficielCourant) quand les données du formulaire n'ont pas changé depuis son émission", () => {
  assert.match(
    html,
    /var url = \(contratOfficielCourant && contratOfficielCourant\.dataJson === JSON\.stringify\(data\)\)\s*\n\s*\? contratOfficielCourant\.url\s*\n\s*: urlLongue;/
  );
});

test("regenererLien() : tous les boutons de partage (ouvrir/whatsapp/sms/e-mail/téléchargement/partage natif/copie) utilisent la même variable url, donc le lien court dès qu'il est disponible", () => {
  assert.match(html, /document\.getElementById\('openLinkBtn'\)\.href = url;/);
  assert.match(html, /whatsappBtn'\)\.href = 'https:\/\/wa\.me\/\?text=' \+ encodeURIComponent\(url\)/);
  assert.match(html, /smsBtn'\)\.href = smsHref\(encodeURIComponent\(url\)\)/);
  assert.match(html, /'&body=' \+ messageEnc/);
  assert.match(html, /navigator\.share\(\{ title: 'Contrat de location GETLOCATION', text: message, url: url \}\)/);
  assert.match(html, /linkOutput\.value = url;/);
});

test("mettreAJourLienCourt() : émet le lien court via POST /api/contract-manual-link, avec le jeton CSRF agence", () => {
  assert.match(html, /function mettreAJourLienCourt\(id, rawData\)\{/);
  assert.match(html, /fetch\('\/api\/contract-manual-link', \{\s*\n\s*method: 'POST',\s*\n\s*credentials: 'same-origin',\s*\n\s*headers: \{ 'Content-Type': 'application\/json', 'X-Agency-Csrf': agenceCsrfToken \|\| '' \},\s*\n\s*body: JSON\.stringify\(\{ id: id \}\)/);
});

test("genererContratBtn : appelle mettreAJourLienCourt() après chaque génération/mise à jour réussie du contrat officiel", () => {
  assert.match(html, /mettreAJourLienCourt\(result\.id, rawData\);/);
});

test("historique 'Ouvrir' : réémet aussi le lien court pour un contrat manuel déjà généré", () => {
  assert.match(html, /entrerModeEdition\(entry\.id, entry\.numero\);\s*\n(?:[^\n]*\n){0,4}[^\n]*mettreAJourLienCourt\(entry\.id, entry\.rawData\);/);
});

test("#manualToken= (fragment, jamais un paramètre de requête) déclenche initManualClientView, comme #agencyToken=/#clientToken=", () => {
  assert.match(html, /var manualToken = hashParams\.get\('manualToken'\);/);
  assert.match(html, /\} else if\(manualToken\)\{\s*\n\s*history\.replaceState\(null, '', window\.location\.pathname\);\s*\n\s*document\.getElementById\('ownerView'\)\.classList\.add\('hidden'\);\s*\n\s*document\.getElementById\('clientView'\)\.classList\.remove\('hidden'\);\s*\n\s*initManualClientView\(manualToken\);/);
});

test("initManualClientView() : résout le jeton auprès du serveur (Authorization: Bearer) puis délègue à initClientView() avec les données reçues", () => {
  assert.match(html, /function initManualClientView\(token\)\{/);
  assert.match(html, /fetch\('\/api\/contract-manual-link', \{ headers: \{ Authorization: 'Bearer ' \+ token \} \}\)/);
  assert.match(html, /\.then\(function\(data\)\{ initClientView\(data\); \}\)/);
});
