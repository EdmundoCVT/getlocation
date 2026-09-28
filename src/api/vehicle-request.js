const { checkRateLimit } = require("../lib/rate-limiter.js");
const { sendEmail } = require("../lib/resend-client.js");

const REQUEST_IDS = new Set([
  "sans-permis-request", "mercedes-cle-cabriolet-request", "audi-a5-cabriolet-request",
  "bmw-serie-4-cabriolet-request", "porsche-macan-request",
  "range-rover-velar-request", "mercedes-gle-request"
]);
const jsonHeaders = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: jsonHeaders });

async function handleVehicleRequest(request, env) {
  if (request.method !== "POST") return reply(405, { error: "Méthode non autorisée" });
  const origin = request.headers.get("origin");
  if (origin !== new URL(request.url).origin && origin !== "https://getlocation.fr" && origin !== "https://www.getlocation.fr") {
    return reply(403, { error: "Origine non autorisée" });
  }
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const limit = await checkRateLimit(env, `vehicle-request:${ip}`, { windowMs: 3600000, maxRequests: 5 });
  if (!limit.allowed) return reply(429, { error: "Trop de demandes" });
  const raw = await request.text();
  if (raw.length > 3000) return reply(413, { error: "Demande trop longue" });
  let data;
  try { data = JSON.parse(raw); } catch (_) { return reply(400, { error: "Demande invalide" }); }
  const val = key => typeof data[key] === "string" ? data[key].trim() : "";
  const vehicleId = val("vehicleId");
  const name = val("name"), email = val("email"), phone = val("phone");
  const dateDebut = val("dateDebut"), dateFin = val("dateFin");
  const heureDebut = val("heureDebut"), heureFin = val("heureFin");
  const adressePrise = val("adressePrise");
  if (!REQUEST_IDS.has(vehicleId) || name.length < 2 || name.length > 100 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200 ||
      !/^[+\d\s().-]{6,40}$/.test(phone) || adressePrise.length > 250 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(dateDebut) || !/^\d{4}-\d{2}-\d{2}$/.test(dateFin) ||
      !/^\d{2}:\d{2}$/.test(heureDebut) || !/^\d{2}:\d{2}$/.test(heureFin) ||
      !(new Date(`${dateFin}T${heureFin}:00`) > new Date(`${dateDebut}T${heureDebut}:00`))) {
    return reply(400, { error: "Informations invalides" });
  }
  if (!env.RESERVATIONS_KV || !env.RESEND_API_KEY || !env.AGENCY_EMAIL) {
    return reply(503, { error: "Service indisponible" });
  }
  const id = crypto.randomUUID();
  const record = { id, status: "pending", vehicleId, name, email, phone, dateDebut, dateFin,
    heureDebut, heureFin, adressePrise, createdAt: new Date().toISOString() };
  try {
    await env.RESERVATIONS_KV.put(`vehicle-request:${id}`, JSON.stringify(record));
    await sendEmail(env.RESEND_API_KEY, {
      from: env.RESEND_FROM || "GET LOCATION <reservations@getlocation.fr>",
      to: [env.AGENCY_EMAIL],
      subject: `Nouvelle demande véhicule — ${vehicleId}`,
      text: `Demande ${id}\nVéhicule : ${vehicleId}\nDates : ${dateDebut} ${heureDebut} au ${dateFin} ${heureFin}\nLivraison : ${adressePrise}\nNom : ${name}\nEmail : ${email}\nTéléphone : ${phone}\nDisponibilité à confirmer avant paiement.`
    });
    return reply(201, { id, status: "pending" });
  } catch (error) {
    console.error("[vehicle-request] échec stockage ou notification", error);
    return reply(503, { error: "Service indisponible" });
  }
}

module.exports = { handleVehicleRequest };
