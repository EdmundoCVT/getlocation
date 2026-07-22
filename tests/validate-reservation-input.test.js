// tests/validate-reservation-input.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { validateReservationInput } = require("../netlify/functions/lib/validate-reservation-input.js");
const { CGL_VERSION } = require("../js/data.js");

function basePayload(overrides = {}) {
  return {
    vehiculeId: "peugeot-3008",
    dateDebut: "2026-08-10",
    heureDebut: "10:00",
    dateFin: "2026-08-13",
    heureFin: "10:00",
    lieuPrise: "Agence Grasse",
    lieuRetour: "Agence Grasse",
    assurance: true,
    conducteur: {
      nom: "Dupont",
      prenom: "Jean",
      email: "jean.dupont@example.com",
      telephone: "0601020304",
      permis: "123456789",
      age: 30
    },
    cglAccepted: true,
    cglVersion: CGL_VERSION,
    ...overrides
  };
}

test("accepte une requête bien formée", () => {
  const { valid, errors, vehicule } = validateReservationInput(basePayload());
  assert.equal(valid, true);
  assert.deepEqual(errors, []);
  assert.equal(vehicule.id, "peugeot-3008");
});

test("rejette un véhicule inconnu", () => {
  const { valid, errors } = validateReservationInput(basePayload({ vehiculeId: "vehicule-inexistant" }));
  assert.equal(valid, false);
  assert.ok(errors.includes("Véhicule inconnu"));
});

test("rejette une date de début dans le passé", () => {
  const { valid, errors } = validateReservationInput(basePayload({ dateDebut: "2020-01-01", dateFin: "2020-01-03" }));
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes("passé")));
});

test("rejette une date de fin antérieure ou égale à la date de début", () => {
  const { valid, errors } = validateReservationInput(
    basePayload({ dateDebut: "2026-08-10", heureDebut: "10:00", dateFin: "2026-08-10", heureFin: "10:00" })
  );
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes("postérieure")));
});

test("rejette des formats de date/heure invalides", () => {
  const { valid, errors } = validateReservationInput(basePayload({ dateDebut: "10/08/2026", heureDebut: "25:99" }));
  assert.equal(valid, false);
  assert.ok(errors.includes("Date de début invalide"));
  assert.ok(errors.includes("Heure de début invalide"));
});

test("rejette un lieu hors liste", () => {
  const { valid, errors } = validateReservationInput(basePayload({ lieuPrise: "Un lieu inventé" }));
  assert.equal(valid, false);
  assert.ok(errors.includes("Lieu de prise en charge invalide"));
});

test("rejette des informations conducteur incomplètes ou invalides", () => {
  const { valid, errors } = validateReservationInput(
    basePayload({ conducteur: { nom: "D", prenom: "", email: "pas-un-email", telephone: "12", permis: "", age: 15 } })
  );
  assert.equal(valid, false);
  assert.ok(errors.includes("Nom invalide"));
  assert.ok(errors.includes("Prénom invalide"));
  assert.ok(errors.includes("E-mail invalide"));
  assert.ok(errors.includes("Téléphone invalide"));
  assert.ok(errors.includes("Numéro de permis invalide"));
  assert.ok(errors.some((e) => e.includes("Âge")));
});

test("rejette une tentative d'injection de montant/prix (champs ignorés silencieusement)", () => {
  // Le validateur ne doit pas planter si des champs non attendus (ex.
  // amount/currency hérités de l'ancienne API) sont présents : ils sont
  // simplement ignorés, jamais utilisés pour le calcul du prix.
  const { valid } = validateReservationInput(basePayload({ amount: 1, currency: "usd" }));
  assert.equal(valid, true);
});

test("rejette une clé d'idempotence mal formée", () => {
  const { valid, errors } = validateReservationInput(basePayload({ idempotencyKey: "clé avec espaces !!" }));
  assert.equal(valid, false);
  assert.ok(errors.includes("Clé d'idempotence invalide"));
});

test("accepte une clé d'idempotence bien formée", () => {
  const { valid } = validateReservationInput(basePayload({ idempotencyKey: "abc123-DEF_456" }));
  assert.equal(valid, true);
});

test("rejette un payload non-objet", () => {
  assert.equal(validateReservationInput(null).valid, false);
  assert.equal(validateReservationInput("chaine").valid, false);
  assert.equal(validateReservationInput(undefined).valid, false);
});

test("rejette une case CGL non cochée (absente, false, ou valeur non stricte)", () => {
  const absent = validateReservationInput(basePayload({ cglAccepted: undefined }));
  assert.equal(absent.valid, false);
  assert.ok(absent.errors.some((e) => e.includes("accepter les conditions")));

  const faux = validateReservationInput(basePayload({ cglAccepted: false }));
  assert.equal(faux.valid, false);

  // "truthy" non strictement égal à true (ex. chaîne "true" envoyée par un
  // client trafiqué) doit aussi être rejeté.
  const trafique = validateReservationInput(basePayload({ cglAccepted: "true" }));
  assert.equal(trafique.valid, false);
});

test("rejette une version de CGL obsolète ou incorrecte", () => {
  const { valid, errors } = validateReservationInput(basePayload({ cglVersion: "1999-01-01" }));
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes("mise à jour")));
});

test("accepte une case CGL cochée avec la version en vigueur", () => {
  const { valid } = validateReservationInput(basePayload());
  assert.equal(valid, true);
});
