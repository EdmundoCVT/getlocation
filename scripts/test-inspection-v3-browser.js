// Real Chromium E2E, using the unchanged Worker handlers and in-memory fixtures.
// Run: node scripts/test-inspection-v3-browser.js (Playwright + Chromium required).
// Never connects to production KV/R2; artifacts are written to a temporary directory.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { execFileSync } = require("node:child_process");
const { chromium } = require("playwright");
const { createFakeKv } = require("../tests/helpers/fake-kv.js");
const { createReservation, updateReservationStatus, saveContractAgencyAccessIndex } = require("../src/lib/reservation-store.js");
const { issueContractAgencyAccess } = require("../src/lib/contract-dossier-token.js");
const { handleContractDossierAgency } = require("../src/api/contract-dossier-agency.js");
const { handleInspectionMedia } = require("../src/api/inspection-media.js");
const root = path.join(__dirname, "..");
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'";
const tinyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==", "base64");

test("V3 navigateur : départ complet, retour, rechargement, mobiles et PDF avec vraies photos", { timeout: 120000 }, async t => {
  const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), "getlocation-v3-"));
  const objects = new Map(), deletes = [], calls = [];
  const env = { RESERVATIONS_KV: createFakeKv(), RATE_LIMITS_KV: createFakeKv(), DOCUMENT_TOKEN_PEPPER: "v3-test-only", DOCUMENTS_BUCKET: {
    async put(key, body, options) { objects.set(key, { body: Buffer.from(body), options }); },
    async get(key) { const object = objects.get(key); return object ? { body: new Blob([object.body]).stream(), writeHttpMetadata(headers) { headers.set("Content-Type", object.options.httpMetadata.contentType); } } : null; },
    async delete(key) { deletes.push(key); objects.delete(key); }
  } };
  const reservation = await createReservation(env, { vehiculeId: "toyota-proace-city", dateDebut: "2026-10-01", heureDebut: "10:00", dateFin: "2026-10-08", heureFin: "10:00", total: 400, conducteur: { prenom: "Client", nom: "V3 test", telephone: "0600000000", email: "test@example.com" } });
  const access = await issueContractAgencyAccess(env, reservation, new Date().toISOString());
  await updateReservationStatus(env, reservation.id, "paid", { contractAgencyAccess: access.stored });
  await saveContractAgencyAccessIndex(env, reservation.id, access.stored.tokenHash, access.stored.expiresAt);
  const historicalKey = `inspection/${reservation.id}/depart/historical.png`;
  await env.DOCUMENTS_BUCKET.put(historicalKey, tinyPng, { httpMetadata: { contentType: "image/png" } });
  const record = JSON.parse(await env.RESERVATIONS_KV.get(reservation.id));
  record.contractDossier = { depart: null, retour: null, signature: { signatureId: "CONTRACT-UNCHANGED", imageDataUrl: "contract-only" }, media: { depart: [{ key: historicalKey, slot: "autre", createdAt: "2026-09-01T10:00:00.000Z" }], retour: [] } };
  await env.RESERVATIONS_KV.put(reservation.id, JSON.stringify(record));
  let ip = 0, failSave = false, failReads = false;
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname.startsWith("/api/")) {
        const buffers = []; for await (const chunk of req) buffers.push(chunk);
        const body = Buffer.concat(buffers), headers = { ...req.headers, "cf-connecting-ip": `198.51.${Math.floor(++ip / 250)}.${ip % 250}` };
        calls.push({ path: url.pathname, method: req.method, body: req.headers["content-type"] === "application/json" ? JSON.parse(body.toString()) : null });
        const request = new Request(url.href, { method: req.method, headers, ...(req.method === "GET" ? {} : { body }) });
        let response;
        if (url.pathname === "/api/contract-dossier-agency") response = failSave && req.method === "POST" ? new Response(JSON.stringify({ error: "Échec simulé" }), { status: 500 }) : await handleContractDossierAgency(request, env);
        else if (url.pathname === "/api/inspection-media") response = failReads && req.method === "GET" ? new Response(null, { status: 503 }) : await handleInspectionMedia(request, env);
        else if (url.pathname === "/api/legacy-inspection-agency") response = new Response(JSON.stringify({ inspection: { id: "res_legacy_fixture", client: { prenom: "Ancien", nom: "Client" }, vehicule: "Peugeot 2008", depart: { km: 4083, cles: 2, marques: [{ view: "left", type: "rayure", x: 20, y: 30 }], photos: [{ dataUrl: "data:image/png;base64," + tinyPng.toString("base64"), capturedAt: "2026-09-01T12:00", slot: "avant" }] } } }));
        else response = new Response(null, { status: 404 });
        res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer())); return;
      }
      const file = path.resolve(root, "." + (url.pathname === "/" ? "/etat-des-lieux.html" : url.pathname));
      if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
      const type = file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : file.endsWith(".png") ? "image/png" : "text/html";
      res.writeHead(200, { "Content-Type": type, "Content-Security-Policy": CSP }); res.end(fs.readFileSync(file));
    } catch (error) { res.writeHead(500); res.end(error.stack); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", args: ["--no-sandbox"] });
  t.after(async () => { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(() => { window.__printCalls = 0; window.print = () => { window.__printCalls++; }; });
  const page = await context.newPage(), errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const base = `http://127.0.0.1:${server.address().port}/etat-des-lieux.html`;
  const go = async mode => { await page.goto(base + "?mode=" + mode + "#agencyToken=" + access.token); await page.waitForSelector("#form:not([hidden])"); };
  const waitStatus = async value => { await page.waitForFunction(v => document.querySelector("#saveStatus").textContent === v, value); };
  await go("depart"); console.log("Départ chargé");
  await page.fill("#dateHeure", "2026-10-01T09:45"); await page.fill("#agent", "Agent V3"); await page.fill("#km", "4083"); await page.selectOption("#carburant", "90"); await page.fill("#cles", "2"); await page.fill("#clesAccessoires", "Double et câble");
  await page.click("[data-field=propreteExterieure] [data-score='2']"); await page.click("[data-field=propreteInterieure] [data-score='4']"); await page.click("[data-field=propreteChargement] [data-score='5']");
  await page.fill("#dommages", "Rayure profil conducteur. Éclat à l’avant.");
  await page.locator("#sketch .inspection-sketch-canvas[data-view=left]").click({ position: { x: 100, y: 70 } });
  await page.getByRole("button", { name: "● Éclat", exact: true }).click();
  await page.locator("#sketch .inspection-sketch-canvas[data-view=front]").click({ position: { x: 80, y: 50 } });
  await page.getByRole("button", { name: "O Bosse / impact", exact: true }).click();
  await page.locator("#sketch .inspection-sketch-canvas[data-view=right]").click({ position: { x: 100, y: 70 } });
  await page.getByRole("button", { name: "X Rayure", exact: true }).click();
  await page.locator("#sketch .inspection-sketch-canvas[data-view=rear]").click({ position: { x: 80, y: 50 } });
  await page.getByRole("button", { name: "● Éclat", exact: true }).click();
  await page.locator("#sketch .inspection-sketch-canvas[data-view=top]").click({ position: { x: 80, y: 150 } });
  await page.locator("#damageTable input").first().fill("Rayure profonde — porte avant gauche");
  const markPositions = await page.locator("#sketch [data-mark-id]").evaluateAll(nodes => nodes.map(n => [n.dataset.x, n.dataset.y, n.style.left, n.style.top]));
  assert.equal(markPositions.length, 5);
  // A tap on an existing numbered marker removes it. Re-add a temporary mark
  // first so the five required views remain represented in the saved dossier.
  await page.locator("#sketch .inspection-sketch-canvas[data-view=left]").click({ position: { x: 150, y: 90 } });
  assert.equal(await page.locator("#sketch [data-mark-id]").count(), 6);
  await page.locator("#sketch .inspection-sketch-canvas[data-view=left] [data-mark-id]").last().click();
  assert.equal(await page.locator("#sketch [data-mark-id]").count(), 5);
  const picture = Buffer.from(await page.evaluate(() => { const canvas = document.createElement("canvas"); canvas.width = 480; canvas.height = 640; const ctx = canvas.getContext("2d"); ctx.fillStyle = "#ff6b00"; ctx.fillRect(0, 0, 480, 640); ctx.fillStyle = "#0066ff"; ctx.fillRect(20, 30, 100, 200); return canvas.toDataURL("image/png").split(",")[1]; }), "base64");
  await page.locator("[data-slot=avant] input:not([capture])").setInputFiles([{ name: "front1.png", mimeType: "image/png", buffer: picture }, { name: "front2.png", mimeType: "image/png", buffer: picture }]);
  await page.locator("[data-slot=arriere] input[capture]").setInputFiles({ name: "rear-camera.png", mimeType: "image/png", buffer: picture });
  await waitStatus("Modifications non enregistrées");
  await page.waitForFunction(() => document.querySelectorAll('[data-slot=avant] .photo-item img').length === 2);
  console.log("Photos importées et décodées");
  const before = JSON.parse(await env.RESERVATIONS_KV.get(reservation.id)).contractDossier.media.depart.find(item => item.slot === "avant");
  await page.locator("[data-slot=avant] .photo-item input").first().fill("2026-10-01T08:20"); await page.locator("[data-slot=avant] .photo-item input").first().press("Tab");
  await waitStatus("Modifications non enregistrées");
  await page.click("#save"); await waitStatus("Modifications enregistrées");
  await page.reload(); await page.waitForSelector("#form:not([hidden])");
  console.log("Sauvegarde et rechargement effectués");
  assert.equal(await page.inputValue("#km"), "4083"); assert.equal(await page.inputValue("#dateHeure"), "2026-10-01T09:45"); assert.equal(await page.inputValue("#carburant"), "90");
  assert.equal(await page.locator("[data-field=propreteExterieure] [aria-pressed=true]").textContent(), "2"); assert.equal(await page.locator("[data-field=propreteInterieure] [aria-pressed=true]").textContent(), "4");
  assert.deepEqual(await page.locator("#sketch [data-mark-id]").evaluateAll(nodes => nodes.map(n => [n.dataset.x, n.dataset.y, n.style.left, n.style.top])), markPositions);
  assert.equal(await page.locator("#damageTable input").first().inputValue(), "Rayure profonde — porte avant gauche");
  assert.equal(await page.locator("[data-slot=avant] .photo-item input").first().inputValue(), "2026-10-01T08:20");
  const after = JSON.parse(await env.RESERVATIONS_KV.get(reservation.id)).contractDossier.media.depart.find(item => item.key === before.key); assert.equal(after.createdAt, before.createdAt);
  // Date remains editable after a save/reload, without changing the server import timestamp.
  await page.locator("[data-slot=avant] .photo-item input").first().fill("2026-10-01T08:25"); await page.locator("[data-slot=avant] .photo-item input").first().press("Tab"); await waitStatus("Modifications enregistrées");
  const changedDate = JSON.parse(await env.RESERVATIONS_KV.get(reservation.id)).contractDossier.media.depart.find(item => item.key === before.key);
  assert.equal(changedDate.capturedAt, "2026-10-01T08:25"); assert.equal(changedDate.createdAt, before.createdAt);
  const fragment = new URL(page.url()).hash; await page.locator('.step-nav a[href="#information"]').click(); assert.equal(new URL(page.url()).hash, fragment); assert.equal(await page.inputValue("#km"), "4083");
  // Historical photo has no delete action; only images uploaded in this V3 session can be deleted.
  assert.equal(await page.locator("[data-slot=autre]").getByRole("button", { name: "Supprimer", exact: true }).count(), 0);
  page.once("dialog", dialog => dialog.accept()); await page.locator("[data-slot=avant]").getByRole("button", { name: "Supprimer", exact: true }).last().click();
  await page.waitForFunction(() => document.querySelectorAll('[data-slot=avant] .photo-item').length === 1);
  await page.locator("[data-slot=tableau-de-bord] input:not([capture])").setInputFiles({ name: "dashboard.png", mimeType: "image/png", buffer: picture });
  await page.waitForFunction(() => document.querySelectorAll('[data-slot=tableau-de-bord] .photo-item').length === 1);
  for (const role of ["client", "agence"]) {
    await page.fill(`#signature-${role}-name`, role === "client" ? "Client V3" : "Agent V3");
    const canvas = page.locator(`canvas[data-role=${role}]`); await canvas.scrollIntoViewIfNeeded(); const box = await canvas.boundingBox();
    await page.mouse.move(box.x + 30, box.y + 30); await page.mouse.down(); await page.mouse.move(box.x + 120, box.y + 60, { steps: 6 }); await page.mouse.up();
  }
  await page.click("#save"); await waitStatus("Modifications enregistrées");
  await page.reload(); await page.waitForSelector("#form:not([hidden])");
  assert.equal(await page.inputValue("#signature-client-name"), "Client V3");
  await page.waitForFunction(() => [...document.querySelectorAll('.signature-pad')].every(canvas => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.some((value, index) => index % 4 === 3 && value > 0)));
  const saved = JSON.parse(await env.RESERVATIONS_KV.get(reservation.id)).contractDossier;
  assert.match(saved.depart.signatures.client.imageDataUrl, /^data:image\/png/); assert.match(saved.depart.signatures.agence.imageDataUrl, /^data:image\/png/);
  assert.equal(saved.signature.signatureId, "CONTRACT-UNCHANGED");
  for (const width of [375, 390, 430, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `pas de débordement à ${width}px`);
    assert.deepEqual(await page.locator("#sketch [data-mark-id]").evaluateAll(nodes => nodes.map(n => [n.dataset.x, n.dataset.y, n.style.left, n.style.top])), markPositions);
    await page.screenshot({ path: path.join(artifacts, `depart-${width}.png`), fullPage: true });
  }
  const print = async name => {
    const promised = context.waitForEvent("page"); await page.click("#pdf"); const popup = await promised;
    await popup.waitForFunction(() => document.body.dataset.ready === "true");
    assert.equal(popup.url(), "about:blank"); assert.equal(await popup.locator("input,select,textarea").count(), 0);
    assert.equal(await popup.locator("img").evaluateAll(images => images.every(im => im.complete && im.naturalWidth > 0 && (im.src.startsWith("data:image/") || im.src.includes("/images/inspection/")))), true);
    assert.equal(await popup.locator("body").textContent().then(text => text.includes(access.token) || text.includes("agencyToken")), false);
    const pdf = path.join(artifacts, name + ".pdf"); await popup.pdf({ path: pdf, preferCSSPageSize: true, printBackground: true, displayHeaderFooter: true });
    const content = execFileSync("pdftotext", [pdf, "-"], { encoding: "utf8" }); assert.equal(content.includes(access.token) || content.includes("agencyToken") || content.includes("about:blank"), false); assert.match(content, /Client V3/); assert.match(content, /Date\/heure :/); assert.match(content, /TABLEAU DE BORD/);
    const imageList = execFileSync("pdfimages", ["-list", pdf], { encoding: "utf8" }); assert.match(imageList, /480\s+640/);
    const textPages = content.split("\f"); const sketch = textPages.find(text => text.includes("Schéma annoté — " + name)); assert.ok(sketch); for (const label of ["Profil conducteur", "Avant", "Profil passager", "Arrière", "Dessus"]) assert.ok(sketch.includes(label), `${label} sur la même page croquis`);
    console.log("PDF vérifié :", name, "— photos incorporées, 5 vues sur une page, aucun token"); await popup.close();
  };
  await print("depart");
  const departure = JSON.parse(JSON.stringify(saved.depart));
  await go("retour"); assert.equal(await page.locator("#departCompare").isVisible(), true); assert.match(await page.locator("#departureValues").textContent(), /4083/);
  await page.fill("#km", "4082"); await page.fill("#agent", "Agent Retour"); await page.click("#save"); assert.match(await page.locator("#message").textContent(), /inférieur/);
  await page.fill("#km", "4500"); await page.fill("#dateHeure", "2026-10-08T18:20"); await page.selectOption("#carburant", "70");
  await page.locator("#sketch .inspection-sketch-canvas[data-view=rear]").click({ position: { x: 100, y: 50 } });
  await page.locator("[data-slot=avant] input:not([capture])").setInputFiles({ name: "return.png", mimeType: "image/png", buffer: picture }); await waitStatus("Modifications non enregistrées");
  await page.waitForFunction(() => document.querySelectorAll('#comparison img').length >= 2);
  await page.click("#save"); await waitStatus("Modifications enregistrées");
  const returned = JSON.parse(await env.RESERVATIONS_KV.get(reservation.id)).contractDossier;
  assert.deepEqual(returned.depart, departure); assert.equal(returned.retour.km, 4500); assert.equal(returned.media.retour.length, 1); assert.equal(returned.media.depart.length, 4);
  // A failed save preserves input and unsaved status.
  failSave = true; await page.fill("#agent", "Saisie conservée"); await page.click("#save"); await page.waitForFunction(() => document.querySelector("#message").textContent.includes("Échec simulé"));
  assert.equal(await page.inputValue("#agent"), "Saisie conservée"); assert.equal(await page.locator("#saveStatus").textContent(), "Modifications non enregistrées"); failSave = false;
  for (const role of ["client", "agence"]) {
    await page.fill(`#signature-${role}-name`, role === "client" ? "Client V3" : "Agent Retour");
    const canvas = page.locator(`canvas[data-role=${role}]`); await canvas.scrollIntoViewIfNeeded(); const box = await canvas.boundingBox();
    await page.mouse.move(box.x + 40, box.y + 35); await page.mouse.down(); await page.mouse.move(box.x + 170, box.y + 70, { steps: 6 }); await page.mouse.up();
  }
  await page.click("#save"); await waitStatus("Modifications enregistrées");
  await page.reload(); await page.waitForSelector("#form:not([hidden])");
  const signaturesReturn = JSON.parse(await env.RESERVATIONS_KV.get(reservation.id)).contractDossier;
  assert.match(signaturesReturn.retour.signatures.client.imageDataUrl, /^data:image\/png/); assert.match(signaturesReturn.retour.signatures.agence.imageDataUrl, /^data:image\/png/);
  assert.deepEqual(signaturesReturn.depart, departure); assert.equal(signaturesReturn.signature.signatureId, "CONTRACT-UNCHANGED");
  for (const width of [375, 390, 430]) { await page.setViewportSize({ width, height: 900 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `retour sans débordement à ${width}px`); }
  await print("retour");
  await page.click("#finalize"); await waitStatus("Modifications enregistrées"); assert.match(await page.locator("#reviewStatus").textContent(), /correction reste possible/);
  await page.fill("#agent", "Correction possible après finalisation"); assert.equal(await page.locator("#saveStatus").textContent(), "Modifications non enregistrées"); await page.click("#save"); await waitStatus("Modifications enregistrées");
  // Reload with unavailable media: no broken image icon, and no print with missing photos.
  // Routing disables Chromium's HTTP cache, so the simulated outage reaches the real GET handler.
  await context.route("**/api/inspection-media?**", route => route.continue());
  failReads = true; await page.reload(); await page.waitForSelector("#form:not([hidden])"); await page.waitForFunction(() => [...document.querySelectorAll(".photo-placeholder")].some(node => node.textContent.includes("inaccessible")));
  assert.equal(await page.locator("#photos img").count(), 0);
  const failedPopup = context.waitForEvent("page"); await page.click("#pdf"); const failed = await failedPopup;
  await page.waitForFunction(() => document.querySelector("#message").textContent.startsWith("PDF non imprimé")); assert.equal(await failed.evaluate(() => window.__printCalls), 0); await failed.close(); failReads = false;
  const writes = calls.filter(call => call.method !== "GET").length;
  await page.goto(base + "?source=legacy&legacyId=res_legacy_fixture&mode=depart"); await page.waitForSelector("#legacyContent:not([hidden]) img");
  assert.match(await page.locator("#legacyContent").textContent(), /4083/); assert.equal(calls.filter(call => call.method !== "GET").length, writes);
  assert.ok(objects.has(historicalKey)); assert.equal(deletes.includes(historicalKey), false); assert.equal(deletes.length, 1);
  assert.deepEqual(errors, []);
  console.log("Artifacts:", artifacts, "| API calls:", calls.length, "| private historical objects unchanged");
});
