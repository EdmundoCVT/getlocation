const test = require("node:test");
const assert = require("node:assert/strict");
const { createFakeKv } = require("./helpers/fake-kv.js");
const { handleBusinessContact } = require("../src/api/business-contact.js");

const valid = {
  type: "corporate", name: "Marie Martin", company: "Martin Services", phone: "+33 6 12 34 56 78",
  email: "marie@example.com", city: "Nice", postcode: "06000", preference: "Appel",
  message: "Un SUV pour un déplacement client.", source: "https://getlocation.fr/business/contact?type=corporate"
};
const request = (data, origin = "https://getlocation.fr") => new Request("https://getlocation.fr/api/business-contact", {
  method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(data)
});

test("contact Business : envoie un email structuré au destinataire Business", async () => {
  const previousFetch = global.fetch;
  const emails = [];
  global.fetch = async (_url, options) => {
    emails.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ id: "email_test" }), { status: 200 });
  };
  try {
    const response = await handleBusinessContact(request(valid), {
      RATE_LIMITS_KV: createFakeKv(), RESEND_API_KEY: "re_test", AGENCY_EMAIL: "agency@example.com",
      BUSINESS_CONTACT_EMAIL: "business@example.com"
    });
    assert.equal(response.status, 201);
    assert.equal(emails.length, 1);
    assert.equal(emails[0].to[0], "business@example.com");
    assert.equal(emails[0].subject, "Nouvelle demande Business GetLocation");
    assert.match(emails[0].text, /Véhicule pour collaborateur \/ entreprise/);
    assert.match(emails[0].text, /Marie Martin/);
    assert.match(emails[0].text, /2026-/);
  } finally { global.fetch = previousFetch; }
});

test("contact Business : refuse les données invalides et les origines tierces", async () => {
  const env = { RATE_LIMITS_KV: createFakeKv(), RESEND_API_KEY: "re_test", AGENCY_EMAIL: "agency@example.com" };
  assert.equal((await handleBusinessContact(request({ ...valid, email: "not-an-email" }), env)).status, 400);
  assert.equal((await handleBusinessContact(request(valid, "https://other.example"), env)).status, 403);
});

test("contact Business : indique une indisponibilité si les secrets email manquent", async () => {
  const response = await handleBusinessContact(request(valid), { RATE_LIMITS_KV: createFakeKv() });
  assert.equal(response.status, 503);
});
