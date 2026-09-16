// tests/worker-mollie-client.test.js
//
// src/lib/mollie-client.js remplace le SDK @mollie/api-client par des
// appels fetch() directs contre l'API REST Mollie (voir ce fichier pour le
// détail) : c'est du code neuf (pas un simple portage de l'ancienne version
// Netlify), donc testé ici directement en simulant fetch() — plutôt que de
// se contenter d'une couverture indirecte via create-payment.js, qui
// s'arrête toujours avant d'atteindre ce module dans les tests existants
// (aucune clé Mollie réelle disponible dans cet environnement).

const test = require("node:test");
const assert = require("node:assert/strict");

const { createPayment, getPayment, cancelPayment, createCapture, listCaptures, MollieApiError } = require("../src/lib/mollie-client.js");

function withFakeFetch(handler, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return Promise.resolve(fn()).finally(() => {
    globalThis.fetch = original;
  });
}

test("createPayment : POST vers /v2/payments avec Authorization Bearer, sans Idempotency-Key si absente", async () => {
  let capturedUrl, capturedInit;
  await withFakeFetch(
    async (url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return new Response(JSON.stringify({ id: "tr_test123", status: "open" }), { status: 201 });
    },
    async () => {
      const result = await createPayment("test_dummy_key", { amount: { currency: "EUR", value: "10.00" } });
      assert.equal(result.id, "tr_test123");
      assert.equal(capturedUrl, "https://api.mollie.com/v2/payments");
      assert.equal(capturedInit.method, "POST");
      assert.equal(capturedInit.headers.Authorization, "Bearer test_dummy_key");
      assert.equal(capturedInit.headers["Content-Type"], "application/json");
      assert.equal(capturedInit.headers["Idempotency-Key"], undefined);
      assert.deepEqual(JSON.parse(capturedInit.body), { amount: { currency: "EUR", value: "10.00" } });
    }
  );
});

test("createPayment : transmet Idempotency-Key quand fournie", async () => {
  let capturedInit;
  await withFakeFetch(
    async (url, init) => {
      capturedInit = init;
      return new Response(JSON.stringify({ id: "tr_test456" }), { status: 201 });
    },
    async () => {
      await createPayment("test_dummy_key", { amount: { currency: "EUR", value: "10.00" } }, "idem-key-abc123");
      assert.equal(capturedInit.headers["Idempotency-Key"], "idem-key-abc123");
    }
  );
});

test("createPayment : une réponse non-ok lève MollieApiError avec le statusCode et le detail Mollie", async () => {
  await withFakeFetch(
    async () => new Response(JSON.stringify({ status: 422, title: "Unprocessable Entity", detail: "montant invalide" }), { status: 422 }),
    async () => {
      await assert.rejects(
        createPayment("test_dummy_key", { amount: { currency: "EUR", value: "0.00" } }),
        (err) => {
          assert.ok(err instanceof MollieApiError);
          assert.equal(err.statusCode, 422);
          assert.equal(err.message, "montant invalide");
          return true;
        }
      );
    }
  );
});

test("createPayment : une réponse non-ok sans JSON parsable ne fait pas planter le traitement de l'erreur", async () => {
  await withFakeFetch(
    async () => new Response("<html>502 Bad Gateway</html>", { status: 502 }),
    async () => {
      await assert.rejects(
        createPayment("test_dummy_key", { amount: { currency: "EUR", value: "10.00" } }),
        (err) => {
          assert.ok(err instanceof MollieApiError);
          assert.equal(err.statusCode, 502);
          assert.match(err.message, /502/);
          return true;
        }
      );
    }
  );
});

test("getPayment : GET vers /v2/payments/:id, id encodé dans l'URL", async () => {
  let capturedUrl, capturedInit;
  await withFakeFetch(
    async (url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return new Response(JSON.stringify({ id: "tr_with space", status: "paid" }), { status: 200 });
    },
    async () => {
      const result = await getPayment("test_dummy_key", "tr_with space");
      assert.equal(result.status, "paid");
      assert.equal(capturedUrl, "https://api.mollie.com/v2/payments/tr_with%20space");
      assert.equal(capturedInit.headers.Authorization, "Bearer test_dummy_key");
      assert.equal(capturedInit.method, "GET");
      assert.equal(capturedInit.body, undefined);
    }
  );
});

test("getPayment : id inconnu (404 Mollie) lève MollieApiError avec statusCode 404", async () => {
  await withFakeFetch(
    async () => new Response(JSON.stringify({ status: 404, detail: "No payment exists with token tr_inexistant" }), { status: 404 }),
    async () => {
      await assert.rejects(getPayment("test_dummy_key", "tr_inexistant"), (err) => {
        assert.ok(err instanceof MollieApiError);
        assert.equal(err.statusCode, 404);
        return true;
      });
    }
  );
});

test("cancelPayment : DELETE vers /v2/payments/:id, gère une réponse 204 sans corps", async () => {
  let capturedUrl, capturedInit;
  await withFakeFetch(
    async (url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return new Response(null, { status: 204 });
    },
    async () => {
      const result = await cancelPayment("test_dummy_key", "tr_test123");
      assert.equal(result, null);
      assert.equal(capturedUrl, "https://api.mollie.com/v2/payments/tr_test123");
      assert.equal(capturedInit.method, "DELETE");
      assert.equal(capturedInit.headers.Authorization, "Bearer test_dummy_key");
      assert.equal(capturedInit.headers["Content-Type"], undefined);
      assert.equal(capturedInit.body, undefined);
    }
  );
});

test("cancelPayment : une réponse d'erreur Mollie (ex. déjà capturé) lève MollieApiError", async () => {
  await withFakeFetch(
    async () => new Response(JSON.stringify({ status: 422, detail: "This payment cannot be canceled" }), { status: 422 }),
    async () => {
      await assert.rejects(cancelPayment("test_dummy_key", "tr_test123"), (err) => {
        assert.ok(err instanceof MollieApiError);
        assert.equal(err.statusCode, 422);
        assert.equal(err.message, "This payment cannot be canceled");
        return true;
      });
    }
  );
});

test("createCapture : POST vers /v2/payments/:id/captures avec le montant et l'Idempotency-Key", async () => {
  let capturedUrl, capturedInit;
  await withFakeFetch(
    async (url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return new Response(JSON.stringify({ id: "cpt_test123", status: "pending" }), { status: 201 });
    },
    async () => {
      const result = await createCapture(
        "test_dummy_key",
        "tr_test123",
        { amount: { currency: "EUR", value: "180.00" } },
        "idem-capture-1"
      );
      assert.equal(result.id, "cpt_test123");
      assert.equal(capturedUrl, "https://api.mollie.com/v2/payments/tr_test123/captures");
      assert.equal(capturedInit.method, "POST");
      assert.equal(capturedInit.headers["Idempotency-Key"], "idem-capture-1");
      assert.deepEqual(JSON.parse(capturedInit.body), { amount: { currency: "EUR", value: "180.00" } });
    }
  );
});

test("createCapture : un montant refusé par Mollie (dépasse le montant autorisé) lève MollieApiError", async () => {
  await withFakeFetch(
    async () => new Response(JSON.stringify({ status: 422, detail: "amount exceeds the authorized amount" }), { status: 422 }),
    async () => {
      await assert.rejects(
        createCapture("test_dummy_key", "tr_test123", { amount: { currency: "EUR", value: "999.00" } }),
        (err) => {
          assert.ok(err instanceof MollieApiError);
          assert.equal(err.statusCode, 422);
          return true;
        }
      );
    }
  );
});

test("listCaptures : GET vers /v2/payments/:id/captures", async () => {
  let capturedUrl, capturedInit;
  await withFakeFetch(
    async (url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return new Response(JSON.stringify({ _embedded: { captures: [{ id: "cpt_test123", status: "succeeded" }] } }), { status: 200 });
    },
    async () => {
      const result = await listCaptures("test_dummy_key", "tr_test123");
      assert.equal(result._embedded.captures[0].status, "succeeded");
      assert.equal(capturedUrl, "https://api.mollie.com/v2/payments/tr_test123/captures");
      assert.equal(capturedInit.method, "GET");
    }
  );
});
