// Lien client opaque de préautorisation. Il ne contient ni montant, ni
// identité, ni identifiant Mollie : la vérification se fait exclusivement
// côté serveur sur l'empreinte HMAC stockée en D1.
const { resolveCustomerDepositLink, DepositLinkConfigurationError } = require("../lib/deposits.js");
const { getPayment } = require("../lib/mollie-client.js");

async function handleDepositCheckout(request, env) {
  if (request.method !== "GET") return new Response(JSON.stringify({ error: "Méthode non autorisée" }), { status: 405, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  try {
    const token = new URL(request.url).searchParams.get("token") || "";
    const deposit = await resolveCustomerDepositLink(env, token);
    if (!deposit || deposit.provider !== "mollie" || !deposit.molliePaymentId) {
      return new Response(JSON.stringify({ error: "Ce lien de dépôt est invalide ou expiré." }), { status: 404, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
    }
    if (!env.MOLLIE_API_KEY) throw new Error("Configuration Mollie indisponible");
    const payment = await getPayment(env.MOLLIE_API_KEY, deposit.molliePaymentId);
    const checkoutUrl = payment._links && payment._links.checkout && payment._links.checkout.href;
    if (!checkoutUrl && !["authorized", "paid"].includes(payment.status)) throw new Error("La page de paiement n’est plus disponible");
    return new Response(JSON.stringify({ status: payment.status, checkoutUrl: checkoutUrl || null }), { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (err) {
    if (err instanceof DepositLinkConfigurationError) {
      console.error("[deposit-checkout] Configuration du secret de lien dépôt absente.");
      return new Response(JSON.stringify({ error: "Ce lien sécurisé est temporairement indisponible. Veuillez contacter GetLocation." }), { status: 503, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
    }
    return new Response(JSON.stringify({ error: err.message || "Lien indisponible" }), { status: 400, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  }
}

module.exports = { handleDepositCheckout };
