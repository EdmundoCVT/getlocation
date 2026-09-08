// tests/helpers/google-sheets-fake.js
//
// Faux backend Google (endpoint de jeton OAuth2 + API Sheets v4) utilisé à
// la place de fetch() global — même principe que withFakeFetch dans
// tests/worker-mollie-client.test.js. Ne comprend QUE les formes de
// requêtes réellement émises par src/lib/google-auth.js et
// src/lib/google-sheets-client.js (pas un simulateur Sheets générique).
//
// state.rows : lignes de données (hors en-tête, ligne 1). state.headers :
// ligne d'en-tête. state.cellMeta["<ligne>:<colonne 0-indexée>"] : override
// {formulaValue} et/ou {validationList: [...]} pour simuler une cellule
// protégée (formule existante ou liste de validation) sur une ligne
// existante — voir sheet-sync.js, computeWritableRuns.

function colIndex(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1; // 0-indexé
}

function decodeRange(range) {
  // Retire l'éventuel "'Nom de feuille'!" en tête.
  const withoutSheet = range.replace(/^'(?:[^']|'')*'!/, "");
  const m = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(withoutSheet);
  if (!m) throw new Error("fake-google-sheets: plage non reconnue : " + range);
  const [, c1, r1, c2, r2] = m;
  return { col1: colIndex(c1), row1: Number(r1), col2: c2 ? colIndex(c2) : colIndex(c1), row2: r2 ? Number(r2) : Number(r1) };
}

function createFakeGoogleSheets({ headers = [], rows = [], cellMeta = {} } = {}) {
  const state = { headers: headers.slice(), rows: rows.map((r) => r.slice()), cellMeta: { ...cellMeta } };
  const calls = [];

  function rowAt(rowNumber) {
    if (rowNumber === 1) return state.headers;
    return state.rows[rowNumber - 2] || [];
  }

  async function fakeFetch(input, init = {}) {
    const url = new URL(typeof input === "string" ? input : input.url);
    calls.push({ url: url.toString(), method: init.method || "GET" });

    if (url.hostname === "oauth2.googleapis.com") {
      return new Response(JSON.stringify({ access_token: "fake-access-token", expires_in: 3600 }), { status: 200 });
    }

    if (url.hostname !== "sheets.googleapis.com") {
      throw new Error("fake-google-sheets: hôte non reconnu : " + url.hostname);
    }

    const path = decodeURIComponent(url.pathname);
    const valuesMatch = /\/v4\/spreadsheets\/[^/]+\/values\/(.+?)(:append)?$/.exec(path);

    if (valuesMatch && !valuesMatch[2] && (!init.method || init.method === "GET")) {
      const { col1, row1, col2, row2 } = decodeRange(valuesMatch[1]);
      const values = [];
      for (let r = row1; r <= row2; r++) {
        const row = rowAt(r);
        values.push(row.slice(col1, col2 + 1));
      }
      return new Response(JSON.stringify({ values }), { status: 200 });
    }

    if (valuesMatch && !valuesMatch[2] && init.method === "PUT") {
      const { col1, row1 } = decodeRange(valuesMatch[1]);
      const body = JSON.parse(init.body);
      body.values.forEach((rowValues, i) => {
        const target = rowAt(row1 + i);
        rowValues.forEach((v, j) => { target[col1 + j] = v; });
      });
      return new Response(JSON.stringify({ updatedCells: body.values.flat().length }), { status: 200 });
    }

    if (valuesMatch && valuesMatch[2] === ":append") {
      const body = JSON.parse(init.body);
      state.rows.push(...body.values);
      return new Response(JSON.stringify({ updates: { updatedRange: `A${state.rows.length + 1}` } }), { status: 200 });
    }

    // spreadsheets.get (métadonnées de cellule) : /v4/spreadsheets/{id}?ranges=...&fields=...
    if (/\/v4\/spreadsheets\/[^/]+$/.test(path)) {
      const range = url.searchParams.get("ranges");
      const { col1, row1, col2 } = decodeRange(range);
      const values = [];
      for (let c = col1; c <= col2; c++) {
        const meta = state.cellMeta[`${row1}:${c}`] || {};
        const cell = {};
        if (meta.formulaValue) cell.userEnteredValue = { formulaValue: meta.formulaValue };
        if (meta.validationList) cell.dataValidation = { condition: { type: "ONE_OF_LIST", values: meta.validationList.map((v) => ({ userEnteredValue: v })) } };
        values.push(cell);
      }
      return new Response(JSON.stringify({ sheets: [{ data: [{ rowData: [{ values }] }] }] }), { status: 200 });
    }

    throw new Error("fake-google-sheets: requête non reconnue : " + path);
  }

  return { fakeFetch, state, calls };
}

async function withFakeGoogleSheets(fake, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = fake.fakeFetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

module.exports = { createFakeGoogleSheets, withFakeGoogleSheets };
