// Données de démonstration — GETLOCATION
// Location de véhicules dans les Alpes-Maritimes (06) / Côte d'Azur.
// À remplacer par de vraies données (base de données / CMS) en production.
//
// IMPORTANT : ce fichier est la SEULE source de vérité pour les tarifs, les
// horaires et les règles de calcul de durée. Il est chargé tel quel par le
// navigateur (balise <script>, variables globales) ET requis tel quel par les
// fonctions Netlify côté serveur (voir l'export gardé en bas de fichier) afin
// que le prix affiché au client et le prix recalculé par le serveur ne
// puissent jamais diverger. Ne dupliquez pas ces valeurs ailleurs : modifiez
// uniquement ce fichier.

const LIEU_LIVRAISON = "Livraison à l'adresse de votre choix";
const ADRESSE_PERSONNALISEE = "Saisir une adresse personnalisée";

const LIEUX = [
  LIEU_LIVRAISON
];

// Zones de livraison proposées à la recherche : uniquement des villes de la
// Côte d'Azur (cohérent avec les pages location-voiture-*.html et le
// areaServed du balisage Schema.org). Remplace la saisie libre d'une adresse
// complète par un choix simple parmi ces villes et points de rendez-vous,
// plus rapide et sans risque de faute de frappe. L'adresse exacte ou le
// point de rencontre détaillé est demandé dans le dossier sécurisé après
// paiement, jamais dans l'URL de réservation.
const VILLES_LIVRAISON = [
  "Grasse",
  "Cannes",
  "Cannes-la-Bocca",
  "Le Cannet",
  "Mougins",
  "Antibes",
  "Juan-les-Pins",
  "Biot",
  "Villeneuve-Loubet",
  "Cagnes-sur-Mer",
  "Saint-Laurent-du-Var",
  "Nice",
  "Monaco",
  "Gare SNCF de Grasse",
  "Gare SNCF de Cannes",
  "Gare SNCF de Cannes-la-Bocca",
  "Gare SNCF d'Antibes",
  "Gare SNCF de Cagnes-sur-Mer",
  "Gare SNCF de Saint-Laurent-du-Var",
  "Gare de Nice-Ville",
  "Gare de Nice-Saint-Augustin",
  "Aéroport Nice Côte d'Azur"
];

function formatAdressePersonnalisee(rue, codePostal, ville) {
  return `${ADRESSE_PERSONNALISEE} — ${String(rue || "").trim()}, ${String(codePostal || "").trim()} ${String(ville || "").trim()}`;
}

function parseAdressePersonnalisee(value) {
  if (typeof value !== "string" || value.length > 300) return null;
  const prefix = `${ADRESSE_PERSONNALISEE} — `;
  if (!value.startsWith(prefix)) return null;
  const match = /^(.{3,200}), (\d{5}) (.{2,80})$/u.exec(value.slice(prefix.length));
  return match ? { rue: match[1], codePostal: match[2], ville: match[3] } : null;
}

function libelleAdresseLivraison(value) {
  const adresse = parseAdressePersonnalisee(value);
  return adresse ? `${adresse.rue}, ${adresse.codePostal} ${adresse.ville}` : (value || "");
}

const CATEGORIES = ["Citadine", "SUV", "Utilitaire"];

// Nouvelle architecture commerciale à deux niveaux (famille -> type),
// utilisée par le moteur de recherche et les filtres de la page véhicules
// (voir js/app.js). S'ajoute aux champs historiques ci-dessus
// (categorie/carburant/hybride/transmission), qui restent la source de
// vérité pour les contrats et les grilles HTML en dur
// (scripts/check-vehicle-grid-sync.js) — jamais renommés ni supprimés.
// Centralisée ici : ajouter un type ou une famille se fait à un seul
// endroit, sans reconstruire le moteur de recherche ni les filtres.
const FAMILLES_VEHICULE = [
  { id: "car", label: "Voitures" },
  { id: "utility", label: "Utilitaires" },
  { id: "license-free", label: "Sans permis" }
];

// Types de voitures (niveau 2, uniquement pour vehicleFamily = "car").
// Liste volontairement extensible : un type sans véhicule associé reste
// affiché comme filtre (le client voit l'étendue de l'offre), il retourne
// simplement une liste vide tant qu'aucun véhicule ne lui correspond.
const TYPES_VOITURE = [
  { id: "citadine", label: "Citadine" },
  { id: "suv", label: "SUV / 4x4" },
  { id: "berline", label: "Berline" },
  { id: "minibus", label: "Minibus" },
  { id: "premium", label: "Premium" }
];

// Motorisation — critère transversal aux types de voitures (ex. SUV
// électrique, citadine hybride), plutôt qu'une catégorie en soi.
const CARBURANTS = [
  { id: "petrol", label: "Essence" },
  { id: "diesel", label: "Diesel" },
  { id: "hybrid", label: "Hybride" },
  { id: "electric", label: "Électrique" }
];

function getFamillesVehicule() { return FAMILLES_VEHICULE; }
function getTypesVoiture() { return TYPES_VOITURE; }
function getCarburants() { return CARBURANTS; }

// Horaires de prise en charge / restitution : disponible 24h/24 sur
// rendez-vous (évolution prévue vers un système de déverrouillage par
// smartphone, sans horaires fixes à terme).
const HEURE_OUVERTURE = "00:00";
const HEURE_FERMETURE = "23:30";

// Identifiant de version des conditions générales de location (CGL) et de
// la politique de confidentialité actuellement en vigueur. Toute
// acceptation client est tracée avec cette version (voir
// netlify/functions/create-payment-intent.js) afin de savoir précisément
// quel texte a été accepté à quelle date. À incrémenter (ex. date du jour)
// à chaque modification substantielle de cgl.html ou confidentialite.html.
// IMPORTANT : cgl.html contient encore des placeholders [à compléter] non
// résolus (cf. LEGAL-TODO.md) — ce mécanisme trace la version acceptée,
// il ne garantit pas à lui seul la validité juridique du texte.
const CGL_VERSION = "2026-07-22";

// Réduction selon la durée de location : aucun tarif dégressif en dessous
// de 5 jours consécutifs ; à partir de 5 jours, réduction fixe de
// `montantParJour` € par jour (appliquée à la totalité du séjour, pas
// seulement aux jours au-delà du seuil). Valeurs d'exemple (placeholders) à
// ajuster librement ici — c'est le seul endroit à modifier pour changer les
// taux : le calcul, l'affichage véhicules/réservation/paiement et le
// recalcul serveur s'appuient tous sur ce tableau. Triées du seuil le plus
// élevé au plus bas pour que reductionDureeApplicable() retienne le
// meilleur palier atteint.
const REDUCTIONS_DUREE = [
  { seuilJours: 5, montantParJour: 10, libelle: "5 jours ou plus" }
];

// Retourne le palier de réduction durée applicable (ou null si la location
// est trop courte pour en bénéficier).
function reductionDureeApplicable(jours) {
  return REDUCTIONS_DUREE.find(r => jours >= r.seuilJours) || null;
}

// Prix/jour le plus bas atteignable pour un véhicule, en supposant la
// meilleure remise durée possible (voir REDUCTIONS_DUREE). Utilisé pour
// l'affichage « à partir de X €/jour » sur les cartes véhicules : le
// client voit d'emblée le tarif le plus avantageux, pas seulement le tarif
// plein.
function prixJourMinimum(vehicule) {
  const meilleureRemiseParJour = REDUCTIONS_DUREE.reduce((max, r) => Math.max(max, r.montantParJour), 0);
  return vehicule.prixJour - meilleureRemiseParJour;
}

// Codes promo — liste simple codée en dur (pas d'interface d'administration
// pour l'instant). Codes insensibles à la casse/espaces (voir
// getCodePromo). Valeurs d'exemple à ajuster ici.
const CODES_PROMO = {
  GETLOC95: { pourcentage: 95, description: "95 % de réduction" },
  GETLOC90: { pourcentage: 90, description: "90 % de réduction" },
  GETLOC85: { pourcentage: 85, description: "85 % de réduction" },
  GETLOC80: { pourcentage: 80, description: "80 % de réduction" },
  GETLOC75: { pourcentage: 75, description: "75 % de réduction" },
  GETLOC70: { pourcentage: 70, description: "70 % de réduction" },
  GETLOC65: { pourcentage: 65, description: "65 % de réduction" },
  GETLOC60: { pourcentage: 60, description: "60 % de réduction" },
  GETLOC55: { pourcentage: 55, description: "55 % de réduction" },
  GETLOC50: { pourcentage: 50, description: "50 % de réduction" },
  GETLOC45: { pourcentage: 45, description: "45 % de réduction" },
  GETLOC40: { pourcentage: 40, description: "40 % de réduction" },
  GETLOC35: { pourcentage: 35, description: "35 % de réduction" },
  GETLOC30: { pourcentage: 30, description: "30 % de réduction" },
  GETLOC25: { pourcentage: 25, description: "25 % de réduction" },
  GETLOC20: { pourcentage: 20, description: "20 % de réduction" },
  GETLOC15: { pourcentage: 15, description: "15 % de réduction" },
  GETLOC10: { pourcentage: 10, description: "10 % de réduction" },
  GETLOC5: { pourcentage: 5, description: "5 % de réduction" }
};

// Normalise et recherche un code promo. Retourne null si absent/invalide.
function getCodePromo(code) {
  if (!code) return null;
  const normalise = String(code).trim().toUpperCase();
  if (!normalise || !CODES_PROMO[normalise]) return null;
  const promo = CODES_PROMO[normalise];
  return { code: normalise, pourcentage: promo.pourcentage, description: promo.description };
}

// Catalogue des options proposées pendant la réservation (avant paiement).
// type "jour" : prix multiplié par le nombre de jours facturables.
// type "forfait" : montant fixe, quelle que soit la durée.
const OPTIONS = [
  { id: "second-conducteur", nom: "Conducteur supplémentaire", description: "Les longs trajets sont plus agréables quand on peut se relayer. Ajoutez un conducteur supplémentaire pour partager le volant et voyager plus sereinement. Il devra simplement présenter un permis de conduire valide et respecter les mêmes conditions que le conducteur principal.", type: "jour", prix: 10 },
  { id: "km-200", nom: "Forfait 200 km supplémentaires", description: "Une petite marge de liberté pour prolonger une balade, changer d'itinéraire ou profiter d'une étape imprévue sans surveiller chaque kilomètre.", type: "forfait", prix: 60 },
  { id: "km-supplementaire", nom: "Forfait 300 km supplémentaires", description: "Le bon équilibre pour explorer davantage la Côte d'Azur et ses alentours, avec une réserve confortable sur l'ensemble du séjour.", type: "forfait", prix: 100 },
  { id: "km-400", nom: "Forfait 400 km supplémentaires", description: "Pour les séjours les plus mobiles : partez plus loin et multipliez les escapades avec une marge kilométrique généreuse.", type: "forfait", prix: 150 },
  { id: "service-plein", nom: "Service de plein / recharge", description: "Profitez de votre dernière journée jusqu'au bout et évitez le détour par une station avant le retour. Rendez le véhicule sans refaire vous-même le plein ou la recharge : notre équipe s'en charge. Le carburant ou l'électricité consommés restent facturés selon les conditions de location.", type: "forfait", prix: 28 },
  { id: "siege-auto", nom: "Siège bébé", description: "Voyagez plus léger : le siège bébé vous attend directement dans le véhicule lors de sa livraison. Une solution simple pour préparer le trajet familial avec moins de matériel à transporter.", type: "jour", prix: 5 },
  { id: "siege-enfant", nom: "Siège enfant", description: "Offrez à votre enfant une assise adaptée et plus confortable pendant le trajet. Le siège est préparé dans le véhicule avant votre prise en charge.", type: "jour", prix: 5 },
  { id: "rehausseur", nom: "Rehausseur enfant", description: "Une solution pratique pour mieux installer les enfants plus grands avec la ceinture du véhicule, sans avoir à emporter votre propre équipement.", type: "jour", prix: 3 },
  { id: "assurance-passagers", nom: "Assurance passagers / accident", description: "Couvre les dommages corporels des passagers en cas d'accident", type: "jour", prix: 6 },
  { id: "livraison-adresse", nom: "Livraison du véhicule", description: "Livraison à l'adresse ou au point de rendez-vous choisi sur la Côte d'Azur", type: "forfait", prix: 20 }
];

function getOptionParId(id) {
  return OPTIONS.find(o => o.id === id);
}

const VEHICULES = [
  {
    id: "opel-corsa",
    nom: "Opel Corsa Business 1.2T",
    immatriculation: "HJ-967-KQ",
    annee: 2026,
    categorie: "Citadine",
    // Nouvelle architecture (voir FAMILLES_VEHICULE/TYPES_VOITURE/CARBURANTS
    // plus haut) : vehicleFamily/type/fuel sont dérivés des champs
    // historiques ci-dessus, jamais divergents. source="internal" (véhicule
    // exploité directement par GET LOCATION) et bookingMode="instant"
    // (paiement en ligne immédiat) décrivent une réalité opérationnelle
    // interne, jamais affichée telle quelle au client (voir js/app.js).
    vehicleFamily: "car",
    type: "citadine",
    fuel: "petrol",
    source: "internal",
    bookingMode: "instant",
    modelGuaranteed: true,
    emoji: "🚗",
    photo: "images/opel-corsa.jpg",
    photoCutout: "images/opel-corsa-cutout.webp",
    photos: [
      { webp: "images/gallery/opel-corsa-1.webp", jpg: "images/gallery/opel-corsa-1.jpg", thumbWebp: "images/gallery/opel-corsa-1-700w.webp", thumbJpg: "images/gallery/opel-corsa-1-700w.jpg", legende: "Vue 3/4 avant" },
      { webp: "images/gallery/opel-corsa-2.webp", jpg: "images/gallery/opel-corsa-2.jpg", thumbWebp: "images/gallery/opel-corsa-2-700w.webp", thumbJpg: "images/gallery/opel-corsa-2-700w.jpg", legende: "Profil" },
      { webp: "images/gallery/opel-corsa-3.webp", jpg: "images/gallery/opel-corsa-3.jpg", thumbWebp: "images/gallery/opel-corsa-3-700w.webp", thumbJpg: "images/gallery/opel-corsa-3-700w.jpg", legende: "Arrière" },
      { webp: "images/gallery/opel-corsa-4.webp", jpg: "images/gallery/opel-corsa-4.jpg", thumbWebp: "images/gallery/opel-corsa-4-700w.webp", thumbJpg: "images/gallery/opel-corsa-4-700w.jpg", legende: "Tableau de bord" },
      { webp: "images/gallery/opel-corsa-5.webp", jpg: "images/gallery/opel-corsa-5.jpg", thumbWebp: "images/gallery/opel-corsa-5-700w.webp", thumbJpg: "images/gallery/opel-corsa-5-700w.jpg", legende: "Sièges avant" },
      { webp: "images/gallery/opel-corsa-6.webp", jpg: "images/gallery/opel-corsa-6.jpg", thumbWebp: "images/gallery/opel-corsa-6-700w.webp", thumbJpg: "images/gallery/opel-corsa-6-700w.jpg", legende: "Coffre" }
    ],
    places: 5,
    portes: 5,
    transmission: "Manuelle",
    clim: true,
    hybride: false,
    // "1.2T" = motorisation 1.2 Turbo essence (aucune version diesel de la
    // Corsa ne porte cette désignation) — seule donnée de carburant déduite
    // du nom du modèle plutôt que d'une carte grise, contrairement aux
    // autres véhicules ci-dessous (voir LEGAL-TODO.md).
    carburant: "Essence",
    prixJour: 59,
    caution: 500,
    description: "Compacte et économique, parfaite pour vos déplacements pro entre Cannes, Antibes et Grasse."
  },
  {
    id: "peugeot-2008-hybrid",
    nom: "Peugeot 2008 Hybrid",
    immatriculation: "HK-493-ZN",
    annee: 2026,
    categorie: "SUV",
    vehicleFamily: "car",
    type: "suv",
    fuel: "hybrid",
    source: "internal",
    bookingMode: "instant",
    modelGuaranteed: true,
    emoji: "🚙",
    photo: "images/peugeot-2008-hybrid.jpg",
    photoCutout: "images/peugeot-2008-hybrid-cutout.webp",
    photos: [
      { webp: "images/gallery/peugeot-2008-hybrid-1.webp", jpg: "images/gallery/peugeot-2008-hybrid-1.jpg", thumbWebp: "images/gallery/peugeot-2008-hybrid-1-700w.webp", thumbJpg: "images/gallery/peugeot-2008-hybrid-1-700w.jpg", legende: "Vue 3/4 avant" },
      { webp: "images/gallery/peugeot-2008-hybrid-2.webp", jpg: "images/gallery/peugeot-2008-hybrid-2.jpg", thumbWebp: "images/gallery/peugeot-2008-hybrid-2-700w.webp", thumbJpg: "images/gallery/peugeot-2008-hybrid-2-700w.jpg", legende: "Profil" },
      { webp: "images/gallery/peugeot-2008-hybrid-3.webp", jpg: "images/gallery/peugeot-2008-hybrid-3.jpg", thumbWebp: "images/gallery/peugeot-2008-hybrid-3-700w.webp", thumbJpg: "images/gallery/peugeot-2008-hybrid-3-700w.jpg", legende: "Arrière 3/4" },
      { webp: "images/gallery/peugeot-2008-hybrid-4.webp", jpg: "images/gallery/peugeot-2008-hybrid-4.jpg", thumbWebp: "images/gallery/peugeot-2008-hybrid-4-700w.webp", thumbJpg: "images/gallery/peugeot-2008-hybrid-4-700w.jpg", legende: "Tableau de bord" },
      { webp: "images/gallery/peugeot-2008-hybrid-5.webp", jpg: "images/gallery/peugeot-2008-hybrid-5.jpg", thumbWebp: "images/gallery/peugeot-2008-hybrid-5-700w.webp", thumbJpg: "images/gallery/peugeot-2008-hybrid-5-700w.jpg", legende: "Sièges arrière" },
      { webp: "images/gallery/peugeot-2008-hybrid-6.webp", jpg: "images/gallery/peugeot-2008-hybrid-6.jpg", thumbWebp: "images/gallery/peugeot-2008-hybrid-6-700w.webp", thumbJpg: "images/gallery/peugeot-2008-hybrid-6-700w.jpg", legende: "Coffre" }
    ],
    places: 5,
    portes: 5,
    transmission: "Automatique",
    clim: true,
    hybride: true,
    carburant: "Hybride essence",
    prixJour: 69,
    caution: 500,
    description: "SUV compact hybride, confortable et sobre pour rayonner sur toute la Côte d'Azur."
  },
  {
    id: "peugeot-3008",
    nom: "Peugeot 3008",
    immatriculation: "HK-085-LQ",
    annee: 2026,
    categorie: "SUV",
    vehicleFamily: "car",
    type: "suv",
    fuel: "hybrid",
    source: "internal",
    bookingMode: "instant",
    modelGuaranteed: true,
    emoji: "🚙",
    photo: "images/peugeot-3008.jpg",
    photoCutout: "images/peugeot-3008-cutout-veh.webp",
    photos: [
      { webp: "images/gallery/peugeot-3008-1.webp", jpg: "images/gallery/peugeot-3008-1.jpg", thumbWebp: "images/gallery/peugeot-3008-1-700w.webp", thumbJpg: "images/gallery/peugeot-3008-1-700w.jpg", legende: "Vue 3/4 avant" },
      { webp: "images/gallery/peugeot-3008-2.webp", jpg: "images/gallery/peugeot-3008-2.jpg", thumbWebp: "images/gallery/peugeot-3008-2-700w.webp", thumbJpg: "images/gallery/peugeot-3008-2-700w.jpg", legende: "Profil" },
      { webp: "images/gallery/peugeot-3008-3.webp", jpg: "images/gallery/peugeot-3008-3.jpg", thumbWebp: "images/gallery/peugeot-3008-3-700w.webp", thumbJpg: "images/gallery/peugeot-3008-3-700w.jpg", legende: "Arrière 3/4" },
      { webp: "images/gallery/peugeot-3008-4.webp", jpg: "images/gallery/peugeot-3008-4.jpg", thumbWebp: "images/gallery/peugeot-3008-4-700w.webp", thumbJpg: "images/gallery/peugeot-3008-4-700w.jpg", legende: "Tableau de bord" },
      { webp: "images/gallery/peugeot-3008-5.webp", jpg: "images/gallery/peugeot-3008-5.jpg", thumbWebp: "images/gallery/peugeot-3008-5-700w.webp", thumbJpg: "images/gallery/peugeot-3008-5-700w.jpg", legende: "Sièges" },
      { webp: "images/gallery/peugeot-3008-6.webp", jpg: "images/gallery/peugeot-3008-6.jpg", thumbWebp: "images/gallery/peugeot-3008-6-700w.webp", thumbJpg: "images/gallery/peugeot-3008-6-700w.jpg", legende: "Coffre" }
    ],
    places: 5,
    portes: 5,
    transmission: "Automatique",
    clim: true,
    hybride: true,
    carburant: "Hybride essence",
    prixJour: 79,
    caution: 600,
    description: "SUV familial haut de gamme, idéal pour vos trajets entre Nice, Cannes et l'arrière-pays."
  },
  {
    id: "toyota-proace-city",
    nom: "Toyota Proace City",
    immatriculation: "HK-619-XA",
    annee: 2026,
    categorie: "Utilitaire",
    // Famille "utility" : pas de sous-type standardisé pour l'instant (voir
    // TYPES_VOITURE — l'équivalent utilitaire reste à définir, cf. mission
    // §6). "type" reste donc null plutôt qu'une valeur inventée.
    vehicleFamily: "utility",
    type: null,
    fuel: null,
    source: "internal",
    bookingMode: "instant",
    modelGuaranteed: true,
    emoji: "🚐",
    photo: "images/toyota-proace-city.jpg",
    photos: [
      { webp: "images/gallery/toyota-proace-city-1.webp", jpg: "images/gallery/toyota-proace-city-1.jpg", thumbWebp: "images/gallery/toyota-proace-city-1-700w.webp", thumbJpg: "images/gallery/toyota-proace-city-1-700w.jpg", legende: "Vue 3/4 avant" },
      { webp: "images/gallery/toyota-proace-city-2.webp", jpg: "images/gallery/toyota-proace-city-2.jpg", thumbWebp: "images/gallery/toyota-proace-city-2-700w.webp", thumbJpg: "images/gallery/toyota-proace-city-2-700w.jpg", legende: "Face avant" },
      { webp: "images/gallery/toyota-proace-city-3.webp", jpg: "images/gallery/toyota-proace-city-3.jpg", thumbWebp: "images/gallery/toyota-proace-city-3-700w.webp", thumbJpg: "images/gallery/toyota-proace-city-3-700w.jpg", legende: "Profil" },
      { webp: "images/gallery/toyota-proace-city-4.webp", jpg: "images/gallery/toyota-proace-city-4.jpg", thumbWebp: "images/gallery/toyota-proace-city-4-700w.webp", thumbJpg: "images/gallery/toyota-proace-city-4-700w.jpg", legende: "Arrière" },
      { webp: "images/gallery/toyota-proace-city-5.webp", jpg: "images/gallery/toyota-proace-city-5.jpg", thumbWebp: "images/gallery/toyota-proace-city-5-700w.webp", thumbJpg: "images/gallery/toyota-proace-city-5-700w.jpg", legende: "Intérieur" },
      { webp: "images/gallery/toyota-proace-city-6.webp", jpg: "images/gallery/toyota-proace-city-6.jpg", thumbWebp: "images/gallery/toyota-proace-city-6-700w.webp", thumbJpg: "images/gallery/toyota-proace-city-6-700w.jpg", legende: "Espace de chargement" }
    ],
    places: 5,
    portes: 5,
    transmission: "Manuelle",
    clim: true,
    hybride: false,
    // Carburant non déductible avec certitude du seul nom du modèle
    // (existe en diesel comme en électrique selon la finition réelle) —
    // à confirmer sur la carte grise avant de l'afficher sur un contrat
    // (voir LEGAL-TODO.md). `null` plutôt qu'une valeur inventée.
    carburant: null,
    prixJour: 99,
    caution: 800,
    description: "Ludospace polyvalent au grand volume de chargement, idéal bagages, matériel ou déménagement."
  }
];

function formatEUR(montant) {
  return montant.toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
}

// Variante précise (2 décimales) de formatEUR, pour les rares montants non
// entiers (ex. le tarif kilométrique supplémentaire — voir
// SUPPLEMENT_KM_CENTIMES plus bas). formatEUR() seul ne convient pas ici :
// avec maximumFractionDigits: 0, formatEUR(0.25) arrondit à "0 €" (bug
// constaté sur le contrat : "0 €/km" au lieu de "0,25 €/km").
function formatEURPrecis(montant) {
  return montant.toLocaleString("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Identité légale de GETLOCATION (TLST SAS), centralisée ici pour ne
// jamais être ressaisie/dupliquée ailleurs (mentions-legales.html reste la
// page publique de référence, mais contrat.html et tout futur document
// généré doivent lire ces valeurs ici plutôt que de les recopier).
// `null` = information non encore fournie par l'agence : ne JAMAIS
// inventer de valeur de substitution (voir LEGAL-TODO.md, mêmes
// placeholders que mentions-legales.html — RCS et capital social restent
// à compléter).
const AGENCE = {
  nomCommercial: "GETLOCATION",
  societe: "TLST SAS",
  siegeSocial: "Grasse (06130)",
  siret: "932 098 908 00019",
  siren: "932 098 908",
  rcs: null,
  capitalSocial: null,
  telephone: "+33 6 67 48 54 30",
  telephoneHref: "+33667485430",
  email: "contact@getlocation.fr",
  siteWeb: "www.getlocation.fr"
};

// Franchises d'assurance — DISTINCTES du dépôt de garantie (voir
// VEHICULES[].caution). Ne jamais assimiler franchise et caution : leurs
// montants peuvent légitimement diverger selon le contrat d'assurance réel
// souscrit par l'agence. Aucun montant n'a été communiqué à ce jour pour
// ces trois franchises (dommages/vol/bris de glace) : elles restent à
// `null` tant que l'agence ne les a pas configurées ici — le contrat
// affiche alors une formulation générique renvoyant aux CGL plutôt qu'un
// montant inventé. À renseigner une fois pour toutes ici (un seul endroit
// à modifier) dès que l'agence communique les montants exacts.
const FRANCHISES = {
  dommages: null,
  vol: null,
  brisDeGlace: null
};

function getFranchises() {
  return FRANCHISES;
}

function getVehiculeParId(id) {
  return VEHICULES.find(v => v.id === id);
}

// Calcule la durée réelle de location en heures, en tenant compte de l'heure
// de prise en charge et de restitution (pas seulement de la date calendaire).
function dureeEnHeures(dateDebut, heureDebut, dateFin, heureFin) {
  const debut = new Date(`${dateDebut}T${heureDebut || "00:00"}:00`);
  const fin = new Date(`${dateFin}T${heureFin || "00:00"}:00`);
  return (fin - debut) / (1000 * 60 * 60);
}

// Convertit une durée en heures en nombre de jours facturables : toute heure
// entamée au-delà d'un multiple de 24h compte pour un jour supplémentaire.
function joursFacturablesDepuisHeures(dureeHeures) {
  if (!isFinite(dureeHeures) || dureeHeures <= 0) return 1;
  return Math.max(Math.ceil(dureeHeures / 24), 1);
}

// Recalcule le prix total d'une location à partir des seules données
// métier (jamais d'un montant fourni par le client). Utilisé à la fois par
// l'affichage côté navigateur et par le recalcul faisant foi côté serveur.
//
// Pipeline (dans cet ordre) :
//   1. sous-total brut = prix/jour du véhicule × jours facturables
//   2. réduction durée (5 jours ou plus, voir REDUCTIONS_DUREE) appliquée
//      sur ce sous-total
//   3. + options sélectionnées (voir OPTIONS)
//   4. − réduction du code promo (si valide), appliquée sur le total obtenu
//      à l'étape précédente
//
// Pas d'assurance tous risques optionnelle pour l'instant (retirée le
// 4 août 2026) : seule l'assurance responsabilité civile obligatoire,
// incluse dans le prix, s'applique. La franchise en cas de sinistre
// responsable est égale au montant de la caution du véhicule loué (voir
// VEHICULES[].caution) — aucun montant de franchise séparé à définir.
//
// `options` est une liste d'identifiants (ex. ["siege-auto","livraison-adresse"]) ;
// les identifiants inconnus sont ignorés ici (la validation stricte côté
// serveur — qui rejette une requête contenant un identifiant inconnu — se
// fait séparément dans validate-reservation-input.js).
function calculerPrixTotal({ vehiculeId, dateDebut, heureDebut, dateFin, heureFin, options, codePromo }) {
  const vehicule = getVehiculeParId(vehiculeId);
  if (!vehicule) return null;
  const dureeHeures = dureeEnHeures(dateDebut, heureDebut, dateFin, heureFin);
  if (!isFinite(dureeHeures) || dureeHeures <= 0) return null;
  const jours = joursFacturablesDepuisHeures(dureeHeures);

  const sousTotalBrut = vehicule.prixJour * jours;
  const palierReduction = reductionDureeApplicable(jours);
  const reductionDureeMontant = palierReduction ? palierReduction.montantParJour * jours : 0;
  const sousTotal = sousTotalBrut - reductionDureeMontant;

  const idsOptions = Array.isArray(options) ? [...new Set(options)] : [];
  const optionsSelectionnees = idsOptions
    .map(id => getOptionParId(id))
    .filter(Boolean)
    .map(opt => ({
      id: opt.id,
      nom: opt.nom,
      type: opt.type,
      montant: opt.type === "jour" ? opt.prix * jours : opt.prix
    }));
  const optionsMontant = optionsSelectionnees.reduce((somme, o) => somme + o.montant, 0);

  const baseAvantPromo = sousTotal + optionsMontant;
  const promo = getCodePromo(codePromo);
  const reductionPromoMontant = promo ? Math.round(baseAvantPromo * promo.pourcentage) / 100 : 0;

  const total = baseAvantPromo - reductionPromoMontant;

  return {
    vehicule,
    jours,
    sousTotalBrut,
    reductionDuree: palierReduction ? { montantParJour: palierReduction.montantParJour, montant: reductionDureeMontant, libelle: palierReduction.libelle } : null,
    sousTotal,
    optionsSelectionnees,
    optionsMontant,
    baseAvantPromo,
    codePromo: promo,
    reductionPromoMontant,
    total,
    totalCentimes: Math.round(total * 100)
  };
}

// Forfait kilométrique inclus dans chaque location et tarif de dépassement
// — seule source de vérité désormais (contrat.html avait ces deux valeurs
// codées en dur en local, jamais partagées avec le reste du site ni avec un
// calcul serveur faisant foi — voir AUDIT-CROISE-SITE-CONTRAT-2026-08-04.md,
// finding P0 correspondant). Valeurs inchangées par cette centralisation :
// 200 km/jour, 0,25 €/km au-delà.
const KM_INCLUS_PAR_JOUR = 200;
const SUPPLEMENT_KM_CENTIMES = 25; // 0,25 € / km, en centimes pour éviter l'arrondi flottant

// Kilomètres inclus dans une location à partir de sa durée facturable (en
// jours — voir joursFacturablesDepuisHeures). Utilisé à la fois par
// l'affichage (tunnel de réservation, contrat.html) et par le recalcul
// serveur faisant foi du dépassement kilométrique.
function kmInclusPourJours(jours) {
  return jours * KM_INCLUS_PAR_JOUR;
}

// Accesseurs (plutôt que d'exposer KM_INCLUS_PAR_JOUR/SUPPLEMENT_KM_CENTIMES
// comme des `const` directement référencées ailleurs) : mêmes conventions
// que getVehiculeParId()/getOptionParId() pour le reste du catalogue.
function getKmInclusParJour() {
  return KM_INCLUS_PAR_JOUR;
}
function getSupplementKmCentimes() {
  return SUPPLEMENT_KM_CENTIMES;
}
function getCglVersion() {
  return CGL_VERSION;
}
function getAgence() {
  return AGENCE;
}

// Calcule le kilométrage parcouru et un éventuel dépassement à partir des
// deux relevés compteur (départ/retour, état des lieux du contrat) et de la
// durée facturable de la location. Ne fait jamais confiance à un
// dépassement/supplément déjà calculé côté client : c'est cette même
// fonction qui doit être appelée côté serveur (voir
// src/api/contract-dossier-agency.js) pour recalculer et faire foi, jamais
// une valeur transmise telle quelle par le navigateur.
//
// Retourne { valid: false, error } si les relevés sont manquants ou
// incohérents (retour inférieur au départ) ; sinon { valid: true, kmInclus,
// kmParcourus, kmDepasses, supplementCentimes, supplement }.
function calculerKilometrage({ kmDepart, kmRetour, jours }) {
  if (!Number.isFinite(kmDepart) || kmDepart < 0) {
    return { valid: false, error: "Kilométrage de départ manquant ou invalide" };
  }
  if (!Number.isFinite(kmRetour) || kmRetour < 0) {
    return { valid: false, error: "Kilométrage de retour manquant ou invalide" };
  }
  if (kmRetour < kmDepart) {
    return { valid: false, error: "Le kilométrage de retour doit être supérieur ou égal à celui du départ" };
  }
  if (!Number.isFinite(jours) || jours <= 0) {
    return { valid: false, error: "Durée de location invalide" };
  }
  const kmInclus = kmInclusPourJours(jours);
  const kmParcourus = kmRetour - kmDepart;
  const kmDepasses = Math.max(kmParcourus - kmInclus, 0);
  const supplementCentimes = Math.round(kmDepasses * SUPPLEMENT_KM_CENTIMES);
  return {
    valid: true,
    kmInclus,
    kmParcourus,
    kmDepasses,
    supplementCentimes,
    supplement: supplementCentimes / 100
  };
}

// Export CommonJS gardé : ne s'exécute que côté Node (fonctions Netlify).
// `module` n'existe pas dans le navigateur, donc ce bloc est ignoré tel quel
// par <script src="js/data.js">, aucun changement de comportement côté site.
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    LIEU_LIVRAISON,
    ADRESSE_PERSONNALISEE,
    formatAdressePersonnalisee,
    parseAdressePersonnalisee,
    libelleAdresseLivraison,
    VILLES_LIVRAISON,
    LIEUX,
    CATEGORIES,
    FAMILLES_VEHICULE,
    TYPES_VOITURE,
    CARBURANTS,
    getFamillesVehicule,
    getTypesVoiture,
    getCarburants,
    VEHICULES,
    HEURE_OUVERTURE,
    HEURE_FERMETURE,
    REDUCTIONS_DUREE,
    CODES_PROMO,
    OPTIONS,
    CGL_VERSION,
    formatEUR,
    formatEURPrecis,
    AGENCE,
    FRANCHISES,
    getFranchises,
    getVehiculeParId,
    dureeEnHeures,
    joursFacturablesDepuisHeures,
    reductionDureeApplicable,
    prixJourMinimum,
    getCodePromo,
    getOptionParId,
    calculerPrixTotal,
    KM_INCLUS_PAR_JOUR,
    SUPPLEMENT_KM_CENTIMES,
    kmInclusPourJours,
    getKmInclusParJour,
    getSupplementKmCentimes,
    getCglVersion,
    getAgence,
    calculerKilometrage
  };
}
