// tests/back-office.test.js
//
// Exerce le vrai JS de back-office.html (extrait, pas une copie à la main —
// même approche que tests/contrat-apercu-fill.test.js) : fonctions pures de
// formatage/rendu exposées via window.__backOffice pour les tests
// (échappement HTML, dates, montants, badges de statut/synchronisation).
// Ne couvre pas les flux réseau (déjà testés côté serveur dans les Lots
// 1-3, cette page n'est qu'une fine couche d'appel par-dessus).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const dataJsSource = fs.readFileSync(path.join(__dirname, "..", "js", "data.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "..", "back-office.html"), "utf8");

function extractBody() {
  const m = /<body>([\s\S]*)<\/body>/.exec(html);
  assert.ok(m, "Balise <body> introuvable dans back-office.html");
  return m[1];
}

function extractInlineScript() {
  const m = /<script>([\s\S]*?)<\/script>/.exec(html);
  assert.ok(m, "Script inline introuvable dans back-office.html");
  return m[1];
}

function buildWindow() {
  const dom = new JSDOM(`<!DOCTYPE html><body>${extractBody()}</body>`, {
    url: "https://getlocation.fr/back-office.html",
    runScripts: "outside-only"
  });
  // fetch n'existe pas nativement dans jsdom : sans ce filet, l'appel
  // synchrone fait par initSession() au chargement lèverait une exception
  // et interromprait le reste du script (jamais le cas dans un vrai
  // navigateur, où fetch existe toujours) — voir apiGet/initSession.
  dom.window.fetch = () => Promise.reject(new Error("fetch désactivé dans les tests"));
  dom.window.eval(dataJsSource);
  dom.window.eval(extractInlineScript());
  return dom.window;
}

test("escapeHtml : neutralise les caractères HTML dangereux", () => {
  const window = buildWindow();
  assert.equal(window.__backOffice.escapeHtml('<script>alert("x")</script>'), "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
  assert.equal(window.__backOffice.escapeHtml("O'Brien & Fils"), "O&#39;Brien &amp; Fils");
  assert.equal(window.__backOffice.escapeHtml(null), "");
  assert.equal(window.__backOffice.escapeHtml(undefined), "");
});

test("formatDateFR : convertit AAAA-MM-JJ en JJ/MM/AAAA", () => {
  const window = buildWindow();
  assert.equal(window.__backOffice.formatDateFR("2026-09-10"), "10/09/2026");
  assert.equal(window.__backOffice.formatDateFR(""), "—");
  assert.equal(window.__backOffice.formatDateFR(null), "—");
});

test("jourMoisAnneeVersIso : convertit JJ/MM/AAAA en AAAA-MM-JJ (inverse de formatDateFR, champ éditable)", () => {
  const window = buildWindow();
  assert.equal(window.__backOffice.jourMoisAnneeVersIso("10/09/2026"), "2026-09-10");
  assert.equal(window.__backOffice.jourMoisAnneeVersIso(""), "");
  assert.equal(window.__backOffice.jourMoisAnneeVersIso(null), "");
  assert.equal(window.__backOffice.jourMoisAnneeVersIso("pas une date"), "pas une date", "saisie invalide renvoyée telle quelle, jamais perdue");
});

// inputmode="numeric" affiche un clavier numérique sur mobile (iOS/Android)
// sans touche "/", rendant JJ/MM/AAAA impossible à saisir (constaté le
// 11/09/2026) — voir le même correctif dans contrat.html/js/app.js.
test("cf-birthDate : insère les \"/\" au fil de la frappe (clavier numérique mobile sans touche /)", () => {
  const window = buildWindow();
  const input = window.document.getElementById("cf-birthDate");
  input.value = "10092026";
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  assert.equal(input.value, "10/09/2026");
});

test("euros : convertit des centimes en libellé français, gère l'absence de valeur", () => {
  const window = buildWindow();
  assert.equal(window.__backOffice.euros(24000), "240,00 €");
  assert.equal(window.__backOffice.euros(0), "0,00 €");
  assert.equal(window.__backOffice.euros(null), "—");
  assert.equal(window.__backOffice.euros(undefined), "—");
});

test("statusBadge : libellé français correct pour chaque statut de location", () => {
  const window = buildWindow();
  assert.match(window.__backOffice.statusBadge("brouillon"), /Brouillon/);
  assert.match(window.__backOffice.statusBadge("contrat_genere"), /Contrat généré/);
  assert.match(window.__backOffice.statusBadge("en_cours"), /En cours/);
  assert.match(window.__backOffice.statusBadge("terminee"), /Terminée/);
  assert.match(window.__backOffice.statusBadge("annulee"), /Annulée/);
});

test("syncBadge : distingue non synchronisé / en attente / synchronisé / erreur", () => {
  const window = buildWindow();
  assert.match(window.__backOffice.syncBadge(null), /Non synchronisé/);
  assert.match(window.__backOffice.syncBadge({ status: "pending" }), /En attente/);
  assert.match(window.__backOffice.syncBadge({ status: "synced" }), /Synchronisé/);
  assert.match(window.__backOffice.syncBadge({ status: "error" }), /Erreur/);
  assert.match(window.__backOffice.syncBadge({ status: "error" }), /sync-error/);
  assert.match(window.__backOffice.syncBadge({ status: "synced" }), /sync-ok/);
});

test("chargement complet de la page sans exception (tous les écouteurs s'attachent)", () => {
  assert.doesNotThrow(() => buildWindow());
});

test("création EDL indépendante : réserve la fenêtre avant la requête puis la réutilise", () => {
  const source = html.match(/function openStandaloneInspectionCreation\(\)[\s\S]*?\n}\n?document\.getElementById\('newStandaloneInspectionBtn'\)/)[0];
  const openIndex = source.indexOf("window.open('about:blank','_blank')");
  const postIndex = source.indexOf("apiPost('/api/standalone-inspections'");
  assert.ok(openIndex >= 0 && postIndex > openIndex, "la fenêtre doit être réservée dans le clic, avant le POST");
  assert.match(source, /if\(popup\)popup\.location\.href=url;else window\.location\.href=url/);
  assert.match(source, /if\(popup\)popup\.close\(\)/);
  assert.match(source, /create\.disabled=true/);
});

test("l'espace interne présente une navigation unique et un tableau de bord", () => {
  const window = buildWindow();
  assert.match(window.document.querySelector("#loginView h1").textContent, /Espace GET LOCATION/);
  assert.ok(window.document.getElementById("dashboardSection"));
  ["planningSection", "deliveriesSection", "depositsSection", "vehiclesSection", "statisticsSection", "settingsSection"].forEach((id) => assert.ok(window.document.getElementById(id), id));
  assert.equal(window.document.querySelectorAll("[data-internal-view]").length >= 8, true);
  assert.match(window.document.querySelector(".internal-nav").textContent, /Contrats/);
  assert.match(window.document.querySelector(".internal-nav").textContent, /Planning/);
  assert.match(window.document.getElementById("deliveriesSection").textContent, /LIVRAISON/);
  assert.ok(!html.includes("docs.google.com/spreadsheets/d/"), "l'URL du fichier ne doit jamais figurer dans l'asset public");
});

test("la navigation mobile ouvre et ferme la sidebar sans exposer de contenu supplémentaire", () => {
  const window = buildWindow();
  const sidebar = window.document.getElementById("internalSidebar");
  const toggle = window.document.getElementById("mobileNavToggle");
  const backdrop = window.document.getElementById("sidebarBackdrop");
  toggle.click();
  assert.ok(sidebar.classList.contains("is-open"));
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  backdrop.click();
  assert.ok(!sidebar.classList.contains("is-open"));
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
});

test("bibliothèque EDL : les sources liées et historiques sont normalisées, sans rendre un retour futur consultable", () => {
  const window = buildWindow();
  window.__backOffice.renderInspectionListForTest([
    {
      id: "res_historique", client: { prenom: "Israa", nom: "Benzaama" }, vehicule: "Opel Corsa", vehiculeId: "opel-corsa", immatriculation: "AB-123-CD",
      dateDebut: "2026-08-13", heureDebut: "10:00", dateFin: "2026-08-15", heureFin: "10:00", contractNumero: "GL-20260813-0001",
      openable: false, historyMode: "manual-contract", inspection: { depart: true, retour: true, retourAvailable: true }
    },
    {
      id: "res_futur", client: { prenom: "Jean", nom: "Dupont" }, vehicule: "Opel Corsa", vehiculeId: "opel-corsa", immatriculation: "",
      dateDebut: "2027-01-01", heureDebut: "10:00", dateFin: "2027-01-02", heureFin: "10:00", contractNumero: null,
      openable: true, historyMode: null, inspection: { depart: false, retour: false, retourAvailable: false }
    }
  ]);
  const cards = [...window.document.querySelectorAll("#inspectionList .dashboard-card")];
  assert.equal(cards.length, 4);
  const historical = cards.filter((card) => /Historique/.test(card.textContent));
  assert.equal(historical.length, 2);
  historical.forEach((card) => assert.equal(card.querySelector("button").disabled, false));
  const retourFutur = cards.find((card) => /^Retour/.test(card.querySelector("h2").textContent));
  assert.ok(retourFutur.querySelector("button").disabled);
});

test("bibliothèque EDL : recherche, filtre indépendant et tri couvrent toutes les sources", () => {
  const window = buildWindow();
  window.__backOffice.renderInspectionListForTest([{
    id: "rental_1", client: { prenom: "Alice", nom: "Martin" }, vehicule: "Peugeot 208", immatriculation: "AA-123-AA", dateDebut: "2026-03-01", heureDebut: "10:00", dateFin: "2026-03-02", heureFin: "10:00", contractNumero: "GL-1", openable: true, inspection: { depart: true, retour: false, retourAvailable: true }
  }], [{
    id: "edl_aaaaaaaaaaaaaaaa", mode: "depart", client: { prenom: "Benoît", nom: "Durand" }, vehicule: { nom: "Renault Trafic", immatriculation: "BB-456-BB" }, linkedContractNumero: "GL-2", dateHeure: "2026-04-01T09:00", status: "draft"
  }]);
  assert.match(window.document.getElementById('inspectionList').textContent, /Alice/);
  assert.match(window.document.getElementById('inspectionList').textContent, /Benoît/);
  window.document.querySelector('[data-inspection-filter="standalone"]').click();
  assert.equal(window.document.querySelectorAll('#inspectionList .dashboard-card').length, 1);
  assert.match(window.document.getElementById('inspectionList').textContent, /Benoît/);
  window.document.querySelector('[data-inspection-filter="all"]').click();
  const search=window.document.getElementById('inspectionSearch'); search.value='AA-123-AA'; search.dispatchEvent(new window.Event('input'));
  assert.equal(window.document.querySelectorAll('#inspectionList .dashboard-card').length, 2, 'départ et retour de la location sont recherchables par immatriculation');
  search.value='Benoît'; search.dispatchEvent(new window.Event('input'));
  assert.equal(window.document.querySelectorAll('#inspectionList .dashboard-card').length, 1);
});

test("bibliothèque EDL : Tous exclut strictement les archives et le filtre Archivés les isole", () => {
  const window = buildWindow();
  window.__backOffice.renderInspectionListForTest([{
    id: "res_archive", client: { prenom: "Active", nom: "Client" }, vehicule: "Peugeot 208", dateDebut: "2026-03-01", heureDebut: "10:00", dateFin: "2026-03-02", heureFin: "10:00", openable: true,
    inspection: { depart: true, retour: true, retourAvailable: true }, inspectionRevisions: { depart: [{ revision: 1, status: "finalized" }], retour: [{ revision: 1, status: "draft" }] }, inspectionArchives: { depart: { archivedAt: "2026-10-13T10:00:00Z", archivedBy: "Edmundo" } }
  }], [{ id: "edl_archive", mode: "depart", client: { prenom: "Ancien", nom: "Test" }, vehicule: { nom: "Toyota Proace" }, status: "finalized", archivedAt: "2026-10-13T10:00:00Z", archivedBy: "Edmundo" }]);
  assert.match(window.document.querySelector('[data-inspection-filter="all"]').textContent, /Tous \(1\)/);
  assert.match(window.document.querySelector('[data-inspection-filter="archived"]').textContent, /Archivés \(2\)/);
  assert.equal(window.document.querySelectorAll('#inspectionList .dashboard-card').length, 1);
  assert.match(window.document.getElementById('inspectionList').textContent, /Active/);
  const search = window.document.getElementById('inspectionSearch'); search.value = 'Ancien'; search.dispatchEvent(new window.Event('input'));
  assert.equal(window.document.querySelectorAll('#inspectionList .dashboard-card').length, 0, "un archivé ne réapparaît jamais dans Tous par recherche");
  window.document.querySelector('[data-inspection-filter="archived"]').click();
  assert.equal(window.document.querySelectorAll('#inspectionList .dashboard-card').length, 1);
  assert.match(window.document.getElementById('inspectionList').textContent, /Ancien/);
  assert.match(window.document.getElementById('inspectionList').textContent, /Archivé/);
});

test("bibliothèque EDL : l'activation directe de la section charge les deux sources et initialise les compteurs", async () => {
  const window = buildWindow();
  const calls = [];
  window.fetch = async (url) => {
    calls.push(String(url));
    const standalone = String(url).includes("standalone-inspections");
    return { ok: true, json: async () => standalone ? { inspections: [{ id: "edl_aaaaaaaaaaaaaaaa", mode: "depart", client: { prenom: "Nicholson", nom: "Test" }, vehicule: { nom: "Toyota Proace" }, status: "draft", updatedAt: "2026-10-12T10:00:00Z" }] } : { rentals: [{ id: "res_3008", client: { prenom: "Client", nom: "3008" }, vehicule: "Peugeot 3008", dateDebut: "2026-10-10", heureDebut: "10:00", dateFin: "2026-10-11", heureFin: "10:00", openable: true, inspection: { depart: true, retour: false, retourAvailable: true } }] } };
  };
  window.__backOffice.showInspectionSectionForTest();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(calls.some((url) => url.includes("/api/agency-rentals?view=inspection")));
  assert.ok(calls.some((url) => url.includes("/api/standalone-inspections")));
  assert.match(window.document.querySelector('[data-inspection-filter="all"]').textContent, /Tous \(3\)/);
  assert.match(window.document.getElementById("inspectionList").textContent, /Toyota Proace/);
});

test("bibliothèque EDL : conserve la source disponible et explique l'échec partiel", async () => {
  const window = buildWindow();
  window.fetch = async (url) => {
    if (String(url).includes("agency-rentals?view=inspection")) return { ok: false, json: async () => ({ error: "indisponible" }) };
    return { ok: true, json: async () => ({ inspections: [{ id: "edl_bbbbbbbbbbbbbbbb", mode: "retour", client: { prenom: "Nicholson", nom: "Test" }, vehicule: { nom: "Toyota Proace" }, status: "finalized", updatedAt: "2026-10-12T10:00:00Z" }] }) };
  };
  window.__backOffice.showInspectionSectionForTest();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  const list = window.document.getElementById("inspectionList").textContent;
  assert.match(list, /Toyota Proace/);
  assert.match(list, /EDL liés aux contrats n’ont pas pu être chargés/);
  assert.match(window.document.querySelector('[data-inspection-filter="all"]').textContent, /Tous \(1\)/);
  assert.equal(window.document.querySelector('#inspectionList button').textContent, 'Réessayer');
});

test("chaque état des lieux historique terminé ouvre la vue legacy, jamais contrat.html", () => {
  const window = buildWindow();
  const popups=[];window.open=()=>{const popup={opener:window,document:{},location:{href:""}};popups.push(popup);return popup};
  const historique=(id,historyMode,historyId)=>({id,client:{prenom:"Israa",nom:"Benzaama"},vehicule:"Opel Corsa",vehiculeId:"opel-corsa",immatriculation:"AB-123-CD",dateDebut:"2026-08-13",heureDebut:"10:00",dateFin:"2026-08-15",heureFin:"10:00",contractNumero:"GL-20260813-0001",openable:false,historyMode,historyId,inspection:{depart:true,retour:true,retourAvailable:true}});
  window.__backOffice.renderInspectionListForTest([
    historique("res_"+"a".repeat(32),"manual-contract","res_"+"a".repeat(32)),
    historique("rnt_legacy","rental-record","rnt_legacy"),
    historique("res_kv","rental-record","rnt_fusionnee")
  ]);
  [...window.document.querySelectorAll("#inspectionList .dashboard-card")].forEach((card,index)=>{
    const open=card.querySelector("button");
    assert.equal(open.disabled,false);
    open.click();
  });
  const urls=popups.map(p=>p.location.href);
  ["res_"+"a".repeat(32),"rnt_legacy","rnt_fusionnee"].forEach((expectedId)=>{
    ['depart','retour'].forEach((mode)=>assert.ok(urls.includes('/etat-des-lieux.html?source=legacy&mode='+mode+'&legacyId='+expectedId)));
  });
  urls.forEach(url=>{assert.ok(!url.includes("contrat.html"));assert.ok(!url.includes("manualToken"))});
});

test("réservation KV moderne : conserve le workflow état des lieux sécurisé", async () => {
  const window=buildWindow(),popup={opener:window,document:{},location:{href:""}};window.open=()=>popup;
  window.fetch=async()=>({ok:true,json:async()=>({agencyUrl:"https://getlocation.fr/contrat.html#agencyToken="+"A".repeat(43)})});
  window.__backOffice.renderInspectionListForTest([{id:"res_"+"b".repeat(32),client:{prenom:"Jean",nom:"Dupont"},vehicule:"Opel Corsa",vehiculeId:"opel-corsa",immatriculation:"",dateDebut:"2027-01-01",heureDebut:"10:00",dateFin:"2027-01-02",heureFin:"10:00",contractNumero:null,openable:true,historyMode:null,historyId:null,inspection:{depart:false,retour:false,retourAvailable:false}}]);
  [...window.document.querySelectorAll("#inspectionList .dashboard-card")].find(card=>/^Départ/.test(card.querySelector('h2').textContent)).querySelector('button').click();
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.match(popup.location.href,/^\/etat-des-lieux\.html\?mode=depart#agencyToken=A{43}$/);
});

test("contrat manuel moderne : Départ À faire ouvre l'EDL autonome avec lien agence", async () => {
  const window = buildWindow();
  const popup = { opener: window, document: {}, location: { href: "" } };
  window.open = () => popup;
  let requestedId = null;
  window.fetch = async (_url, options) => {
    requestedId = JSON.parse(options.body).id;
    return { ok: true, json: async () => ({ agencyUrl: "https://getlocation.fr/etat-des-lieux.html#agencyToken=" + "B".repeat(43) }) };
  };
  window.__backOffice.renderInspectionListForTest([{
    id: "res_manual_modern", client: { prenom: "Anne", nom: "Martin" }, vehicule: "Opel Corsa",
    vehiculeId: "opel-corsa", immatriculation: "AA-123-BB", dateDebut: "2026-10-10",
    heureDebut: "10:00", dateFin: "2026-10-12", heureFin: "10:00", contractNumero: "GL-20261010-0001",
    openable: true, historyMode: null, historyId: null,
    inspection: { depart: false, retour: false, retourAvailable: false }
  }]);
  const depart = [...window.document.querySelectorAll("#inspectionList .dashboard-card")].find(card=>/^Départ/.test(card.querySelector('h2').textContent)).querySelector('button');
  assert.equal(depart.textContent, "Consulter");
  assert.equal(depart.disabled, false);
  depart.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(requestedId, "res_manual_modern");
  assert.match(popup.location.href, /^\/etat-des-lieux\.html\?mode=depart#agencyToken=B{43}$/);
});

// Régression Lot 5 : renderSyncStatus utilisait row(), qui échappe
// systématiquement sa valeur (correct pour du texte utilisateur) — appliqué
// au HTML de confiance renvoyé par syncBadge(), il affichait le balisage
// brut ("<span class=...>Synchronisé</span>") au lieu du badge coloré,
// repéré lors de la validation manuelle du Lot 5 (voir compte rendu).
test("renderSyncStatus : insère le badge de synchronisation comme HTML, jamais échappé", () => {
  const window = buildWindow();
  window.__backOffice.renderSyncStatusForTest({ id: "r1", syncStatus: { status: "synced" } });
  const card = window.document.getElementById("syncStatusCard");
  assert.equal(card.querySelectorAll(".status-pill.sync-ok").length, 1);
  assert.ok(!card.innerHTML.includes("&lt;span"), "le badge ne doit jamais apparaître échappé");
});

// Régression Lot 5 (lien "Ouvrir dans l'outil de contrat") : le lien
// ?prefill= produit ici doit rester décodable par le VRAI decodeData() de
// contrat.html — même approche que
// worker-send-contract-email.test.js#"encodeContractData : produit un
// base64 décodable par decodeData()".
test("contratPrefillUrl : produit un lien ?prefill= décodable par decodeData() de contrat.html", () => {
  const contratHtml = fs.readFileSync(path.join(__dirname, "..", "contrat.html"), "utf8");
  const decodeMatch = contratHtml.match(/function decodeData\(str\)\{[\s\S]*?\n\}/);
  assert.ok(decodeMatch, "decodeData() introuvable dans contrat.html (structure du fichier changée ?)");

  const window = buildWindow();
  window.eval(decodeMatch[0] + "\nwindow.decodeData = decodeData;");

  const rental = { vehiculeId: "opel-corsa", dateDebut: "2026-09-10", heureDebut: "10:00", dateFin: "2026-09-12", heureFin: "10:00" };
  const client = { firstName: "Jean", lastName: "Dupont", phone: "0601020304", email: "jean@example.com", birthDate: "1990-05-20", postalAddress: "12 rue des Lilas", postalCode: "06130", city: "Grasse", permitNumber: "123456789" };
  const url = window.__backOffice.contratPrefillUrl(rental, client);

  assert.match(url, /^\/contrat\.html\?prefill=/);
  const encoded = url.split("?prefill=")[1];
  const decoded = window.decodeData(encoded);
  assert.equal(decoded.prenom, "Jean");
  assert.equal(decoded.nom, "Dupont");
  assert.equal(decoded.tel, "0601020304");
  assert.equal(decoded.email, "jean@example.com");
  assert.equal(decoded.naissance, "1990-05-20");
  assert.equal(decoded.adresse, "12 rue des Lilas");
  assert.equal(decoded.codePostal, "06130");
  assert.equal(decoded.ville, "Grasse");
  assert.equal(decoded.permis, "123456789");
  assert.equal(decoded.vehiculeId, "opel-corsa");
  assert.equal(decoded.depart, "2026-09-10T10:00");
  assert.equal(decoded.retour, "2026-09-12T10:00");
  assert.equal(decoded.montantRegle, undefined, "sans montant connu, laisse contrat.html à son propre défaut (payé en totalité)");

  const urlAvecPaiement = window.__backOffice.contratPrefillUrl(rental, client, 5000);
  const decodedAvecPaiement = window.decodeData(urlAvecPaiement.split("?prefill=")[1]);
  assert.equal(decodedAvecPaiement.montantRegle, 50, "50,00 € déjà encaissés, jamais le total par défaut");
  assert.equal(decodedAvecPaiement.acompteRegle, true, "un montant encaissé est par définition déjà réglé");

  const urlImpayee = window.__backOffice.contratPrefillUrl(rental, client, 0);
  const decodedImpayee = window.decodeData(urlImpayee.split("?prefill=")[1]);
  assert.equal(decodedImpayee.montantRegle, 0, "régression : une location non payée ne doit jamais afficher un solde à 0 sur le contrat");
  assert.equal(decodedImpayee.acompteRegle, false, "0 € encaissé : rien n'est encore réglé");
});

test("contratPrefillUrl : déduit acompteRegle/soldeRegle du vrai statut de paiement (jamais réglé par défaut)", () => {
  const window = buildWindow();
  const client = { firstName: "Jean", lastName: "Dupont" };
  const rentalAvecTotal = { vehiculeId: "opel-corsa", priceTotalCents: 24000 };

  const contratHtml = fs.readFileSync(path.join(__dirname, "..", "contrat.html"), "utf8");
  const decodeMatch = contratHtml.match(/function decodeData\(str\)\{[\s\S]*?\n\}/);
  window.eval(decodeMatch[0] + "\nwindow.decodeData = decodeData;");

  const partiel = window.decodeData(window.__backOffice.contratPrefillUrl(rentalAvecTotal, client, 12000).split("?prefill=")[1]);
  assert.equal(partiel.acompteRegle, true, "50 % encaissés : l'acompte déjà perçu est réglé");
  assert.equal(partiel.soldeRegle, false, "50 % encaissés : il reste un solde, jamais marqué réglé par défaut");

  const soldeComplet = window.decodeData(
    window.__backOffice.contratPrefillUrl(rentalAvecTotal, client, 24000).split("?prefill=")[1]
  );
  assert.equal(soldeComplet.soldeRegle, true, "montant encaissé = total : le solde est bien réglé");

  const rentalSansTotal = { vehiculeId: "opel-corsa" };
  const sansTotal = window.decodeData(
    window.__backOffice.contratPrefillUrl(rentalSansTotal, client, 12000).split("?prefill=")[1]
  );
  assert.equal(sansTotal.soldeRegle, undefined, "total inconnu : impossible de savoir si le solde est réglé, ne jamais deviner");
});

test("tableau des dépôts : filtres et cartes compactes affichent les montants et le statut", () => {
  const window = buildWindow();
  window.__backOffice.renderDepositDashboardForTest([
    { id: "dep_1", client: { firstName: "Joseph", lastName: "Nicholson" }, rental: { id: "rnt_1", vehiculeId: "opel-corsa", contractNumero: "GL-1" }, amountRequestedCents: 150000, capturedCents: 35000, availableCents: 115000, dashboardStatus: "partially_captured", authorizationExpiresAt: "2099-10-16T12:00:00.000Z" },
    { id: "dep_2", client: { firstName: "Anne", lastName: "Martin" }, rental: { id: "rnt_2", vehiculeId: "opel-corsa" }, amountRequestedCents: 50000, capturedCents: 0, availableCents: 50000, dashboardStatus: "authorized" }
  ]);
  assert.match(window.document.getElementById("depositDashboardList").textContent, /Joseph Nicholson/);
  assert.match(window.document.getElementById("depositDashboardList").textContent, /1\s*150,00 € disponibles/);
  window.document.querySelector('[data-deposit-filter="authorized"]').click();
  assert.match(window.document.getElementById("depositDashboardList").textContent, /Anne Martin/);
  assert.doesNotMatch(window.document.getElementById("depositDashboardList").textContent, /Joseph Nicholson/);
});

test("nouvelle empreinte : modes visibles, résumé de réservation et fermeture compacte", async () => {
  const window = buildWindow();
  window.fetch = () => Promise.resolve({ ok: true, json: async () => ({ rentals: [{ id: "rnt_42", vehiculeId: "opel-corsa", vehicule: "Opel Corsa Business", contractNumero: "GL-42", client: { prenom: "Felipe", nom: "Martin" } }] }) });
  window.__backOffice.openDepositCreationForTest();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const panel = window.document.getElementById("depositCreationPanel");
  assert.equal(window.document.getElementById("newDepositBtn").textContent, "Fermer");
  assert.match(panel.textContent, /Felipe/);
  assert.match(panel.textContent, /Montant libre/);
  assert.equal(window.document.querySelectorAll("[data-deposit-mode]").length, 2);
  window.document.querySelector('[data-deposit-mode="onsite"]').click();
  assert.equal(window.document.getElementById("newDepositMode").value, "onsite");
  assert.ok(window.document.querySelector('[data-deposit-mode="onsite"]').classList.contains("is-selected"));
  window.document.getElementById("newDepositBtn").click();
  assert.equal(panel.hidden, true);
  assert.equal(window.document.getElementById("newDepositBtn").textContent, "+ Nouvelle empreinte");
});

test("après création : les partages sont réservés au mode envoyé au client", () => {
  const window = buildWindow();
  const data = { deposit: { id: "dep_x" }, customerLink: "https://getlocation.fr/deposit.html?token=test" };
  window.__backOffice.renderCreatedDepositLinkForTest(data, "onsite");
  assert.equal(window.document.getElementById("createdDepositCopy"), null);
  window.__backOffice.renderCreatedDepositLinkForTest(data, "send");
  assert.ok(window.document.getElementById("createdDepositCopy"));
  assert.ok(window.document.getElementById("createdDepositWhatsapp"));
  assert.ok(window.document.getElementById("createdDepositSms"));
});
