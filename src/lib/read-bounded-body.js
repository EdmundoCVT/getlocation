// src/lib/read-bounded-body.js
//
// Lit le corps d'une Request en comptant réellement les octets reçus,
// indépendamment de l'en-tête Content-Length (absent ou mensonger en
// Transfer-Encoding: chunked, par exemple). Interrompt la lecture réseau
// dès que la limite est dépassée — jamais après avoir tout bufferisé — et
// ne renvoie donc jamais un corps partiel au-delà de la limite autorisée :
// voir la revue de sécurité des PR #3-8 (finding "faible", limite de taille
// contournable) et son correctif dans documents-submit.js.

class RequestTooLargeError extends Error {
  constructor(maxBytes) {
    super(`Corps de requête supérieur à ${maxBytes} octets`);
    this.name = "RequestTooLargeError";
  }
}

async function readBoundedBody(request, maxBytes) {
  if (!request.body) return new Uint8Array(0);

  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      // N'accumule jamais plus que la limite autorisée : la lecture réseau
      // est annulée immédiatement, aucun octet au-delà du seuil n'est
      // conservé, et aucun fichier partiel ne peut donc jamais atteindre la
      // validation ni R2.
      await reader.cancel().catch(() => undefined);
      throw new RequestTooLargeError(maxBytes);
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

module.exports = { readBoundedBody, RequestTooLargeError };
