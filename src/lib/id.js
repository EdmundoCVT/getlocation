// src/lib/id.js
//
// Générateur d'identifiants opaques partagé par les modules du mini-back-
// office agence (clients, rentals, payments, deposits, additional_drivers)
// — même technique que generateReservationId() dans reservation-store.js
// (16 octets aléatoires, hexadécimal), factorisée ici pour ne pas la
// dupliquer 5 fois.

function generateId(prefix) {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${prefix}_${hex}`;
}

module.exports = { generateId };
