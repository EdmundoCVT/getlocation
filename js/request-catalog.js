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

  function svgCar(label, kind) {
    var cabrio = kind === "cabriolet";
    var roof = cabrio
      ? '<path d="M250 235 C330 170 510 170 595 235" fill="none" stroke="#bfc4cc" stroke-width="18" stroke-linecap="round"/>'
      : '<path d="M245 235 C320 145 540 145 625 235 L690 305 L210 305 Z" fill="#e9ebef" stroke="#c7cbd2" stroke-width="7"/>';
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 620">' +
      '<rect width="900" height="620" fill="#f7f7f8"/>' + roof +
      '<path d="M125 340 C160 300 220 282 300 276 L650 276 C725 280 775 310 805 360 L790 418 C785 438 765 452 742 452 L165 452 C140 452 120 436 116 414 Z" fill="#202124"/>' +
      '<path d="M205 340 L302 295 L620 295 L710 340 Z" fill="#34373c"/>' +
      '<circle cx="260" cy="442" r="58" fill="#17181a"/><circle cx="260" cy="442" r="31" fill="#d7d9dd"/>' +
      '<circle cx="670" cy="442" r="58" fill="#17181a"/><circle cx="670" cy="442" r="31" fill="#d7d9dd"/>' +
      '<text x="450" y="545" text-anchor="middle" font-family="Arial,sans-serif" font-size="30" font-weight="700" fill="#26272a">' + label + '</text>' +
      '<text x="450" y="580" text-anchor="middle" font-family="Arial,sans-serif" font-size="19" fill="#777">Visuel indicatif · modèle selon disponibilité</text>' +
      '</svg>';
    return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
  }

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
      photo: svgCar("Mercedes-Benz CLE Cabriolet", "cabriolet"),
      photos: [],
      places: null,
      portes: null,
      transmission: null,
      clim: true,
      hybride: false,
      carburant: null,
      prixJour: 0,
      caution: null,
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
      photo: svgCar("Audi A5 Cabriolet", "cabriolet"),
      photos: [],
      places: null,
      portes: null,
      transmission: null,
      clim: true,
      hybride: false,
      carburant: null,
      prixJour: 0,
      caution: null,
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
      photo: svgCar("BMW Série 4 Cabriolet", "cabriolet"),
      photos: [],
      places: null,
      portes: null,
      transmission: null,
      clim: true,
      hybride: false,
      carburant: null,
      prixJour: 0,
      caution: null,
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
      photo: svgCar("Porsche Macan", "premium"),
      photos: [],
      places: null,
      portes: null,
      transmission: null,
      clim: true,
      hybride: false,
      carburant: null,
      prixJour: 0,
      caution: null,
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
      photo: svgCar("Range Rover Velar", "premium"),
      photos: [],
      places: null,
      portes: null,
      transmission: null,
      clim: true,
      hybride: false,
      carburant: null,
      prixJour: 0,
      caution: null,
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
      photo: svgCar("Mercedes-Benz GLE", "premium"),
      photos: [],
      places: null,
      portes: null,
      transmission: null,
      clim: true,
      hybride: false,
      carburant: null,
      prixJour: 0,
      caution: null,
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
