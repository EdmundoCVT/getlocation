const { getVehiculeParId } = require("../../js/data.js");
const { sendEmail } = require("./resend-client.js");

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
}

function vehicleName(reservation) {
  const vehicle = getVehiculeParId(reservation.vehiculeId);
  return vehicle ? vehicle.nom : reservation.vehiculeId;
}

function driverName(reservation) {
  const driver = reservation.conducteur || {};
  return [driver.prenom, driver.nom].filter(Boolean).join(" ") || "Client non renseigné";
}

function locationLabel(reservation, type) {
  const place = reservation[type === "pickup" ? "lieuPrise" : "lieuRetour"] || "À confirmer";
  const city = reservation[type === "pickup" ? "adressePrise" : "adresseRetour"];
  return city ? `${place} — ${city}` : place;
}

function whatsappUrl(reservation) {
  const phone = String(reservation.conducteur && reservation.conducteur.telephone || "").replace(/\D/g, "");
  if (!phone) return null;
  const normalized = phone.startsWith("0") ? `33${phone.slice(1)}` : phone;
  const message = `Bonjour, je vous contacte au sujet de votre réservation ${reservation.id}.`;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}

function eventLine(event) {
  const reservation = event.reservation;
  const hour = event.type === "pickup" ? reservation.heureDebut : reservation.heureFin;
  const type = event.type === "pickup" ? "Départ" : "Retour";
  const docs = reservation.documentsStatus === "submitted" ? "documents reçus" : "dossier incomplet";
  return `${type} ${hour || "heure à confirmer"} — ${vehicleName(reservation)} — ${driverName(reservation)} — ${locationLabel(reservation, event.type)} — ${docs} — ${reservation.id}`;
}

function buildAgencyDailySummaryContent(date, events) {
  const pickups = events.filter((event) => event.type === "pickup");
  const returns = events.filter((event) => event.type === "return");
  const subject = `Planning GET LOCATION du ${date} — ${pickups.length} départ(s), ${returns.length} retour(s)`;
  const text = [
    `Planning du ${date}`, "",
    ...events.flatMap((event) => {
      const reservation = event.reservation;
      const phone = reservation.conducteur && reservation.conducteur.telephone;
      const email = reservation.conducteur && reservation.conducteur.email;
      return [eventLine(event), `Contact : ${phone || "non renseigné"}${email ? ` — ${email}` : ""}`, whatsappUrl(reservation) || "", ""];
    })
  ].join("\n");
  const sections = events.map((event) => {
    const reservation = event.reservation;
    const contactUrl = whatsappUrl(reservation);
    const phone = reservation.conducteur && reservation.conducteur.telephone || "non renseigné";
    const email = reservation.conducteur && reservation.conducteur.email || "non renseigné";
    return `<li style="margin-bottom:16px"><strong>${escapeHtml(eventLine(event))}</strong><br>Contact : ${escapeHtml(phone)} — ${escapeHtml(email)}${contactUrl ? `<br><a href="${escapeHtml(contactUrl)}">Contacter sur WhatsApp</a>` : ""}</li>`;
  }).join("");
  const html = `<h2>Planning du ${escapeHtml(date)}</h2><p><strong>${pickups.length} départ(s) — ${returns.length} retour(s)</strong></p><ul>${sections}</ul>`;
  return { subject, text, html };
}

async function sendAgencyDailySummaryEmail(env, date, events) {
  if (!env.RESEND_API_KEY || !env.AGENCY_EMAIL || !events.length) return false;
  try {
    await sendEmail(env.RESEND_API_KEY, {
      from: env.RESEND_FROM || "GET LOCATION <reservations@getlocation.fr>",
      to: [env.AGENCY_EMAIL],
      ...buildAgencyDailySummaryContent(date, events)
    });
    return true;
  } catch (err) {
    console.error("[agency-daily-summary] Échec d'envoi", err && err.message);
    return false;
  }
}

module.exports = { buildAgencyDailySummaryContent, sendAgencyDailySummaryEmail };
