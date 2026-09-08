// src/lib/google-sheets-client.js
//
// Client Google Sheets minimal basé sur fetch() natif (Lot 3, voir
// CLAUDE.md) — même principe que src/lib/mollie-client.js : pas de SDK
// googleapis (cible Node classique, aucune garantie de compatibilité avec
// le runtime Cloudflare Workers ; empreinte bien plus lourde qu'une poignée
// d'appels REST). N'implémente que ce dont src/lib/sheet-sync.js a besoin :
// lire des valeurs, en écrire/ajouter, et lire les métadonnées de cellule
// (formule, validation de données) nécessaires pour ne jamais écraser une
// formule ni forcer une valeur hors validation.

const { getAccessToken } = require("./google-auth.js");

const SHEETS_API_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

class GoogleSheetsApiError extends Error {
  constructor(message, statusCode, body) {
    super(message);
    this.name = "GoogleSheetsApiError";
    this.statusCode = statusCode;
    this.body = body;
  }
}

async function sheetsRequest(env, path, { method = "GET", query, body } = {}) {
  const spreadsheetId = env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!spreadsheetId) throw new GoogleSheetsApiError("GOOGLE_SHEETS_SPREADSHEET_ID manquant", 0, null);

  const token = await getAccessToken(env);
  const url = new URL(`${SHEETS_API_BASE}/${spreadsheetId}${path}`);
  if (query) Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new GoogleSheetsApiError((json && json.error && json.error.message) || `Erreur Google Sheets (${res.status})`, res.status, json);
  }
  return json;
}

// Enferme systématiquement le nom de la feuille entre apostrophes (voir
// notation A1) — nécessaire dès qu'il contient un espace ou un accent
// composé, inoffensif sinon.
function quoteSheetName(sheetName) {
  return `'${sheetName.replace(/'/g, "''")}'`;
}

async function getValues(env, sheetName, a1Range) {
  const range = `${quoteSheetName(sheetName)}!${a1Range}`;
  const json = await sheetsRequest(env, `/values/${encodeURIComponent(range)}`, {
    query: { valueRenderOption: "UNFORMATTED_VALUE", dateTimeRenderOption: "FORMATTED_STRING" }
  });
  return json.values || [];
}

// valueInputOption=USER_ENTERED : Google interprète les valeurs comme si
// elles étaient tapées à la main (formatage automatique des dates/nombres,
// cohérent avec les autres lignes déjà saisies manuellement par l'agence) —
// jamais RAW, qui figerait tout en texte brut.
async function updateValues(env, sheetName, a1Range, values) {
  const range = `${quoteSheetName(sheetName)}!${a1Range}`;
  return sheetsRequest(env, `/values/${encodeURIComponent(range)}`, {
    method: "PUT",
    query: { valueInputOption: "USER_ENTERED" },
    body: { range, values }
  });
}

async function appendValues(env, sheetName, values) {
  const range = `${quoteSheetName(sheetName)}!A1`;
  return sheetsRequest(env, `/values/${encodeURIComponent(range)}:append`, {
    method: "POST",
    query: { valueInputOption: "USER_ENTERED", insertDataOption: "INSERT_ROWS" },
    body: { values }
  });
}

// Métadonnées riches (formule éventuelle + règle de validation) d'une ligne
// précise — voir sheet-sync.js, protège contre l'écrasement d'une formule
// ou d'une valeur hors liste de validation. `values.get` seul ne renvoie
// jamais ces informations, d'où un appel distinct à spreadsheets.get.
async function getRowMeta(env, sheetName, rowNumber, lastColumnLetter) {
  const range = `${quoteSheetName(sheetName)}!A${rowNumber}:${lastColumnLetter}${rowNumber}`;
  const json = await sheetsRequest(env, "", {
    query: {
      ranges: range,
      fields: "sheets.data.rowData.values(userEnteredValue,dataValidation)"
    }
  });
  const rowData = json.sheets && json.sheets[0] && json.sheets[0].data && json.sheets[0].data[0] && json.sheets[0].data[0].rowData;
  return (rowData && rowData[0] && rowData[0].values) || [];
}

module.exports = { getValues, updateValues, appendValues, getRowMeta, GoogleSheetsApiError };
