// Données de démonstration — GETLOCATION06 (TLST SAS)
// Location de véhicules dans les Alpes-Maritimes (06) / Côte d'Azur.
// À remplacer par de vraies données (base de données / CMS) en production.

const LIEUX = [
  "Agence Grasse (siège)",
  "Agence Cannes",
  "Agence Antibes",
  "Aéroport Nice Côte d'Azur"
];

const CATEGORIES = ["Citadine", "SUV", "Utilitaire"];

const VEHICULES = [
  {
    id: "opel-corsa",
    nom: "Opel Corsa Business 1.2T",
    annee: 2026,
    categorie: "Citadine",
    emoji: "🚗",
    photo: "images/opel-corsa.jpg",
    places: 5,
    portes: 5,
    transmission: "Manuelle",
    clim: true,
    hybride: false,
    prixJour: 35,
    caution: 300,
    description: "Compacte et économique, parfaite pour vos déplacements pro entre Cannes, Antibes et Grasse."
  },
  {
    id: "peugeot-2008-hybrid",
    nom: "Peugeot 2008 Hybrid",
    annee: 2026,
    categorie: "SUV",
    emoji: "🚙",
    photo: "images/peugeot-2008-hybrid.jpg",
    places: 5,
    portes: 5,
    transmission: "Automatique",
    clim: true,
    hybride: true,
    prixJour: 50,
    caution: 500,
    description: "SUV compact hybride, confortable et sobre pour rayonner sur toute la Côte d'Azur."
  },
  {
    id: "peugeot-3008",
    nom: "Peugeot 3008",
    annee: 2026,
    categorie: "SUV",
    emoji: "🚙",
    photo: "images/peugeot-3008.jpg",
    places: 5,
    portes: 5,
    transmission: "Automatique",
    clim: true,
    hybride: true,
    prixJour: 65,
    caution: 600,
    description: "SUV familial haut de gamme, idéal pour vos trajets entre Nice, Cannes et l'arrière-pays."
  },
  {
    id: "toyota-proace-city",
    nom: "Toyota Proace City",
    annee: 2026,
    categorie: "Utilitaire",
    emoji: "🚐",
    photo: "images/toyota-proace-city.jpg",
    places: 5,
    portes: 5,
    transmission: "Manuelle",
    clim: true,
    hybride: false,
    prixJour: 45,
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
