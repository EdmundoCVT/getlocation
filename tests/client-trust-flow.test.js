const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const root = path.join(__dirname, "..");
const depositScript = fs.readFileSync(path.join(root, "js", "deposit-page.js"), "utf8");

function documentFor(file) {
  return new JSDOM(fs.readFileSync(path.join(root, file), "utf8")).window.document;
}

test("paiement : lieu, prix, dépôt et récupération sont visibles avant Mollie", () => {
  const document = documentFor("paiement.html");
  assert.match(document.querySelector("h1").textContent, /Paiement, livraison et récapitulatif/);
  assert.ok(document.getElementById("payment-delivery-distance"));
  assert.equal(document.getElementById("payment-delivery-price").getAttribute("role"), "status");
  assert.equal(document.querySelector("details.payment-summary-card").open, true);
  assert.equal(document.getElementById("payment-errors").getAttribute("role"), "alert");
  assert.match(document.body.textContent, /n’est pas incluse dans le montant payé aujourd’hui/);
});

test("confirmation : aucun succès n'est annoncé avant la réponse serveur", () => {
  const document = documentFor("confirmation.html");
  assert.match(document.getElementById("confirmation-title").textContent, /Vérification/);
  assert.equal(document.getElementById("confirmation-reference").hidden, true);
  assert.equal(document.getElementById("confirmation-next").hidden, true);
  assert.equal(document.getElementById("confirmation-contact").hidden, true);
  assert.ok(document.querySelectorAll(".confirmation-timeline li").length >= 5);
});

test("dépôt : un lien valide affiche le contexte, le montant figé et la préautorisation", async () => {
  const html = fs.readFileSync(path.join(root, "deposit.html"), "utf8");
  const dom = new JSDOM(html, { url: "https://getlocation.fr/deposit.html?token=secure-token", runScripts: "outside-only" });
  dom.window.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      status: "open",
      checkoutUrl: "https://www.mollie.com/checkout/deposit",
      amountCents: 65000,
      reference: "GL-20261110-001",
      vehicle: { name: "Peugeot 2008 Hybrid" },
      rental: { startDate: "2026-11-10", endDate: "2026-11-13" },
      authorizationExpiresAt: "2026-11-20T10:00:00Z"
    })
  });
  dom.window.eval(depositScript);
  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

  const { document } = dom.window;
  assert.equal(document.getElementById("depositDetails").hidden, false);
  assert.equal(document.getElementById("depositVehicle").textContent, "Peugeot 2008 Hybrid");
  assert.match(document.getElementById("depositAmount").textContent, /650/);
  assert.equal(document.getElementById("checkoutButton").href, "https://www.mollie.com/checkout/deposit");
  assert.match(document.body.textContent, /n’est pas débité immédiatement/);
  assert.match(document.body.textContent, /ne constitue pas un plafond/);
  dom.window.close();
});

test("dépôt : un lien invalide propose une récupération sans prétendre à un débit", async () => {
  const html = fs.readFileSync(path.join(root, "deposit.html"), "utf8");
  const dom = new JSDOM(html, { url: "https://getlocation.fr/deposit.html", runScripts: "outside-only" });
  let fetched = false;
  dom.window.fetch = async () => { fetched = true; };
  dom.window.eval(depositScript);
  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

  const { document } = dom.window;
  assert.equal(fetched, false);
  assert.equal(document.getElementById("depositRecovery").hidden, false);
  assert.match(document.getElementById("depositRecoveryText").textContent, /invalide/);
  dom.window.close();
});
