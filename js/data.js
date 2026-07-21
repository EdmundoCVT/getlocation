// Données de démonstration — GETLOCATION
// Location de véhicules dans les Alpes-Maritimes (06) / Côte d'Azur.
// À remplacer par de vraies données (base de données / CMS) en production.

const LIEU_LIVRAISON = "Livraison à l'adresse de votre choix";

const LIEUX = [
  "Agence Grasse",
  LIEU_LIVRAISON
];

const CATEGORIES = ["Citadine", "SUV", "Utilitaire"];

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
      { webp: "images/gallery/toyota-proace-city-1.webp", jpg: "images/gallery/toyota-proace-city-1.jpg", thumbWebp: "images/gallery/toyota-proace-city-1-700w.webp", thumbJpg: "images/gallery/toyota-proace-city-1-700w.jpg", legende: "Vue 3/4 avant" }
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
