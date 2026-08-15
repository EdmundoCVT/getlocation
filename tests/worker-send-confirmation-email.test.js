// tests/worker-send-confirmation-email.test.js
//
// Équivalent de tests/send-confirmation-email.test.js pour
// src/lib/send-confirmation-email.js (Resend, Cloudflare Worker, Phase B —
// voir DEPLOIEMENT.md). L'envoi réel via l'API Resend ne peut pas être
// testé ici (pas d'accès réseau sortant, pas de clé réelle) — même limite
// déjà documentée pour Mollie. Ce fichier teste donc : le contenu généré
// (build...), et le comportement "best effort" quand RESEND_API_KEY n'est
// pas configurée (aucune exception, pas de blocage de la confirmation de
// paiement).

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  sendConfirmationEmail,
  buildConfirmationEmailContent
} = require("../src/lib/send-confirmation-email.js");

function makeReservation(overrides = {}) {
  return {
    id: "res_test1234567890abcdef1234567890",
    vehiculeId: "peugeot-3008",
    dateDebut: "2026-09-10",
    heureDebut: "10:00",
    dateFin: "2026-09-12",
    heureFin: "10:00",
    lieuPrise: "Aéroport de Nice",
    lieuRetour: "Aéroport de Nice",
    jours: 2,
    total: 138,
    conducteur: { prenom: "Camille", nom: "Martin", email: "camille@example.com" },
    ...overrides
  };
}

test("buildConfirmationEmailContent : inclut les informations clés de la réservation", () => {
  const { subject, text, html } = buildConfirmationEmailContent(makeReservation());

  assert.match(subject, /Peugeot 3008/);
  assert.match(text, /Camille/);
  assert.match(text, /Peugeot 3008/);
  assert.match(text, /Aéroport de Nice/);
  assert.match(text, /res_test1234567890abcdef1234567890/);
  assert.match(text, /138/);
  assert.match(html, /Peugeot 3008/);
  assert.match(html, /res_test1234567890abcdef1234567890/);
});

test("buildConfirmationEmailContent : aucune donnée conducteur autre que le prénom n'apparaît (pas de fuite superflue)", () => {
  const { text } = buildConfirmationEmailContent(makeReservation());
  assert.doesNotMatch(text, /Martin/);
  assert.doesNotMatch(text, /camille@example\.com/);
});

test("sendConfirmationEmail : ne lève jamais si RESEND_API_KEY n'est pas configurée", async () => {
  await assert.doesNotReject(sendConfirmationEmail({}, makeReservation()));
});

test("sendConfirmationEmail : ne lève jamais si la réservation n'a pas d'email conducteur", async () => {
  await assert.doesNotReject(sendConfirmationEmail({}, makeReservation({ conducteur: null })));
  await assert.doesNotReject(sendConfirmationEmail({}, null));
});

test("buildConfirmationEmailContent : inclut le montant de la caution du véhicule", () => {
  const { text, html } = buildConfirmationEmailContent(makeReservation());
  // Peugeot 3008 : caution 600 € dans js/data.js
  assert.match(text, /Caution du véhicule : 600/);
  assert.match(html, /Caution du véhicule.*600/s);
});

test("buildConfirmationEmailContent : inclut la checklist de documents de base sans mention du second conducteur par défaut", () => {
  const { text, html } = buildConfirmationEmailContent(makeReservation());
  assert.match(text, /Permis de conduire valide/);
  assert.match(text, /Pièce d'identité/);
  assert.match(text, /Justificatif de domicile ou adresse postale/);
  // Dans le HTML, l'apostrophe est échappée en entité (&#39;) — voir escapeHtml.
  assert.match(html, /Permis de conduire valide/);
  assert.match(html, /Pi[eè]ce d&#39;identit[eé]/);
  assert.match(html, /Justificatif de domicile ou adresse postale/);
  assert.doesNotMatch(text, /second conducteur/);
  assert.doesNotMatch(html, /second conducteur/);
});

test("buildConfirmationEmailContent : ajoute la checklist du second conducteur uniquement si l'option a été sélectionnée", () => {
  const reservation = makeReservation({
    options: [{ id: "second-conducteur", nom: "Deuxième conducteur", type: "jour", montant: 20 }]
  });
  const { text, html } = buildConfirmationEmailContent(reservation);
  assert.match(text, /second conducteur/);
  assert.match(html, /second conducteur/);
});

test("buildConfirmationEmailContent : inclut un lien WhatsApp prérempli avec la référence de réservation", () => {
  const reservation = makeReservation();
  const { text, html } = buildConfirmationEmailContent(reservation);
  const expectedUrlStart = "https://wa.me/33667485430?text=";
  assert.match(text, new RegExp(expectedUrlStart.replace(/[/?]/g, "\\$&")));
  assert.match(html, new RegExp(expectedUrlStart.replace(/[/?]/g, "\\$&")));
  assert.match(text, new RegExp(encodeURIComponent(reservation.id)));
  assert.match(html, new RegExp(encodeURIComponent(reservation.id)));
});

test("buildConfirmationEmailContent : ajoute le lien documentaire dans le fragment sans exposer le jeton ailleurs", () => {
  const reservation = makeReservation({ documentsAccessToken: "jeton_test-A_B" });
  const { text, html } = buildConfirmationEmailContent(reservation, "https://getlocation.fr/");
  const expected = "https://getlocation.fr/documents.html#token=jeton_test-A_B";
  assert.match(text, /Complétez votre dossier en ligne/);
  assert.ok(text.includes(expected));
  assert.ok(html.includes(expected));
  assert.doesNotMatch(text, /documents\.html\?token=/);
  assert.doesNotMatch(html, /documents\.html\?token=/);
});

test("buildConfirmationEmailContent : n'affiche aucun bouton documentaire sans jeton transitoire", () => {
  const { text, html } = buildConfirmationEmailContent(makeReservation());
  assert.doesNotMatch(text, /Complétez votre dossier en ligne/);
  assert.doesNotMatch(html, /Compléter mon dossier/);
});

test("buildConfirmationEmailContent : échappe le prénom du conducteur dans le HTML mais pas dans le texte brut", () => {
  const reservation = makeReservation({
    conducteur: { prenom: "<img src=x onerror=alert(1)>", nom: "Martin", email: "camille@example.com" }
  });
  const { text, html } = buildConfirmationEmailContent(reservation);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
  assert.match(text, /<img src=x onerror=alert\(1\)>/);
});

test("buildConfirmationEmailContent : la version texte et la version HTML contiennent les mêmes informations clés", () => {
  const reservation = makeReservation();
  const { text, html } = buildConfirmationEmailContent(reservation);
  const faitsClefs = [reservation.id, "Peugeot 3008", "600", "138"];
  faitsClefs.forEach((fait) => {
    assert.ok(text.includes(fait), `texte manquant : ${fait}`);
    assert.ok(html.includes(fait), `html manquant : ${fait}`);
  });
});
