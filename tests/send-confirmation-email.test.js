// tests/send-confirmation-email.test.js
//
// L'envoi réel via Gmail SMTP ne peut pas être testé ici (pas d'accès
// réseau sortant, pas d'identifiants réels) — voir la même limite déjà
// documentée pour Mollie dans tests/mollie-webhook.test.js. Ce fichier
// teste donc : le contenu généré (build...), et le comportement "best
// effort" quand GMAIL_USER/GMAIL_APP_PASSWORD ne sont pas configurés
// (aucune exception, pas de blocage de la confirmation de paiement).

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  sendConfirmationEmail,
  buildConfirmationEmailContent
} = require("../lib/server/send-confirmation-email.js");

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

test("sendConfirmationEmail : ne lève jamais si GMAIL_USER/GMAIL_APP_PASSWORD ne sont pas configurés", async () => {
  delete process.env.GMAIL_USER;
  delete process.env.GMAIL_APP_PASSWORD;
  await assert.doesNotReject(sendConfirmationEmail(makeReservation()));
});

test("sendConfirmationEmail : ne lève jamais si la réservation n'a pas d'email conducteur", async () => {
  await assert.doesNotReject(sendConfirmationEmail(makeReservation({ conducteur: null })));
  await assert.doesNotReject(sendConfirmationEmail(null));
});
