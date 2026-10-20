const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function article4Text() {
  const dom = new JSDOM(read("cgl.html"));
  const article = [...dom.window.document.querySelectorAll(".section .card")]
    .find((card) => /^4\./.test(card.querySelector("h2")?.textContent.trim() || ""));
  assert.ok(article);
  const text = article.textContent.replace(/\s+/g, " ").trim();
  dom.window.close();
  return text;
}

test("présentation client courante : aucune ancienne notion de plafond commercial", () => {
  const sources = [
    "reservation.html",
    "index.html",
    "paiement.html",
    "js/data.js",
    "js/i18n.js",
    "js/deposit-ux.js",
    "contrat.html",
    "js/contrat-en.js"
  ].map(read).join("\n");
  assert.doesNotMatch(sources, /franchise/i);
  assert.doesNotMatch(sources, /rédui(?:t|re|sent) (?:votre |sa |la )?participation financière/i);
  assert.doesNotMatch(sources, /responsabilité maximale|montant maximal à la charge|maximum liability|deductible waiver/i);
});

test("CGL article 4 : le dépôt est une garantie financière sans plafond", () => {
  const text = article4Text();
  assert.match(text, /Le dépôt de garantie constitue une garantie financière/);
  assert.match(text, /Il ne constitue pas un plafond de responsabilité du locataire/);
  assert.match(text, /GETLOCATION peut réclamer le complément/);
  assert.match(text, /ni une assurance tous risques, ni une garantie d'absence de frais/);
});

test("mentions FR et EN : même portée juridique autour du dépôt", () => {
  const fr = read("contrat.html");
  const en = read("js/contrat-en.js");
  assert.match(fr, /Le dépôt de garantie est une garantie financière et ne constitue pas un plafond de responsabilité/);
  assert.match(fr, /Des sommes complémentaires peuvent être réclamées/);
  assert.match(en, /The security deposit is a financial guarantee and does not constitute a cap on the renter's liability/);
  assert.match(en, /Additional amounts may be claimed where costs chargeable to the renter exceed the security deposit/);
  assert.doesNotMatch(en, /excess applicable|deductible waiver/i);
});
