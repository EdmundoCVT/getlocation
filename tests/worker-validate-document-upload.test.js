const test = require("node:test");
const assert = require("node:assert/strict");
const { validateUploadedFile, validateDocumentSubmission } = require("../src/lib/validate-document-upload.js");

function jpeg(name = "preuve.jpg", type = "image/jpeg") {
  return new File([new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x01])], name, { type });
}
function baseForm() {
  const form = new FormData();
  form.set("birthDate", "1990-01-01");
  form.set("postalAddress", "12 rue des Tests, 06130 Grasse");
  form.set("permitNumber", "12AB34567");
  form.set("permitDate", "2015-06-01");
  form.set("permis-recto", jpeg("recto.jpg"));
  form.set("permis-verso", jpeg("verso.jpg"));
  form.set("identite", jpeg("identite.jpg"));
  return form;
}

test("accepte JPG/PNG/PDF d'après leur signature réelle", async () => {
  await assert.doesNotReject(validateUploadedFile(jpeg(), "identite"));
  const png = new File([new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])], "x.png", { type: "image/png" });
  const pdf = new File([new TextEncoder().encode("%PDF-1.7")], "x.pdf", { type: "application/pdf" });
  await assert.doesNotReject(validateUploadedFile(png, "identite"));
  await assert.doesNotReject(validateUploadedFile(pdf, "identite"));
});

test("rejette un MIME usurpé", async () => {
  const fake = new File([new TextEncoder().encode("pas une image")], "faux.jpg", { type: "image/jpeg" });
  await assert.rejects(validateUploadedFile(fake, "identite"), /Format invalide/);
  await assert.rejects(validateUploadedFile(jpeg("x.png", "image/png"), "identite"), /Format invalide/);
});

test("valide les champs et impose la date de naissance connue", async () => {
  const reservation = { conducteur: { naissance: "1990-01-01" }, options: [] };
  const result = await validateDocumentSubmission(baseForm(), reservation);
  assert.equal(result.data.permitNumber, "12AB34567");
  assert.equal(result.files.length, 3);
  const wrong = baseForm();
  wrong.set("birthDate", "1991-01-01");
  await assert.rejects(validateDocumentSubmission(wrong, reservation), /naissance incorrecte/);
});

test("impose les informations et trois pièces du second conducteur seulement si acheté", async () => {
  const reservation = { conducteur: { naissance: "1990-01-01" }, options: [{ id: "second-conducteur" }] };
  await assert.rejects(validateDocumentSubmission(baseForm(), reservation), /secondDriverFirstName/);
  const form = baseForm();
  form.set("secondDriverFirstName", "Alex"); form.set("secondDriverLastName", "Martin");
  form.set("secondDriverPermitNumber", "98ZZ7654"); form.set("secondDriverPermitDate", "2018-01-01");
  form.set("second-permis-recto", jpeg()); form.set("second-permis-verso", jpeg()); form.set("second-identite", jpeg());
  assert.equal((await validateDocumentSubmission(form, reservation)).files.length, 6);
});
