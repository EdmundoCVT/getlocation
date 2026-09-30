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
  const opened = [];
  dom.window.open = (href) => opened.push(href);
  dom.window.eval(script);
  return { dom, opened, form: dom.window.document.getElementById("business-contact-form") };
}

test("contact Business : le type est prérempli depuis l'URL", () => {
  const { dom, form } = page("https://getlocation.fr/business/contact?type=corporate");
  assert.equal(form.elements.type.value, "corporate");
  dom.window.close();
});

test("contact Business : les champs obligatoires sont signalés", () => {
  const { dom, form, opened } = page("https://getlocation.fr/business/contact");
  form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  ["type", "name", "phone", "message"].forEach((name) => {
    assert.equal(form.elements[name].getAttribute("aria-invalid"), "true");
    assert.equal(dom.window.document.getElementById(`contact-${name}-error`).hidden, false);
  });
  assert.equal(opened.length, 0);
  dom.window.close();
});

test("contact Business : le formulaire ouvre WhatsApp avec la demande", () => {
  const { dom, form, opened } = page("https://getlocation.fr/business/contact?type=pro");
  form.elements.name.value = "Marie Martin";
  form.elements.company.value = "Martin Services";
  form.elements.phone.value = "0612345678";
  form.elements.email.value = "marie@example.com";
  form.elements.city.value = "Nice";
  form.elements.postcode.value = "06000";
  form.elements.message.value = "Un utilitaire pour lundi.";
  form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  assert.equal(opened.length, 1);
  assert.match(opened[0], /^https:\/\/wa\.me\/33667485430\?text=/);
  const message = decodeURIComponent(opened[0].split("?text=")[1]);
  assert.match(message, /Besoin professionnel spécifique/);
  assert.match(message, /Marie Martin/);
  assert.match(message, /Nice 06000/);
  assert.match(message, /Un utilitaire pour lundi\./);
  dom.window.close();
});
