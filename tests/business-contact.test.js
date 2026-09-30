const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "business", "contact.html"), "utf8");
const script = fs.readFileSync(path.join(root, "js", "business-contact.js"), "utf8");

function page(url) {
  const dom = new JSDOM(html, { url, runScripts: "outside-only" });
  const requests = [];
  dom.window.fetch = async (url, options) => {
    requests.push({ url, options });
    return new Response(JSON.stringify({ status: "received" }), { status: 201 });
  };
  dom.window.eval(script);
  return { dom, requests, form: dom.window.document.getElementById("business-contact-form") };
}

test("contact Business : le type est prérempli depuis l'URL", () => {
  const { dom, form } = page("https://getlocation.fr/business/contact?type=corporate");
  assert.equal(form.elements.type.value, "corporate");
  dom.window.close();
});

test("contact Business : les champs obligatoires sont signalés", () => {
  const { dom, form, requests } = page("https://getlocation.fr/business/contact");
  form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  ["type", "name", "phone", "message"].forEach((name) => {
    assert.equal(form.elements[name].getAttribute("aria-invalid"), "true");
    assert.equal(dom.window.document.getElementById(`contact-${name}-error`).hidden, false);
  });
  assert.equal(requests.length, 0);
  dom.window.close();
});

test("contact Business : le formulaire envoie la demande et confirme le succès", async () => {
  const { dom, form, requests } = page("https://getlocation.fr/business/contact?type=pro");
  form.elements.name.value = "Marie Martin";
  form.elements.company.value = "Martin Services";
  form.elements.phone.value = "0612345678";
  form.elements.email.value = "marie@example.com";
  form.elements.city.value = "Nice";
  form.elements.postcode.value = "06000";
  form.elements.message.value = "Un utilitaire pour lundi.";
  form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "/api/business-contact");
  const payload = JSON.parse(requests[0].options.body);
  assert.equal(payload.type, "pro");
  assert.equal(payload.name, "Marie Martin");
  assert.equal(payload.city, "Nice");
  assert.equal(payload.source, "https://getlocation.fr/business/contact?type=pro");
  assert.equal(dom.window.document.querySelector(".business-contact-success").hidden, false);
  dom.window.close();
});

test("contact Business : une erreur d'API conserve les champs et affiche le repli", async () => {
  const { dom, form } = page("https://getlocation.fr/business/contact?type=garage");
  dom.window.fetch = async () => new Response("", { status: 503 });
  form.elements.name.value = "Marie Martin";
  form.elements.phone.value = "0612345678";
  form.elements.message.value = "Besoin d'un véhicule.";
  form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(form.elements.message.value, "Besoin d'un véhicule.");
  assert.equal(dom.window.document.querySelector(".business-contact-failure").hidden, false);
  dom.window.close();
});
