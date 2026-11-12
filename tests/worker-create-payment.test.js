// tests/worker-create-payment.test.js
//
// Équivalent de tests/create-payment.test.js pour src/api/create-payment.js
// (Cloudflare Worker, Phase B — voir DEPLOIEMENT.md). Teste tous les chemins
// qui ne nécessitent PAS un appel réseau réel à Mollie (validation, CORS,
// rate limiting, disponibilité, configuration manquante). Le chemin "Mollie
// configuré + succès" ne peut pas être testé ici sans clé Mollie réelle ni
// accès réseau sortant — il devra être vérifié manuellement en mode test
// Mollie avant mise en production (voir DEPLOIEMENT.md).

const test = require("node:test");
const assert = require("node:assert/strict");

const { createFakeKv } = require("./helpers/fake-kv.js");
const { handleCreatePayment } = require("../src/api/create-payment.js");
const { createReservation, getReservation } = require("../src/lib/reservation-store.js");
const { CGL_VERSION, formatAdressePersonnalisee } = require("../js/data.js");

function makeEnv(overrides = {}) {
  return { RESERVATIONS_KV: createFakeKv(), RATE_LIMITS_KV: createFakeKv(), ...overrides };
}

let ipCounter = 0;
function uniqueIp() {
  ipCounter += 1;
  return `198.51.100.${ipCounter}`;
}

// Chaque test utilise par défaut une IP unique (sauf le test dédié au rate
// limiting) afin que les décomptes de la fenêtre anti-abus d'un test ne
// puissent jamais influencer un autre test, quel que soit l'ordre
// d'exécution ou le nombre de requêtes précédemment envoyées.
function makeRequest({ method = "POST", body = {}, origin = "https://getlocation.fr", headers = {} } = {}) {
  return new Request("https://getlocation.fr/api/create-payment", {
    method,
    headers: { origin, "cf-connecting-ip": uniqueIp(), ...headers },
    body: method === "GET" || method === "OPTIONS" ? undefined : typeof body === "string" ? body : JSON.stringify(body)
  });
}

function futureDate(joursDepuisAujourdhui) {
  const d = new Date();
  d.setDate(d.getDate() + joursDepuisAujourdhui);
  return d.toISOString().slice(0, 10);
}

function futureDateTimeISO(joursDepuisAujourdhui, heure = "10:00:00") {
  return `${futureDate(joursDepuisAujourdhui)}T${heure}.000Z`;
}

function validPayload(overrides = {}) {
  return {
    vehiculeId: "opel-corsa",
    dateDebut: futureDate(30),
    heureDebut: "10:00",
    dateFin: futureDate(32),
    heureFin: "10:00",
    lieuPrise: "Agence Grasse",
    lieuRetour: "Agence Grasse",
    assurance: false,
    conducteur: {
      nom: "Martin",
      prenom: "Alice",
      email: "alice.martin@example.com",
      telephone: "0601020304",
      naissance: "1998-03-20",
      // Date d'obtention du permis : obligatoire depuis l'ajout du supplément
      // jeune conducteur (permis de moins de 3 ans). Ancienne ici, donc aucun
      // supplément — les montants attendus par ces tests ne changent pas.
      permisDate: "2016-04-10"
    },
    cglAccepted: true,
    cglVersion: CGL_VERSION,
    ...overrides
  };
}

test("rejette les méthodes autres que POST/OPTIONS", async () => {
  const res = await handleCreatePayment(makeRequest({ method: "GET" }), makeEnv());
  assert.equal(res.status, 405);
});

test("répond correctement à une requête OPTIONS (préflight CORS)", async () => {
  const res = await handleCreatePayment(makeRequest({ method: "OPTIONS" }), makeEnv());
  assert.equal(res.status, 204);
});

test("CORS : reflète l'origine autorisée, l'ignore sinon", async () => {
  const ok = await handleCreatePayment(makeRequest({ body: validPayload(), origin: "https://getlocation.fr" }), makeEnv());
  assert.equal(ok.headers.get("Access-Control-Allow-Origin"), "https://getlocation.fr");

  const bad = await handleCreatePayment(makeRequest({ body: validPayload(), origin: "https://site-pirate.example" }), makeEnv());
  assert.equal(bad.headers.get("Access-Control-Allow-Origin"), null);
});

test("rejette un JSON invalide", async () => {
  const res = await handleCreatePayment(makeRequest({ body: "{ceci n'est pas du json" }), makeEnv());
  assert.equal(res.status, 400);
});

test("rejette un payload métier invalide (véhicule inconnu)", async () => {
  const res = await handleCreatePayment(makeRequest({ body: validPayload({ vehiculeId: "voiture-fantome" }) }), makeEnv());
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.ok(json.details.includes("Véhicule inconnu"));
});

test("rejette une tentative de paiement sans acceptation des CGL", async () => {
  const res = await handleCreatePayment(makeRequest({ body: validPayload({ cglAccepted: false }) }), makeEnv());
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.ok(json.details.some((e) => e.includes("accepter les conditions")));
});

test("ignore un montant/currency fourni par le client (jamais utilisé)", async () => {
  // Comme aucune clé Mollie n'est configurée dans cet environnement de
  // test, la requête s'arrête à la vérification mollie_not_configured —
  // ce qui suffit à prouver qu'elle a passé la validation métier et le
  // recalcul serveur du prix sans jamais lire amount/currency du payload.
  const res = await handleCreatePayment(
    makeRequest({ body: validPayload({ amount: 1, currency: "usd", description: "faux" }) }),
    makeEnv()
  );
  assert.equal(res.status, 503);
  const json = await res.json();
  assert.equal(json.code, "mollie_not_configured");
});

test("répond mollie_not_configured (503) quand MOLLIE_API_KEY est absente", async () => {
  const env = makeEnv();
  assert.equal(env.MOLLIE_API_KEY, undefined);
  const res = await handleCreatePayment(makeRequest({ body: validPayload() }), env);
  assert.equal(res.status, 503);
  const json = await res.json();
  assert.equal(json.code, "mollie_not_configured");
});

test("une nouvelle réservation Peugeot 2008 fige le dépôt catalogue à 750 €", async () => {
  const env = makeEnv({ MOLLIE_API_KEY: "test_dummy_for_unit_tests" });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    id: "tr_peugeot_2008",
    _links: { checkout: { href: "https://www.mollie.com/checkout/test" } }
  }), { status: 201, headers: { "Content-Type": "application/json" } });
  try {
    const res = await handleCreatePayment(makeRequest({ body: validPayload({ vehiculeId: "peugeot-2008-hybrid" }) }), env);
    assert.equal(res.status, 200);
    const body = await res.json();
    const stored = await getReservation(env, body.reservationId);
    assert.equal(stored.depotGarantie, 750);
    assert.equal(stored.cautionContractuelle, 750);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("destination connue : Cannes ignore 1 km falsifié, fige 28 km et facture 43 €", async () => {
  const env = makeEnv({ MOLLIE_API_KEY: "test_dummy_for_unit_tests" });
  const originalFetch = globalThis.fetch;
  let molliePayload;
  globalThis.fetch = async (_url, init) => {
    molliePayload = JSON.parse(init.body);
    return new Response(JSON.stringify({
      id: "tr_delivery_cannes",
      _links: { checkout: { href: "https://www.mollie.com/checkout/test" } }
    }), { status: 201, headers: { "Content-Type": "application/json" } });
  };
  try {
    const res = await handleCreatePayment(makeRequest({ body: validPayload({
      lieuPrise: "Livraison à l'adresse de votre choix",
      lieuRetour: "Livraison à l'adresse de votre choix",
      adressePrise: "Cannes",
      adresseRetour: "Cannes",
      deliveryDistanceKm: 1,
      options: []
    }) }), env);
    assert.equal(res.status, 200);
    const body = await res.json();
    const stored = await getReservation(env, body.reservationId);
    const delivery = stored.options.find((option) => option.id === "livraison-adresse");
    assert.equal(stored.deliveryDistanceKm, 28);
    assert.equal(stored.deliveryDistanceSource, "reference");
    assert.equal(stored.deliveryReferenceLabel, "Cannes");
    assert.equal(delivery.montant, 43);
    assert.equal(stored.pricingSnapshot.livraison.distanceKm, 28);
    assert.equal(stored.pricingSnapshot.livraison.amount, 43);
    assert.equal(molliePayload.amount.value, stored.total.toFixed(2));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("adresse personnalisée : le serveur conserve la distance validée et applique la nouvelle formule", async () => {
  const env = makeEnv({ MOLLIE_API_KEY: "test_dummy_for_unit_tests" });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    id: "tr_delivery_custom",
    _links: { checkout: { href: "https://www.mollie.com/checkout/test" } }
  }), { status: 201, headers: { "Content-Type": "application/json" } });
  try {
    const adresse = formatAdressePersonnalisee("12 avenue Jean Médecin", "06000", "Nice");
    const res = await handleCreatePayment(makeRequest({ body: validPayload({
      lieuPrise: "Livraison à l'adresse de votre choix",
      lieuRetour: "Livraison à l'adresse de votre choix",
      adressePrise: adresse,
      adresseRetour: adresse,
      lieuPriseType: "custom",
      lieuRetourType: "custom",
      deliveryDistanceKm: 6,
      options: []
    }) }), env);
    assert.equal(res.status, 200);
    const stored = await getReservation(env, (await res.json()).reservationId);
    const delivery = stored.options.find((option) => option.id === "livraison-adresse");
    assert.equal(stored.deliveryDistanceKm, 6);
    assert.equal(stored.deliveryDistanceSource, "manual");
    assert.equal(delivery.montant, 21);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("recalcule et fige plusieurs promotions côté serveur, sans faire confiance au client", async () => {
  const env = makeEnv({ MOLLIE_API_KEY: "test_dummy_for_unit_tests" });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    id: "tr_promos_multiples",
    _links: { checkout: { href: "https://www.mollie.com/checkout/test" } }
  }), { status: 201, headers: { "Content-Type": "application/json" } });
  try {
    const res = await handleCreatePayment(makeRequest({ body: validPayload({
      dateFin: futureDate(41),
      codesPromo: ["CORSA50", "GETLOC10", "BIENVENUE20"],
      total: 0,
      options: []
    }) }), env);
    assert.equal(res.status, 200);
    const body = await res.json();
    const stored = await getReservation(env, body.reservationId);
    assert.deepEqual(stored.codesPromo.map((promo) => promo.code), ["CORSA50", "GETLOC10", "BIENVENUE20"]);
    assert.equal(stored.locationNette, 475);
    assert.equal(stored.total, 475);
    assert.equal(stored.pricingSnapshot.montantLocationNet, 475);
    assert.equal(stored.reductionDuree, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("refuse côté serveur un code inconnu, un doublon et CORSA50 sur un autre véhicule", async () => {
  for (const body of [
    validPayload({ codesPromo: ["CODE-INCONNU"] }),
    validPayload({ codesPromo: ["GETLOC10", "getloc10"] }),
    validPayload({ vehiculeId: "peugeot-3008", codesPromo: ["CORSA50"] })
  ]) {
    const res = await handleCreatePayment(makeRequest({ body }), makeEnv());
    assert.equal(res.status, 400);
  }
});

test("détecte l'indisponibilité (409) sur un chevauchement de dates pour le même véhicule", async () => {
  const env = makeEnv({ MOLLIE_API_KEY: "test_dummy_for_unit_tests" });
  const vehiculeId = "peugeot-2008-hybrid";
  // createReservation force toujours le statut initial à "pending_payment" ;
  // une réservation "pending_payment" récente bloque déjà le véhicule
  // pendant la fenêtre de hold (cf. RESERVATION_HOLD_MS dans
  // reservation-store.js), ce qui suffit à reproduire un cas réel de
  // double demande simultanée sur le même véhicule.
  await createReservation(env, {
    vehiculeId,
    periodeDebut: futureDateTimeISO(60),
    periodeFin: futureDateTimeISO(65)
  });

  const res = await handleCreatePayment(
    makeRequest({
      body: validPayload({
        vehiculeId,
        dateDebut: futureDate(62),
        heureDebut: "10:00",
        dateFin: futureDate(63),
        heureFin: "10:00"
      })
    }),
    env
  );
  assert.equal(res.status, 409);
  const json = await res.json();
  assert.equal(json.code, "not_available");
});

test("rate limiting : bloque après plusieurs requêtes rapprochées depuis la même IP", async () => {
  const env = makeEnv();
  const ip = `203.0.113.${Math.floor(Math.random() * 250)}`;
  let last;
  for (let i = 0; i < 10; i++) {
    last = await handleCreatePayment(makeRequest({ body: validPayload(), headers: { "cf-connecting-ip": ip } }), env);
  }
  assert.equal(last.status, 429);
});
