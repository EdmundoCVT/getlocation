const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "back-office.html"), "utf8");
const sources = ["js/pricing.js", "js/data.js", "js/agency-quote.js"].map((file) => fs.readFileSync(path.join(root, file), "utf8"));
const body = /<body>([\s\S]*)<\/body>/.exec(html)[1];
const inline = /<script>([\s\S]*?)<\/script>/.exec(html)[1];

function makeWindow() {
  const dom = new JSDOM(`<!doctype html><body>${body}</body>`, { url: "https://getlocation.fr/back-office.html", runScripts: "outside-only" });
  dom.window.__fetchCount = 0;
  dom.window.fetch = () => { dom.window.__fetchCount += 1; return Promise.reject(new Error("offline test")); };
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({ fillRect() {}, fillText() {} });
  dom.window.HTMLCanvasElement.prototype.toBlob = function (callback) { callback(new dom.window.Blob(["png"], { type: "image/png" })); };
  dom.window.URL.createObjectURL = () => "blob:test";
  dom.window.URL.revokeObjectURL = () => {};
  dom.window.HTMLAnchorElement.prototype.click = function () { dom.window.__downloadName = this.download; };
  sources.forEach((source) => dom.window.eval(source));
  dom.window.eval(inline);
  dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
  return dom.window;
}

test("durée, tarifs personnalisés, frais et remises sont calculés sans réservation", () => {
  const window = makeWindow();
  const doc = window.document;
  assert.equal(window.GETLOCATION_AGENCY_QUOTE.daysBetween("2026-10-01", "10:00", "2026-10-03", "10:00"), 2);
  doc.getElementById("q-vehicle").value = "custom";
  doc.getElementById("q-vehicle").dispatchEvent(new window.Event("change", { bubbles: true }));
  doc.getElementById("q-custom-name").value = "Véhicule test";
  doc.getElementById("q-start").value = "2026-10-01";
  doc.getElementById("q-end").value = "2026-10-03";
  doc.getElementById("q-daily").value = "100";
  doc.getElementById("q-delivery").value = "20";
  doc.getElementById("q-return-fee").value = "5";
  doc.getElementById("q-discount-type").value = "percent";
  doc.getElementById("q-discount").value = "10";
  doc.getElementById("q-add-extra").click();
  const extra = doc.querySelector(".quote-extra-row");
  extra.querySelector('input[type="text"]').value = "Siège enfant";
  extra.querySelector('input[type="number"]').value = "15";
  doc.getElementById("q-preview-btn").click();
  assert.equal(doc.getElementById("q-preview").hidden, false, doc.getElementById("q-error").textContent);
  assert.match(doc.getElementById("q-preview").textContent, /216,00/);
  assert.match(doc.getElementById("q-preview").textContent, /Dépôt de garantie/);
  const fetchCount = window.__fetchCount;
  doc.getElementById("q-png").click();
  assert.equal(window.__downloadName, "devis-getlocation.png");
  assert.equal(window.__fetchCount, fetchCount, "le devis ne crée pas de réservation ni d'appel au serveur");
  doc.getElementById("q-edit").click();
  assert.equal(doc.getElementById("q-custom-name").value, "Véhicule test", "modifier conserve les saisies");
  assert.equal(doc.getElementById("q-preview").hidden, true);
  assert.doesNotMatch(html, /convertir en réservation/i);
  assert.match(html, /@media \(max-width:820px\)[\s\S]*?\.quote-grid \{ grid-template-columns:1fr/);
  assert.match(html, /@media \(max-width:820px\)[\s\S]*?\.quote-extra-row/);
});

test("moteur tarifaire existant conserve les tarifs automatiques et frais de livraison", () => {
  const pricing = require("../js/pricing.js");
  const automatic = pricing.calculateQuote({ vehicleId: "opel-corsa", dateDebut: "2026-10-01", heureDebut: "10:00", dateFin: "2026-10-03", heureFin: "10:00" });
  assert.equal(automatic.days, 2);
  assert.equal(automatic.rentalSubtotal, 110);
  assert.equal(pricing.deliveryCost(10), 30);
  const totals = makeWindow().GETLOCATION_AGENCY_QUOTE.calculateTotals({ rentalSubtotal: 200, delivery: 20, returnFee: 5, extras: [{ amount: 15 }], discountType: "percent", discountValue: 10 });
  assert.deepEqual({ beforeDiscount: totals.beforeDiscount, discount: totals.discount, total: totals.total }, { beforeDiscount: 240, discount: 24, total: 216 });
  assert.equal(makeWindow().GETLOCATION_AGENCY_QUOTE.calculateTotals({ rentalSubtotal: 20, discountValue: 50 }).total, 0, "une remise ne rend jamais le total négatif");
});
