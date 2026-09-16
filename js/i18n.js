/* =====================================================================
   js/i18n.js — version anglaise du site GETLOCATION (/en/)

   Principe : le site reste écrit en français dans les fichiers HTML, qui
   restent la version de référence. Ce fichier contient la traduction
   anglaise de chaque texte visible, indexée PAR LE TEXTE FRANÇAIS
   lui-même. Quand la page est servie sous /en/, le moteur ci-dessous
   parcourt le document et remplace chaque texte connu par sa version
   anglaise.

   Pourquoi ce choix plutôt qu'un second jeu de pages :
   - aucune page HTML n'est dupliquée (15 pages, un seul design, un seul
     gabarit à maintenir — voir la règle "ne jamais dupliquer" de CLAUDE.md) ;
   - le français reste lisible dans le code source ;
   - un test (tests/i18n-couverture.test.js) échoue dès qu'un texte visible
     n'a pas de traduction : impossible d'oublier une chaîne en ajoutant du
     contenu, et impossible qu'une phrase française traîne sur le site
     anglais sans que la suite de tests le signale.

   Ce qui n'est VOLONTAIREMENT pas traduit :
   - le corps des pages juridiques (cgl.html, mentions-legales.html,
     confidentialite.html) : la version française fait foi, une traduction
     juridique demande une validation qui n'a pas été faite. Les pages
     anglaises affichent la mention prévue à cet effet ;
   - le back-office et le contrat (usage interne agence).

   Orthographe : anglais britannique pour le vocabulaire de la location
   (licence, kilometres), tournures commerciales internationales ailleurs.
   ===================================================================== */

(function (global) {
  "use strict";

  // Pages client traduites. Sert au routage /en/ (worker) et aux tests.
  var PAGES = [
    "index.html",
    "vehicules.html",
    "reservation.html",
    "paiement.html",
    "confirmation.html",
    "documents.html",
    "location-voiture-nice.html",
    "location-voiture-cannes.html",
    "location-voiture-antibes.html",
    "location-voiture-grasse.html",
    "location-voiture-monaco.html",
    "location-voiture-aeroport-nice.html",
    "cgl.html",
    "mentions-legales.html",
    "confidentialite.html"
  ];

  // Pages dont le CORPS reste en français (valeur juridique) : seuls
  // l'en-tête, la navigation et le pied de page sont traduits.
  var PAGES_JURIDIQUES = ["cgl.html", "mentions-legales.html", "confidentialite.html"];

  // Adresses anglaises : /en/cars plutôt que /en/vehicules.html. Les URLs
  // françaises, elles, ne bougent pas d'un iota (aucun lien existant, aucun
  // référencement acquis n'est cassé). Une page = un fichier HTML unique,
  // servi sous les deux adresses par le worker (voir src/worker.js).
  var SLUGS_EN = {
    "index.html": "",
    "vehicules.html": "cars",
    "reservation.html": "booking",
    "paiement.html": "payment",
    "confirmation.html": "confirmation",
    "documents.html": "documents",
    "location-voiture-nice.html": "car-rental-nice",
    "location-voiture-cannes.html": "car-rental-cannes",
    "location-voiture-antibes.html": "car-rental-antibes",
    "location-voiture-grasse.html": "car-rental-grasse",
    "location-voiture-monaco.html": "car-rental-monaco",
    "location-voiture-aeroport-nice.html": "car-rental-nice-airport",
    "cgl.html": "terms",
    "mentions-legales.html": "legal-notice",
    "confidentialite.html": "privacy"
  };

  var FICHIERS_PAR_SLUG = {};
  Object.keys(SLUGS_EN).forEach(function (fichier) { FICHIERS_PAR_SLUG[SLUGS_EN[fichier]] = fichier; });

  // ---------------------------------------------------------------
  // Titres et métadonnées SEO des pages anglaises. Appliqués côté
  // serveur (src/lib/pages-en.js, via le worker) pour que les moteurs de
  // recherche voient directement le titre anglais, sans exécuter de JS.
  // ---------------------------------------------------------------
  var SEO = {
    "index.html": {
      titre: "GETLOCATION — Car Rental on the French Riviera, Delivered to You",
      description: "Rent a recent car, van or licence-free vehicle on the French Riviera. Book online, we deliver it to your address, hotel or Nice airport. Secure payment, insurance included."
    },
    "vehicules.html": {
      titre: "Our Vehicles — Car and Van Rental | GETLOCATION",
      description: "City cars, hybrid SUVs and vans available on the French Riviera. Check availability, pick your dates and book online in a few minutes."
    },
    "reservation.html": {
      titre: "Book Your Vehicle — GETLOCATION",
      description: "Choose your cover and options, then confirm your booking. Clear pricing, insurance included, delivery on the French Riviera."
    },
    "paiement.html": {
      titre: "Secure Payment — GETLOCATION",
      description: "Pay for your car rental securely through Mollie. No card details are stored by GETLOCATION."
    },
    "confirmation.html": {
      titre: "Booking Confirmed — GETLOCATION",
      description: "Your car rental booking is confirmed. Find your reference and booking details here."
    },
    "documents.html": {
      titre: "Complete Your File — GETLOCATION",
      description: "Send your driving licence and ID securely so we can prepare your rental."
    },
    "location-voiture-nice.html": {
      titre: "Car Rental in Nice — Delivered to Your Address | GETLOCATION",
      description: "Rent a car in Nice and have it delivered to your address, hotel, railway station or the airport. Book online with secure payment."
    },
    "location-voiture-cannes.html": {
      titre: "Car Rental in Cannes — Delivered to Your Address | GETLOCATION",
      description: "Rent a car in Cannes, delivered to your address, hotel or meeting point, including near the Croisette. Book online in minutes."
    },
    "location-voiture-antibes.html": {
      titre: "Car Rental in Antibes — Delivered to Your Address | GETLOCATION",
      description: "Rent a car in Antibes and Juan-les-Pins, delivered where you need it. City cars, hybrid SUVs and vans, insurance included."
    },
    "location-voiture-grasse.html": {
      titre: "Car Rental in Grasse — Local Agency | GETLOCATION",
      description: "Rent a car in Grasse with delivery to your address or a meeting point. Local agency, recent vehicles, clear pricing."
    },
    "location-voiture-monaco.html": {
      titre: "Car Rental in Monaco — Delivery on Request | GETLOCATION",
      description: "Rent a car for Monaco and Monte-Carlo with delivery on request. Hybrid SUVs and city cars, insurance included."
    },
    "location-voiture-aeroport-nice.html": {
      titre: "Car Rental at Nice Airport — Delivered on Arrival | GETLOCATION",
      description: "Rent a car at Nice Côte d'Azur airport. We deliver your vehicle to Terminal 1 or 2 when you land. Book online."
    },
    "cgl.html": {
      titre: "Rental Terms and Conditions — GETLOCATION",
      description: "General rental terms and conditions applicable to bookings made on getlocation.fr. The French version is the legally binding version."
    },
    "mentions-legales.html": {
      titre: "Legal Notice — GETLOCATION",
      description: "Legal information about GETLOCATION (TLST SAS). The French version is the legally binding version."
    },
    "confidentialite.html": {
      titre: "Privacy Policy — GETLOCATION",
      description: "How GETLOCATION collects and protects your personal data. The French version is the legally binding version."
    }
  };

  // ---------------------------------------------------------------
  // Traductions : clé = texte français EXACT tel qu'affiché.
  // ---------------------------------------------------------------
  var TRADUCTIONS = {
    // --- Navigation, en-tête, pied de page (communs à toutes les pages)
    "Accueil": "Home",
    "Véhicules": "Vehicles",
    "Contact": "Contact",
    "Nous appeler": "Call us",
    "Ouvrir le menu": "Open menu",
    "Fermer le menu": "Close menu",
    "Liens": "Links",
    "Mentions légales": "Legal Notice",
    "Conditions de location": "Rental Terms",
    "Confidentialité": "Privacy",
    "Agence de location en ligne. Livraison de véhicules à l'adresse de votre choix sur la Côte d'Azur.":
      "Online car rental agency. We deliver your vehicle wherever you need it on the French Riviera.",
    "Location voiture Nice": "Car rental Nice",
    "Location voiture Cannes": "Car rental Cannes",
    "Location voiture Antibes": "Car rental Antibes",
    "Location voiture Grasse": "Car rental Grasse",
    "Location voiture Monaco": "Car rental Monaco",
    "Aéroport de Nice": "Nice Airport",
    "Horaires : 7j/7, 08:00–20:00": "Open 7 days a week, 08:00–20:00",
    "📍 Grasse (06130)": "📍 Grasse (06130), France",

    // --- Accueil : hero
    "La location simplifiée": "Car rental made simple",
    "Le véhicule qu'il vous faut, livré où vous voulez.": "Book. We deliver. You drive.",
    "Choisissez vos dates et votre véhicule. GETLOCATION s'occupe du reste — livraison à domicile, à l'hôtel ou à l'aéroport, sur toute la Côte d'Azur.":
      "Pick your dates and your vehicle. We take care of the rest — home, hotel or airport delivery across the French Riviera.",
    "Entreprise locale": "Local company",
    "Véhicules 2026": "2026 vehicles",
    "Paiement sécurisé": "Secure payment",
    "Assurance incluse": "Insurance included",
    "Trouver mon véhicule": "Find my vehicle",
    "Voir les véhicules": "View vehicles",

    // --- Accueil : moteur de recherche
    "Trouvez votre véhicule": "Find your vehicle",
    "Choisissez vos dates et votre lieu de livraison pour consulter les disponibilités.":
      "Choose your dates and delivery location to see what is available.",
    "Quel véhicule recherchez-vous ?": "What are you looking for?",
    "Voitures": "Cars",
    "Utilitaires": "Vans",
    "Sans permis": "Licence-free",
    "Date et heure de départ": "Pick-up date and time",
    "Date et heure de retour": "Return date and time",
    "Lieu de prise en charge": "Pick-up location",
    "Lieu de livraison": "Delivery location",
    "Restituer à un endroit différent": "Return to a different location",
    "Lieu de restitution": "Return location",
    "Voir les véhicules disponibles": "See available vehicles",
    "Rechercher": "Search",

    // --- Accueil : pourquoi nous choisir
    "Pourquoi nous choisir": "Why us",
    "Pourquoi choisir GETLOCATION ?": "Why choose GETLOCATION?",
    "Une agence locale, des véhicules récents et une réservation pensée pour aller vite.":
      "A local agency, recent vehicles and a booking process built to be quick.",
    "Livraison partout sur la Côte d'Azur": "Delivery across the French Riviera",
    "Récupérez votre véhicule à l'adresse de votre choix : domicile, hôtel ou aéroport.":
      "Get your vehicle wherever you need it: home, hotel or airport.",
    "Assurance comprise": "Insurance included",
    "Chaque location inclut une assurance, sans mauvaise surprise à la restitution.":
      "Every rental includes insurance, with no surprises when you return the vehicle.",
    "Paiement sécurisé Mollie": "Secure payment with Mollie",
    "Réglez en ligne en toute confiance : aucune donnée bancaire stockée par nos soins.":
      "Pay online with confidence: we never store your card details.",
    "Assistance 7j/7": "Support 7 days a week",
    "Une équipe locale joignable directement, sept jours sur sept.":
      "A local team you can reach directly, seven days a week.",
    "Véhicules neufs 2026": "Brand new 2026 vehicles",
    "Des véhicules récents, entretenus et régulièrement renouvelés.":
      "Recent vehicles, well maintained and regularly renewed.",
    "Tarifs transparents": "Transparent pricing",
    "Le prix affiché avant le paiement est le prix payé, sans frais cachés.":
      "The price you see before paying is the price you pay. No hidden fees.",

    // --- Accueil : véhicules mis en avant
    "Nos offres": "Our fleet",
    "Les véhicules disponibles": "Available vehicles",
    "Citadine, SUV et utilitaire — assurance et assistance incluses.":
      "City cars, SUVs and vans — insurance and roadside assistance included.",
    "Citadine": "City car",
    "SUV Hybride": "Hybrid SUV",
    "Utilitaire": "Van",
    "5 places": "5 seats",
    "Manuelle": "Manual",
    "Automatique": "Automatic",
    "Climatisation": "Air conditioning",
    "Caution 500 €": "€500 deposit",
    "Caution 600 €": "€600 deposit",
    "Caution 800 €": "€800 deposit",
    "À partir de": "From",
    "/ jour": " / day",
    "Voir le véhicule": "View this vehicle",
    "Voir tous les véhicules": "View all vehicles",

    // --- Accueil : comment ça marche
    "Le parcours": "How it works",
    "La location de voiture simplifiée": "Car rental made simple",
    "Commandez, faites-vous livrer, roulez : trois étapes, sans complication.":
      "Book, get it delivered, drive away: three steps, no complications.",
    "Commandez votre véhicule": "Book your vehicle",
    "Sur": "On",
    "ou par téléphone.": "or by phone.",
    "Faites-vous livrer": "We deliver it to you",
    "À l'adresse de votre choix ou au point de retrait.": "At the address of your choice or at a meeting point.",
    "Roulez": "You drive",
    "Prenez la route, on s'occupe du reste.": "Hit the road, we take care of the rest.",

    // --- Accueil : appel à l'action et contact
    "Prêt à réserver votre véhicule ?": "Ready to book your vehicle?",
    "Choisissez vos dates, votre véhicule, et prenez la route sur la Côte d'Azur.":
      "Choose your dates, choose your vehicle, and hit the road on the French Riviera.",
    "Demander un devis": "Request a quote",
    "Voir les disponibilités": "Check availability",

    // --- Accueil : texte de présentation et zones desservies
    "Location de voiture sur la Côte d'Azur": "Car rental on the French Riviera",
    "GETLOCATION est une agence de location de véhicules basée à Grasse, dans les Alpes-Maritimes (06). Nous proposons des véhicules récents (modèles 2026) et une réservation entièrement en ligne, avec paiement sécurisé.":
      "GETLOCATION is a vehicle rental agency based in Grasse, on the French Riviera. We offer recent vehicles (2026 models) and a fully online booking process with secure payment.",
    "Zones desservies": "Where we deliver",
    "Notre agence se trouve à": "Our agency is based in",
    ". Nous proposons également la": ". We also offer",
    "livraison à l'adresse de votre choix": "delivery to the address of your choice",
    "sur": "in",
    "et": "and",
    ", ainsi que sur l'ensemble du bassin cannois et azuréen, sur demande. Voir aussi la":
      ", as well as across the wider Cannes and Riviera area on request. See also",
    "location à l'aéroport de Nice": "car rental at Nice airport",

    // --- Accueil : questions fréquentes
    "Questions fréquentes": "Frequently asked questions",
    "Quel âge minimum pour louer un véhicule ?": "What is the minimum age to rent a vehicle?",
    "Le conducteur doit être âgé d'au moins 21 ans et titulaire d'un permis de conduire valide depuis au moins 2 ans. Voir nos":
      "Drivers must be at least 21 years old and have held a valid driving licence for at least 2 years. See our",
    "conditions générales de location": "rental terms and conditions",
    "Dans quelles villes puis-je récupérer mon véhicule ?": "Where can I pick up my vehicle?",
    "Nous sommes une agence en ligne : le véhicule est livré à l'adresse, à la gare ou au point de rendez-vous choisi sur la Côte d'Azur.":
      "We are an online agency: your vehicle is delivered to the address, railway station or meeting point you choose on the French Riviera.",
    "Une caution est-elle demandée ?": "Is a deposit required?",
    "Oui, un dépôt de garantie de 500 à 800 € est demandé selon le véhicule loué. Son montant exact est affiché sur chaque fiche véhicule.":
      "Yes, a security deposit of €500 to €800 is required depending on the vehicle. The exact amount is shown on each vehicle page.",
    "Le paiement en ligne est-il sécurisé ?": "Is online payment secure?",
    "Oui, le paiement est traité par Mollie, un prestataire de paiement certifié. GETLOCATION ne stocke aucune donnée bancaire.":
      "Yes, payments are handled by Mollie, a certified payment provider. GETLOCATION never stores your card details.",

    // --- Pages véhicules / réservation
    "Chargement de vos dates…": "Loading your dates…",
    "Modifier les dates": "Change dates",
    "Départ": "Pick-up",
    "Retour": "Return",
    "Mettre à jour le prix": "Update price",
    "← Modifier ma recherche": "← Change my search",
    "Choisissez votre véhicule": "Choose your vehicle",
    "Chargement de votre recherche…": "Loading your search…",
    "Finalisez votre réservation": "Complete your booking",
    "Choisissez votre niveau de protection, puis ajoutez uniquement les options dont vous avez besoin.":
      "Choose your level of cover, then add only the extras you need.",
    "Véhicule": "Vehicle",
    "Protection": "Cover",
    "Options": "Extras",
    "Paiement": "Payment",
    "← Revenir aux véhicules": "← Back to vehicles",
    "Étape 2 sur 4": "Step 2 of 4",
    "Étape 3 sur 4": "Step 3 of 4",
    "Quelle protection souhaitez-vous ?": "Which cover would you like?",
    "L’assurance prévue au contrat est incluse. Vous pouvez ajouter la protection passagers proposée par GETLOCATION.":
      "The insurance included in your rental agreement is already covered. You can add passenger cover offered by GETLOCATION.",
    "Continuer vers les options": "Continue to extras",
    "← Revenir à la protection": "← Back to cover",
    "Ajoutez les options utiles": "Add the extras you need",
    "Toutes ces options sont facultatives. Ouvrez « Voir le détail » pour en savoir plus avant de choisir.":
      "All of these extras are optional. Open “See details” to learn more before choosing.",
    "Vous avez un code promo ?": "Have a promo code?",
    "Appliquer": "Apply",
    "Votre code": "Your code",
    "Retour à la protection": "Back to cover",
    "Continuer vers le paiement": "Continue to payment",
    "Votre réservation": "Your booking",
    "Prix actualisé à chaque choix": "Price updated with every choice",
    "Aucun paiement à cette étape": "No payment at this step",
    "Paiement 100% sécurisé — vos données bancaires ne transitent jamais par nos serveurs.":
      "100% secure payment — your card details never pass through our servers.",
    "Revenir au moteur de recherche": "Back to search",
    "Revenir au choix du véhicule": "Back to vehicle selection",
    "Revenir au choix de la protection": "Back to cover selection",
    "Revenir aux options": "Back to extras",

    // --- Paiement
    "← Revenir aux options": "← Back to extras",
    "Paiement sécurisé de votre location": "Secure payment for your rental",
    "Vos coordonnées": "Your details",
    "Nom": "Last name",
    "Prénom": "First name",
    "E-mail": "Email",
    "Téléphone": "Phone number",
    "Date de naissance": "Date of birth",
    "Le permis de conduire et une pièce d'identité vous seront demandés par e-mail après la réservation.":
      "We will ask for your driving licence and ID by email after the booking.",
    "Vous allez être redirigé(e) vers notre prestataire de paiement sécurisé":
      "You will be redirected to our secure payment provider",
    "(carte bancaire, Apple Pay, etc.) pour finaliser le règlement, puis renvoyé(e) automatiquement ici.":
      "(card, Apple Pay, etc.) to complete the payment, then brought back here automatically.",
    "J'ai lu et j'accepte les": "I have read and accept the",
    "et la": "and the",
    "politique de confidentialité": "privacy policy",
    "Payer maintenant": "Pay now",
    "🔒 Paiement chiffré de bout en bout par Mollie — GETLOCATION ne stocke aucune donnée bancaire.":
      "🔒 End-to-end encrypted payment by Mollie — GETLOCATION never stores your card details.",
    "La caution est prélevée avant la remise des clés, selon le véhicule choisi.":
      "The security deposit is taken before the keys are handed over, depending on the vehicle.",
    "Résumé de la commande": "Order summary",

    // --- Confirmation
    "Réservation confirmée !": "Booking confirmed!",
    "Merci, votre paiement a été accepté. Un e-mail de confirmation vous a été envoyé.":
      "Thank you, your payment was accepted. A confirmation email is on its way.",
    "Réf.": "Ref.",
    "Détails de votre réservation": "Your booking details",
    "Retour à l'accueil": "Back to home",

    // --- Dossier client (documents.html)
    "Compléter mon dossier": "Complete your file",
    "Transmettez les éléments nécessaires à la préparation de votre location.":
      "Send us what we need to prepare your rental.",
    "Vérification de votre lien sécurisé…": "Checking your secure link…",
    "Lien indisponible": "Link unavailable",
    "Contacter l'agence": "Contact the agency",
    "Vérification": "Verification",
    "Date de naissance du conducteur principal": "Main driver's date of birth",
    "Informations du conducteur": "Driver details",
    "Adresse postale complète": "Full postal address",
    "Numéro de permis": "Driving licence number",
    "Date d'obtention du permis": "Licence issue date",
    "Documents du conducteur": "Driver documents",
    "Formats acceptés : JPG, PNG ou PDF — 8 Mo maximum par fichier.":
      "Accepted formats: JPG, PNG or PDF — 8 MB maximum per file.",
    "Permis — recto": "Driving licence — front",
    "Permis — verso": "Driving licence — back",
    "Pièce d'identité": "ID document",
    "Adresse de livraison": "Delivery address",
    "Adresse exacte ou point de rendez-vous": "Exact address or meeting point",
    "Indiquez le numéro, la rue ou le point précis où nous devons vous retrouver.":
      "Tell us the street number, street name or exact spot where we should meet you.",
    "Second conducteur": "Additional driver",
    "Date d'obtention": "Issue date",
    "Vos documents seront stockés dans un espace privé et examinés uniquement pour préparer votre location.":
      "Your documents are stored privately and reviewed only to prepare your rental.",
    "Envoyer mon dossier": "Submit my file",
    "Dossier reçu": "File received",
    "Vos documents ont bien été reçus. L'agence les examinera avant la prise en charge.":
      "We have received your documents. The agency will review them before your vehicle is handed over.",
    "JJ/MM/AAAA": "DD/MM/YYYY",
    "Ex. 12 rue…, hôtel…, terminal ou sortie de gare":
      "E.g. 12 Main Street, hotel name, airport terminal or station exit",

    // --- Fiches véhicules (attributs)
    "Découvrir l'Opel Corsa Business 1.2T": "Discover the Opel Corsa Business 1.2T",
    "Découvrir le Peugeot 2008 Hybrid": "Discover the Peugeot 2008 Hybrid",
    "Découvrir le Peugeot 3008": "Discover the Peugeot 3008",
    "Découvrir le Toyota Proace Medium": "Discover the Toyota Proace Medium",

    // --- Pages villes : Nice
    "Location de voiture à Nice": "Car rental in Nice",
    "Besoin d'une voiture à Nice, capitale de la Côte d'Azur ? GETLOCATION livre votre véhicule directement à l'adresse de votre choix à Nice — centre-ville, Promenade des Anglais, gare SNCF, aéroport ou hôtel. Réservez en ligne, choisissez votre créneau, puis précisez l'adresse exacte après le paiement.":
      "Need a car in Nice? GETLOCATION delivers your vehicle straight to the address of your choice in Nice — the city centre, Promenade des Anglais, the railway station, the airport or your hotel. Book online, pick your time slot, then give us the exact address after payment.",
    "Réserver maintenant": "Book now",
    "Véhicules disponibles": "Available vehicles",
    "Citadine, SUV et utilitaire — assurance et assistance incluses, livrés à l'adresse ou au point de rendez-vous choisi à Nice.":
      "City cars, SUVs and vans — insurance and roadside assistance included, delivered to your address or meeting point in Nice.",
    "Réserver": "Book",
    "Questions fréquentes — Nice": "Frequently asked questions — Nice",
    "Livrez-vous vraiment jusqu'à Nice ?": "Do you really deliver to Nice?",
    "Oui. Choisissez d'abord Nice, une gare ou l'aéroport lors de la réservation, puis indiquez l'adresse ou le point de rencontre exact après le paiement.":
      "Yes. Select Nice, a railway station or the airport when booking, then give us the exact address or meeting point after payment.",
    "Proposez-vous la prise en charge à l'aéroport de Nice ?": "Do you offer pick-up at Nice airport?",
    "Oui, voir notre page dédiée à la": "Yes — see our dedicated page on",
    "location de voiture à l'aéroport de Nice": "car rental at Nice airport",
    "Autres villes desservies": "Other cities we serve",
    "GETLOCATION livre également sur :": "GETLOCATION also delivers in:",

    // --- Pages villes : Cannes
    "Location de voiture à Cannes": "Car rental in Cannes",
    "Que ce soit pour un rendez-vous professionnel près du Palais des Festivals, un séjour sur la Croisette ou un déplacement pendant un événement, GETLOCATION livre votre véhicule directement à l'adresse, à la gare ou au point de rendez-vous choisi à Cannes.":
      "Whether you are here for a business meeting near the Palais des Festivals, a stay on the Croisette or an event, GETLOCATION delivers your vehicle straight to the address, railway station or meeting point you choose in Cannes.",
    "Citadine, SUV et utilitaire — assurance et assistance incluses, livrés à Cannes ou Cannes-la-Bocca.":
      "City cars, SUVs and vans — insurance and roadside assistance included, delivered in Cannes or Cannes-la-Bocca.",
    "Questions fréquentes — Cannes": "Frequently asked questions — Cannes",
    "Peut-on récupérer le véhicule directement sur la Croisette ?": "Can I collect the vehicle on the Croisette?",
    "Oui, choisissez « Livraison » lors de la réservation et indiquez l'adresse souhaitée à Cannes, y compris à proximité de la Croisette ou du Palais des Festivals.":
      "Yes — choose “Delivery” when booking and give us the address you want in Cannes, including near the Croisette or the Palais des Festivals.",
    "Quels véhicules recommandez-vous pour Cannes ?": "Which vehicles do you recommend for Cannes?",
    "La Peugeot 3008 ou 2008 Hybrid pour le confort en ville, ou l'Opel Corsa pour se garer facilement dans les rues étroites du centre.":
      "The Peugeot 3008 or 2008 Hybrid for comfort in town, or the Opel Corsa to park easily in the narrow streets of the centre.",

    // --- Pages villes : Antibes
    "Location de voiture à Antibes": "Car rental in Antibes",
    "Pour visiter le Vieil Antibes, le marché provençal ou rejoindre le Cap d'Antibes, GETLOCATION vous propose le véhicule adapté, livré directement à l'adresse, à la gare ou au point de rendez-vous choisi.":
      "To explore Old Antibes, the Provençal market or drive out to Cap d'Antibes, GETLOCATION has the right vehicle for you, delivered to the address, railway station or meeting point you choose.",
    "Citadine, SUV et utilitaire — assurance et assistance incluses, livrés à Antibes, Juan-les-Pins ou dans les environs.":
      "City cars, SUVs and vans — insurance and roadside assistance included, delivered in Antibes, Juan-les-Pins and the surrounding area.",
    "Questions fréquentes — Antibes": "Frequently asked questions — Antibes",
    "La livraison est-elle possible jusqu'au Cap d'Antibes ?": "Can you deliver as far as Cap d'Antibes?",
    "Oui, indiquez simplement l'adresse souhaitée lors de la réservation en choisissant l'option « Livraison ».":
      "Yes — just choose the “Delivery” option when booking and give us the address you want.",
    "Un utilitaire est-il disponible à Antibes ?": "Is a van available in Antibes?",
    "Oui, le Toyota Proace Medium est disponible avec livraison sur Antibes pour vos déménagements ou transports de matériel.":
      "Yes, the Toyota Proace Medium can be delivered in Antibes for house moves or carrying equipment.",

    // --- Pages villes : Grasse
    "Location de voiture à Grasse": "Car rental in Grasse",
    "GETLOCATION est une agence en ligne : votre véhicule est livré à l'adresse ou au point de rendez-vous choisi à Grasse et dans ses environs. Aucun déplacement en agence, avec un tarif clair affiché dès la réservation.":
      "GETLOCATION is an online agency: your vehicle is delivered to the address or meeting point you choose in Grasse and the surrounding area. No agency counter to visit, and a clear price shown from the start.",
    "Citadine, SUV et utilitaire — assurance et assistance incluses, livrés à l'adresse ou au point de rendez-vous choisi à Grasse.":
      "City cars, SUVs and vans — insurance and roadside assistance included, delivered to your address or meeting point in Grasse.",
    "Questions fréquentes — Grasse": "Frequently asked questions — Grasse",
    "Où se trouve l'agence GETLOCATION à Grasse ?": "Where is the GETLOCATION agency in Grasse?",
    "Notre agence est située à Grasse (06130). Voir l'itinéraire sur": "Our agency is in Grasse (06130). See directions on",
    "Quels sont les horaires de l'agence ?": "What are your opening hours?",
    "L'agence est joignable 7j/7 de 08:00 à 20:00 pour la prise en charge et la restitution des véhicules.":
      "We are reachable 7 days a week from 08:00 to 20:00 for vehicle handovers and returns.",

    // --- Pages villes : Monaco
    "Location de voiture à Monaco": "Car rental in Monaco",
    "Pour un séjour à Monaco ou Monte-Carlo, GETLOCATION propose la livraison de son véhicule à l'adresse de votre choix en Principauté, sur demande. Nos SUV Peugeot 3008 et 2008 Hybrid conviennent parfaitement aux trajets entre Monaco et le reste de la Côte d'Azur. Pensez à vérifier que votre permis et vos papiers sont à jour avant le passage de la frontière.":
      "Staying in Monaco or Monte-Carlo? GETLOCATION delivers your vehicle to the address of your choice in the Principality, on request. Our Peugeot 3008 and 2008 Hybrid SUVs are ideal for driving between Monaco and the rest of the French Riviera. Do check that your licence and documents are valid before crossing the border.",
    "Citadine, SUV et utilitaire — assurance et assistance incluses, livrés au point de rendez-vous choisi à Monaco.":
      "City cars, SUVs and vans — insurance and roadside assistance included, delivered to your chosen meeting point in Monaco.",
    "Questions fréquentes — Monaco": "Frequently asked questions — Monaco",
    "Livrez-vous un véhicule jusqu'à Monaco ?": "Do you deliver vehicles to Monaco?",
    "Oui, sur demande : choisissez « Livraison » lors de la réservation et indiquez l'adresse souhaitée à Monaco ou Monte-Carlo.":
      "Yes, on request: choose “Delivery” when booking and give us the address you want in Monaco or Monte-Carlo.",
    "Faut-il des papiers spécifiques pour circuler entre la France et Monaco ?":
      "Do I need special documents to drive between France and Monaco?",
    "Un permis de conduire valide et les papiers du véhicule fournis par GETLOCATION suffisent ; aucune formalité douanière particulière n'est requise pour un véhicule loué en France.":
      "A valid driving licence and the vehicle documents provided by GETLOCATION are enough; no particular customs formalities apply to a vehicle rented in France.",

    // --- Pages villes : aéroport de Nice
    "Location de voiture à l'aéroport de Nice": "Car rental at Nice airport",
    "Vous atterrissez à l'aéroport de Nice Côte d'Azur (Terminal 1 ou Terminal 2) ? GETLOCATION organise la livraison de votre véhicule à votre arrivée, pour prendre la route sans attendre. Indiquez simplement votre heure de vol lors de la réservation et choisissez « Livraison » avec l'adresse de l'aéroport.":
      "Landing at Nice Côte d'Azur airport (Terminal 1 or Terminal 2)? GETLOCATION delivers your vehicle when you arrive, so you can hit the road without waiting. Just give us your flight time when booking and choose “Delivery” with the airport as the address.",
    "Citadine, SUV et utilitaire — assurance et assistance incluses, livrés à l'aéroport de Nice ou à la gare de Nice-Saint-Augustin.":
      "City cars, SUVs and vans — insurance and roadside assistance included, delivered at Nice airport or Nice-Saint-Augustin station.",
    "Questions fréquentes — l'aéroport de Nice": "Frequently asked questions — Nice airport",
    "Le véhicule est-il livré directement au terminal ?": "Is the vehicle delivered to the terminal?",
    "Oui, en choisissant l'option « Livraison » et en indiquant le terminal (1 ou 2) et l'heure d'arrivée de votre vol lors de la réservation.":
      "Yes — choose the “Delivery” option and give us your terminal (1 or 2) and your arrival time when booking.",
    "Que faire en cas de retard de vol ?": "What if my flight is delayed?",
    "Contactez-nous par téléphone ou WhatsApp dès que possible : nous ajustons l'heure de livraison en fonction du retard annoncé.":
      "Call or WhatsApp us as soon as you can: we adjust the delivery time to match your new arrival.",

    // --- Pages juridiques : en-tête uniquement (le corps reste en français)
    "Conditions générales de location (CGL)": "Rental terms and conditions",
    "Applicables à toute réservation effectuée sur getlocation.fr auprès de GETLOCATION (TLST SAS).":
      "Applicable to every booking made on getlocation.fr with GETLOCATION (TLST SAS).",
    "Version en vigueur :": "Version in force:",

    // =================================================================
    // Textes générés par JavaScript (js/app.js)
    // =================================================================

    // --- Descriptions des véhicules (js/data.js, affichées sur les fiches)
    "Compacte et économique, parfaite pour vos déplacements pro entre Cannes, Antibes et Grasse.":
      "Compact and economical, ideal for business trips between Cannes, Antibes and Grasse.",
    "SUV compact hybride, confortable et sobre pour rayonner sur toute la Côte d'Azur.":
      "A compact hybrid SUV, comfortable and economical for exploring the whole French Riviera.",
    "SUV familial haut de gamme, idéal pour vos trajets entre Nice, Cannes et l'arrière-pays.":
      "A high-end family SUV, ideal for trips between Nice, Cannes and the hinterland.",
    "Ludospace polyvalent au grand volume de chargement, idéal bagages, matériel ou déménagement.":
      "A versatile van with plenty of load space — perfect for luggage, equipment or moving house.",

    // --- Réservation immédiate / sur demande
    "Réservation immédiate": "Instant booking",

    // --- Filtres et listes de véhicules
    "Filtres": "Filters",
    "Type": "Type",
    "Nombre de places": "Seats",
    "Boîte de vitesses": "Transmission",
    "Motorisation": "Engine",
    "Automatique seulement": "Automatic only",
    "Sans clim": "No air conditioning",
    "Essence / Diesel": "Petrol / Diesel",
    "Hybride": "Hybrid",
    "Électrique": "Electric",
    "Aucun véhicule ne correspond à cette recherche pour le moment.":
      "No vehicle matches this search at the moment.",
    // --- Niveaux de protection (PROTECTIONS, js/data.js)
    // Les noms de formules sont traduits : « Essentiel » ou « Sérénité » ne
    // dit rien à un client anglophone. Le même nom traduit doit se retrouver
    // sur le contrat PDF anglais (js/contrat-en.js).
    "Essentiel": "Essential",
    "Confort": "Comfort",
    "Sérénité": "Serenity",
    "Sérénité+": "Serenity+",
    "Responsabilité civile / tiers": "Third-party liability",
    "Collision, rayures et chocs": "Collision, scratches and impacts",
    "Vol": "Theft",
    "Pneus": "Tyres",
    "Pare-brise et vitres": "Windscreen and windows",
    "Assistance / dépannage": "Roadside assistance",
    "Protection conducteur et passagers": "Driver and passenger protection",
    "Choisissez votre niveau de protection": "Choose your protection level",
    "La formule Essentiel est incluse dans votre location. Les formules supérieures réduisent votre franchise en cas de dommage — elles s'appliquent pendant toute la durée de la location, avec un prix plafonné.":
      "The Essential cover is included in the rental. Higher levels reduce the excess payable if the car is damaged — they apply for the whole rental period, at a capped price.",
    "Recommandé": "Recommended",
    "Franchise": "Excess",
    "Couvert : ": "Covered: ",
    "Non couvert : ": "Not covered: ",
    "✓ Sélectionnée": "✓ Selected",
    "Voir les détails et exclusions": "See details and exclusions",
    "Les protections sont soumises aux conditions et exclusions prévues par les Conditions Générales de Location. Certains dommages, usages interdits ou manquements contractuels peuvent rester à la charge du locataire.":
      "Protection levels are subject to the terms and exclusions set out in the General Rental Conditions. Some damage, prohibited uses or breaches of contract may remain payable by the renter.",

    "Voir le détail": "See details",
    "Inclus": "Included",
    "Incluse": "Included",
    "Total": "Total",
    "Conducteur": "Driver",
    "Livraison": "Delivery",
    "Montant réglé": "Amount paid",
    "Confirmé via Mollie": "Confirmed via Mollie",
    "Réservation": "Booking",
    "sur demande": "on request",

    // --- Réservation immédiate / demande (flotte GETLOCATION vs partenaires)
    "Disponibilité à confirmer": "Subject to confirmation",
    "Faire une demande": "Request this vehicle",
    "Vous pouvez finaliser votre réservation directement avec notre équipe :":
      "You can complete this booking directly with our team:",

    // --- Galerie photos
    "Fermer": "Close",
    "Fermer la galerie": "Close gallery",
    "Photo précédente": "Previous photo",
    "Photo suivante": "Next photo",

    // --- Avis clients
    "Avis clients": "Customer reviews",
    "Les avis de nos clients seront bientôt disponibles ici.": "Customer reviews will appear here soon.",

    // --- Kilométrage et options
    "Forfait kilométrage supplémentaire": "Extra mileage package",
    "Besoin de plus de kilomètres ? Nous consulter": "Need more mileage? Get in touch",
    "Voyager avec un enfant": "Travelling with a child",
    "Ajoutez une protection dédiée aux passagers du véhicule.": "Add dedicated cover for the vehicle's passengers.",
    "Conservez la protection prévue dans votre contrat de location.":
      "Keep the cover already included in your rental agreement.",

    // --- Formulaires : messages de validation
    "Nom requis (2 caractères min.)": "Last name required (2 characters minimum)",
    "Prénom requis": "First name required",
    "Adresse e-mail invalide": "Invalid email address",
    "Date de naissance invalide (JJ/MM/AAAA) — le conducteur doit avoir entre 21 et 99 ans":
      "Invalid date of birth (DD/MM/YYYY) — the driver must be between 21 and 99 years old",
    "La date/heure de retour doit être après la date/heure de départ.":
      "The return date and time must be after the pick-up date and time.",
    "Choisissez un lieu de livraison": "Choose a delivery location",
    "Choisissez une protection pour continuer.": "Choose a level of cover to continue.",
    "Choisir une famille de véhicule": "Choose a vehicle category",
    "Chaque fichier doit faire moins de 8 Mo.": "Each file must be smaller than 8 MB.",
    "Envoi en cours…": "Sending…",
    "Vérification du code…": "Checking the code…",
    "Code promo invalide": "Invalid promo code",
    "Code promo invalide ou expiré.": "This promo code is invalid or has expired.",
    "Trop de tentatives. Merci de patienter quelques instants avant de réessayer.":
      "Too many attempts. Please wait a moment before trying again.",
    "Accès indisponible": "Access unavailable",
    "Ce lien est invalide ou a expiré.": "This link is invalid or has expired.",
    "Ce lien est invalide ou a expiré. Ouvrez à nouveau le lien reçu par e-mail.":
      "This link is invalid or has expired. Please open the link from your email again.",
    "Lien invalide ou expiré": "Invalid or expired link",
    "Téléchargement impossible": "Download failed",
    "Remplacer mon dossier": "Replace my file",

    // --- Confirmation / paiement
    "Chargement de votre confirmation…": "Loading your confirmation…",
    "Impossible de retrouver cette réservation pour le moment. Si vous venez de payer, patientez quelques instants puis rafraîchissez la page.":
      "We cannot find this booking right now. If you have just paid, wait a few moments and refresh the page.",
    "Votre paiement est en cours de confirmation. Rafraîchissez cette page dans quelques instants.":
      "Your payment is being confirmed. Please refresh this page in a few moments.",
    "Payer": "Pay",

    // --- Champs d'adresse
    "Numéro et rue": "Street number and name",
    "Code postal": "Postcode",
    "Ville": "Town or city",
    "Adresse": "Address",

    // --- Textes venus de js/data.js (options, lieux, paliers de remise)
    // Ils n'apparaissent dans aucun fichier HTML : ils sont insérés dans la
    // page par js/app.js à partir de la seule source de vérité tarifaire
    // (règle n°1 du CLAUDE.md). tests/i18n-couverture.test.js les contrôle
    // désormais au même titre que les textes des pages.
    "Livraison à l'adresse de votre choix": "Delivery to the address of your choice",
    "Saisir une adresse personnalisée": "Enter a different address",
    "5 jours ou plus": "5 days or more",

    "Conducteur supplémentaire": "Additional driver",
    "Les longs trajets sont plus agréables quand on peut se relayer. Ajoutez un conducteur supplémentaire pour partager le volant et voyager plus sereinement. Il devra simplement présenter un permis de conduire valide et respecter les mêmes conditions que le conducteur principal.":
      "Long journeys are easier when you can share the driving. Add a second driver to take turns at the wheel and travel more comfortably. They simply need a valid driving licence and must meet the same conditions as the main driver.",

    "Forfait 200 km supplémentaires": "200 km extra mileage package",
    "Une petite marge de liberté pour prolonger une balade, changer d'itinéraire ou profiter d'une étape imprévue sans surveiller chaque kilomètre.":
      "A little extra freedom to stretch out a drive, change route or add an unplanned stop without watching every kilometre.",
    "Forfait 300 km supplémentaires": "300 km extra mileage package",
    "Le bon équilibre pour explorer davantage la Côte d'Azur et ses alentours, avec une réserve confortable sur l'ensemble du séjour.":
      "The right balance for exploring more of the French Riviera and beyond, with a comfortable allowance across your whole stay.",
    "Forfait 400 km supplémentaires": "400 km extra mileage package",
    "Pour les séjours les plus mobiles : partez plus loin et multipliez les escapades avec une marge kilométrique généreuse.":
      "For the busiest itineraries: travel further and fit in more trips with a generous mileage allowance.",

    "Service de plein / recharge": "Refuelling / recharging service",
    "Profitez de votre dernière journée jusqu'au bout et évitez le détour par une station avant le retour. Rendez le véhicule sans refaire vous-même le plein ou la recharge : notre équipe s'en charge. Le carburant ou l'électricité consommés restent facturés selon les conditions de location.":
      "Make the most of your last day and skip the detour to a filling station before you hand the vehicle back. Return it without refuelling or recharging yourself — our team takes care of it. The fuel or electricity used is still charged in line with the rental conditions.",

    "Siège bébé": "Baby seat",
    "Voyagez plus léger : le siège bébé vous attend directement dans le véhicule lors de sa livraison. Une solution simple pour préparer le trajet familial avec moins de matériel à transporter.":
      "Travel light: the baby seat is waiting in the vehicle when it is delivered. A simple way to prepare a family trip with less to carry.",
    "Siège enfant": "Child seat",
    "Offrez à votre enfant une assise adaptée et plus confortable pendant le trajet. Le siège est préparé dans le véhicule avant votre prise en charge.":
      "Give your child a properly sized, more comfortable seat for the journey. The seat is fitted in the vehicle before you collect it.",
    "Rehausseur enfant": "Booster seat",
    "Une solution pratique pour mieux installer les enfants plus grands avec la ceinture du véhicule, sans avoir à emporter votre propre équipement.":
      "A practical way to seat older children safely with the vehicle's own seatbelt, without bringing your own equipment.",

    "Assurance passagers / accident": "Passenger / accident cover",
    "Couvre les dommages corporels des passagers en cas d'accident":
      "Covers injury to passengers in the event of an accident",

    "Aucun forfait": "No package",

    // --- Options enfants et supplément jeune conducteur
    "Âge de l'enfant": "Child's age",
    "Poids de l'enfant": "Child's weight",
    "ans": "years",
    "kg": "kg",
    "Rehausseur": "Booster seat",
    "Le siège adapté sera sélectionné en fonction de l'âge et du poids de l'enfant. Il est installé dans le véhicule avant votre prise en charge.":
      "The right seat is chosen according to the child's age and weight. It is fitted in the vehicle before you collect it.",
    "Une solution pratique pour installer un enfant plus grand avec la ceinture du véhicule, sans avoir à emporter votre propre équipement.":
      "A practical way to seat an older child safely with the vehicle's own seatbelt, without bringing your own equipment.",
    "Date d'obtention du permis": "Driving licence issue date",
    "Un supplément s'applique aux permis de moins de 3 ans.": "A surcharge applies to licences held for less than 3 years.",
    "Date d'obtention du permis invalide (JJ/MM/AAAA)": "Invalid licence issue date (DD/MM/YYYY)",

    // Libellés des filtres du catalogue (familles, types, carburants).
    // « SUV », « SUV / 4x4 », « Minibus », « Premium », « Diesel » s'écrivent
    // à l'identique en anglais : la traduction les reprend tels quels pour
    // qu'ils soient couverts par le test plutôt que signalés comme oublis.
    "SUV": "SUV",
    "SUV / 4x4": "SUV / 4x4",
    "Berline": "Saloon",
    "Minibus": "Minibus",
    "Premium": "Premium",
    "Essence": "Petrol",
    "Diesel": "Diesel",

    // Intertitres du choix des options, écrits dans js/app.js.
    "Gardez la liberté de prolonger une balade ou d'improviser une étape, sans surveiller chaque kilomètre. Choisissez un seul forfait pour l'ensemble de la location.":
      "Keep the freedom to extend a drive or add a stop on a whim, without watching every kilometre. Choose a single package for the whole rental.",
    "Dépliez cette rubrique pour choisir l'équipement adapté à votre enfant.":
      "Open this section to choose the right equipment for your child.",

    "Livraison du véhicule": "Vehicle delivery",
    "Livraison à l'adresse ou au point de rendez-vous choisi sur la Côte d'Azur":
      "Delivery to the address or meeting point of your choice on the French Riviera"
  };

  // Textes paramétrés (contenant {variable}) : traduits via t().
  var MODELES = {
    "{lieu} · du {debut} au {fin} ({jours})": "{lieu} · from {debut} to {fin} ({jours})",
    "{debut} → {fin} ({jours})": "{debut} → {fin} ({jours})",
    "{nombre} jour": "{nombre} day",
    "{nombre} jours": "{nombre} days",
    "Total pour {jours} : {montant}": "Total for {jours}: {montant}",
    "Caution {montant}": "{montant} deposit",
    "Date invalide (JJ/MM/AAAA attendu) : {champ}.": "Invalid date (DD/MM/YYYY expected): {champ}.",
    "Demande de réservation — {vehicule}": "Booking request — {vehicule}",
    "{vehicule} — GETLOCATION": "{vehicule} — GETLOCATION",
    "Bonjour,\n\nJe souhaite faire une demande de réservation pour : {vehicule}\nDu {debut} au {fin}.\n\nMerci de me recontacter.":
      "Hello,\n\nI would like to request a booking for: {vehicule}\nFrom {debut} to {fin}.\n\nPlease get back to me.",
    "Aucun supplément. Une caution de {caution} reste prévue pour ce véhicule. Les conditions exactes figurent dans les conditions de location.":
      "No extra charge. A deposit of {caution} still applies to this vehicle. The exact terms are set out in the rental conditions.",
    "{prix} / jour": "{prix} / day",
    "Choisir {protection}": "Choose {protection}",
    "{montant} maximum par location": "{montant} maximum per rental",
    "Protection {nom} — {jours}": "{nom} protection — {jours}",
    "Protection {nom} (forfait plafonné à {jours})": "{nom} protection (flat rate capped at {jours})",
    "Télécharger {type}": "Download {type}",
    "{index} / {total}": "{index} / {total}",
    "Réservation {reference}": "Booking {reference}",
    "Location ({jours})": "Rental ({jours})",
    "Supplément jeune conducteur — {jours}": "Young driver surcharge — {jours}",
    "Remise durée ({palier}, -{montant}/jour)": "Long-stay discount ({palier}, -{montant}/day)",
    "Code promo {code} ({remise})": "Promo code {code} ({remise})",
    "Livraison — {adresse}": "Delivery — {adresse}",
    "{pourcentage} % de réduction": "{pourcentage}% off",
    "{montant} € de réduction": "€{montant} off",
    "Code \"{code}\" appliqué : {remise}.": "Code \"{code}\" applied: {remise}.",
    "{description} Cette option s'ajoute à l'assurance incluse dans la location.":
      "{description} This cover is added to the insurance included in the rental.",
    "-{montant}/jour dès {palier}": "-{montant}/day from {palier}"
  };

  // Mention affichée en anglais sur les pages juridiques, dont le corps
  // reste volontairement en français (seule version faisant foi).
  var MENTION_JURIDIQUE = "This page is available in French only. The French version is the legally binding version.";

  // Attributs porteurs de texte visible ou lu par les lecteurs d'écran.
  var ATTRIBUTS_TRADUITS = ["placeholder", "aria-label", "title", "alt", "data-empty"];

  // ---------------------------------------------------------------
  // Moteur
  // ---------------------------------------------------------------

  // Renvoie TOUJOURS le nom du fichier HTML (la page française de
  // référence), que le chemin soit français ou anglais.
  function nomDePage(chemin) {
    var sansParametres = String(chemin || "").split("?")[0].split("#")[0];
    if (langueDuChemin(sansParametres) === "en") {
      var slug = sansParametres.replace(/^\/en\/?/, "").replace(/\/$/, "");
      return FICHIERS_PAR_SLUG[slug] || "index.html";
    }
    var fichier = sansParametres.replace(/^\//, "");
    return fichier || "index.html";
  }

  function langueDuChemin(chemin) {
    return /^\/en(\/|$)/.test(String(chemin || "")) ? "en" : "fr";
  }

  function traduire(texte) {
    var brut = String(texte);
    var nettoye = brut.trim();
    if (!nettoye) return null;
    var traduction = TRADUCTIONS[nettoye];
    if (traduction === undefined) {
      // Les montants produits par formatEUR() contiennent une espace
      // insécable avant le « € », les fichiers HTML une espace ordinaire :
      // une seule entrée de dictionnaire doit valoir pour les deux.
      traduction = TRADUCTIONS[nettoye.replace(/\u00A0/g, " ")];
    }
    if (traduction === undefined) {
      var enAnglais = montant(nettoye);
      if (enAnglais === nettoye) return null;
      traduction = enAnglais;
    }
    // Conserve les espaces d'origine autour du texte (indentation HTML).
    var avant = brut.slice(0, brut.indexOf(nettoye[0]));
    var apres = brut.slice(avant.length + nettoye.length);
    return avant + traduction + apres;
  }

  // « 500 € » -> « €500 » : en anglais le symbole précède le montant. Les
  // chiffres et leur séparateur de milliers restent inchangés — seul
  // l'affichage bouge, jamais un calcul (voir CLAUDE.md, règle n°1).
  // Le signe est reconnu séparément (tiret ASCII comme signe moins U+2212,
  // employé pour les remises) : sans lui, « − 35 € » ne ressemblait plus à un
  // montant et restait au format français au milieu d'un récapitulatif
  // anglais.
  var MONTANT_SEUL = /^([-−+]?)\s*([\d\s\u00A0.,]+?)\s*€$/;
  function montant(texte) {
    var valeur = String(texte).trim();
    var trouve = MONTANT_SEUL.exec(valeur);
    if (!trouve) return texte;
    return trouve[1] + "€" + trouve[2];
  }

  function t(cle, variables) {
    var modele = MODELES[cle];
    var resultat;
    if (API.langue() === "en") {
      resultat = modele !== undefined ? modele : (TRADUCTIONS[cle] !== undefined ? TRADUCTIONS[cle] : cle);
    } else {
      resultat = cle;
    }
    if (variables) {
      var anglais = API.langue() === "en";
      Object.keys(variables).forEach(function (nom) {
        var valeur = anglais ? montant(variables[nom]) : variables[nom];
        resultat = resultat.split("{" + nom + "}").join(String(valeur));
      });
    }
    return resultat;
  }

  // Traduit un arbre DOM : nœuds texte puis attributs. Idempotent (une
  // chaîne déjà anglaise n'est pas une clé du dictionnaire).
  function appliquer(racine) {
    if (!racine || API.langue() !== "en") return;
    var document = racine.ownerDocument || racine;
    var vue = document.defaultView || global;
    if (racine.nodeType === 3) {
      var direct = traduire(racine.textContent);
      if (direct !== null) racine.textContent = direct;
      return;
    }
    var parcours = document.createTreeWalker(racine, vue.NodeFilter.SHOW_TEXT, {
      acceptNode: function (noeud) {
        var parent = noeud.parentElement;
        if (!parent || parent.closest("script,style,noscript,textarea")) return vue.NodeFilter.FILTER_REJECT;
        return vue.NodeFilter.FILTER_ACCEPT;
      }
    });
    var aTraduire = [];
    var noeud;
    while ((noeud = parcours.nextNode())) aTraduire.push(noeud);
    aTraduire.forEach(function (texte) {
      var traduit = traduire(texte.textContent);
      if (traduit !== null) texte.textContent = traduit;
    });

    var elements = racine.querySelectorAll ? racine.querySelectorAll("*") : [];
    var tous = racine.nodeType === 1 ? [racine].concat(Array.prototype.slice.call(elements)) : Array.prototype.slice.call(elements);
    tous.forEach(function (element) {
      ATTRIBUTS_TRADUITS.forEach(function (attribut) {
        if (!element.hasAttribute || !element.hasAttribute(attribut)) return;
        var traduit = traduire(element.getAttribute(attribut));
        if (traduit !== null) element.setAttribute(attribut, traduit);
      });
    });
  }

  // Bascule un lien interne vers la langue demandée, en conservant ses
  // paramètres et son ancre. Les liens externes, ancres seules, tel: et
  // mailto: ne sont jamais touchés.
  function urlVersLangue(href, langue) {
    var valeur = String(href || "");
    if (!valeur || /^(https?:|tel:|mailto:|#|data:)/i.test(valeur)) return valeur;
    var separateur = valeur.search(/[?#]/);
    var chemin = separateur === -1 ? valeur : valeur.slice(0, separateur);
    var suite = separateur === -1 ? "" : valeur.slice(separateur);
    var fichier = nomDePage(chemin.charAt(0) === "/" ? chemin : "/" + chemin);
    if (langue === "en") {
      var slug = SLUGS_EN[fichier];
      if (slug === undefined) return valeur;      // page sans version anglaise
      return "/en/" + slug + suite;
    }
    return "/" + fichier + suite;
  }

  var API = {
    PAGES: PAGES,
    PAGES_JURIDIQUES: PAGES_JURIDIQUES,
    SLUGS_EN: SLUGS_EN,
    FICHIERS_PAR_SLUG: FICHIERS_PAR_SLUG,
    SEO: SEO,
    TRADUCTIONS: TRADUCTIONS,
    MODELES: MODELES,
    MENTION_JURIDIQUE: MENTION_JURIDIQUE,
    nomDePage: nomDePage,
    langueDuChemin: langueDuChemin,
    urlVersLangue: urlVersLangue,
    montant: montant,
    traduire: traduire,
    appliquer: appliquer,
    t: t,
    langue: function () {
      return global.location ? langueDuChemin(global.location.pathname) : "fr";
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  global.GLI18N = API;

  // =================================================================
  // Démarrage côté navigateur
  // =================================================================
  if (typeof document === "undefined" || !global.location) return;

  var langue = API.langue();
  var CLE_MEMOIRE = "gl_langue";

  // Mémorise le dernier choix pour le proposer au retour du visiteur. Aucune
  // redirection automatique n'est faite à partir de cette valeur : l'URL
  // reste la seule autorité sur la langue affichée (indispensable pour que
  // chaque version ait sa propre adresse indexable).
  try { localStorage.setItem(CLE_MEMOIRE, langue); } catch (e) { /* navigation privée */ }

  function reecrireLiens(racine) {
    var liens = racine.querySelectorAll ? racine.querySelectorAll("a[href]") : [];
    Array.prototype.forEach.call(liens, function (lien) {
      // Le sélecteur de langue est le seul endroit du site qui doit pouvoir
      // pointer vers l'AUTRE langue : sans cette exception, son bouton « FR »
      // serait réécrit vers /en/ et le retour au français deviendrait
      // impossible depuis la version anglaise.
      if (lien.closest && lien.closest(".lang-switch")) return;
      var href = lien.getAttribute("href");
      // Un fichier (image, PDF…) n'a pas de version linguistique.
      if (/^(https?:|tel:|mailto:|#|data:)/i.test(href) || /\.(jpe?g|png|webp|svg|pdf|ico|xml|txt)$/i.test(href)) return;
      var cible = urlVersLangue(href, "en");
      if (cible !== href) lien.setAttribute("href", cible);
    });
  }

  function construireSelecteur() {
    var nav = document.getElementById("main-nav") || document.querySelector(".main-nav");
    if (!nav || document.querySelector(".lang-switch")) return;
    var page = nomDePage(global.location.pathname);
    var parametres = global.location.search || "";
    var bloc = document.createElement("div");
    bloc.className = "lang-switch";
    bloc.setAttribute("aria-label", langue === "en" ? "Language" : "Langue");
    [
      { code: "fr", libelle: "FR", titre: "Version française" },
      { code: "en", libelle: "EN", titre: "English version" }
    ].forEach(function (choix) {
      var lien = document.createElement("a");
      lien.className = "lang-switch-option" + (choix.code === langue ? " active" : "");
      lien.textContent = choix.libelle;
      lien.setAttribute("hreflang", choix.code);
      lien.setAttribute("title", choix.titre);
      lien.href = urlVersLangue(page + parametres, choix.code);
      if (choix.code === langue) lien.setAttribute("aria-current", "true");
      bloc.appendChild(lien);
    });
    nav.appendChild(bloc);
  }

  function mentionJuridique() {
    var page = nomDePage(global.location.pathname);
    if (PAGES_JURIDIQUES.indexOf(page) === -1) return;
    var ancre = document.querySelector("main h1, main .section-title, h1");
    if (!ancre || document.querySelector(".legal-language-note")) return;
    var note = document.createElement("p");
    note.className = "legal-language-note";
    note.textContent = MENTION_JURIDIQUE;
    ancre.parentNode.insertBefore(note, ancre.nextSibling);
  }

  function demarrer() {
    construireSelecteur();
    if (langue !== "en") return;
    document.documentElement.lang = "en";
    appliquer(document.body);
    reecrireLiens(document);
    mentionJuridique();

    // Contenu ajouté après coup (fiches véhicules, filtres, modales,
    // messages…) : traduit dès son insertion, ce qui évite d'avoir à
    // appeler la traduction depuis chaque écran de js/app.js.
    if (global.MutationObserver) {
      new global.MutationObserver(function (mutations) {
        mutations.forEach(function (mutation) {
          Array.prototype.forEach.call(mutation.addedNodes, function (noeud) {
            if (noeud.nodeType !== 1 && noeud.nodeType !== 3) return;
            appliquer(noeud);
            if (noeud.nodeType === 1) reecrireLiens(noeud);
          });
        });
      }).observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", demarrer);
  } else {
    demarrer();
  }
})(typeof window !== "undefined" ? window : globalThis);
