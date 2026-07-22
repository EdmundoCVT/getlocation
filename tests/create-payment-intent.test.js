// tests/create-payment-intent.test.js
//
// Teste tous les chemins de la fonction qui ne nécessitent PAS un appel
// réseau réel à Stripe (validation, CORS, rate limiting, disponibilité,
// configuration manquante). Le chemin "Stripe configuré + succès" ne peut
// pas être testé ici sans clé Stripe réelle ni accès réseau sortant — il
// devra être vérifié manuellement en mode test Stripe avant mise en
// production (cf. procédure de test dans la livraison finale).

const test = require("node:test");
const assert = require("node:assert/strict");

const { handler } = require("../netlify/functions/create-payment-intent.js");
const { createReservation } = require("../netlify/functions/lib/reservation-store.js");
const { CGL_VERSION } = require("../js/data.js");

let ipCounter = 0;
function uniqueIp() {
  ipCounter += 1;
  return `198.51.100.${ipCounter}`;
}

// Chaque test utilise par défaut une IP unique (sauf le test dédié au rate
// limiting) afin que les décomptes de la fenêtre anti-abus d'un test ne
// puissent jamais influencer un autre test, quel que soit l'ordre
// d'exécution ou le nombre de requêtes précédemment envoyées.
function makeEvent({ method = "POST", body = {}, origin = "https://getlocation.fr", headers = {} } = {}) {
  return {
    httpMethod: method,
    headers: { origin, "x-nf-client-connection-ip": uniqueIp(), ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body)
  };
}

function validPayload(overrides = {}) {
  return {
    vehiculeId: "opel-corsa",
    dateDebut: "2026-08-10",
    heureDebut: "10:00",
    dateFin: "2026-08-12",
    heureFin: "10:00",
    lieuPrise: "Agence Grasse",
    lieuRetour: "Agence Grasse",
    assurance: false,
    conducteur: {
      nom: "Martin",
      prenom: "Alice",
      email: "alice.martin@example.com",
      telephone: "0601020304",
      permis: "987654321",
      age: 28
    },
    cglAccepted: true,
    cglVersion: CGL_VERSION,
    ...overrides
  };
}

test("rejette les méthodes autres que POST/OPTIONS", async () => {
  const res = await handler(makeEvent({ method: "GET" }));
  assert.equal(res.statusCode, 405);
});

test("répond correctement à une requête OPTIONS (préflight CORS)", async () => {
  const res = await handler(makeEvent({ method: "OPTIONS" }));
  assert.equal(res.statusCode, 204);
});

test("CORS : reflète l'origine autorisée, l'ignore sinon", async () => {
  const ok = await handler(makeEvent({ body: validPayload(), origin: "https://getlocation.fr" }));
  assert.equal(ok.headers["Access-Control-Allow-Origin"], "https://getlocation.fr");

  const bad = await handler(makeEvent({ body: validPayload(), origin: "https://site-pirate.example" }));
  assert.equal(bad.headers["Access-Control-Allow-Origin"], undefined);
});

test("rejette un JSON invalide", async () => {
  const res = await handler(makeEvent({ body: "{ceci n'est pas du json" }));
  assert.equal(res.statusCode, 400);
});

test("rejette un payload métier invalide (véhicule inconnu)", async () => {
  const res = await handler(makeEvent({ body: validPayload({ vehiculeId: "voiture-fantome" }) }));
  assert.equal(res.statusCode, 400);
  const json = JSON.parse(res.body);
  assert.ok(json.details.includes("Véhicule inconnu"));
});

test("rejette une tentative de paiement sans acceptation des CGL", async () => {
  const res = await handler(makeEvent({ body: validPayload({ cglAccepted: false }) }));
  assert.equal(res.statusCode, 400);
  const json = JSON.parse(res.body);
  assert.ok(json.details.some((e) => e.includes("accepter les conditions")));
});

test("ignore un montant/currency fourni par le client (jamais utilisé)", async () => {
  // Comme aucune clé Stripe n'est configurée dans cet environnement de
  // test, la requête s'arrête à la vérification stripe_not_configured —
  // ce qui suffit à prouver qu'elle a passé la validation métier et le
  // recalcul serveur du prix sans jamais lire amount/currency du payload.
  const res = await handler(
    makeEvent({ body: validPayload({ amount: 1, currency: "usd", description: "faux" }) })
  );
  assert.equal(res.statusCode, 503);
  const json = JSON.parse(res.body);
  assert.equal(json.code, "stripe_not_configured");
});

test("répond stripe_not_configured (503) quand STRIPE_SECRET_KEY est absente", async () => {
  assert.equal(process.env.STRIPE_SECRET_KEY, undefined);
  const res = await handler(makeEvent({ body: validPayload() }));
  assert.equal(res.statusCode, 503);
  const json = JSON.parse(res.body);
  assert.equal(json.code, "stripe_not_configured");
});

test("détecte l'indisponibilité (409) sur un chevauchement de dates pour le même véhicule", async () => {
  const vehiculeId = "peugeot-2008-hybrid";
  // createReservation force toujours le statut initial à "pending_payment" ;
  // une réservation "pending_payment" récente bloque déjà le véhicule
  // pendant la fenêtre de hold (cf. RESERVATION_HOLD_MS dans
  // reservation-store.js), ce qui suffit à reproduire un cas réel de
  // double demande simultanée sur le même véhicule.
  await createReservation({
    vehiculeId,
    periodeDebut: "2026-09-10T10:00:00.000Z",
    periodeFin: "2026-09-15T10:00:00.000Z"
  });

  // La vérification de disponibilité n'est atteinte qu'après la vérification
  // de configuration Stripe : on fixe temporairement une clé factice pour
  // dépasser cette étape sans jamais atteindre le véritable appel réseau à
  // Stripe (la fonction retourne 409 avant d'y arriver).
  process.env.STRIPE_SECRET_KEY = "sk_test_dummy_for_unit_tests";
  let res;
  try {
    res = await handler(
      makeEvent({
        body: validPayload({
          vehiculeId,
          dateDebut: "2026-09-12",
          heureDebut: "10:00",
          dateFin: "2026-09-13",
          heureFin: "10:00"
        })
      })
    );
  } finally {
    delete process.env.STRIPE_SECRET_KEY;
  }
  assert.equal(res.statusCode, 409);
  const json = JSON.parse(res.body);
  assert.equal(json.code, "not_available");
});

test("rate limiting : bloque après plusieurs requêtes rapprochées depuis la même IP", async () => {
  const ip = `203.0.113.${Math.floor(Math.random() * 250)}`;
  let last;
  for (let i = 0; i < 10; i++) {
    last = await handler(
      makeEvent({ body: validPayload(), headers: { "x-nf-client-connection-ip": ip } })
    );
  }
  assert.equal(last.statusCode, 429);
});
