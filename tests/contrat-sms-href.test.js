// tests/contrat-sms-href.test.js
//
// Garde-fou pour le bug signalé le 17/08/2026 : le lien "Envoyer par SMS"
// (contrat.html, vue AGENCE) n'ouvrait pas l'app Messages avec le texte
// prérempli sur iPhone. Cause : le schéma d'URI "sms:" n'est pas standardisé
// entre plateformes — Android attend "sms:?body=...", iOS Safari
// "sms:&body=...". Le code utilisait systématiquement le format Android,
// aussi bien dans la vue manuelle (regenererLien) que dans la vue "dossier
// contrat sécurisé" (dfSmsBtn) — les deux utilisent désormais smsHref().
//
// Exécute le vrai code de contrat.html via jsdom, comme
// tests/contrat-apercu-fill.test.js — jsdom permet de fixer précisément le
// user-agent, ce qu'un test dans un vrai navigateur ne permet pas de
// vérifier de façon déterministe pour les deux plateformes.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const dataJsSource = fs.readFileSync(path.join(__dirname, "..", "js", "data.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "..", "contrat.html"), "utf8");

function extractScriptBody() {
  const afterDataJs = html.indexOf("js/data.js");
  const openTag = html.indexOf("<script>", afterDataJs);
  assert.ok(openTag !== -1, "Balise <script> introuvable après js/data.js dans contrat.html");
  const bodyStart = openTag + "<script>".length;
  const initMarker = "var params = new URLSearchParams";
  const bodyEnd = html.indexOf(initMarker, bodyStart);
  assert.ok(bodyEnd !== -1, "Marqueur d'auto-init introuvable (structure de contrat.html changée ?)");
  return html.slice(bodyStart, bodyEnd);
}

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const ANDROID_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const DESKTOP_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function buildWindow(userAgent) {
  // jsdom 29 : le user-agent se règle via `resources: { userAgent }`, pas
  // via une option `userAgent` de premier niveau (API changée depuis les
  // versions antérieures de jsdom).
  const dom = new JSDOM(`<!DOCTYPE html><body></body>`, {
    url: "https://getlocation.fr/contrat.html",
    runScripts: "outside-only",
    resources: { userAgent }
  });
  dom.window.eval(dataJsSource);
  dom.window.eval(extractScriptBody());
  return dom.window;
}

test("smsHref : format iOS (\"&body=\", sans \"?\") sur iPhone — c'est le bug signalé, corrigé ici", () => {
  const win = buildWindow(IPHONE_UA);
  assert.equal(win.smsHref("bonjour%20test"), "sms:&body=bonjour%20test");
});

test("smsHref : format standard (\"?body=\") sur Android", () => {
  const win = buildWindow(ANDROID_UA);
  assert.equal(win.smsHref("bonjour%20test"), "sms:?body=bonjour%20test");
});

test("smsHref : format standard (\"?body=\") sur desktop (repli par défaut)", () => {
  const win = buildWindow(DESKTOP_UA);
  assert.equal(win.smsHref("bonjour%20test"), "sms:?body=bonjour%20test");
});

test("les deux points d'appel SMS du fichier utilisent smsHref() (vue manuelle et dossier sécurisé), aucun appel ne contourne plus smsHref() avec le format Android codé en dur", () => {
  // smsHref() lui-même contient légitimement le littéral 'sms:?body=' (cas
  // Android/desktop) : on vérifie ici qu'aucun *appelant* ne l'écrit en dur
  // directement dans une affectation .href, pas que la sous-chaîne
  // n'apparaît nulle part dans le fichier.
  assert.doesNotMatch(html, /\.href\s*=\s*'sms:\?body='/, "un appel .href assigne encore le format Android en dur au lieu de passer par smsHref()");
  assert.match(html, /smsBtn'\)\.href = smsHref\(/);
  assert.match(html, /dfSmsBtn'\)\.href = smsHref\(/);
});
