#!/usr/bin/env node
"use strict";

// Fixture locale volontairement lourde pour quantifier le coût structurel des
// révisions EDL. Elle n'accède jamais à Cloudflare et ne contient aucune donnée
// réelle : KV, D1 et R2 sont les doubles en mémoire utilisés par les tests.
const { performance } = require("node:perf_hooks");
const { handleStandaloneInspections } = require("../src/api/standalone-inspections.js");
const { handleStandaloneInspectionMedia } = require("../src/api/standalone-inspection-media.js");
const { createFakeKv } = require("../tests/helpers/fake-kv.js");
const { makeAgencyEnv, loginAgency, agencyRequest } = require("../tests/helpers/agency-session.js");

function bucket() {
  const objects = new Map();
  return {
    async put(key, value, metadata) { objects.set(key, { value, metadata }); },
    async get(key) {
      const item = objects.get(key);
      if (!item) return null;
      return { body: item.value, httpMetadata: item.metadata && item.metadata.httpMetadata, async arrayBuffer() { return new Uint8Array(item.value).buffer; } };
    },
    async delete(key) { objects.delete(key); }
  };
}

const signature = "data:image/png;base64," + "A".repeat(120000);
function snapshot(mode, version) {
  return {
    dateHeure: `2026-10-${String(10 + version).padStart(2, "0")}T18:00`,
    km: 40000 + version * 120,
    carburant: mode === "retour" ? 60 : 100,
    propreteExterieure: 4,
    propreteInterieure: 4,
    propreteChargement: null,
    cles: 2,
    clesAccessoires: "Deux clés et pochette",
    agent: "Agent fixture",
    dommages: "Remarque synthétique de charge, sans donnée réelle. ".repeat(20),
    sketchVehicleType: "car",
    marks: [
      { id: "m1", view: "left", type: "rayure", x: 35.2, y: 54.1, description: "Marque synthétique avant gauche" },
      { id: "m2", view: "rear", type: "eclat", x: 62.4, y: 43.8, description: "Marque synthétique arrière" }
    ],
    utilityMarks: [],
    signatures: {
      client: { name: "Client fixture", imageDataUrl: signature },
      agence: { name: "Agence fixture", imageDataUrl: signature }
    }
  };
}

let requestSequence = 0;
async function run() {
  const env = makeAgencyEnv({ RESERVATIONS_KV: createFakeKv(), DOCUMENTS_BUCKET: bucket() });
  const session = await loginAgency(env);
  const measurements = [];

  async function post(body) {
    requestSequence += 1;
    const id = "edlreq_" + requestSequence.toString(16).padStart(8, "0");
    const request = agencyRequest("https://getlocation.fr/api/standalone-inspections", { method: "POST", session, body });
    request.headers.set("X-EDL-Request-ID", id);
    const started = performance.now();
    const response = await handleStandaloneInspections(request, env);
    const responseText = await response.text();
    const elapsedMs = Math.round((performance.now() - started) * 10) / 10;
    const payload = JSON.parse(responseText);
    if (!response.ok) throw new Error(response.status + " " + JSON.stringify(payload));
    return { payload, elapsedMs, responseBytes: Buffer.byteLength(responseText) };
  }

  async function uploadMedia(inspectionId, mode, revision, count) {
    for (let index = 0; index < count; index++) {
      const form = new FormData();
      form.set("stage", mode);
      form.set("revision", String(revision));
      form.set("slot", index % 2 ? "gauche" : "avant-gauche");
      form.set("capturedAt", "2026-10-15T18:00");
      form.set("file", new File([`fixture-${revision}-${index}`], `fixture-${revision}-${index}.jpg`, { type: "image/jpeg" }));
      const response = await handleStandaloneInspectionMedia(new Request("https://getlocation.fr/api/standalone-inspection-media?id=" + inspectionId, { method: "POST", headers: { origin: "https://getlocation.fr", cookie: "agency_session=" + session.cookie, "x-agency-csrf": session.csrfToken }, body: form }), env);
      if (!response.ok) throw new Error("Upload fixture impossible : " + response.status);
    }
  }

  async function create(mode) {
    return (await post({ action: "create", mode, client: { prenom: "Fixture", nom: "Charge" }, vehicule: { nom: "Véhicule synthétique", immatriculation: "TEST-000" } })).payload.inspection;
  }

  async function saveVersion(inspection, mode, version, finalize) {
    await uploadMedia(inspection.id, mode, version, version === 1 ? 8 : 1);
    const saved = await post({ action: "update-stage", id: inspection.id, revision: version, stage: snapshot(mode, version), finalize: false });
    const diagnostic = saved.payload.diagnostic;
    measurements.push({ mode, version, operation: "save", elapsedMs: saved.elapsedMs, responseBytes: saved.responseBytes, ...diagnostic });
    if (!finalize) return saved.payload.inspection;
    const finalized = await post({ action: "update-stage", id: inspection.id, revision: version, stage: saved.payload.revision.snapshot, finalize: true });
    measurements.push({ mode, version, operation: "finalize", elapsedMs: finalized.elapsedMs, responseBytes: finalized.responseBytes, ...finalized.payload.diagnostic });
    return finalized.payload.inspection;
  }

  let depart = await create("depart");
  depart = await saveVersion(depart, "depart", 1, false);

  let retour = await create("retour");
  for (let version = 1; version <= 6; version++) {
    retour = await saveVersion(retour, "retour", version, version < 6);
    if (version < 6) {
      const correction = await post({ action: "create-revision", id: retour.id, stage: "retour", baseRevision: version, revisionReason: "Fixture de charge V" + (version + 1) });
      retour = correction.payload.inspection;
    }
  }

  process.stdout.write(JSON.stringify({ generatedAt: new Date().toISOString(), signatureBytesPerSnapshot: Buffer.byteLength(signature) * 2, measurements }, null, 2) + "\n");
}

run().catch(error => { console.error(error); process.exitCode = 1; });
