// Netlify Function — crée un PaymentIntent Stripe côté serveur.
// La clé secrète Stripe (STRIPE_SECRET_KEY) doit être configurée dans
// Netlify > Site configuration > Environment variables. Elle n'est jamais
// exposée au navigateur : seule cette fonction, exécutée côté serveur, l'utilise.

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json"
  };

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Méthode non autorisée" }) };
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: "Paiement non configuré : STRIPE_SECRET_KEY manquante. Ajoute-la dans Netlify > Site configuration > Environment variables, puis redéploie."
      })
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Requête invalide" }) };
  }

  const { amount, currency, description, receiptEmail } = payload;
  const montant = Math.round(Number(amount));

  if (!montant || montant < 50) {
    // Stripe exige un montant minimum (~0,50 € pour l'EUR)
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Montant invalide" }) };
  }

  try {
    const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
    const paymentIntent = await stripe.paymentIntents.create({
      amount: montant,
      currency: currency || "eur",
      description: description || "Réservation GETLOCATION",
      receipt_email: receiptEmail || undefined,
      automatic_payment_methods: { enabled: true }
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ clientSecret: paymentIntent.client_secret })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message || "Erreur lors de la création du paiement" })
    };
  }
};
