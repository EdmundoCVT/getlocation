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
    "confirmation.html",
    "deposit.html",
    "js/data.js",
    "js/i18n.js",
    "js/deposit-ux.js",
    "js/app.js"
  ].map(read).join("\n");
  assert.doesNotMatch(sources, /franchise/i);
  assert.doesNotMatch(sources, /rédui(?:t|re|sent) (?:votre |sa |la )?participation financière/i);
  assert.doesNotMatch(sources, /responsabilité maximale|montant maximal à la charge|maximum liability|deductible waiver/i);
  assert.doesNotMatch(sources, /plafond des sommes|plafond de responsabilité|limitation de responsabilité|cap on the amounts|cap on the renter(?:'|’)?s liability/i);
  assert.match(sources, /Un dépôt de garantie est demandé avant la remise des clés\. Il peut être effectué sous forme de préautorisation bancaire et n’est pas inclus dans le prix de la location\./);
  assert.match(sources, /A security deposit is required before the vehicle is handed over\. It may be taken as a card pre-authorisation and is not included in the rental price\./);
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
  assert.match(fr, /Le dépôt de garantie est distinct du prix de la location/);
  assert.match(fr, /Son montant ne constitue pas une limitation de la responsabilité du locataire ni un plafond des sommes/);
  assert.match(fr, /des sommes complémentaires peuvent être réclamées/i);
  assert.match(en, /The security deposit is separate from the rental price/);
  assert.match(en, /Its amount does not limit the renter(?:'|’)?s liability or cap any amounts/);
  assert.match(en, /Additional amounts may be/);
  assert.match(en, /claimed where costs chargeable to the renter exceed the security deposit/);
  assert.doesNotMatch(en, /excess applicable|deductible waiver/i);
});

test("les montants et le snapshot historique du dépôt restent inchangés", () => {
  const { VEHICULES } = require("../js/data.js");
  const { resolveContractDeposit } = require("../src/lib/contract-deposit.js");
  assert.deepEqual(Object.fromEntries(VEHICULES.map((vehicle) => [vehicle.id, vehicle.caution])), {
    "opel-corsa": 650,
    "peugeot-2008-hybrid": 750,
    "peugeot-3008": 900,
    "toyota-proace-city": 1000
  });
  const signedHistoricalContract = {
    vehiculeId: "peugeot-2008-hybrid",
    cautionContractuelle: 650,
    contractVersion: { version: 1, status: "signed" },
    contractDossier: { status: "signed" }
  };
  const before = JSON.stringify(signedHistoricalContract);
  assert.equal(resolveContractDeposit(signedHistoricalContract), 650);
  assert.equal(JSON.stringify(signedHistoricalContract), before, "la lecture du snapshot signé reste pure");
});
