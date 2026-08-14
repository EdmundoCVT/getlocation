// src/lib/resend-client.js
//
// Client minimal pour l'API HTTP de Resend (https://resend.com/docs/api-reference/emails/send-email),
// utilisé en remplacement de nodemailer/SMTP Gmail (Phase A) — nodemailer
// s'appuie sur des sockets TCP brutes que le runtime Cloudflare Workers ne
// fournit pas nativement, contrairement à l'environnement Node classique de
// Netlify Functions.

const RESEND_API_URL = "https://api.resend.com/emails";

async function sendEmail(apiKey, { from, to, bcc, subject, text, html }) {
  const res = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ from, to, bcc, subject, text, html })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend a répondu ${res.status} : ${body.slice(0, 300)}`);
  }
  return res.json();
}

module.exports = { sendEmail };
