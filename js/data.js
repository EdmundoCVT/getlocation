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
// Prix d'exemple (placeholders) à ajuster ici.
const OPTIONS = [
  { id: "siege-auto", nom: "Siège auto bébé", description: "Siège auto homologué pour bébé (0-13 kg)", type: "jour", prix: 5 },
  { id: "rehausseur", nom: "Réhausseur enfant", description: "Réhausseur homologué pour enfant (15-36 kg)", type: "jour", prix: 3 },
  { id: "assurance-passagers", nom: "Assurance passagers / accident", description: "Couvre les dommages corporels des passagers en cas d'accident", type: "jour", prix: 6 },
  { id: "second-conducteur", nom: "Deuxième conducteur", description: "Ajoute un second conducteur autorisé sur le contrat", type: "jour", prix: 10 },
  { id: "km-supplementaire", nom: "Forfait kilométrage supplémentaire", description: "300 km supplémentaires inclus sur la durée de la location", type: "forfait", prix: 30 },
  { id: "livraison-adresse", nom: "Livraison à l'adresse de votre choix", description: "Le véhicule vous est livré à l'adresse indiquée (Nice, Cannes, Antibes, Grasse, Monaco)", type: "forfait", prix: 20 }
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
    prixJour: 99,
    caution: 800,
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
    REDUCTIONS_DUREE,
    CODES_PROMO,
    OPTIONS,
    CGL_VERSION,
    formatEUR,
    getVehiculeParId,
    dureeEnHeures,
    joursFacturablesDepuisHeures,
    reductionDureeApplicable,
    prixJourMinimum,
    getCodePromo,
    getOptionParId,
    calculerPrixTotal
  };
}
