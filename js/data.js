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
