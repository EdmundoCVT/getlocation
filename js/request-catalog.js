// GETLOCATION — catalogue complémentaire sur demande.
// Ces véhicules ne sont pas présentés comme disponibles instantanément :
// ils sont recherchés/confirmés après la demande du client. Aucun tarif
// n'est affiché ni utilisé pour un paiement en ligne.
(function () {
  "use strict";

  if (typeof VEHICULES === "undefined" || typeof TYPES_VOITURE === "undefined") return;

  if (!TYPES_VOITURE.some(function (type) { return type.id === "cabriolet"; })) {
    TYPES_VOITURE.splice(Math.max(TYPES_VOITURE.length - 1, 0), 0, { id: "cabriolet", label: "Cabriolet" });
  }

  var PHOTO_LABELS = [
    "Vue 3/4 avant gauche",
    "Profil gauche",
    "Face avant",
    "Vue 3/4 avant droit",
    "Profil droit",
    "Vue 3/4 arrière droit",
    "Face arrière",
    "Vue 3/4 arrière gauche",
    "Intérieur"
  ];

  function galleryPhotos(slug) {
    return PHOTO_LABELS.map(function (legende, index) {
      var base = "images/gallery/" + slug + "-" + (index + 1);
      return {
        webp: base + ".webp",
        jpg: base + ".jpg",
        thumbWebp: base + "-700w.webp",
        thumbJpg: base + "-700w.jpg",
        legende: legende
      };
    });
  }

  // `caution` vaut 0 uniquement pour rester compatible avec le moteur de rendu
  // historique (formatEUR attend un nombre). Elle n'est jamais affichée pour
  // ces véhicules : deposit-ux.js retire les caractéristiques/prix des cartes
  // `bookingMode=request`, et aucun paiement en ligne n'est possible.
  var REQUEST_VEHICLES = [
    {
      id: "mercedes-cle-cabriolet-request",
      nom: "Mercedes-Benz CLE Cabriolet",
      categorie: "Cabriolet",
      vehicleFamily: "car",
      type: "cabriolet",
      fuel: null,
      source: "external",
      bookingMode: "request",
      modelGuaranteed: false,
      emoji: "🚘",
      photo: "images/gallery/mercedes-cle-cabriolet-1.jpg",
      photos: galleryPhotos("mercedes-cle-cabriolet"),
      places: null,
      portes: null,
      transmission: null,
      clim: true,
      hybride: false,
      carburant: null,
      prixJour: 0,
      caution: 0,
      specsOnRequest: true,
      description: "Cabriolet premium proposé sur demande. Nous vérifions le modèle et la disponibilité pour vos dates avant confirmation."
    },
    {
      id: "audi-a5-cabriolet-request",
      nom: "Audi A5 Cabriolet",
      categorie: "Cabriolet",
      vehicleFamily: "car",
      type: "cabriolet",
      fuel: null,
      source: "external",
      bookingMode: "request",
      modelGuaranteed: false,
      emoji: "🚘",
      photo: "images/gallery/audi-a5-cabriolet-1.jpg",
      photos: galleryPhotos("audi-a5-cabriolet"),
      places: null,
      portes: null,
      transmission: null,
      clim: true,
      hybride: false,
      carburant: null,
      prixJour: 0,
      caution: 0,
      specsOnRequest: true,
      description: "Cabriolet premium proposé sur demande, selon les disponibilités de notre sélection de véhicules."
    },
    {
      id: "bmw-serie-4-cabriolet-request",
      nom: "BMW Série 4 Cabriolet",
      categorie: "Cabriolet",
      vehicleFamily: "car",
      type: "cabriolet",
      fuel: null,
      source: "external",
      bookingMode: "request",
      modelGuaranteed: false,
      emoji: "🚘",
      photo: "images/gallery/bmw-serie-4-cabriolet-1.jpg",
      photos: galleryPhotos("bmw-serie-4-cabriolet"),
      places: null,
      portes: null,
      transmission: null,
      clim: true,
      hybride: false,
      carburant: null,
      prixJour: 0,
      caution: 0,
      specsOnRequest: true,
      description: "Cabriolet sportif et premium proposé sur demande. Le modèle exact est confirmé après vérification."
    },
    {
      id: "porsche-macan-request",
      nom: "Porsche Macan",
      categorie: "Premium",
      vehicleFamily: "car",
      type: "premium",
      fuel: null,
      source: "external",
      bookingMode: "request",
      modelGuaranteed: false,
      emoji: "🚙",
      photo: "images/gallery/porsche-macan-1.jpg",
      photos: galleryPhotos("porsche-macan"),
      places: null,
      portes: null,
      transmission: null,
      clim: true,
      hybride: false,
      carburant: null,
      prixJour: 0,
      caution: 0,
      specsOnRequest: true,
      description: "SUV premium proposé sur demande. Disponibilité et configuration confirmées pour vos dates avant réservation."
    },
    {
      id: "range-rover-velar-request",
      nom: "Range Rover Velar",
      categorie: "Premium",
      vehicleFamily: "car",
      type: "premium",
      fuel: null,
      source: "external",
      bookingMode: "request",
      modelGuaranteed: false,
      emoji: "🚙",
      photo: "images/gallery/range-rover-velar-1.jpg",
      photos: galleryPhotos("range-rover-velar"),
      places: null,
      portes: null,
      transmission: null,
      clim: true,
      hybride: false,
      carburant: null,
      prixJour: 0,
      caution: 0,
      specsOnRequest: true,
      description: "SUV premium proposé sur demande, idéal pour une demande haut de gamme sur la Côte d’Azur."
    },
    {
      id: "mercedes-gle-request",
      nom: "Mercedes-Benz GLE",
      categorie: "Premium",
      vehicleFamily: "car",
      type: "premium",
      fuel: null,
      source: "external",
      bookingMode: "request",
      modelGuaranteed: false,
      emoji: "🚙",
      photo: "images/gallery/mercedes-gle-1.jpg",
      photos: galleryPhotos("mercedes-gle"),
      places: null,
      portes: null,
      transmission: null,
      clim: true,
      hybride: false,
      carburant: null,
      prixJour: 0,
      caution: 0,
      specsOnRequest: true,
      description: "SUV premium proposé sur demande. GET LOCATION vérifie la disponibilité avant de confirmer la réservation."
    }
  ];

  REQUEST_VEHICLES.forEach(function (vehicle) {
    if (!VEHICULES.some(function (existing) { return existing.id === vehicle.id; })) {
      VEHICULES.push(vehicle);
    }
  });
})();
