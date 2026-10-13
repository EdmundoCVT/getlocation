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
    assert.match(error.message, /enregistrement de la photo/);
    assert.match(error.message, /HTTP 404/);
    assert.match(error.message, /\/api\/standalone-inspection-media/);
    assert.match(error.message, /page HTML/);
    assert.doesNotMatch(error.message, /DOCTYPE|secret interne|Unexpected token/);
    return true;
  });
  dom.window.close();
});
