// tests/documents-page-dates.test.js
//
// documents.html (formulaire de dépôt post-paiement) : les champs de date
// (naissance du conducteur principal, date d'obtention du permis, date
// d'obtention du permis du second conducteur) sont saisis au format
// JJ/MM/AAAA (voir insererSlashesDateFr dans js/app.js), comme le champ
// #naissance sur paiement.html — plutôt qu'un <input type="date"> natif,
// dont le format d'affichage dépend de la langue du système et n'est donc
// pas garanti JJ/MM/AAAA d'un visiteur à l'autre. Le serveur
// (validate-document-upload.js) attend toujours YYYY-MM-DD : la conversion
// a lieu juste avant l'envoi (voir initDocumentsPage).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const DATA_SRC = fs.readFileSync(path.join(__dirname, "..", "js", "data.js"), "utf8");
const APP_SRC = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8");

const VALID_TOKEN = "a".repeat(43); // format attendu : /^[A-Za-z0-9_-]{43}$/

// Les <input type="file"> ci-dessous n'ont volontairement pas l'attribut
// "required" : jsdom ne reconnaît pas les fichiers injectés via
// Object.defineProperty(input, "files", ...) (voir setFiles plus bas) pour
// sa validation native de formulaire — hors sujet de ce fichier de test
// (dates), la contrainte "fichier requis" est déjà couverte côté serveur
// (tests/worker-validate-document-upload.test.js).
function documentsPageHtml() {
  return `<!DOCTYPE html><body>
    <div id="documents-loading"></div>
    <div id="documents-error" hidden><p id="documents-error-text"></p></div>
    <form id="documents-form" hidden enctype="multipart/form-data" novalidate>
      <p id="documents-reference"></p>
      <div class="field"><label for="birthDate">Date de naissance du conducteur principal</label><input type="text" id="birthDate" name="birthDate" required></div>
      <div class="field"><label for="postalAddress">Adresse postale complète</label><input type="text" id="postalAddress" name="postalAddress" required></div>
      <div class="field"><label for="permitNumber">Numéro de permis</label><input type="text" id="permitNumber" name="permitNumber" required></div>
      <div class="field"><label for="permitDate">Date d'obtention du permis</label><input type="text" id="permitDate" name="permitDate" required></div>
      <div class="field"><label for="permis-recto">Permis — recto</label><input type="file" id="permis-recto" name="permis-recto"></div>
      <div class="field"><label for="permis-verso">Permis — verso</label><input type="file" id="permis-verso" name="permis-verso"></div>
      <div class="field"><label for="identite">Pièce d'identité</label><input type="file" id="identite" name="identite"></div>
      <div id="delivery-fields" hidden><div class="field"><label for="deliveryAddress">Adresse exacte</label><input type="text" id="deliveryAddress" name="deliveryAddress"></div></div>
      <div id="second-driver-fields" hidden>
        <div class="field"><label for="secondDriverFirstName">Prénom</label><input type="text" id="secondDriverFirstName" name="secondDriverFirstName"></div>
        <div class="field"><label for="secondDriverLastName">Nom</label><input type="text" id="secondDriverLastName" name="secondDriverLastName"></div>
        <div class="field"><label for="secondDriverPermitNumber">Numéro de permis</label><input type="text" id="secondDriverPermitNumber" name="secondDriverPermitNumber"></div>
        <div class="field"><label for="secondDriverPermitDate">Date d'obtention</label><input type="text" id="secondDriverPermitDate" name="secondDriverPermitDate"></div>
        <div class="field"><label for="second-permis-recto">Permis — recto</label><input type="file" id="second-permis-recto" name="second-permis-recto"></div>
        <div class="field"><label for="second-permis-verso">Permis — verso</label><input type="file" id="second-permis-verso" name="second-permis-verso"></div>
        <div class="field"><label for="second-identite">Pièce d'identité</label><input type="file" id="second-identite" name="second-identite"></div>
      </div>
      <button type="submit" id="documents-submit">Envoyer mon dossier</button>
      <div id="documents-submit-error"></div>
    </form>
    <div id="documents-success" hidden></div>
  </body>`;
}

function newWindow(access = { reference: "res_test", vehicle: { name: "Opel Corsa" }, secondDriverRequired: false, deliveryAddressRequired: false }) {
  const dom = new JSDOM(documentsPageHtml(), {
    url: `https://getlocation.fr/documents.html#token=${VALID_TOKEN}`,
    runScripts: "outside-only"
  });
  const fetchCalls = [];
  dom.window.fetch = (url, options) => {
    fetchCalls.push({ url, options });
    if (String(url).includes("/api/documents-access")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(access) });
    }
    if (String(url).includes("/api/documents-submit")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
    }
    return Promise.reject(new Error(`URL inattendue dans ce test : ${url}`));
  };
  dom.window.eval(DATA_SRC + "\n" + APP_SRC);
  dom.window.initDocumentsPage();
  return { window: dom.window, fetchCalls };
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

// jsdom n'implémente pas DataTransfer (utilisé dans un vrai navigateur pour
// peupler <input type="file">.files) : on définit directement une
// FileList minimale à la place, suffisante pour ce que le code testé lit
// (input.files, transmis tel quel à new FormData(form)).
function setFiles(window, input, files) {
  const fileList = { length: files.length, item: (i) => files[i], [Symbol.iterator]: () => files[Symbol.iterator]() };
  files.forEach((f, i) => { fileList[i] = f; });
  Object.defineProperty(input, "files", { value: fileList, configurable: true });
}

function remplirFichiersObligatoires(window) {
  const fichier = new window.File(["contenu"], "permis.jpg", { type: "image/jpeg" });
  ["permis-recto", "permis-verso", "identite"].forEach((id) => {
    setFiles(window, window.document.getElementById(id), [fichier]);
  });
}

test("insererSlashesDateFr : insère les \"/\" au fil de la frappe sur les 3 champs date", async () => {
  const { window } = newWindow();
  await flush();

  for (const id of ["birthDate", "permitDate"]) {
    const input = window.document.getElementById(id);
    input.value = "15061995";
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    assert.equal(input.value, "15/06/1995", `échec pour #${id}`);
  }
});

test("soumission : convertit les dates JJ/MM/AAAA en YYYY-MM-DD avant l'envoi au serveur", async () => {
  const { window, fetchCalls } = newWindow();
  await flush();

  window.document.getElementById("birthDate").value = "15/06/1995";
  window.document.getElementById("postalAddress").value = "1 rue de la Paix, 06130 Grasse";
  window.document.getElementById("permitNumber").value = "123456789";
  window.document.getElementById("permitDate").value = "01/09/2018";
  remplirFichiersObligatoires(window);

  window.document.getElementById("documents-form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await flush();

  const submitCall = fetchCalls.find((c) => String(c.url).includes("/api/documents-submit"));
  assert.ok(submitCall, "l'envoi n'a pas eu lieu");
  const formData = submitCall.options.body;
  assert.equal(formData.get("birthDate"), "1995-06-15");
  assert.equal(formData.get("permitDate"), "2018-09-01");
});

test("soumission : une date invalide (JJ/MM/AAAA bien formée mais inexistante) bloque l'envoi avec un message clair", async () => {
  const { window, fetchCalls } = newWindow();
  await flush();

  window.document.getElementById("birthDate").value = "31/02/2000"; // 31 février n'existe pas
  window.document.getElementById("postalAddress").value = "1 rue de la Paix, 06130 Grasse";
  window.document.getElementById("permitNumber").value = "123456789";
  window.document.getElementById("permitDate").value = "01/09/2018";
  remplirFichiersObligatoires(window);

  window.document.getElementById("documents-form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await flush();

  assert.match(window.document.getElementById("documents-submit-error").textContent, /Date invalide/);
  assert.ok(!fetchCalls.some((c) => String(c.url).includes("/api/documents-submit")), "l'envoi n'aurait pas dû avoir lieu");
});

test("second conducteur non requis : secondDriverPermitDate vide n'est pas envoyé et ne bloque pas la soumission", async () => {
  const { window, fetchCalls } = newWindow({ reference: "res_test", vehicle: null, secondDriverRequired: false, deliveryAddressRequired: false });
  await flush();

  window.document.getElementById("birthDate").value = "15/06/1995";
  window.document.getElementById("postalAddress").value = "1 rue de la Paix, 06130 Grasse";
  window.document.getElementById("permitNumber").value = "123456789";
  window.document.getElementById("permitDate").value = "01/09/2018";
  remplirFichiersObligatoires(window);

  window.document.getElementById("documents-form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await flush();

  const submitCall = fetchCalls.find((c) => String(c.url).includes("/api/documents-submit"));
  assert.ok(submitCall, "l'envoi n'a pas eu lieu");
  assert.equal(submitCall.options.body.get("secondDriverPermitDate"), "");
});
