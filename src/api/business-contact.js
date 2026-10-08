const { checkRateLimit } = require("../lib/rate-limiter.js");
const { sendEmail } = require("../lib/resend-client.js");

const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers });
const TYPES = new Set(["garage", "hebergement", "corporate", "pro", "autre"]);
const PREFERENCES = new Set(["WhatsApp", "Appel", "Email"]);
const labels = {
  garage: "Véhicule de remplacement pour garage / carrosserie",
  hebergement: "Partenariat hébergement / conciergerie",
  corporate: "Véhicule pour collaborateur / entreprise",
  pro: "Besoin professionnel spécifique",
  autre: "Autre demande"
};

const clean = (value, max) => typeof value === "string" ? value.trim().slice(0, max) : "";
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const emailValid = (value) => !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

async function handleBusinessContact(request, env) {
  if (request.method !== "POST") return reply(405, { error: "Méthode non autorisée" });
  const origin = request.headers.get("origin");
  if (origin !== new URL(request.url).origin && origin !== "https://getlocation.fr" && origin !== "https://www.getlocation.fr") {
    return reply(403, { error: "Origine non autorisée" });
  }
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const limit = await checkRateLimit(env, `business-contact:${ip}`, { windowMs: 3600000, maxRequests: 5 });
  if (!limit.allowed) return reply(429, { error: "Trop de demandes" });

  const raw = await request.text();
  if (raw.length > 6000) return reply(413, { error: "Demande trop longue" });
  let data;
  try { data = JSON.parse(raw); } catch (_) { return reply(400, { error: "Demande invalide" }); }

  const type = clean(data.type, 30), name = clean(data.name, 100), company = clean(data.company, 150);
  const phone = clean(data.phone, 40), email = clean(data.email, 200), city = clean(data.city, 100);
  const postcode = clean(data.postcode, 20), preference = clean(data.preference, 20);
  const message = clean(data.message, 1500), source = clean(data.source, 500);
  if (!TYPES.has(type) || name.length < 2 || !/^[+\d\s().-]{6,40}$/.test(phone) ||
      message.length < 2 || !emailValid(email) || !PREFERENCES.has(preference)) {
    return reply(400, { error: "Informations invalides" });
  }

  const recipient = env.BUSINESS_CONTACT_EMAIL || env.AGENCY_EMAIL;
  if (!env.RESEND_API_KEY || !recipient) return reply(503, { error: "Service indisponible" });
  const createdAt = new Date().toISOString();
  const text = `Nouvelle demande professionnelle reçue depuis GetLocation.fr

Type de demande : ${labels[type]}
Nom : ${name}
Société / établissement : ${company || "Non renseigné"}
Téléphone : ${phone}
Email : ${email || "Non renseigné"}
Ville : ${city || "Non renseignée"}
Code postal : ${postcode || "Non renseigné"}
Préférence de contact : ${preference}

Message :
${message}

Page d’origine : ${source || "Non précisée"}
Date de la demande : ${createdAt}`;
  const details = [
    ["Type de demande", labels[type]], ["Nom", name], ["Société / établissement", company || "Non renseigné"],
    ["Téléphone", phone], ["Email", email || "Non renseigné"], ["Ville", city || "Non renseignée"],
    ["Code postal", postcode || "Non renseigné"], ["Préférence de contact", preference],
    ["Page d’origine", source || "Non précisée"], ["Date de la demande", createdAt]
  ].map(([label, value]) => `<li><strong>${escapeHtml(label)} :</strong> ${escapeHtml(value)}</li>`).join("");

  try {
    await sendEmail(env.RESEND_API_KEY, {
      from: env.RESEND_FROM || "GET LOCATION <reservations@getlocation.fr>",
      to: [recipient],
      subject: "Nouvelle demande Business GetLocation",
      text,
      html: `<h2>Nouvelle demande professionnelle reçue depuis GetLocation.fr</h2><ul>${details}</ul><p><strong>Message :</strong><br>${escapeHtml(message).replace(/\n/g, "<br>")}</p>`
    });
    return reply(201, { status: "received" });
  } catch (error) {
    console.error("[business-contact] échec de notification", error && error.message);
    return reply(503, { error: "Service indisponible" });
  }
}

module.exports = { handleBusinessContact };
