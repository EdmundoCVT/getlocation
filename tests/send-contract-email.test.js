// tests/send-contract-email.test.js
//
// L'envoi réel via Gmail SMTP ne peut pas être testé ici (même limite que
// send-confirmation-email.js). Ce fichier teste : le contenu du lien
// pré-rempli généré (buildContractPrefillData), et surtout que l'encodage
// utilisé côté serveur (encodeContractData, Buffer Node) est bien compatible
// avec le décodage réel utilisé par contrat.html côté navigateur
// (decodeData, atob/escape/decodeURIComponent) — sans cette vérification,
// un lien généré par email pourrait sembler correct ici tout en cassant
// silencieusement une fois ouvert dans un vrai navigateur.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const {
  sendContractEmail,
  buildContractPrefillData,
  encodeContractData
} = require("../netlify/functions/lib/send-contract-email.js");
const { formatAdressePersonnalisee } = require("../js/data.js");

function makeReservation(overrides = {}) {
  return {
    id: "res_test1234567890abcdef1234567890",
    vehiculeId: "peugeot-3008",
    dateDebut: "2026-09-10",
    heureDebut: "10:00",
    dateFin: "2026-09-12",
    heureFin: "11:30",
    lieuPrise: "Agence Grasse",
    lieuRetour: "Agence Grasse",
    adressePrise: null,
    adresseRetour: null,
    options: [],
    conducteur: { prenom: "Camille", nom: "Martin", email: "camille@example.com", telephone: "0601020304", naissance: "1995-04-12" },
    ...overrides
  };
}

test("buildContractPrefillData : reprend les champs connus de la réservation, laisse le reste absent", () => {
  const data = buildContractPrefillData(makeReservation());
  assert.equal(data.vehiculeId, "peugeot-3008");
  assert.equal(data.lieu, "Agence Grasse");
  assert.equal(data.depart, "2026-09-10T10:00");
  assert.equal(data.retour, "2026-09-12T11:30");
  assert.equal(data.prenom, "Camille");
  assert.equal(data.nom, "Martin");
  assert.equal(data.naissance, "1995-04-12");
  assert.equal(data.tel, "0601020304");
  assert.equal(data.email, "camille@example.com");
  assert.equal(data.secondConducteur, false);
  assert.equal(data.livraison, false);
  // Jamais collecté pendant la réservation (demandé par email après coup) :
  // absent de l'objet
  assert.equal("permis" in data, false);
  assert.equal("adresse" in data, false);
});

test("buildContractPrefillData : détecte la livraison et préremplit sa zone sans inventer l'adresse exacte", () => {
  const data = buildContractPrefillData(makeReservation({
    options: [{ id: "second-conducteur" }, { id: "livraison-adresse" }],
    adressePrise: "Nice"
  }));
  assert.equal(data.secondConducteur, true);
  assert.equal(data.livraison, true);
  assert.equal(data.livraisonRue, "");
  assert.equal(data.livraisonVille, "Nice");
});

test("buildContractPrefillData : répartit une adresse personnalisée dans les champs du contrat", () => {
  const data = buildContractPrefillData(makeReservation({
    options: [{ id: "livraison-adresse" }],
    adressePrise: formatAdressePersonnalisee("12 avenue Jean Médecin", "06000", "Nice")
  }));
  assert.equal(data.livraisonRue, "12 avenue Jean Médecin");
  assert.equal(data.livraisonCP, "06000");
  assert.equal(data.livraisonVille, "Nice");
});

test("encodeContractData : produit un base64 décodable par decodeData() de contrat.html (round-trip navigateur réel)", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "contrat.html"), "utf8");
  // Extrait les vraies définitions de contrat.html (pas une copie à la
  // main) : si ces fonctions changent un jour dans la page, ce test doit
  // suivre le vrai code, pas une supposition figée ici.
  const encodeMatch = html.match(/function encodeData\(obj\)\{[\s\S]*?\n\}/);
  const decodeMatch = html.match(/function decodeData\(str\)\{[\s\S]*?\n\}/);
  assert.ok(encodeMatch, "encodeData() introuvable dans contrat.html (structure du fichier changée ?)");
  assert.ok(decodeMatch, "decodeData() introuvable dans contrat.html (structure du fichier changée ?)");

  const dom = new JSDOM("<!DOCTYPE html><body></body>", { url: "https://getlocation.fr/contrat.html", runScripts: "outside-only" });
  dom.window.eval(`
    ${encodeMatch[0]}
    ${decodeMatch[0]}
    window.encodeData = encodeData;
    window.decodeData = decodeData;
  `);

  const original = { prenom: "Camille", nom: "Martin", email: "camille@example.com", note: "accentué : é è à ç €" };
  const encodedByServer = encodeContractData(original);

  // JSON.parse(JSON.stringify(...)) normalise l'objet retourné par jsdom
  // (autre "royaume" JS, donc un autre prototype Object) en objet Node
  // ordinaire, pour une comparaison structurelle propre.
  const decoded = JSON.parse(JSON.stringify(dom.window.decodeData(encodedByServer)));
  assert.deepEqual(decoded, original);

  // Et inversement, un lien généré par le navigateur reste lisible par le
  // même décodage côté serveur (symétrie complète).
  const encodedByBrowser = dom.window.encodeData(original);
  assert.equal(encodedByBrowser, encodedByServer);
});

test("sendContractEmail : ne lève jamais si GMAIL_USER/GMAIL_APP_PASSWORD ne sont pas configurés", async () => {
  delete process.env.GMAIL_USER;
  delete process.env.GMAIL_APP_PASSWORD;
  await assert.doesNotReject(sendContractEmail(makeReservation()));
});

test("sendContractEmail : ne lève jamais si la réservation est absente ou sans conducteur", async () => {
  await assert.doesNotReject(sendContractEmail(null));
  await assert.doesNotReject(sendContractEmail(makeReservation({ conducteur: null })));
});
