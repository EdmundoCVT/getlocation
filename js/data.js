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

const LIEUX = [
  "Agence Grasse",
  LIEU_LIVRAISON
];

// Zones de livraison proposées à la recherche : uniquement des villes de la
// Côte d'Azur (cohérent avec les pages location-voiture-*.html et le
// areaServed du balisage Schema.org). Remplace la saisie libre d'une adresse
// complète par un choix simple parmi ces villes, plus rapide et sans risque
// de faute de frappe. L'adresse précise de livraison reste à convenir avec
// l'agence (téléphone/WhatsApp) une fois la réservation initiée.
const VILLES_LIVRAISON = ["Nice", "Cannes", "Antibes", "Grasse", "Monaco"];

const CATEGORIES = ["Citadine", "SUV", "Utilitaire"];

// Horaires d'ouverture pour la prise en charge / restitution des véhicules.
const HEURE_OUVERTURE = "08:00";
const HEURE_FERMETURE = "19:00";

// Prix de l'assurance tous risques optionnelle (par jour facturable).
const PRIX_ASSURANCE_JOUR = 8;

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

const VEHICULES = [
  {
    id: "opel-corsa",
    nom: "Opel Corsa Business 1.2T",
    immatriculation: "HJ-967-KQ",
    annee: 2026,
    categorie: "Citadine",
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
    prixJour: 60,
    caution: 300,
    description: "Compacte et économique, parfaite pour vos déplacements pro entre Cannes, Antibes et Grasse."
  },
  {
    id: "peugeot-2008-hybrid",
    nom: "Peugeot 2008 Hybrid",
    immatriculation: "HK-493-ZN",
    annee: 2026,
    categorie: "SUV",
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
    prixJour: 70,
    caution: 500,
    description: "SUV compact hybride, confortable et sobre pour rayonner sur toute la Côte d'Azur."
  },
  {
    id: "peugeot-3008",
    nom: "Peugeot 3008",
    immatriculation: "HK-085-LQ",
    annee: 2026,
    categorie: "SUV",
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
    prixJour: 80,
    caution: 600,
    description: "SUV familial haut de gamme, idéal pour vos trajets entre Nice, Cannes et l'arrière-pays."
  },
  {
    id: "toyota-proace-city",
    nom: "Toyota Proace City",
    immatriculation: "",
    annee: 2026,
    categorie: "Utilitaire",
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
    prixJour: 90,
    caution: 450,
    description: "Ludospace polyvalent au grand volume de chargement, idéal bagages, matériel ou déménagement."
  }
];

function formatEUR(montant) {
  return montant.toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
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
function calculerPrixTotal({ vehiculeId, dateDebut, heureDebut, dateFin, heureFin, assurance }) {
  const vehicule = getVehiculeParId(vehiculeId);
  if (!vehicule) return null;
  const dureeHeures = dureeEnHeures(dateDebut, heureDebut, dateFin, heureFin);
  if (!isFinite(dureeHeures) || dureeHeures <= 0) return null;
  const jours = joursFacturablesDepuisHeures(dureeHeures);
  const sousTotal = vehicule.prixJour * jours;
  const assuranceMontant = assurance ? PRIX_ASSURANCE_JOUR * jours : 0;
  const total = sousTotal + assuranceMontant;
  return { vehicule, jours, sousTotal, assuranceMontant, total, totalCentimes: Math.round(total * 100) };
}

// Export CommonJS gardé : ne s'exécute que côté Node (fonctions Netlify).
// `module` n'existe pas dans le navigateur, donc ce bloc est ignoré tel quel
// par <script src="js/data.js">, aucun changement de comportement côté site.
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    LIEU_LIVRAISON,
    VILLES_LIVRAISON,
    LIEUX,
    CATEGORIES,
    VEHICULES,
    HEURE_OUVERTURE,
    HEURE_FERMETURE,
    PRIX_ASSURANCE_JOUR,
    formatEUR,
    getVehiculeParId,
    dureeEnHeures,
    joursFacturablesDepuisHeures,
    calculerPrixTotal
  };
}
