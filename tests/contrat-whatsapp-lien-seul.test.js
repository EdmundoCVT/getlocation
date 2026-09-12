// tests/contrat-whatsapp-lien-seul.test.js
//
// Garde-fou pour le bug signalé le 12/09/2026 : le lien du contrat, envoyé
// via WhatsApp ou SMS, n'était plus reconnu comme cliquable une fois reçu
// — contrairement à l'e-mail, qui a toujours fonctionné. Cause probable :
// le lien était noyé dans une phrase ("Bonjour X, voici le lien ... :
// https://..."), plutôt qu'envoyé seul — combiné à un lien de contrat
// manuel pouvant être long (toutes les données du contrat y sont encodées,
// contrairement au lien de dossier sécurisé, un simple jeton court).
//
// Corrigé en envoyant le lien SEUL vers WhatsApp/SMS (jamais noyé dans une
// phrase), sur les deux points d'appel du fichier (vue manuelle et dossier
// sécurisé) — l'e-mail garde le message complet, ce canal n'ayant jamais
// posé ce problème. Vérifié directement sur le code source (comme le
// dernier test de contrat-sms-href.test.js) : reproduire le flux complet
// nécessiterait tout le DOM du formulaire agence, disproportionné pour
// vérifier quel argument est passé à un .href.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "contrat.html"), "utf8");

test("whatsappBtn/smsBtn (vue manuelle) : reçoivent le lien seul, jamais le message complet noyant le lien", () => {
  assert.match(html, /whatsappBtn'\)\.href = 'https:\/\/wa\.me\/\?text=' \+ encodeURIComponent\(url\)/);
  assert.match(html, /smsBtn'\)\.href = smsHref\(encodeURIComponent\(url\)\)/);
});

test("dfWhatsappBtn/dfSmsBtn (dossier sécurisé) : reçoivent le lien seul, jamais le message complet noyant le lien", () => {
  assert.match(html, /dfWhatsappBtn'\)\.href = 'https:\/\/wa\.me\/\?text=' \+ encodeURIComponent\(body\.clientUrl\)/);
  assert.match(html, /dfSmsBtn'\)\.href = smsHref\(encodeURIComponent\(body\.clientUrl\)\)/);
});

test("emailBtn/dfEmailBtn : gardent le message complet (canal jamais concerné par ce bug)", () => {
  assert.match(html, /emailBtn'\)\.href = 'mailto:\?subject=' \+[\s\S]{0,80}'&body=' \+ messageEnc/);
  assert.match(html, /dfEmailBtn'\)\.href = 'mailto:\?subject=' \+ encodeURIComponent\('Votre contrat de location GETLOCATION'\) \+ '&body=' \+ messageEnc/);
});
