const { checkRateLimit } = require("../lib/rate-limiter.js");
const { sendEmail } = require("../lib/resend-client.js");

const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers });
const clean = (value, max) => typeof value === "string" ? value.trim().slice(0, max) : "";
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function handleBusinessPartner(request, env) {
  if (request.method !== "POST") return reply(405, { error: "Méthode non autorisée" });
  const origin = request.headers.get("origin");
  if (origin !== new URL(request.url).origin && origin !== "https://getlocation.fr" && origin !== "https://www.getlocation.fr") return reply(403, { error: "Origine non autorisée" });
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const limit = await checkRateLimit(env, `business-partner:${ip}`, { windowMs: 3600000, maxRequests: 5 });
  if (!limit.allowed) return reply(429, { error: "Trop de demandes" });
  const raw = await request.text();
  if (raw.length > 4000) return reply(413, { error: "Demande trop longue" });
  let data;
  try { data = JSON.parse(raw); } catch (_) { return reply(400, { error: "Demande invalide" }); }
  const name = clean(data.name, 100), company = clean(data.company, 150), email = clean(data.email, 200);
  const phone = clean(data.phone, 40), message = clean(data.message, 1500);
  const benefits = Array.isArray(data.benefits) ? data.benefits.filter((item) => ["remuneration", "credits", "days", "talk"].includes(item)) : [];
  if (name.length < 2 || company.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || (phone && !/^[+\d\s().-]{6,40}$/.test(phone))) return reply(400, { error: "Informations invalides" });
  if (!env.RESEND_API_KEY || !env.AGENCY_EMAIL) return reply(503, { error: "Service indisponible" });
  const labels = { remuneration: "Rémunération partenaire", credits: "Crédits GetLocation", days: "Journées offertes", talk: "Je souhaite en discuter" };
  const benefitsText = benefits.length ? benefits.map((benefit) => labels[benefit]).join(", ") : "Non précisé";
  const text = `Nouvelle demande GetLocation Business — Tourisme\n\nNom : ${name}\nÉtablissement : ${company}\nE-mail : ${email}\nTéléphone : ${phone || "Non renseigné"}\nAvantages : ${benefitsText}\n\nMessage :\n${message || "Non renseigné"}`;
  try {
    await sendEmail(env.RESEND_API_KEY, { from: env.RESEND_FROM || "GET LOCATION <reservations@getlocation.fr>", to: [env.AGENCY_EMAIL], subject: `Nouvelle demande Business — ${company}`, text, html: `<h2>Nouvelle demande GetLocation Business — Tourisme</h2><p><strong>Nom :</strong> ${escapeHtml(name)}<br><strong>Établissement :</strong> ${escapeHtml(company)}<br><strong>E-mail :</strong> ${escapeHtml(email)}<br><strong>Téléphone :</strong> ${escapeHtml(phone || "Non renseigné")}<br><strong>Avantages :</strong> ${escapeHtml(benefitsText)}</p><p><strong>Message :</strong><br>${escapeHtml(message || "Non renseigné").replace(/\n/g, "<br>")}</p>` });
    return reply(201, { status: "received" });
  } catch (error) {
    console.error("[business-partner] échec de notification", error);
    return reply(503, { error: "Service indisponible" });
  }
}

module.exports = { handleBusinessPartner };
