// tests/regression-data-app-contract.test.js
//
// Garde-fou ajouté après la régression du 3 août 2026 (commits c4cee92 et
// 768bf4b) : ces deux commits ont supprimé silencieusement, en quelques
// secondes, la quasi-totalité des exports de js/data.js et 77 % du contenu
// de js/app.js (dont il s'est avéré que 768bf4b avait en réalité collé le
// contenu d'un ancien projet sans rapport, "Capver Tours", à la place du
// vrai app.js). Aucun test existant n'a détecté la casse avant un audit
// manuel, car les tests unitaires qui auraient dû échouer (data-pricing,
// validate-reservation-input, create-payment-intent...) plantaient tous
// silencieusement dès le require() au lieu de faire remonter une erreur
// explicite exploitable en CI.
//
// Ce fichier fait deux choses que les autres tests ne faisaient pas :
//  1. Vérifie explicitement, par leur nom, que TOUS les exports attendus de
//     js/data.js existent et ont le bon type — un seul test qui échoue
//     nommément si un export disparaît, plutôt qu'une cascade d'erreurs
//     "is not a function" dispersées dans des dizaines de fichiers.
//  2. Vérifie que le payload envoyé par js/app.js à create-payment-intent
//     (fetch body) contient exactement les champs attendus par
//     validateReservationInput — un test de contrat front/API qui aurait
//     immédiatement révélé le payload {amount, currency, description,
//     receiptEmail} envoyé pendant la régression.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const dataJs = require("../js/data.js");
const appJsSource = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8");
const { validateReservationInput } = require("../src/lib/validate-reservation-input.js");

test("js/data.js exporte toutes les valeurs requises par le backend (netlify/functions)", () => {
  const exportsAttendus = {
    LIEU_LIVRAISON: "string",
    VILLES_LIVRAISON: "object", // Array
    LIEUX: "object",
    CATEGORIES: "object",
    VEHICULES: "object",
    HEURE_OUVERTURE: "string",
    HEURE_FERMETURE: "string",
    REDUCTIONS_DUREE: "object",
    CODES_PROMO: "object",
    OPTIONS: "object",
    CGL_VERSION: "string",
    formatEUR: "function",
    getVehiculeParId: "function",
    dureeEnHeures: "function",
    joursFacturablesDepuisHeures: "function",
    reductionDureeApplicable: "function",
    getCodePromo: "function",
    getOptionParId: "function",
    calculerPrixTotal: "function"
  };

  for (const [nom, typeAttendu] of Object.entries(exportsAttendus)) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(dataJs, nom),
      `js/data.js doit exporter "${nom}" (utilisé par netlify/functions/*)`
    );
    assert.equal(
      typeof dataJs[nom],
      typeAttendu,
      `js/data.js: "${nom}" doit être de type "${typeAttendu}" (reçu "${typeof dataJs[nom]}")`
    );
  }

  assert.ok(Array.isArray(dataJs.VEHICULES) && dataJs.VEHICULES.length > 0, "VEHICULES doit être un tableau non vide");
  assert.ok(Array.isArray(dataJs.OPTIONS) && dataJs.OPTIONS.length > 0, "OPTIONS doit être un tableau non vide");
  assert.ok(Array.isArray(dataJs.LIEUX) && dataJs.LIEUX.includes(dataJs.LIEU_LIVRAISON),
    "LIEUX doit inclure LIEU_LIVRAISON (le modèle métier est : une agence + livraison, pas plusieurs agences physiques)");
});

test("garde-fou anti-effacement silencieux : js/data.js et js/app.js ont une taille minimale plausible", () => {
  // Seuils volontairement larges (pas un test de contenu précis) : leur
  // seul but est de faire échouer bruyamment un futur commit qui viderait
  // accidentellement l'un de ces deux fichiers, comme le 3 août 2026.
  const dataJsPath = path.join(__dirname, "..", "js", "data.js");
  const dataJsLignes = fs.readFileSync(dataJsPath, "utf8").split("\n").length;
  const appJsLignes = appJsSource.split("\n").length;

  assert.ok(dataJsLignes > 150, `js/data.js ne fait que ${dataJsLignes} lignes (seuil : 150) — vérifier qu'aucun export n'a été supprimé par erreur`);
  assert.ok(appJsLignes > 700, `js/app.js ne fait que ${appJsLignes} lignes (seuil : 700) — vérifier qu'aucune fonction n'a été supprimée par erreur`);
});

test("contrat front/API : le payload fetch() de create-payment dans js/app.js correspond exactement à ce qu'attend validateReservationInput", () => {
  // Extrait le nom des champs du littéral d'objet passé à JSON.stringify()
  // juste avant l'appel fetch(...create-payment). Depuis la Phase B de la
  // migration Cloudflare, le site et les fonctions serveur sont servis par
  // le même Worker : cet appel est redevenu un chemin relatif same-origin
  // (voir js/app.js et src/api/create-payment.js).
  const appelIndex = appJsSource.indexOf("fetch(`/api/create-payment`, {");
  assert.ok(appelIndex !== -1, "js/app.js doit appeler /api/create-payment");

  const stringifyIndex = appJsSource.indexOf("JSON.stringify({", appelIndex);
  assert.ok(stringifyIndex !== -1, "L'appel fetch doit envoyer un body JSON.stringify({...})");

  const debutObjet = stringifyIndex + "JSON.stringify(".length;
  let profondeur = 0;
  let finObjet = -1;
  for (let i = debutObjet; i < appJsSource.length; i++) {
    if (appJsSource[i] === "{") profondeur++;
    if (appJsSource[i] === "}") {
      profondeur--;
      if (profondeur === 0) { finObjet = i + 1; break; }
    }
  }
  assert.ok(finObjet !== -1, "Objet JSON.stringify non refermé (parsing)");

  const objetLitteral = appJsSource.slice(debutObjet, finObjet);
  // Ne capture que les noms de clés en tête de ligne (évite les faux
  // positifs sur des ":" présents dans des commentaires/chaînes).
  const champsEnvoyes = [...objetLitteral.matchAll(/^\s*(\w+)\s*:/gm)].map(m => m[1]);

  assert.ok(champsEnvoyes.length > 5, "Le payload envoyé semble anormalement pauvre — vérifier l'extraction ou une régression du payload");

  // Aucun de ces trois champs ne doit jamais être envoyé : c'est
  // précisément le payload {amount, currency, description, receiptEmail}
  // de la régression, qui laissait le client dicter le prix facturé.
  for (const champInterdit of ["amount", "currency", "description"]) {
    assert.ok(!champsEnvoyes.includes(champInterdit),
      `Le client ne doit JAMAIS envoyer "${champInterdit}" — le serveur doit recalculer le prix (cf. AUDIT.md, P0)`);
  }

  // Un payload plausible mais avec les champs obligatoires manquants doit
  // être rejeté par le serveur — vérifie que les noms de champs envoyés
  // par le client correspondent à ce que le serveur sait interpréter,
  // sans avoir à deviner un jeu de valeurs valides pour chacun.
  const echantillon = {
    vehiculeId: dataJs.VEHICULES[0].id,
    dateDebut: "2099-01-01",
    heureDebut: "10:00",
    dateFin: "2099-01-02",
    heureFin: "10:00",
    lieuPrise: dataJs.LIEUX[0],
    lieuRetour: dataJs.LIEUX[0],
    adressePrise: "",
    adresseRetour: "",
    options: [],
    codePromo: "",
    conducteur: { nom: "Dupont", prenom: "Jean", email: "jean@example.com", telephone: "0600000000", naissance: "1995-06-15" },
    idempotencyKey: "test-key-123",
    cglAccepted: true,
    cglVersion: dataJs.CGL_VERSION
  };
  for (const champ of champsEnvoyes) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(echantillon, champ),
      `Le champ "${champ}" envoyé par js/app.js n'est pas reconnu dans un payload d'exemple valide — vérifier l'alignement avec validate-reservation-input.js`
    );
  }

  const resultat = validateReservationInput(echantillon);
  assert.equal(resultat.valid, true, `Un payload construit avec exactement les champs envoyés par js/app.js doit être accepté par le serveur. Erreurs : ${resultat.errors.join(", ")}`);
});
