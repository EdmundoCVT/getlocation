// tests/deposit-authorizations.test.js
//
// src/lib/deposit-authorizations.js — empreinte bancaire Mollie (caution),
// distincte de src/lib/deposits.js (caution classique). Simule fetch()
// (comme tests/worker-mollie-client.test.js) et le D1 agence (comme
// tests/deposits.test.js) pour rester indépendant d'un vrai accès réseau
// Mollie, non disponible dans cet environnement (voir DEPLOIEMENT.md).
//
// Montant : TOUJOURS celui figé sur la location (rental.depositAmountCents,
// voir migrations/0006/src/lib/rentals.js) — createDepositAuthorization
// n'accepte plus aucun montant en paramètre (cahier des charges §6, voir
// commit "Cautions par véhicule + snapshot depositAmount"). Les tests qui
// ont besoin d'un montant précis créent donc leur location avec
// `depositAmount` explicite plutôt que de le passer à
// createDepositAuthorization.

const test = require("node:test");
const assert = require("node:assert/strict");

const { createFakeD1 } = require("./helpers/fake-d1.js");
const { createRental } = require("../src/lib/rentals.js");
const {
  deriveInternalStatus,
  createDepositAuthorization,
  captureDepositAuthorization,
  releaseDepositAuthorization,
  refreshDepositAuthorization,
  syncDepositAuthorizationFromWebhook,
  getActiveDepositAuthorization
} = require("../src/lib/deposit-authorizations.js");
const { MollieApiError } = require("../src/lib/mollie-client.js");

function makeEnv(apiKey = "test_dummy_key") {
  return { AGENCY_DB: createFakeD1(), MOLLIE_DEPOSIT_API_KEY: apiKey };
}

async function makeRental(env, overrides = {}) {
  return createRental(
    env,
    "cli_1",
    {
      vehiculeId: "opel-corsa",
      dateDebut: "2026-10-01",
      heureDebut: "10:00",
      dateFin: "2026-10-05",
      heureFin: "10:00",
      ...overrides
    },
    "Edmundo"
  );
}

// Consomme les réponses fournies dans l'ordre, une par appel fetch() —
// suffisant ici (jamais plus de deux appels Mollie séquentiels par action :
// capture puis relecture, ou annulation puis relecture).
function withQueuedFetch(responses, fn) {
  const original = globalThis.fetch;
  const calls = [];
  let i = 0;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    const r = responses[i++];
    if (!r) throw new Error("withQueuedFetch: plus de réponse simulée disponible");
    return new Response(JSON.stringify(r.body), { status: r.status || 200 });
  };
  return Promise.resolve(fn(calls)).finally(() => {
    globalThis.fetch = original;
  });
}

test("deriveInternalStatus : mappe chaque statut Mollie réel vers un statut interne", () => {
  assert.equal(deriveInternalStatus({ status: "open" }, null), "en_attente");
  assert.equal(deriveInternalStatus({ status: "pending" }, null), "en_attente");
  assert.equal(deriveInternalStatus({ status: "authorized" }, { capturedAmountCents: 0 }), "autorisee");
  assert.equal(
    deriveInternalStatus({ status: "authorized", amountCaptured: { currency: "EUR", value: "180.00" } }, { capturedAmountCents: 0 }),
    "capturee_partielle"
  );
  assert.equal(deriveInternalStatus({ status: "authorized" }, { capturedAmountCents: 18000 }), "capturee_partielle");
  assert.equal(deriveInternalStatus({ status: "paid" }, { capturedAmountCents: 50000 }), "capturee");
  assert.equal(deriveInternalStatus({ status: "canceled" }, { authorizedAt: "2026-09-16T10:00:00.000Z" }), "liberee");
  assert.equal(deriveInternalStatus({ status: "canceled" }, { authorizedAt: null }), "annulee");
  assert.equal(deriveInternalStatus({ status: "canceled" }, null), "annulee");
  assert.equal(deriveInternalStatus({ status: "expired" }, null), "expiree");
  assert.equal(deriveInternalStatus({ status: "failed" }, null), "echouee");
});

test("createDepositAuthorization : cas nominal, montant figé de la location (opel-corsa = 650 €)", async () => {
  const env = makeEnv();
  const rental = await makeRental(env);
  assert.equal(rental.depositAmountCents, 65000); // snapshot automatique à la création (VEHICULES[].caution)
  await withQueuedFetch(
    [{ status: 201, body: { id: "tr_test1", status: "open", mode: "test", _links: { checkout: { href: "https://www.mollie.com/checkout/tr_test1" } } } }],
    async (calls) => {
      const auth = await createDepositAuthorization(env, rental.id, "Edmundo", { origin: "https://getlocation.fr" });
      assert.match(auth.id, /^depauth_[a-f0-9]{32}$/);
      assert.equal(auth.authorizedAmountCents, 65000);
      assert.equal(auth.capturedAmountCents, 0);
      assert.equal(auth.status, "lien_cree");
      assert.equal(auth.mollieStatus, "open");
      assert.equal(auth.molliePaymentId, "tr_test1");
      assert.equal(auth.checkoutUrl, "https://www.mollie.com/checkout/tr_test1");
      assert.equal(auth.testMode, true);

      const body = JSON.parse(calls[0].init.body);
      assert.equal(body.method, "creditcard");
      assert.equal(body.captureMode, "manual");
      assert.equal(body.amount.value, "650.00");
      assert.equal(body.redirectUrl, "https://getlocation.fr/caution-mollie-retour.html");
      assert.equal(body.webhookUrl, "https://getlocation.fr/api/mollie-deposit-webhook");
      assert.equal(body.metadata.rentalId, rental.id);
      assert.equal(calls[0].init.headers.Authorization, "Bearer test_dummy_key");
    }
  );
});

test("createDepositAuthorization : utilise le dépôt de garantie figé sur la location, pas le tarif courant du véhicule", async () => {
  const env = makeEnv();
  // Location créée avec un montant explicite (ex. négocié par l'agence,
  // voir src/lib/rentals.js#resolveDepositAmountCents) : Mollie doit
  // utiliser CE montant, jamais recalculer depuis VEHICULES[].caution.
  const rental = await makeRental(env, { depositAmount: 1000 });
  assert.equal(rental.depositAmountCents, 100000);
  await withQueuedFetch(
    [{ status: 201, body: { id: "tr_test2", status: "open", mode: "test", _links: { checkout: { href: "https://www.mollie.com/checkout/tr_test2" } } } }],
    async (calls) => {
      const auth = await createDepositAuthorization(env, rental.id, "Edmundo", { origin: "https://getlocation.fr" });
      assert.equal(auth.authorizedAmountCents, 100000);
      assert.equal(JSON.parse(calls[0].init.body).amount.value, "1000.00");
    }
  );
});

test("createDepositAuthorization : ignore un dépôt de véhicule antérieur si la location a changé de véhicule (900 € pour le 3008)", async () => {
  const env = makeEnv();
  const rental = await makeRental(env, { vehiculeId: "peugeot-3008" });
  assert.equal(rental.depositAmountCents, 90000);
  await withQueuedFetch(
    [{ status: 201, body: { id: "tr_test2b", status: "open", mode: "test", _links: { checkout: { href: "https://x" } } } }],
    async (calls) => {
      const auth = await createDepositAuthorization(env, rental.id, "Edmundo", { origin: "https://getlocation.fr" });
      assert.equal(auth.authorizedAmountCents, 90000);
      assert.equal(JSON.parse(calls[0].init.body).amount.value, "900.00");
    }
  );
});

test("createDepositAuthorization : refuse une deuxième demande active pour la même location", async () => {
  const env = makeEnv();
  const rental = await makeRental(env);
  await withQueuedFetch(
    [{ status: 201, body: { id: "tr_test3", status: "open", mode: "test", _links: { checkout: { href: "https://x" } } } }],
    () => createDepositAuthorization(env, rental.id, "Edmundo", { origin: "https://getlocation.fr" })
  );
  await assert.rejects(
    createDepositAuthorization(env, rental.id, "Edmundo", { origin: "https://getlocation.fr" }),
    /déjà en cours/
  );
});

test("createDepositAuthorization : refuse si MOLLIE_DEPOSIT_API_KEY absente", async () => {
  const env = makeEnv(undefined);
  delete env.MOLLIE_DEPOSIT_API_KEY;
  const rental = await makeRental(env);
  await assert.rejects(createDepositAuthorization(env, rental.id, "Edmundo", { origin: "https://getlocation.fr" }), /MOLLIE_DEPOSIT_API_KEY/);
});

test("createDepositAuthorization : refuse une location introuvable", async () => {
  const env = makeEnv();
  await assert.rejects(createDepositAuthorization(env, "rnt_inexistant", "Edmundo", { origin: "https://getlocation.fr" }), /introuvable/);
});

test("createDepositAuthorization : Mollie refuse la création -> statut echouee, erreur Mollie propagée telle quelle", async () => {
  const env = makeEnv();
  const rental = await makeRental(env);
  await withQueuedFetch(
    [{ status: 422, body: { status: 422, title: "Unprocessable Entity", detail: "This payment method does not support manual capture" } }],
    async () => {
      await assert.rejects(
        createDepositAuthorization(env, rental.id, "Edmundo", { origin: "https://getlocation.fr" }),
        (err) => {
          assert.ok(err instanceof MollieApiError);
          assert.equal(err.statusCode, 422);
          assert.equal(err.message, "This payment method does not support manual capture");
          return true;
        }
      );
      const active = await getActiveDepositAuthorization(env, rental.id);
      assert.equal(active, null); // "echouee" est un statut terminal, plus "active"
    }
  );
});

// `rental` doit déjà porter le depositAmountCents voulu (via makeRental(env,
// { depositAmount }) si besoin d'un montant précis) : createDepositAuthorization
// ne fait plus que le lire, jamais un montant passé ici.
async function createAuthorized(env, rental, { molliePaymentId = "tr_auth1" } = {}) {
  const created = await withQueuedFetch(
    [{ status: 201, body: { id: molliePaymentId, status: "open", mode: "test", _links: { checkout: { href: "https://x" } } } }],
    () => createDepositAuthorization(env, rental.id, "Edmundo", { origin: "https://getlocation.fr" })
  );
  return withQueuedFetch(
    [{ status: 200, body: { id: molliePaymentId, status: "authorized", mode: "test" } }],
    () => syncDepositAuthorizationFromWebhook(env, { id: molliePaymentId, status: "authorized", mode: "test" })
  ).then(() => created);
}

test("captureDepositAuthorization : capture partielle -> statut capturee_partielle, solde recalculé", async () => {
  const env = makeEnv();
  const rental = await makeRental(env);
  const created = await createAuthorized(env, rental);

  await withQueuedFetch(
    [
      { status: 200, body: { id: created.molliePaymentId, status: "authorized", mode: "test" } },
      { status: 201, body: { id: "cpt_1", status: "pending" } },
      { status: 200, body: { id: created.molliePaymentId, status: "paid", mode: "test", amountCaptured: { currency: "EUR", value: "180.00" } } }
    ],
    async (calls) => {
      const updated = await captureDepositAuthorization(env, created.id, 180, "Antonio");
      assert.equal(updated.status, "capturee_partielle");
      assert.equal(updated.capturedAmountCents, 18000);
      assert.equal(JSON.parse(calls[1].init.body).amount.value, "180.00");
      assert.match(calls[1].url, /\/captures$/);
    }
  );
});

test("captureDepositAuthorization : refuse un montant dépassant le solde restant", async () => {
  const env = makeEnv();
  const rental = await makeRental(env, { depositAmount: 500 });
  const created = await createAuthorized(env, rental);
  await assert.rejects(captureDepositAuthorization(env, created.id, 600, "Antonio"), /dépasse le montant restant/);
});

test("captureDepositAuthorization : refuse un statut non débitable (lien_cree)", async () => {
  const env = makeEnv();
  const rental = await makeRental(env);
  const created = await withQueuedFetch(
    [{ status: 201, body: { id: "tr_x", status: "open", mode: "test", _links: { checkout: { href: "https://x" } } } }],
    () => createDepositAuthorization(env, rental.id, "Edmundo", { origin: "https://getlocation.fr" })
  );
  await assert.rejects(captureDepositAuthorization(env, created.id, 100, "Antonio"), /ne peut pas être débitée/);
});

test("captureDepositAuthorization : capture intégrale -> statut capturee", async () => {
  const env = makeEnv();
  const rental = await makeRental(env, { depositAmount: 500 });
  const created = await createAuthorized(env, rental);
  await withQueuedFetch(
    [
      { status: 200, body: { id: created.molliePaymentId, status: "authorized", mode: "test" } },
      { status: 201, body: { id: "cpt_full", status: "pending" } },
      { status: 200, body: { id: created.molliePaymentId, status: "paid", mode: "test", amountCaptured: { currency: "EUR", value: "500.00" } } }
    ],
    async () => {
      const updated = await captureDepositAuthorization(env, created.id, 500, "Antonio");
      assert.equal(updated.status, "capturee");
      assert.equal(updated.capturedAmountCents, 50000);
      assert.ok(updated.capturedAt);
    }
  );
});

test("releaseDepositAuthorization : libère une caution autorisée non débitée", async () => {
  const env = makeEnv();
  const rental = await makeRental(env);
  const created = await createAuthorized(env, rental);
  await withQueuedFetch(
    [
      { status: 200, body: { id: created.molliePaymentId, status: "authorized", mode: "test" } },
      { status: 204, body: undefined },
      { status: 200, body: { id: created.molliePaymentId, status: "canceled", mode: "test" } }
    ],
    async (calls) => {
      const updated = await releaseDepositAuthorization(env, created.id, "Edmundo");
      assert.equal(updated.status, "liberee");
      assert.ok(updated.releasedAt);
      assert.equal(calls[1].init.method, "POST");
      assert.match(calls[1].url, /release-authorization$/);
    }
  );
});

test("releaseDepositAuthorization : refuse si déjà partiellement capturée", async () => {
  const env = makeEnv();
  const rental = await makeRental(env);
  const created = await createAuthorized(env, rental);
  await withQueuedFetch(
    [
      { status: 200, body: { id: created.molliePaymentId, status: "authorized", mode: "test" } },
      { status: 201, body: { id: "cpt_2", status: "pending" } },
      { status: 200, body: { id: created.molliePaymentId, status: "paid", mode: "test", amountCaptured: { currency: "EUR", value: "180.00" } } }
    ],
    () => captureDepositAuthorization(env, created.id, 100, "Antonio")
  );
  await assert.rejects(releaseDepositAuthorization(env, created.id, "Edmundo"), /intégralement autorisée/);
});

test("refreshDepositAuthorization : re-synchronise depuis Mollie (open -> authorized)", async () => {
  const env = makeEnv();
  const rental = await makeRental(env);
  const created = await withQueuedFetch(
    [{ status: 201, body: { id: "tr_refresh", status: "open", mode: "test", _links: { checkout: { href: "https://x" } } } }],
    () => createDepositAuthorization(env, rental.id, "Edmundo", { origin: "https://getlocation.fr" })
  );
  assert.equal(created.status, "lien_cree");
  await withQueuedFetch(
    [{ status: 200, body: { id: "tr_refresh", status: "authorized", mode: "test" } }],
    async () => {
      const refreshed = await refreshDepositAuthorization(env, created.id, "Edmundo");
      assert.equal(refreshed.status, "autorisee");
      assert.ok(refreshed.authorizedAt);
    }
  );
});

test("syncDepositAuthorizationFromWebhook : paiement Mollie inconnu -> null, sans effet", async () => {
  const env = makeEnv();
  const result = await syncDepositAuthorizationFromWebhook(env, { id: "tr_inconnu", status: "authorized" });
  assert.equal(result, null);
});

test("getActiveDepositAuthorization : ignore les tentatives terminales, une nouvelle demande reste possible ensuite", async () => {
  const env = makeEnv();
  const rental = await makeRental(env);
  const created = await createAuthorized(env, rental);
  await withQueuedFetch(
    [
      { status: 200, body: { id: created.molliePaymentId, status: "authorized", mode: "test" } },
      { status: 204, body: undefined },
      { status: 200, body: { id: created.molliePaymentId, status: "canceled", mode: "test" } }
    ],
    () => releaseDepositAuthorization(env, created.id, "Edmundo")
  );
  assert.equal(await getActiveDepositAuthorization(env, rental.id), null);

  const second = await withQueuedFetch(
    [{ status: 201, body: { id: "tr_second", status: "open", mode: "test", _links: { checkout: { href: "https://x" } } } }],
    () => createDepositAuthorization(env, rental.id, "Edmundo", { origin: "https://getlocation.fr" })
  );
  assert.equal((await getActiveDepositAuthorization(env, rental.id)).id, second.id);
});
