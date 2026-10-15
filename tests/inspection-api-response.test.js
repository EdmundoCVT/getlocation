const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

function inspectionMedia() {
  const dom = new JSDOM("<!doctype html><body></body>", { url: "https://getlocation.fr/etat-des-lieux.html", runScripts: "outside-only" });
  dom.window.eval(fs.readFileSync(path.join(__dirname, "..", "js", "inspection-media-view.js"), "utf8"));
  return { dom, media: dom.window.InspectionMedia };
}

test("réponse HTML d'une API photo devient une erreur explicite sans exposer le HTML", async () => {
  const { dom, media } = inspectionMedia();
  const response = new Response("<!DOCTYPE html><html><body>secret interne</body></html>", { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } });
  Object.defineProperty(response, "url", { value: "https://getlocation.fr/api/standalone-inspection-media?id=edl_secret" });
  await assert.rejects(() => media.parseApiResponse(response), (error) => {
    assert.match(error.message, /Upload photo impossible/);
    assert.match(error.message, /HTTP 404/);
    assert.match(error.message, /\/api\/standalone-inspection-media/);
    assert.match(error.message, /HTML au lieu de JSON/);
    assert.doesNotMatch(error.message, /DOCTYPE|secret interne|Unexpected token/);
    return true;
  });
  dom.window.close();
});

test("une erreur JSON EDL expose seulement son identifiant et son diagnostic safe", async () => {
  const { dom, media } = inspectionMedia();
  const diagnostic = { stage: "before-kv-write", recordBytes: 824531, revisionCount: 4, signatureBytes: 118000, mediaCount: 8 };
  const response = new Response(JSON.stringify({ error: "Erreur serveur", requestId: "edlreq_ab12cd34", diagnostic }), { status: 503, headers: { "Content-Type": "application/json", "X-EDL-Request-ID": "edlreq_ab12cd34" } });
  Object.defineProperty(response, "url", { value: "https://getlocation.fr/api/standalone-inspections" });
  await assert.rejects(() => media.parseApiResponse(response), error => {
    assert.equal(error.status, 503);
    assert.equal(error.requestId, "edlreq_ab12cd34");
    assert.deepEqual(error.diagnostic, diagnostic);
    return true;
  });
  dom.window.close();
});
