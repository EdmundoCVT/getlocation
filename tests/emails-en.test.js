// tests/emails-en.test.js
//
// E-mails envoyés au client : ils doivent suivre la langue dans laquelle la
// réservation a été faite (`langue: "fr" | "en"`, voir textes-email.js).
// Vérifie aussi que la version française n'a pas bougé — c'est elle que
// reçoivent la quasi-totalité des clients.

const test = require("node:test");
const assert = require("node:assert/strict");

const { buildConfirmationEmailContent } = require("../src/lib/send-confirmation-email.js");
const { buildPickupReminderEmailContent } = require("../src/lib/send-pickup-reminder-email.js");
const { buildReturnReminderEmailContent } = require("../src/lib/send-return-reminder-email.js");
const { TRADUCTIONS, traducteur, langueClient, lienPageClient, deuxPoints } = require("../src/lib/textes-email.js");

const RESERVATION = {
  id: "res_abc123",
  vehiculeId: "opel-corsa",
  dateDebut: "2026-09-16",
  heureDebut: "10:00",
  dateFin: "2026-09-18",
  heureFin: "10:00",
  jours: 3,
  total: 197,
  lieuPrise: "Livraison à l'adresse de votre choix",
  lieuRetour: "Livraison à l'adresse de votre choix",
  options: [{ id: "second-conducteur" }],
  conducteur: { prenom: "John", nom: "Smith", email: "john@example.com" },
  documentsAccessToken: "tok123",
  documentsStatus: "pending"
};

function en(reservation) { return { ...reservation, langue: "en" }; }

const CONSTRUCTEURS = [
  ["confirmation", (r) => buildConfirmationEmailContent(r, "https://getlocation.fr")],
  ["rappel prise en charge", buildPickupReminderEmailContent],
  ["rappel restitution", buildReturnReminderEmailContent]
];

test("les e-mails client sont entièrement en anglais quand la réservation l'est", () => {
  // Mots français qui n'ont aucune raison d'apparaître dans un e-mail anglais.
  const francais = /\b(Bonjour|Véhicule|Caution|Référence|Lieu|Restitution|jour\(s\)|bientôt|équipe|réservation|Documents à préparer|Prévenir|Contacter)\b/;
  CONSTRUCTEURS.forEach(([nom, construire]) => {
    const { subject, text, html } = construire(en(RESERVATION));
    [["objet", subject], ["texte", text], ["html", html]].forEach(([partie, contenu]) => {
      const trouve = contenu.match(francais);
      assert.equal(trouve, null, `${nom} (${partie}) : reste du français — « ${trouve && trouve[0]} »`);
    });
  });
});

test("les e-mails français ne changent pas", () => {
  const { subject, text } = buildConfirmationEmailContent(RESERVATION, "https://getlocation.fr");
  assert.equal(subject, "Confirmation de votre réservation GET LOCATION — Opel Corsa Business 1.2T");
  assert.match(text, /^Bonjour John,/);
  assert.match(text, /Véhicule : Opel Corsa Business 1\.2T/);
  // formatEUR() sépare le montant du « € » par une espace insécable. 650 € :
  // VEHICULES[].caution pour opel-corsa (voir js/data.js) — RESERVATION
  // ci-dessus n'a pas de depositAmount figé, donc repli sur ce tarif
  // courant (voir resolveDepositAmount() dans js/data.js).
  assert.match(text, /Caution du véhicule : 650\s€ \(prélevée avant la remise des clés\)/);
  assert.match(text, /mercredi 16 septembre 2026 à 10:00/);
  assert.match(text, /L'équipe GET LOCATION$/);
});

test("dates et liens suivent la langue du client", () => {
  const anglais = buildConfirmationEmailContent(en(RESERVATION), "https://getlocation.fr");
  // Date longue en anglais, pas la date française traduite à moitié.
  assert.match(anglais.text, /Wednesday,? 16 September 2026 at 10:00/);
  // Le lien « compléter mon dossier » ouvre la version anglaise du site.
  assert.match(anglais.text, /https:\/\/getlocation\.fr\/en\/documents#token=tok123/);
  // Et le message WhatsApp prérempli est en anglais lui aussi.
  assert.match(anglais.text, /I%20am%20contacting%20you%20about%20my%20booking/);

  const francais = buildConfirmationEmailContent(RESERVATION, "https://getlocation.fr");
  assert.match(francais.text, /https:\/\/getlocation\.fr\/documents\.html#token=tok123/);
});

test("les valeurs venues de js/data.js sont traduites sans être recopiées dans le dictionnaire des e-mails", () => {
  // « Livraison à l'adresse de votre choix » vit dans js/i18n.js : le
  // traducteur des e-mails doit s'y rabattre plutôt que d'en dupliquer
  // l'entrée ici.
  assert.equal(TRADUCTIONS["Livraison à l'adresse de votre choix"], undefined);
  assert.equal(
    traducteur("en")("Livraison à l'adresse de votre choix"),
    "Delivery to the address of your choice"
  );
  const { text } = buildConfirmationEmailContent(en(RESERVATION), "https://getlocation.fr");
  assert.match(text, /Delivery to the address of your choice/);
});

test("typographie : espace avant les deux-points en français, jamais en anglais", () => {
  assert.equal(deuxPoints("fr"), " : ");
  assert.equal(deuxPoints("en"), ": ");
  const anglais = buildPickupReminderEmailContent(en(RESERVATION));
  assert.doesNotMatch(anglais.text, / :/, "l'anglais ne met pas d'espace avant les deux-points");
  assert.doesNotMatch(anglais.html, / :<\/strong>/);
});

test("une phrase sans traduction retombe en français plutôt que de casser l'envoi", () => {
  const t = traducteur("en");
  assert.equal(t("Phrase jamais traduite {valeur}", { valeur: "X" }), "Phrase jamais traduite X");
});

test("langueClient : anglais seulement si la réservation le dit explicitement", () => {
  assert.equal(langueClient({ langue: "en" }), "en");
  assert.equal(langueClient({ langue: "fr" }), "fr");
  assert.equal(langueClient({}), "fr", "une réservation d'avant la version anglaise reste en français");
  assert.equal(langueClient(null), "fr");
  assert.equal(langueClient({ langue: "EN" }), "fr", "aucune tolérance : seul \"en\" bascule");
});

test("lienPageClient : adresse anglaise seulement pour une page qui en a une", () => {
  assert.equal(lienPageClient("https://getlocation.fr", "documents.html", "en", "token=x"), "https://getlocation.fr/en/documents#token=x");
  assert.equal(lienPageClient("https://getlocation.fr/", "documents.html", "fr", "token=x"), "https://getlocation.fr/documents.html#token=x");
  // Page sans version anglaise (outil agence) : jamais réécrite.
  assert.equal(lienPageClient("https://getlocation.fr", "contrat.html", "en"), "https://getlocation.fr/contrat.html");
});

test("chaque traduction d'e-mail déclare les mêmes variables que le français", () => {
  Object.keys(TRADUCTIONS).forEach((source) => {
    const variables = (texte) => (String(texte).match(/\{[a-zA-Z]+\}/g) || []).sort().join(",");
    assert.equal(variables(TRADUCTIONS[source]), variables(source), `variables divergentes pour « ${source} »`);
    assert.ok(String(TRADUCTIONS[source]).trim().length > 0, `traduction vide pour « ${source} »`);
  });
});
