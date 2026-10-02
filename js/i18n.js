Warning: truncated output (original token count: 28763)
Total output lines: 1611

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
    "confidentialite.html",
    "business/index.html",
    "business/tourism.html",
    "business/hebergements.html",
    "business/corporate-mobility.html",
    "business/professional-solutions.html",
    "business/contact.html",
    "business/garages.html",
    "business/corporate.html",
    "business/hotels.html",
    "business/events.html",
    "business/partners.html"
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
    "confidentialite.html": "privacy",
    "business/index.html": "business",
    "business/tourism.html": "business/tourism",
    "business/hebergements.html": "business/accommodation",
    "business/corporate-mobility.html": "business/corporate-mobility",
    "business/professional-solutions.html": "business/professional-solutions",
    "business/contact.html": "business/contact",
    "business/garages.html": "business/garages",
    "business/corporate.html": "business/corporate",
    "business/hotels.html": "business/hotels",
    "business/events.html": "business/events",
    "business/partners.html": "business/partners"
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
    },
    "business/index.html": {
      titre: "GETLOCATION Business — Professional Mobility Solutions",
      description: "Professional mobility solutions tailored to every business, designed to make everyday work simpler for your teams and clients."
    },
    "business/tourism.html": {
      titre: "GetLocation Business Tourism — Mobility for Your Guests",
      description: "A mobility programme for Airbnb hosts, concierges, hotels, tourist residences and property managers on the French Riviera."
    },
    "business/hebergements.html": {
      titre: "Accommodation Partnerships | GetLocation",
      description: "Offer your guests a vehicle rental solution with delivery to their accommodation, hotel or the airport."
    },
    "business/corporate-mobility.html": {
      titre: "Corporate Mobility | GetLocation",
      description: "Vehicles adapted to the needs of your employees, teams and professionals, with simple, flexible delivery."
    },
    "business/professional-solutions.html": {
      titre: "Professional Solutions | GetLocation",
      description: "Flexible vehicle solutions for specific business needs: vans, one-off assignments, transport, events or extra activity support."
    },
    "business/contact.html": {
      titre: "Business Contact | GetLocation",
      description: "Contact GetLocation for a business request: garage, accommodation, company, employee or specific vehicle requirement."
    },
    "business/garages.html": {
      titre: "GetLocation Business Garages — Replacement Vehicles",
      description: "GetLocation is preparing a replacement-vehicle solution for automotive garages."
    },
    "business/corporate.html": {
      titre: "GetLocation Business Companies — Employee Mobility",
      description: "GetLocation is preparing mobility solutions for companies and their employees."
    },
    "business/hotels.html": {
      titre: "GetLocation Business Hotels — Mobility for Your Guests",
      description: "GetLocation is preparing a mobility offer for hotels and their guests on the French Riviera."
    },
    "business/events.html": {
      titre: "GetLocation Business Events — Event Mobility",
      description: "GetLocation is preparing mobility solutions for event professionals."
    },
    "business/partners.html": {
      titre: "GetLocation Partners — Partner Programme",
      description: "GetLocation is preparing a partner programme for mobility and tourism professionals."
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
    "Business": "Business",
    "Mobility Pro": "Mobility Pro",
    "GETLOCATION MOBILITY PRO": "GETLOCATION MOBILITY PRO",
    "Des solutions de mobilité adaptées à chaque activité.": "Mobility solutions tailored to every business.",
    "Choisissez la solution correspondant à votre métier et découvrez comment GetLocation peut simplifier votre quotidien.": "Choose the solution that fits your business and discover how GetLocation can make everyday work simpler.",
    "Découvrir nos solutions": "Explore our solutions",
    "Solutions professionnelles": "Professional solutions",
    "Choisissez votre solution.": "Choose your solution.",
    "Une réponse claire pour chaque besoin métier.": "A clear answer for every business need.",
    "Disponible": "Available",
    "Ouverture prochaine": "Opening soon",
    "Facilitez les déplacements de vos voyageurs.": "Make travel easier for your guests.",
    "Des solutions adaptées aux besoins de vos équipes.": "Solutions tailored to your teams’ needs.",
    "Autres solutions professionnelles": "Other professional solutions",
    "Découvrez les prochains services GetLocation.": "Discover upcoming GetLocation services.",
    "Une plateforme, plusieurs solutions": "One platform, several solutions",
    "GetLocation réunit des solutions pensées pour les professionnels, leurs équipes et leurs clients.": "GetLocation brings together solutions designed for professionals, their teams and their clients.",
    "Simple à proposer. Facile à intégrer.": "Simple to offer. Easy to integrate.",
    "Adapté à votre activité": "Tailored to your business",
    "Une solution pensée autour de vos besoins.": "A solution designed around your needs.",
    "Un parcours clair": "A clear journey",
    "Un lien suffit pour orienter votre client.": "A link is all you need to guide your client.",
    "Un service professionnel": "A professional service",
    "Une expérience fluide, de la demande au retour.": "A seamless experience, from request to return.",
    "Une solution facile à déployer.": "A solution that is easy to roll out.",
    "Choisissez votre solution": "Choose your solution",
    "Selon votre activité.": "For your business.",
    "Partagez-la simplement": "Share it simply",
    "Avec vos clients ou vos équipes.": "With your clients or teams.",
    "GetLocation vous accompagne": "GetLocation supports you",
    "À chaque étape du parcours.": "At every stage of the journey.",
    "Une mobilité fluide pour enrichir l’expérience de séjour.": "Seamless mobility to enrich the guest experience.",
    "Couple de voyageurs accueilli devant un hébergement avec véhicule à proximité": "Couple of travellers welcomed outside an accommodation with a vehicle nearby",
    "Professionnel récupérant un véhicule GetLocation devant des bureaux": "Professional collecting a GetLocation vehicle outside offices",
    "Des solutions pour vos besoins ponctuels, utilitaires ou professionnels.": "Solutions for your occasional, utility or professional needs.",
    "Client recevant les clés d’un véhicule GetLocation devant une carrosserie": "Client receiving the keys to a GetLocation vehicle outside a body shop",
    "Voyageurs accueillis devant un hébergement avec un véhicule à proximité": "Travellers welcomed outside an accommodation with a vehicle nearby",
    "Professionnel recevant les clés d’un véhicule GetLocation devant des bureaux": "Professional receiving the keys to a GetLocation vehicle outside offices",
    "Agent GetLocation chargeant des cartons dans un utilitaire professionnel": "GetLocation agent loading boxes into a professional utility vehicle",
    "GETLOCATION Business": "GETLOCATION Business",
    "Pourquoi GetLocation": "Why GetLocation",
    "Comment ça fonctionne": "How it works",
    "La mobilité au service de votre activité.": "Mobility that works for your business.",
    "Navigation GetLocation Business": "GetLocation Business navigation",
    "Offrez un service complet à vos clients pendant les réparations.": "Offer your clients a complete service while their vehicle is being repaired.",
    "Une solution simple pour mieux accompagner vos clients, sans alourdir l'organisation de votre équipe.": "A simple way to support your clients better without adding work for your team.",
    "Toujours une solution pour vos clients.": "Always a solution for your clients.",
    "Découvrez la première solution Mobility Pro, conçue pour les garages et carrosseries.": "Discover the first Mobility Pro solution, designed for garages and body shops.",
    "Ajoutez facilement un service de véhicule à votre activité.": "Easily add a vehicle service to your business.",
    "Des solutions de mobilité complémentaires, conçues autour des besoins réels de vos clients et de vos équipes.": "Complementary mobility solutions, designed around the real needs of your clients and teams.",
    "Vos besoins métier": "Your business needs",
    "Une solution adaptée à chaque moment.": "A solution for every moment.",
    "La première verticale est prête à être testée avec des garages et carrosseries.": "The first vertical is ready to be tested with garages and body shops.",
    "Véhicule de remplacement": "Replacement vehicle",
    "Une solution simple pour vos clients pendant les réparations.": "A simple solution for your customers while repairs are underway.",
    "Découvrir la solution": "Explore the solution",
    "Accueillir des voyageurs": "Welcome travellers",
    "Une mobilité fluide pour enrichir l'expérience de séjour.": "Seamless mobility to enrich the guest experience.",
    "Équiper vos collaborateurs": "Equip your employees",
    "Des solutions souples pour vos déplacements professionnels.": "Flexible solutions for your business travel.",
    "Accueillir vos clients": "Welcome your clients",
    "Proposez simplement un service de mobilité à votre établissement.": "Easily offer a mobility service at your establishment.",
    "Pour les professionnels": "For professionals",
    "GetLocation Business": "GetLocation Business",
    "Des solutions de mobilité adaptées aux professionnels.": "Mobility solutions designed for professionals.",
    "GetLocation accompagne les acteurs de différents secteurs avec des solutions de mobilité souples, un service de proximité et des programmes partenaires conçus pour évoluer avec leurs besoins.": "GetLocation supports businesses across sectors with flexible mobility solutions, local service and partner programmes designed to grow with their needs.",
    "Nos solutions": "Our solutions",
    "La mobilité au service de votre activité": "Mobility that works for your business",
    "Découvrez l'offre la plus adaptée à vos clients, vos équipes et vos projets.": "Find the offer best suited to your clients, teams and projects.",
    "Tourisme": "Tourism",
    "Solutions pour propriétaires Airbnb, conciergeries, hôtels et agences de gestion.": "Solutions for Airbnb hosts, concierges, hotels and property managers.",
    "Découvrir": "Discover",
    "Garages automobiles": "Automotive garages",
    "Des véhicules de remplacement livrés directement à vos clients.": "Replacement vehicles delivered directly to your clients.",
    "Entreprises": "Companies",
    "Des solutions de mobilité pour vos collaborateurs.": "Mobility solutions for your employees.",
    "Hôtels": "Hotels",
    "Proposez un service de mobilité directement à vos clients.": "Offer a mobility service directly to your guests.",
    "Événementiel": "Events",
    "Des solutions de mobilité pour vos événements.": "Mobility solutions for your events.",
    "Partenaires": "Partners",
    "Rejoignez le programme GetLocation Partners.": "Join the GetLocation Partners programme.",
    "contact@getlocation.fr": "contact@getlocation.fr",
    "Informations": "Information",
    "GetLocation Business · Tourisme": "GetLocation Business · Tourism",
    "Partenariat hébergements": "Accommodation partnerships",
    "Corporate Mobility": "Corporate Mobility",
    "Professional Solutions": "Professional Solutions",
    "Parlons de votre besoin véhicule.": "Let us discuss your vehicle requirement.",
    "Décrivez rapidement votre demande. GetLocation vous recontacte pour vous proposer une solution adaptée à votre activité.": "Briefly describe your request. GetLocation will contact you with a solution suited to your business.",
    "Réponse rapide par téléphone, WhatsApp ou email.": "A quick response by phone, WhatsApp or email.",
    "Une demande simple": "A simple request",
    "Un échange direct, pour une réponse adaptée.": "A direct conversation, for the right response.",
    "Quelques informations suffisent pour nous permettre de comprendre votre besoin.": "A few details are enough for us to understand your requirement.",
    "Réponse rapide": "Quick response",
    "Par le canal qui vous convient.": "Through the channel that suits you.",
    "Solution adaptée": "Tailored solution",
    "Selon votre activité et votre besoin.": "For your business and your requirement.",
    "Contact humain": "Human contact",
    "Un interlocuteur local et disponible.": "A local, available contact.",
    "Type de demande": "Type of request",
    "Choisissez votre demande": "Choose your request",
    "Véhicule de remplacement pour garage / carrosserie": "Replacement vehicle for a garage or body shop",
    "Partenariat hébergement / conciergerie": "Accommodation or concierge partnership",
    "Véhicule pour collaborateur / entreprise": "Vehicle for an employee or business",
    "Besoin professionnel spécifique": "Specific business requirement",
    "Autre demande": "Other request",
    "Ce champ est obligatoire.": "This field is required.",
    "Veuillez saisir une adresse email valide.": "Please enter a valid email address.",
    "Merci, votre demande a bien été envoyée. Nous vous recontacterons rapidement.": "Thank you, your request has been sent. We will contact you shortly.",
    "Une erreur est survenue lors de l’envoi. Vous pouvez nous contacter directement par téléphone ou WhatsApp.": "An error occurred while sending your request. You can contact us directly by phone or WhatsApp.",
    "Voir nos solutions Business": "View our Business solutions",
    "Nom complet": "Full name",
    "Société / établissement": "Company or establishment",
    "Email": "Email",
    "Préférence de contact": "Contact preference",
    "Appel": "Phone call",
    "Message": "Message",
    "Être recontacté": "Request a call back",
    "Décrivez rapidement votre besoin : type de véhicule, durée, lieu, date souhaitée…": "Briefly describe your requirement: vehicle type, duration, location and preferred date…",
    "Des véhicules pour vos besoins professionnels spécifiques.": "Vehicles for your specific business needs.",
    "Utilitaire, véhicule temporaire, mission ponctuelle ou renfort d’activité : GetLocation vous accompagne avec une solution simple et adaptée.": "Van, temporary vehicle, one-off assignment or extra activity support: GetLocation provides a simple solution suited to your needs.",
    "Découvrir les cas d’usage": "Explore use cases",
    "Une réponse concrète": "A practical answer",
    "Tous les besoins professionnels ne rentrent pas dans une case.": "Not every business need fits into one category.",
    "Certaines situations demandent une solution rapide, souple et adaptée : transport ponctuel, matériel à déplacer, événement, remplacement temporaire ou mission imprévue.": "Some situations call for a quick, flexible solution: one-off transport, equipment to move, an event, a temporary replacement or an unexpected assignment.",
    "Transport ponctuel": "One-off transport",
    "Le véhicule utile lorsque vous en avez besoin.": "The useful vehicle, when you need it.",
    "Un format adapté au matériel à déplacer.": "A format suited to the equipment you need to move.",
    "Mission temporaire": "Temporary assignment",
    "Une solution pensée pour la bonne durée.": "A solution designed for the right duration.",
    "Renfort d’activité": "Extra activity support",
    "Un appui mobile au rythme de votre activité.": "Mobile support that keeps pace with your business.",
    "Vous avez un besoin. Nous cherchons la solution véhicule adaptée.": "You have a need. We find the right vehicle solution.",
    "Un fonctionnement simple et flexible.": "A simple, flexible process.",
    "Expliquez-nous votre besoin, nous vous orientons vers la solution adaptée.": "Tell us what you need and we will guide you to the right solution.",
    "Vous décrivez votre besoin": "You describe your requirement",
    "Nous identifions le véhicule adapté": "We identify the right vehicle",
    "GetLocation organise la mise à disposition": "GetLocation arranges availability",
    "Vous réalisez votre mission": "You complete your assignment",
    "Dans quels cas utiliser Professional Solutions ?": "When should you use Professional Solutions?",
    "La solution s’adapte à votre activité, à votre timing et au type de véhicule nécessaire.": "The solution adapts to your business, your timing and the type of vehicle required.",
    "Transport de matériel": "Equipment transport",
    "Livraison ponctuelle": "One-off delivery",
    "Déménagement léger": "Light moving",
    "Renfort saisonnier": "Seasonal support",
    "Besoin urgent": "Urgent need",
    "Déplacement professionnel spécifique": "Specific business journey",
    "Une solution souple pour les professionnels.": "A flexible solution for professionals.",
    "Véhicule adapté": "The right vehicle",
    "Utilitaire, citadine, SUV ou autre véhicule selon le besoin.": "Van, city car, SUV or another vehicle depending on the need.",
    "Vous évitez de chercher une solution dans l’urgence.": "You avoid having to find a solution at short notice.",
    "Flexibilité": "Flexibility",
    "Une solution ponctuelle ou régulière selon votre activité.": "A one-off or regular solution to suit your business.",
    "Un interlocuteur proche, réactif et disponible.": "A nearby, responsive and available contact.",
    "Professional Solutions s’adresse aux professionnels qui ont besoin d’un véhicule sans gérer une flotte.": "Professional Solutions is for professionals who need a vehicle without managing a fleet.",
    "Artisans": "Tradespeople",
    "Commerçants": "Retailers",
    "Entreprises locales": "Local businesses",
    "Organisateurs d’événements": "Event organisers",
    "Agences": "Agencies",
    "Restaurateurs": "Restaurant owners",
    "Professionnels du tourisme": "Tourism professionals",
    "Associations": "Associations",
    "Est-ce réservé aux entreprises ?": "Is it only for businesses?",
    "Non. La solution s’adresse aussi aux indépendants, artisans, commerçants, associations et professionnels locaux.": "No. The solution is also for self-employed professionals, tradespeople, retailers, associations and local professionals.",
    "Peut-on demander un utilitaire ?": "Can I request a van?",
    "Oui, selon les disponibilités et le besoin exprimé.": "Yes, depending on availability and the requirement described.",
    "Peut-on utiliser ce service pour une seule journée ?": "Can I use this service for just one day?",
    "Oui, selon le véhicule, la durée et les disponibilités.": "Yes, depending on the vehicle, duration and availability.",
    "Le véhicule peut-il être livré ?": "Can the vehicle be delivered?",
    "Puis-je demander une solution régulière ?": "Can I request an ongoing solution?",
    "Oui. Nous pouvons définir un fonctionnement adapté à votre activité.": "Yes. We can define an arrangement suited to your business.",
    "Un besoin véhicule spécifique ?": "Need a specific vehicle?",
    "Parlons de votre activité et voyons comment GetLocation peut vous proposer une solution simple, flexible et adaptée.": "Let us discuss your business and see how GetLocation can offer you a simple, flexible solution.",
    "Navigation Professional Solutions": "Professional Solutions navigation",
    "Des véhicules pour vos équipes, sans gestion de flotte.": "Vehicles for your teams, without fleet management.",
    "GetLocation accompagne les entreprises et professionnels avec des véhicules adaptés aux besoins ponctuels ou réguliers de leurs collaborateurs.": "GetLocation supports businesses and professionals with vehicles suited to the occasional or regular needs of their employees.",
    "Échanger sur un besoin": "Discuss a requirement",
    "Cas d’usage": "Use cases",
    "Au bon moment": "At the right time",
    "Vos équipes ont parfois besoin d’un véhicule.": "Your teams sometimes need a vehicle.",
    "Déplacement professionnel, mission ponctuelle, rendez-vous client ou besoin temporaire : vous pouvez proposer une solution simple sans gérer une flotte supplémentaire.": "Business travel, a one-off assignment, a client meeting or a temporary need: you can offer a simple solution without managing an additional fleet.",
    "Rendez-vous client": "Client meeting",
    "Une mobilité adaptée pour être au bon endroit.": "Mobility designed to get them to the right place.",
    "Déplacement professionnel": "Business travel",
    "Un véhicule prêt selon votre organisation.": "A vehicle ready around your schedule.",
    "Mission ponctuelle": "One-off assignment",
    "La bonne solution pour une durée précise.": "The right solution for a defined period.",
    "Besoin temporaire": "Temporary need",
    "Un renfort sans alourdir votre parc.": "Extra capacity without growing your fleet.",
    "Vous gardez la maîtrise. Nous simplifions la mise à disposition du véhicule.": "You stay in control. We simplify making the vehicle available.",
    "Simple pour l’entreprise. Fluide pour le collaborateur.": "Simple for the business. Smooth for the employee.",
    "Un fonctionnement clair, sans organisation complexe.": "A clear process, without complex organisation.",
    "Vous exprimez le besoin": "You explain your requirement",
    "Nous proposons le véhicule adapté": "We suggest the right vehicle",
    "Votre collaborateur prend la route": "Your employee takes to the road",
    "Une solution souple pour vos besoins professionnels.": "A flexible solution for your business needs.",
    "Pas de flotte à gérer": "No fleet to manage",
    "Vous évitez l’achat, l’entretien et l’organisation d’un véhicule supplémentaire.": "You avoid buying, maintaining and organising an additional vehicle.",
    "Véhicule adapté au besoin": "A vehicle suited to the need",
    "Citadine, SUV, utilitaire ou véhicule premium selon la mission.": "City car, SUV, van or premium vehicle depending on the assignment.",
    "Gain de temps": "Time saving",
    "Le véhicule est mis à disposition selon le lieu convenu.": "The vehicle is made available at the agreed location.",
    "Des cas concrets": "Real-life use cases",
    "Dans quels cas utiliser Corporate Mobility ?": "When should you use Corporate Mobility?",
    "La solution s’adapte aux besoins réels de votre activité.": "The solution adapts to the real needs of your business.",
    "Collaborateur en déplacement": "Employee travelling",
    "Rendez-vous professionnel": "Professional meeting",
    "Renfort temporaire": "Temporary support",
    "Événement ou salon": "Event or trade show",
    "Besoin utilitaire": "Van requirement",
    "Véhicule indisponible": "Vehicle unavailable",
    "Mission courte durée": "Short-term assignment",
    "Client ou partenaire à accompagner": "Client or partner to accompany",
    "Pour votre activité": "For your business",
    "Pour quels professionnels ?": "Which professionals?",
    "TPE et PME": "Small and medium-sized businesses",
    "Indépendants": "Self-employed professionals",
    "Commerciaux": "Sales teams",
    "Agences événementielles": "Event agencies",
    "Sociétés de services": "Service companies",
    "Hôtels et conciergeries": "Hotels and concierge services",
    "Équipes terrain": "Field teams",
    "Professionnels en déplacement": "Travelling professionals",
    "Est-ce réservé aux grandes entreprises ?": "Is it only for large businesses?",
    "Non. La solution s’adresse aussi aux indépendants, TPE, PME et professionnels ayant un besoin ponctuel ou régulier.": "No. The solution is also for self-employed professionals, small and medium-sized businesses, and professionals with occasional or regular needs.",
    "Peut-on louer pour une seule journée ?": "Can I rent for just one day?",
    "Oui, selon les disponibilités et le besoin du professionnel.": "Yes, depending on availability and the professional's requirement.",
    "Le véhicule peut-il être livré sur site ?": "Can the vehicle be delivered on site?",
    "Quels types de véhicules sont disponibles ?": "What types of vehicles are available?",
    "Selon les besoins : citadine, SUV, utilitaire, minibus ou véhicule premium.": "Depending on your needs: city car, SUV, van, minibus or premium vehicle.",
    "Peut-on mettre en place un partenariat régulier ?": "Can we set up an ongoing partnership?",
    "Oui. Nous pouvons définir ensemble un fonctionnement adapté à votre activité.": "Yes. Together, we can define an arrangement suited to your business.",
    "Parlons de votre besoin": "Let us discuss your requirement",
    "Un besoin véhicule pour vos équipes ?": "Need a vehicle for your teams?",
    "Parlons de votre activité et voyons comment GetLocation peut vous proposer une solution simple, souple et adaptée.": "Let us discuss your business and see how GetLocation can offer you a simple, flexible solution.",
    "Navigation Corporate Mobility": "Corporate Mobility navigation",
    "GETLOCATION BUSINESS": "GETLOCATION BUSINESS",
    "Offrez une solution de mobilité à vos voyageurs.": "Offer your guests a mobility solution.",
    "GetLocation livre le véhicule directement à l’hébergement, à l’hôtel ou à l’aéroport, pour simplifier l’arrivée et les déplacements de vos clients.": "GetLocation delivers the vehicle directly to the accommodation, hotel or airport, making arrivals and journeys easier for your guests.",
    "Découvrir le fonctionnement": "Discover how it works",
    "Les besoins": "Guest needs",
    "Fonctionnement": "How it works",
    "Avantages": "Benefits",
    "Pour qui": "Who it is for",
    "FAQ": "FAQ",
    "L’expérience voyageur": "The guest experience",
    "Vos voyageurs ont souvent besoin d’un véhicule.": "Your guests often need a vehicle.",
    "À l’arrivée, pendant le séjour ou au moment du départ, le besoin de se déplacer fait partie de l’expérience voyageur.": "On arrival, during the stay or at departure, getting around is part of the guest experience.",
    "Arrivée à l’aéroport": "Arrival at the airport",
    "Un véhicule disponible dès l’atterrissage.": "A vehicle ready from the moment they land.",
    "Déplacements pendant le séjour": "Getting around during the stay",
    "La liberté de découvrir la région à son rythme.": "The freedom to explore the region at their own pace.",
    "Courses, plages et activités": "Shopping, beaches and activities",
    "Une solution pratique pour chaque envie.": "A practical solution for every plan.",
    "Retour en fin de séjour": "End-of-stay return",
    "Un départ organisé plus simplement.": "A departure that is easier to organise.",
    "Vous gérez l’accueil. Nous facilitons leurs déplacements.": "You handle the welcome. We make their journeys easier.",
    "Un parcours simple": "A simple journey",
    "Vous recommandez. Nous gérons.": "You recommend. We handle the rest.",
    "Un fonctionnement simple, sans gestion supplémentaire pour vous.": "A simple process, with no extra administration for you.",
    "Vous partagez votre lien partenaire": "You share your partner link",
    "Le voyageur choisit son véhicule": "The guest chooses their vehicle",
    "GetLocation livre le véhicule": "GetLocation delivers the vehicle",
    "Le voyageur profite de son séjour": "The guest enjoys their stay",
    "Les avantages": "The benefits",
    "Un service utile pour vos voyageurs. Simple pour vous.": "A useful service for your guests. Simple for you.",
    "Expérience client améliorée": "An improved guest experience",
    "Vos voyageurs disposent d’une solution simple pour se déplacer.": "Your guests have a simple way to get around.",
    "Aucune gestion supplémentaire": "No extra administration",
    "Vous ne gérez ni véhicule, ni contrat, ni livraison.": "You do not manage the vehicle, contract or delivery.",
    "Revenu complémentaire": "Additional income",
    "Vous pouvez bénéficier d’une rémunération sur les réservations apportées.": "You can receive remuneration for bookings you refer.",
    "Service local": "Local service",
    "Un interlocuteur proche, disponible et réactif.": "A nearby, available and responsive contact.",
    "Pensé pour votre activité": "Designed for your business",
    "Pour quels hébergements ?": "Which accommodation businesses?",
    "La solution s’adapte à votre façon d’accueillir vos voyageurs.": "The solution adapts to the way you welcome your guests.",
    "Propriétaires Airbnb": "Airbnb hosts",
    "Conciergeries": "Concierge services",
    "Agences de gestion locative": "Property management agencies",
    "Résidences de tourisme": "Tourist residences",
    "Hôtels indépendants": "Independent hotels",
    "Maisons d’hôtes": "Guest houses",
    "Villas saisonnières": "Holiday villas",
    "Les réponses essentielles": "Essential answers",
    "Est-ce que je dois gérer la réservation ?": "Do I need to manage the booking?",
    "Non. Vous transmettez le lien ou le contact. GetLocation gère la suite.": "No. You share the link or contact details. GetLocation handles the rest.",
    "Le véhicule peut-il être livré à l’hébergement ?": "Can the vehicle be delivered to the accommodation?",
    "Oui, selon l’adresse, l’horaire et les disponibilités.": "Yes, depending on the address, timing and availability.",
    "Puis-je proposer ce service à tous mes voyageurs ?": "Can I offer this service to all my guests?",
    "Oui. Vous pouvez intégrer le lien dans vos messages d’accueil, votre livret voyageur ou vos échanges WhatsApp.": "Yes. You can include the link in your welcome messages, guest guide or WhatsApp conversations.",
    "Comment fonctionne la rémunération partenaire ?": "How does partner remuneration work?",
    "Elle peut être définie ensemble selon le volume, le fonctionnement souhaité et les réservations apportées.": "It can be agreed together according to volume, your preferred setup and the bookings referred.",
    "Est-ce obligatoire pour mes voyageurs ?": "Is it compulsory for my guests?",
    "Non. C’est simplement un service complémentaire que vous pouvez leur proposer.": "No. It is simply an additional service you can offer them.",
    "Prêt à en parler ?": "Ready to talk?",
    "Proposez un service utile à vos voyageurs.": "Offer a useful service to your guests.",
    "Parlons de votre hébergement et voyons comment intégrer GetLocation simplement dans votre parcours client.": "Let us discuss your accommodation and how to integrate GetLocation easily into your guest journey.",
    "Échanger sur un partenariat": "Talk about a partnership",
    "Nous contacter sur WhatsApp": "Contact us on WhatsApp",
    "Navigation partenariat hébergements": "Accommodation partnership navigation",
    "Une expérience de mobilité à la hauteur de vos voyageurs.": "A mobility experience worthy of your guests.",
    "Simplifiez les déplacements de vos clients avec un partenaire local, réactif et attentif à chaque séjour.": "Make your guests’ journeys simpler with a local, responsive partner attentive to every stay.",
    "Devenir partenaire": "Become a partner",
    "Découvrir le programme": "Explore the programme",
    "Pensé pour le tourisme": "Designed for tourism",
    "Un service complémentaire pour vos clients": "An added service for your guests",
    "Pour les propriétaires Airbnb, conciergeries, agences de gestion locative, hôtels et résidences touristiques, GetLocation apporte une solution de mobilité claire et personnalisable.": "For Airbnb hosts, concierges, property managers, hotels and tourist residences, GetLocation provides a clear, adaptable mobility soluti…8763 tokens truncated… and give us the address you want in Cannes, including near the Croisette or the Palais des Festivals.",
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
    "Détails du véhicule": "Vehicle details",
    "portes": "doors",
    "Essence / Diesel": "Petrol / Diesel",
    "Hybride": "Hybrid",
    "Électrique": "Electric",
    "Aucun véhicule ne correspond à cette recherche pour le moment.":
      "No vehicle matches this search at the moment.",
    // --- Niveaux de protection (PROTECTIONS, js/data.js)
    // Les noms de formules sont traduits : « Essentiel » ou « Sérénité » ne
    // dit rien à un client anglophone. Le même nom traduit doit se retrouver
    // sur le contrat PDF anglais (js/contrat-en.js).
    "Protection Essentielle": "Essential Protection",
    "Protection Standard": "Standard Protection",
    "Protection Confort": "Comfort Protection",
    "Protection Premium": "Premium Protection",
    "Protection minimale incluse": "Minimum protection included",
    "Protection du véhicule": "Vehicle protection",
    "Protection élargie": "Extended protection",
    "Protection la plus complète proposée": "The most comprehensive protection offered",
    "Dépôt de garantie": "Security deposit",
    "préautorisation bancaire, non débitée sauf frais, dommages ou sommes restant dues": "bank pre-authorisation, not charged unless costs, damage or outstanding amounts are due",
    "Responsabilité civile obligatoire": "Mandatory third-party liability",
    "Collision": "Collision",
    "Rayures": "Scratches",
    "Chocs": "Impacts",
    "Vol": "Theft",
    "Pneus": "Tyres",
    "Pare-brise": "Windscreen",
    "Vitres": "Windows",
    "Assistance dépannage": "Breakdown assistance",
    "Protection conducteur": "Driver protection",
    "Protection passagers": "Passenger protection",
    "Choisissez votre niveau de protection": "Choose your protection level",
    "La formule Essentiel est incluse dans votre location. Les formules supérieures réduisent votre participation financière en cas de dommage couvert — elles s'appliquent pendant toute la durée de la location, avec un prix plafonné.":
      "The Essential cover is included in the rental. Higher levels add extra guarantees, with a capped price depending on the level.",
    "La Protection Essentielle est incluse dans votre location. Les formules supérieures ajoutent des garanties complémentaires, avec un prix plafonné selon la formule.":
      "Essential Protection is included in your rental. Higher levels add extra guarantees, with a capped price depending on the level.",
    "Protection minimale incluse. La responsabilité civile obligatoire s'applique selon les conditions du contrat.": "Minimum protection included. Mandatory third-party liability applies under the rental agreement.",
    "Protection du véhicule. Réduit votre participation financière en cas de dommage couvert, selon les conditions du contrat.": "Vehicle protection. Reduces your financial contribution for covered damage, subject to the rental agreement.",
    "Protection élargie. Réduit votre participation financière en cas de dommage couvert, selon les conditions du contrat.": "Extended protection. Reduces your financial contribution for covered damage, subject to the rental agreement.",
    "Protection la plus complète proposée. Réduit votre participation financière en cas de dommage couvert, selon les conditions du contrat.": "The most comprehensive protection offered. Reduces your financial contribution for covered damage, subject to the rental agreement.",
    "Protection minimale incluse": "Minimum protection included",
    "Protection du véhicule": "Vehicle protection",
    "Protection élargie": "Extended protection",
    "Protection la plus complète proposée": "The most comprehensive protection offered",
    "Recommandé": "Recommended",
    "Couvert : ": "Covered: ",
    "Non couvert : ": "Not covered: ",
    "✓ Sélectionnée": "✓ Selected",
    "Les protections complémentaires permettent de réduire la participation financière du locataire dans les conditions prévues au contrat de location. Elles restent soumises aux exclusions, limitations et conditions générales applicables.":
      "Additional protection can reduce the renter's financial contribution under the terms of the rental agreement. It remains subject to the applicable exclusions, limitations and general conditions.",
    "Les protections complémentaires permettent de réduire la participation financière du locataire dans les conditions prévues au contrat de location. Elles restent soumises aux exclusions, limitations et conditions générales applicables.\n\nLe dépôt de garantie ne constitue pas un plafond de responsabilité. En cas de dommages, frais ou réparations supérieurs au dépôt de garantie, un complément pourra être réclamé conformément au contrat.":
      "Additional protection can reduce the renter's financial contribution under the terms of the rental agreement. It remains subject to the applicable exclusions, limitations and general conditions.\n\nThe security deposit does not constitute a liability cap. If damage, costs or repairs exceed the security deposit, an additional amount may be claimed in accordance with the rental agreement.",
    "Les garanties sont détaillées dans les Conditions Générales de Location et restent soumises aux exclusions et limitations applicables.": "The guarantees are detailed in the General Rental Conditions and remain subject to the applicable exclusions and limitations.",
    "Informations sur {protection}": "Information about {protection}",
    "Fermer": "Close",
    "Maximum : {montant}": "Maximum: {montant}",

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
    "Demander ce véhicule": "Request this vehicle",
    "Choisir ce véhicule": "Choose this vehicle",
    "Tarif sur demande": "Price on request",
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
    "Dépôt de garantie : {montant}": "Security deposit: {montant}",
    "Date invalide (JJ/MM/AAAA attendu) : {champ}.": "Invalid date (DD/MM/YYYY expected): {champ}.",
    "Demande de réservation — {vehicule}": "Booking request — {vehicule}",
    "{vehicule} — GETLOCATION": "{vehicule} — GETLOCATION",
    "Bonjour,\n\nJe souhaite faire une demande de réservation pour : {vehicule}\nDu {debut} au {fin}.\n\nMerci de me recontacter.":
      "Hello,\n\nI would like to request a booking for: {vehicule}\nFrom {debut} to {fin}.\n\nPlease get back to me.",
    "Aucun supplément. Un dépôt de garantie de {caution} reste prévu pour ce véhicule. Les conditions exactes figurent dans les conditions de location.":
      "No extra charge. A deposit of {caution} still applies to this vehicle. The exact terms are set out in the rental conditions.",
    "{prix} / jour": "{prix} / day",
    "Choisir {protection}": "Choose {protection}",
    "Choisir {vehicule}": "Choose {vehicule}",
    "Franchise : {montant}": "Excess: {montant}",
    "Niveau de protection : {niveau} sur 3": "Protection level: {niveau} out of 3",
    "Afficher les détails de {protection}": "Show details for {protection}",
    "Masquer les détails de {protection}": "Hide details for {protection}",
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
    if (fichier === "business" || fichier === "business/") return "business/index.html";
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
        // translate="no" : texte à laisser tel quel, quoi qu'en dise le
        // dictionnaire. Sert au corps des pages juridiques, où une phrase
        // traduite au milieu d'un texte français donnerait un document
        // hybride qui ne correspond à aucune version faisant foi.
        if (parent.closest('[translate="no"]')) return vue.NodeFilter.FILTER_REJECT;
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
      if (element.closest && element.closest('[translate="no"]')) return;
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

  // Corps des pages juridiques : marqué translate="no" AVANT toute
  // traduction. Le dictionnaire contient forcément des mots qui y figurent
  // aussi (« Essentiel », « Inclus », des montants…) : sans ce garde-fou, les
  // CGL anglaises affichaient un tableau à moitié traduit, alors que seule la
  // version française fait foi (voir CLAUDE.md).
  function figerCorpsJuridique() {
    var page = nomDePage(global.location.pathname);
    if (PAGES_JURIDIQUES.indexOf(page) === -1) return;
    var cartes = document.querySelectorAll(".section .card, main .card");
    Array.prototype.forEach.call(cartes, function (carte) {
      carte.setAttribute("translate", "no");
    });
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
    figerCorpsJuridique();
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
