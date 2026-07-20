// Clé PUBLIQUE Stripe (publishable key, commence par pk_test_ ou pk_live_).
// Cette clé est faite pour être visible dans le navigateur, ce n'est pas un secret.
// La clé SECRÈTE (sk_...) ne doit jamais apparaître ici : elle vit uniquement
// dans les variables d'environnement Netlify (STRIPE_SECRET_KEY), utilisée par
// netlify/functions/create-payment-intent.js côté serveur.
window.STRIPE_PUBLISHABLE_KEY = "pk_test_A_REMPLACER";
