// tests/back-office.test.js
//
// Exerce le vrai JS de back-office.html (extrait, pas une copie à la main —
// même approche que tests/contrat-apercu-fill.test.js) : fonctions pures de
// formatage/rendu exposées via window.__backOffice pour les tests
// (échappement HTML, dates, montants, badges de statut/synchronisation).
// Ne couvre pas les flux réseau (déjà testés côté serveur dans les Lots
// 1-3, cette page n'est qu'une fine couche d'appel par-dessus).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const dataJsSource = fs.readFileSync(path.join(__dirname, "..", "js", "data.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "..", "back-office.html"), "utf8");

function extractBody() {
  const m = /<body>([\s\S]*)<\/body>/.exec(html);
  assert.ok(m, "Balise <body> introuvable dans back-office.html");
  return m[1];
}

function extractInlineScript() {
  const m = /<script>([\s\S]*?)<\/script>/.exec(html);
  assert.ok(m, "Script inline introuvable dans back-office.html");
  return m[1];
}

function buildWindow() {
  const dom = new JSDOM(`<!DOCTYPE html><body>${extractBody()}</body>`, {
    url: "https://getlocation.fr/back-office.html",
    runScripts: "outside-only"
  });
  // fetch n'existe pas nativement dans jsdom : sans ce filet, l'appel
  // synchrone fait par initSession() au chargement lèverait une exception
  // et interromprait le reste du script (jamais le cas dans un vrai
  // navigateur, où fetch existe toujours) — voir apiGet/initSession.
  dom.window.fetch = () => Promise.reject(new Error("fetch désactivé dans les tests"));
  dom.window.eval(dataJsSource);
  dom.window.eval(extractInlineScript());
  return dom.window;
}

test("escapeHtml : neutralise les caractères HTML dangereux", () => {
  const window = buildWindow();
  assert.equal(window.__backOffice.escapeHtml('<script>alert("x")</script>'), "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
  assert.equal(window.__backOffice.escapeHtml("O'Brien & Fils"), "O&#39;Brien &amp; Fils");
  assert.equal(window.__backOffice.escapeHtml(null), "");
  assert.equal(window.__backOffice.escapeHtml(undefined), "");
});

test("formatDateFR : convertit AAAA-MM-JJ en JJ/MM/AAAA", () => {
  const window = buildWindow();
  assert.equal(window.__backOffice.formatDateFR("2026-09-10"), "10/09/2026");
  assert.equal(window.__backOffice.formatDateFR(""), "—");
  assert.equal(window.__backOffice.formatDateFR(null), "—");
});

test("euros : convertit des centimes en libellé français, gère l'absence de valeur", () => {
  const window = buildWindow();
  assert.equal(window.__backOffice.euros(24000), "240,00 €");
  assert.equal(window.__backOffice.euros(0), "0,00 €");
  assert.equal(window.__backOffice.euros(null), "—");
  assert.equal(window.__backOffice.euros(undefined), "—");
});

test("statusBadge : libellé français correct pour chaque statut de location", () => {
  const window = buildWindow();
  assert.match(window.__backOffice.statusBadge("brouillon"), /Brouillon/);
  assert.match(window.__backOffice.statusBadge("contrat_genere"), /Contrat généré/);
  assert.match(window.__backOffice.statusBadge("en_cours"), /En cours/);
  assert.match(window.__backOffice.statusBadge("terminee"), /Terminée/);
  assert.match(window.__backOffice.statusBadge("annulee"), /Annulée/);
});

test("syncBadge : distingue non synchronisé / en attente / synchronisé / erreur", () => {
  const window = buildWindow();
  assert.match(window.__backOffice.syncBadge(null), /Non synchronisé/);
  assert.match(window.__backOffice.syncBadge({ status: "pending" }), /En attente/);
  assert.match(window.__backOffice.syncBadge({ status: "synced" }), /Synchronisé/);
  assert.match(window.__backOffice.syncBadge({ status: "error" }), /Erreur/);
  assert.match(window.__backOffice.syncBadge({ status: "error" }), /sync-error/);
  assert.match(window.__backOffice.syncBadge({ status: "synced" }), /sync-ok/);
});

test("chargement complet de la page sans exception (tous les écouteurs s'attachent)", () => {
  assert.doesNotThrow(() => buildWindow());
});

// Régression Lot 5 : renderSyncStatus utilisait row(), qui échappe
// systématiquement sa valeur (correct pour du texte utilisateur) — appliqué
// au HTML de confiance renvoyé par syncBadge(), il affichait le balisage
// brut ("<span class=...>Synchronisé</span>") au lieu du badge coloré,
// repéré lors de la validation manuelle du Lot 5 (voir compte rendu).
test("renderSyncStatus : insère le badge de synchronisation comme HTML, jamais échappé", () => {
  const window = buildWindow();
  window.__backOffice.renderSyncStatusForTest({ id: "r1", syncStatus: { status: "synced" } });
  const card = window.document.getElementById("syncStatusCard");
  assert.equal(card.querySelectorAll(".status-pill.sync-ok").length, 1);
  assert.ok(!card.innerHTML.includes("&lt;span"), "le badge ne doit jamais apparaître échappé");
});
