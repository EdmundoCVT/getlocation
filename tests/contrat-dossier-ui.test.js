// tests/contrat-dossier-ui.test.js
//
// Exerce le vrai JS de contrat.html (extrait, pas une copie à la main —
// même approche que tests/contrat-apercu-fill.test.js) pour les nouvelles
// vues "dossier sécurisé" (#agencyToken=/#clientToken=) : rendu du
// récapitulatif, pré-remplissage depuis le dossier documentaire, blocage de
// l'envoi tant que des champs obligatoires manquent, saisie de l'état des
// lieux départ/retour, et flux de signature côté client (jamais de calcul
// de kilométrage fait confiance côté client : uniquement ce que le serveur
// simulé renvoie).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const dataJsSource = fs.readFileSync(path.join(__dirname, "..", "js", "data.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "..", "contrat.html"), "utf8");

function extractScriptBody() {
  const afterDataJs = html.indexOf("js/data.js");
  const openTag = html.indexOf("<script>", afterDataJs);
  const bodyStart = openTag + "<script>".length;
  const initMarker = "var params = new URLSearchParams";
  const bodyEnd = html.indexOf(initMarker, bodyStart);
  return html.slice(bodyStart, bodyEnd);
}

// Extrait un bloc <div id="...">...</div> par comptage de profondeur (pas
// une regex non-gourmande, qui s'arrêterait au premier </div> imbriqué) —
// même technique que extractContractTextDiv() dans contrat-apercu-fill.test.js.
function extractDivById(id) {
  const startMarker = new RegExp('<div[^>]*id="' + id + '"[^>]*>');
  const match = startMarker.exec(html);
  assert.ok(match, `Bloc #${id} introuvable dans contrat.html`);
  const start = match.index;
  let depth = 0;
  const re = /<div\b[^>]*>|<\/div>/g;
  re.lastIndex = start;
  let m;
  while ((m = re.exec(html))) {
    if (m[0].startsWith("</")) depth--;
    else depth++;
    if (depth === 0) return html.slice(start, m.index + m[0].length);
  }
  throw new Error(`Bloc #${id} non refermé`);
}

function buildWindow(url) {
  const body = extractDivById("contractText") + extractDivById("dossierAgencyView") + extractDivById("dossierClientView");
  const dom = new JSDOM(`<!DOCTYPE html><body>${body}</body>`, {
    url: url || "https://getlocation.fr/contrat.html",
    runScripts: "outside-only"
  });
  dom.window.eval(dataJsSource);
  dom.window.eval(extractScriptBody());
  return dom.window;
}

async function flush() {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

const AGENCY_TOKEN = "a".repeat(43);
const CLIENT_TOKEN = "b".repeat(43);

function baseAgencyView(overrides = {}) {
  return {
    reservation: {
      id: "res_test1234",
      vehicule: { id: "opel-corsa", nom: "Opel Corsa Business 1.2T", immatriculation: "HJ-967-KQ", caution: 500, prixJour: 59 },
      dateDebut: "2026-09-01", heureDebut: "10:00", dateFin: "2026-09-04", heureFin: "10:00",
      lieuPrise: "Agence Grasse", lieuRetour: "Agence Grasse",
      jours: 3, total: 177, options: [],
      conducteur: { nom: "Tavares", prenom: "Edmond", naissance: "1986-12-19", telephone: "0601020304", email: "e@example.com" },
      cglVersion: "2026-07-22"
    },
    kmInclusParJour: 200,
    supplementKmCentimes: 25,
    documentsPrefill: null,
    dossier: { status: "draft", fields: null, cglAcceptedAt: null, signature: null, depart: null, retour: null, kilometrage: null, observations: "" },
    ...overrides
  };
}

function withFakeFetch(window, handler) {
  window.fetch = handler;
}

test("dossier agence : affiche le récapitulatif et pré-remplit depuis le dossier documentaire", async () => {
  const window = buildWindow();
  const view = baseAgencyView({
    documentsPrefill: { adresse: "1 rue de la Paix", permisNumero: "999888777", permisDate: "2010-05-01", secondConducteurNom: "", secondConducteurPrenom: "", secondConducteurPermisNumero: "" }
  });
  withFakeFetch(window, async () => ({ ok: true, json: async () => view }));

  window.initDossierAgencyView(AGENCY_TOKEN);
  await flush();

  assert.match(window.document.getElementById("dossierRecap").textContent, /Opel Corsa/);
  assert.equal(window.document.getElementById("df-adresse").value, "1 rue de la Paix");
  assert.equal(window.document.getElementById("df-permisNumero").value, "999888777");
});

test("dossier agence : jeton invalide (mauvais format) affiche une erreur sans appeler le serveur", async () => {
  const window = buildWindow();
  let called = false;
  withFakeFetch(window, async () => { called = true; return { ok: true, json: async () => baseAgencyView() }; });

  window.initDossierAgencyView("trop-court");
  await flush();

  assert.equal(called, false);
  assert.equal(window.document.getElementById("dossierAgencyError").classList.contains("hidden"), false);
});

test("dossier agence : le bouton d'envoi au client reste bloqué tant que des champs obligatoires manquent", async () => {
  const window = buildWindow();
  withFakeFetch(window, async () => ({ ok: true, json: async () => baseAgencyView() }));

  window.initDossierAgencyView(AGENCY_TOKEN);
  await flush();

  assert.equal(window.document.getElementById("dfSendBtn").disabled, true);
  assert.match(window.document.getElementById("dfMissingFields").textContent, /Adresse/);
});

test("dossier agence : le bouton d'envoi se débloque une fois tous les champs enregistrés", async () => {
  const window = buildWindow();
  const view = baseAgencyView();
  withFakeFetch(window, async (url, opts) => {
    if (opts && opts.method === "POST") {
      const body = JSON.parse(opts.body);
      if (body.action === "update-fields") {
        view.dossier = { ...view.dossier, fields: { immatriculation: body.immatriculation, adresse: body.adresse, codePostal: body.codePostal, ville: body.ville, permisNumero: body.permisNumero, modeCaution: "carte", livraison: false, secondConducteur: false } };
      }
      return { ok: true, json: async () => view };
    }
    return { ok: true, json: async () => view };
  });

  window.initDossierAgencyView(AGENCY_TOKEN);
  await flush();

  window.document.getElementById("df-immatriculation").value = "AB-123-CD";
  window.document.getElementById("df-adresse").value = "1 rue de la Paix";
  window.document.getElementById("df-codePostal").value = "06130";
  window.document.getElementById("df-ville").value = "Grasse";
  window.document.getElementById("df-permisNumero").value = "123456789";
  window.document.getElementById("dfSaveBtn").dispatchEvent(new window.Event("click", { bubbles: true }));
  await flush();

  assert.equal(window.document.getElementById("dfSendBtn").disabled, false);
  assert.equal(window.document.getElementById("dfMissingFields").classList.contains("hidden"), true);
});

test("dossier agence : envoi au client réussi affiche le lien de partage (fragment #clientToken=, jamais en paramètre de requête)", async () => {
  const window = buildWindow();
  const fieldsComplets = { immatriculation: "AB-123-CD", adresse: "1 rue X", codePostal: "06130", ville: "Grasse", permisNumero: "123456789", modeCaution: "carte", livraison: false, secondConducteur: false };
  const view = baseAgencyView({ dossier: { status: "draft", fields: fieldsComplets, cglAcceptedAt: null, signature: null, depart: null, retour: null, kilometrage: null, observations: "" } });

  withFakeFetch(window, async (url, opts) => {
    if (opts && opts.method === "POST") {
      const body = JSON.parse(opts.body);
      if (body.action === "send-to-client") {
        view.dossier.status = "sent";
        return { ok: true, json: async () => ({ ...view, clientUrl: "https://getlocation.fr/contrat.html#clientToken=" + CLIENT_TOKEN }) };
      }
    }
    return { ok: true, json: async () => view };
  });

  window.initDossierAgencyView(AGENCY_TOKEN);
  await flush();

  window.document.getElementById("dfSendBtn").dispatchEvent(new window.Event("click", { bubbles: true }));
  await flush();

  const link = window.document.getElementById("dfLinkOutput").value;
  assert.match(link, /#clientToken=/);
  assert.equal(link.includes("?clientToken="), false);
  assert.equal(window.document.getElementById("dfLinkBox").classList.contains("hidden"), false);
});

test("dossier agence : enregistre la remise puis la restitution, affiche le résultat kilométrique renvoyé par le serveur (jamais recalculé côté client)", async () => {
  const window = buildWindow();
  const view = baseAgencyView();

  withFakeFetch(window, async (url, opts) => {
    if (opts && opts.method === "POST") {
      const body = JSON.parse(opts.body);
      if (body.action === "update-depart") {
        view.dossier.depart = { dateHeure: body.dateHeure, km: body.km, carburant: body.carburant, agent: body.agent, proprete: "", dommages: "", photosRef: "", clesAccessoires: "", clientSigne: "", agenceSigne: "" };
      }
      if (body.action === "update-retour") {
        view.dossier.retour = { dateHeure: body.dateHeure, km: body.km, carburant: body.carburant, agent: body.agent, proprete: "", dommages: "", photosRef: "", clesAccessoires: "", clientSigne: "", agenceSigne: "" };
        // Résultat volontairement DIFFÉRENT de ce qu'un calcul client naïf
        // donnerait, pour prouver que l'UI affiche bien la réponse serveur
        // telle quelle et ne recalcule rien elle-même.
        view.dossier.kilometrage = { valid: true, kmInclus: 600, kmParcourus: 700, kmDepasses: 100, supplementCentimes: 2500, supplement: 25 };
      }
      return { ok: true, json: async () => view };
    }
    return { ok: true, json: async () => view };
  });

  window.initDossierAgencyView(AGENCY_TOKEN);
  await flush();

  window.document.getElementById("rr-depart-km").value = "15000";
  window.document.getElementById("rr-depart-carburant").value = "100";
  window.document.getElementById("rr-depart-agent").value = "Jean";
  window.document.getElementById("rrDepartSaveBtn").dispatchEvent(new window.Event("click", { bubbles: true }));
  await flush();

  window.document.getElementById("rr-retour-km").value = "15700";
  window.document.getElementById("rr-retour-carburant").value = "80";
  window.document.getElementById("rr-retour-agent").value = "Jean";
  window.document.getElementById("rrRetourSaveBtn").dispatchEvent(new window.Event("click", { bubbles: true }));
  await flush();

  const resultat = window.document.getElementById("rrKilometrageResultat").textContent;
  assert.match(resultat, /Dépassement : 100 km/);
  assert.match(resultat, /25/);
});

test("dossier client : affiche le récapitulatif et bloque la signature sans dessin", async () => {
  const window = buildWindow();
  const clientView = {
    reservation: {
      vehicule: { nom: "Opel Corsa Business 1.2T", caution: 500 },
      immatriculation: "HJ-967-KQ",
      dateDebut: "2026-09-01", heureDebut: "10:00", dateFin: "2026-09-04", heureFin: "10:00",
      lieuPrise: "Agence Grasse", jours: 3, total: 177,
      conducteur: { nom: "Tavares", prenom: "Edmond", naissance: "1986-12-19", telephone: "0601020304", email: "e@example.com" },
      cglVersion: "2026-07-22"
    },
    fields: { modeCaution: "carte", adresse: "1 rue X", codePostal: "06130", ville: "Grasse", permisNumero: "123456789", livraison: false, livraisonRue: "", livraisonCP: "", livraisonVille: "", secondConducteur: false, secondConducteurNom: "", secondConducteurPrenom: "", secondConducteurPermisNumero: "" },
    kmInclus: 600,
    status: "sent",
    signedAt: null,
    signatureId: null
  };
  withFakeFetch(window, async () => ({ ok: true, json: async () => clientView }));

  window.initDossierClientView(CLIENT_TOKEN);
  await flush();

  assert.match(window.document.getElementById("dcRecap").textContent, /Opel Corsa/);
  assert.equal(window.document.getElementById("dcSubmitBtn").disabled, true);

  window.document.getElementById("dc-accept").checked = true;
  window.document.getElementById("dc-accept").dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.equal(window.document.getElementById("dcSubmitBtn").disabled, true, "toujours bloqué sans dessin de signature");
});

test("dossier client : contrat déjà signé affiche l'état signé plutôt que le formulaire", async () => {
  const window = buildWindow();
  const clientView = {
    reservation: {
      vehicule: { nom: "Opel Corsa Business 1.2T", caution: 500 },
      immatriculation: "HJ-967-KQ",
      dateDebut: "2026-09-01", heureDebut: "10:00", dateFin: "2026-09-04", heureFin: "10:00",
      lieuPrise: "Agence Grasse", jours: 3, total: 177,
      conducteur: { nom: "Tavares", prenom: "Edmond", naissance: "1986-12-19", telephone: "0601020304", email: "e@example.com" },
      cglVersion: "2026-07-22"
    },
    fields: { modeCaution: "carte", adresse: "1 rue X", codePostal: "06130", ville: "Grasse", permisNumero: "123456789", livraison: false, secondConducteur: false },
    kmInclus: 600,
    status: "signed",
    signedAt: "2026-08-20T10:00:00.000Z",
    signatureId: "ABCDEF01"
  };
  withFakeFetch(window, async () => ({ ok: true, json: async () => clientView }));

  window.initDossierClientView(CLIENT_TOKEN);
  await flush();

  assert.equal(window.document.getElementById("dcSignCard").classList.contains("hidden"), true);
  assert.equal(window.document.getElementById("dcAlreadySigned").classList.contains("hidden"), false);
  assert.match(window.document.getElementById("dcAlreadySignedMeta").textContent, /ABCDEF01/);
});
