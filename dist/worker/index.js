var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};

// ../js/data.js
var require_data = __commonJS({
  "../js/data.js"(exports, module) {
    init_functionsRoutes_0_5221053579021873();
    var LIEU_LIVRAISON = "Livraison \xE0 l'adresse de votre choix";
    var LIEUX = [
      "Agence Grasse",
      LIEU_LIVRAISON
    ];
    var VILLES_LIVRAISON = ["Nice", "Cannes", "Antibes", "Grasse", "Monaco"];
    var CATEGORIES = ["Citadine", "SUV", "Utilitaire"];
    var HEURE_OUVERTURE = "00:00";
    var HEURE_FERMETURE = "23:30";
    var CGL_VERSION = "2026-07-22";
    var REDUCTIONS_DUREE = [
      { seuilJours: 5, montantParJour: 10, libelle: "5 jours ou plus" }
    ];
    function reductionDureeApplicable(jours) {
      return REDUCTIONS_DUREE.find((r) => jours >= r.seuilJours) || null;
    }
    __name(reductionDureeApplicable, "reductionDureeApplicable");
    function prixJourMinimum(vehicule) {
      const meilleureRemiseParJour = REDUCTIONS_DUREE.reduce((max, r) => Math.max(max, r.montantParJour), 0);
      return vehicule.prixJour - meilleureRemiseParJour;
    }
    __name(prixJourMinimum, "prixJourMinimum");
    var CODES_PROMO = {
      GETLOC95: { pourcentage: 95, description: "95 % de r\xE9duction" },
      GETLOC90: { pourcentage: 90, description: "90 % de r\xE9duction" },
      GETLOC85: { pourcentage: 85, description: "85 % de r\xE9duction" },
      GETLOC80: { pourcentage: 80, description: "80 % de r\xE9duction" },
      GETLOC75: { pourcentage: 75, description: "75 % de r\xE9duction" },
      GETLOC70: { pourcentage: 70, description: "70 % de r\xE9duction" },
      GETLOC65: { pourcentage: 65, description: "65 % de r\xE9duction" },
      GETLOC60: { pourcentage: 60, description: "60 % de r\xE9duction" },
      GETLOC55: { pourcentage: 55, description: "55 % de r\xE9duction" },
      GETLOC50: { pourcentage: 50, description: "50 % de r\xE9duction" },
      GETLOC45: { pourcentage: 45, description: "45 % de r\xE9duction" },
      GETLOC40: { pourcentage: 40, description: "40 % de r\xE9duction" },
      GETLOC35: { pourcentage: 35, description: "35 % de r\xE9duction" },
      GETLOC30: { pourcentage: 30, description: "30 % de r\xE9duction" },
      GETLOC25: { pourcentage: 25, description: "25 % de r\xE9duction" },
      GETLOC20: { pourcentage: 20, description: "20 % de r\xE9duction" },
      GETLOC15: { pourcentage: 15, description: "15 % de r\xE9duction" },
      GETLOC10: { pourcentage: 10, description: "10 % de r\xE9duction" },
      GETLOC5: { pourcentage: 5, description: "5 % de r\xE9duction" }
    };
    function getCodePromo(code) {
      if (!code) return null;
      const normalise = String(code).trim().toUpperCase();
      if (!normalise || !CODES_PROMO[normalise]) return null;
      const promo = CODES_PROMO[normalise];
      return { code: normalise, pourcentage: promo.pourcentage, description: promo.description };
    }
    __name(getCodePromo, "getCodePromo");
    var OPTIONS = [
      { id: "siege-auto", nom: "Si\xE8ge auto b\xE9b\xE9", description: "Si\xE8ge auto homologu\xE9 pour b\xE9b\xE9 (0-13 kg)", type: "jour", prix: 5 },
      { id: "rehausseur", nom: "R\xE9hausseur enfant", description: "R\xE9hausseur homologu\xE9 pour enfant (15-36 kg)", type: "jour", prix: 3 },
      { id: "assurance-passagers", nom: "Assurance passagers / accident", description: "Couvre les dommages corporels des passagers en cas d'accident", type: "jour", prix: 6 },
      { id: "second-conducteur", nom: "Deuxi\xE8me conducteur", description: "Ajoute un second conducteur autoris\xE9 sur le contrat", type: "jour", prix: 10 },
      { id: "km-supplementaire", nom: "Forfait kilom\xE9trage suppl\xE9mentaire", description: "300 km suppl\xE9mentaires inclus sur la dur\xE9e de la location", type: "forfait", prix: 30 },
      { id: "livraison-adresse", nom: "Livraison \xE0 l'adresse de votre choix", description: "Le v\xE9hicule vous est livr\xE9 \xE0 l'adresse indiqu\xE9e (Nice, Cannes, Antibes, Grasse, Monaco)", type: "forfait", prix: 20 }
    ];
    function getOptionParId(id) {
      return OPTIONS.find((o) => o.id === id);
    }
    __name(getOptionParId, "getOptionParId");
    var VEHICULES = [
      {
        id: "opel-corsa",
        nom: "Opel Corsa Business 1.2T",
        immatriculation: "HJ-967-KQ",
        annee: 2026,
        categorie: "Citadine",
        emoji: "\u{1F697}",
        photo: "images/opel-corsa.jpg",
        photoCutout: "images/opel-corsa-cutout.webp",
        photos: [
          { webp: "images/gallery/opel-corsa-1.webp", jpg: "images/gallery/opel-corsa-1.jpg", thumbWebp: "images/gallery/opel-corsa-1-700w.webp", thumbJpg: "images/gallery/opel-corsa-1-700w.jpg", legende: "Vue 3/4 avant" },
          { webp: "images/gallery/opel-corsa-2.webp", jpg: "images/gallery/opel-corsa-2.jpg", thumbWebp: "images/gallery/opel-corsa-2-700w.webp", thumbJpg: "images/gallery/opel-corsa-2-700w.jpg", legende: "Profil" },
          { webp: "images/gallery/opel-corsa-3.webp", jpg: "images/gallery/opel-corsa-3.jpg", thumbWebp: "images/gallery/opel-corsa-3-700w.webp", thumbJpg: "images/gallery/opel-corsa-3-700w.jpg", legende: "Arri\xE8re" },
          { webp: "images/gallery/opel-corsa-4.webp", jpg: "images/gallery/opel-corsa-4.jpg", thumbWebp: "images/gallery/opel-corsa-4-700w.webp", thumbJpg: "images/gallery/opel-corsa-4-700w.jpg", legende: "Tableau de bord" },
          { webp: "images/gallery/opel-corsa-5.webp", jpg: "images/gallery/opel-corsa-5.jpg", thumbWebp: "images/gallery/opel-corsa-5-700w.webp", thumbJpg: "images/gallery/opel-corsa-5-700w.jpg", legende: "Si\xE8ges avant" },
          { webp: "images/gallery/opel-corsa-6.webp", jpg: "images/gallery/opel-corsa-6.jpg", thumbWebp: "images/gallery/opel-corsa-6-700w.webp", thumbJpg: "images/gallery/opel-corsa-6-700w.jpg", legende: "Coffre" }
        ],
        places: 5,
        portes: 5,
        transmission: "Manuelle",
        clim: true,
        hybride: false,
        prixJour: 59,
        caution: 500,
        description: "Compacte et \xE9conomique, parfaite pour vos d\xE9placements pro entre Cannes, Antibes et Grasse."
      },
      {
        id: "peugeot-2008-hybrid",
        nom: "Peugeot 2008 Hybrid",
        immatriculation: "HK-493-ZN",
        annee: 2026,
        categorie: "SUV",
        emoji: "\u{1F699}",
        photo: "images/peugeot-2008-hybrid.jpg",
        photoCutout: "images/peugeot-2008-hybrid-cutout.webp",
        photos: [
          { webp: "images/gallery/peugeot-2008-hybrid-1.webp", jpg: "images/gallery/peugeot-2008-hybrid-1.jpg", thumbWebp: "images/gallery/peugeot-2008-hybrid-1-700w.webp", thumbJpg: "images/gallery/peugeot-2008-hybrid-1-700w.jpg", legende: "Vue 3/4 avant" },
          { webp: "images/gallery/peugeot-2008-hybrid-2.webp", jpg: "images/gallery/peugeot-2008-hybrid-2.jpg", thumbWebp: "images/gallery/peugeot-2008-hybrid-2-700w.webp", thumbJpg: "images/gallery/peugeot-2008-hybrid-2-700w.jpg", legende: "Profil" },
          { webp: "images/gallery/peugeot-2008-hybrid-3.webp", jpg: "images/gallery/peugeot-2008-hybrid-3.jpg", thumbWebp: "images/gallery/peugeot-2008-hybrid-3-700w.webp", thumbJpg: "images/gallery/peugeot-2008-hybrid-3-700w.jpg", legende: "Arri\xE8re 3/4" },
          { webp: "images/gallery/peugeot-2008-hybrid-4.webp", jpg: "images/gallery/peugeot-2008-hybrid-4.jpg", thumbWebp: "images/gallery/peugeot-2008-hybrid-4-700w.webp", thumbJpg: "images/gallery/peugeot-2008-hybrid-4-700w.jpg", legende: "Tableau de bord" },
          { webp: "images/gallery/peugeot-2008-hybrid-5.webp", jpg: "images/gallery/peugeot-2008-hybrid-5.jpg", thumbWebp: "images/gallery/peugeot-2008-hybrid-5-700w.webp", thumbJpg: "images/gallery/peugeot-2008-hybrid-5-700w.jpg", legende: "Si\xE8ges arri\xE8re" },
          { webp: "images/gallery/peugeot-2008-hybrid-6.webp", jpg: "images/gallery/peugeot-2008-hybrid-6.jpg", thumbWebp: "images/gallery/peugeot-2008-hybrid-6-700w.webp", thumbJpg: "images/gallery/peugeot-2008-hybrid-6-700w.jpg", legende: "Coffre" }
        ],
        places: 5,
        portes: 5,
        transmission: "Automatique",
        clim: true,
        hybride: true,
        prixJour: 69,
        caution: 500,
        description: "SUV compact hybride, confortable et sobre pour rayonner sur toute la C\xF4te d'Azur."
      },
      {
        id: "peugeot-3008",
        nom: "Peugeot 3008",
        immatriculation: "HK-085-LQ",
        annee: 2026,
        categorie: "SUV",
        emoji: "\u{1F699}",
        photo: "images/peugeot-3008.jpg",
        photoCutout: "images/peugeot-3008-cutout-veh.webp",
        photos: [
          { webp: "images/gallery/peugeot-3008-1.webp", jpg: "images/gallery/peugeot-3008-1.jpg", thumbWebp: "images/gallery/peugeot-3008-1-700w.webp", thumbJpg: "images/gallery/peugeot-3008-1-700w.jpg", legende: "Vue 3/4 avant" },
          { webp: "images/gallery/peugeot-3008-2.webp", jpg: "images/gallery/peugeot-3008-2.jpg", thumbWebp: "images/gallery/peugeot-3008-2-700w.webp", thumbJpg: "images/gallery/peugeot-3008-2-700w.jpg", legende: "Profil" },
          { webp: "images/gallery/peugeot-3008-3.webp", jpg: "images/gallery/peugeot-3008-3.jpg", thumbWebp: "images/gallery/peugeot-3008-3-700w.webp", thumbJpg: "images/gallery/peugeot-3008-3-700w.jpg", legende: "Arri\xE8re 3/4" },
          { webp: "images/gallery/peugeot-3008-4.webp", jpg: "images/gallery/peugeot-3008-4.jpg", thumbWebp: "images/gallery/peugeot-3008-4-700w.webp", thumbJpg: "images/gallery/peugeot-3008-4-700w.jpg", legende: "Tableau de bord" },
          { webp: "images/gallery/peugeot-3008-5.webp", jpg: "images/gallery/peugeot-3008-5.jpg", thumbWebp: "images/gallery/peugeot-3008-5-700w.webp", thumbJpg: "images/gallery/peugeot-3008-5-700w.jpg", legende: "Si\xE8ges" },
          { webp: "images/gallery/peugeot-3008-6.webp", jpg: "images/gallery/peugeot-3008-6.jpg", thumbWebp: "images/gallery/peugeot-3008-6-700w.webp", thumbJpg: "images/gallery/peugeot-3008-6-700w.jpg", legende: "Coffre" }
        ],
        places: 5,
        portes: 5,
        transmission: "Automatique",
        clim: true,
        hybride: true,
        prixJour: 79,
        caution: 600,
        description: "SUV familial haut de gamme, id\xE9al pour vos trajets entre Nice, Cannes et l'arri\xE8re-pays."
      },
      {
        id: "toyota-proace-city",
        nom: "Toyota Proace City",
        immatriculation: "HK-619-XA",
        annee: 2026,
        categorie: "Utilitaire",
        emoji: "\u{1F690}",
        photo: "images/toyota-proace-city.jpg",
        photos: [
          { webp: "images/gallery/toyota-proace-city-1.webp", jpg: "images/gallery/toyota-proace-city-1.jpg", thumbWebp: "images/gallery/toyota-proace-city-1-700w.webp", thumbJpg: "images/gallery/toyota-proace-city-1-700w.jpg", legende: "Vue 3/4 avant" },
          { webp: "images/gallery/toyota-proace-city-2.webp", jpg: "images/gallery/toyota-proace-city-2.jpg", thumbWebp: "images/gallery/toyota-proace-city-2-700w.webp", thumbJpg: "images/gallery/toyota-proace-city-2-700w.jpg", legende: "Face avant" },
          { webp: "images/gallery/toyota-proace-city-3.webp", jpg: "images/gallery/toyota-proace-city-3.jpg", thumbWebp: "images/gallery/toyota-proace-city-3-700w.webp", thumbJpg: "images/gallery/toyota-proace-city-3-700w.jpg", legende: "Profil" },
          { webp: "images/gallery/toyota-proace-city-4.webp", jpg: "images/gallery/toyota-proace-city-4.jpg", thumbWebp: "images/gallery/toyota-proace-city-4-700w.webp", thumbJpg: "images/gallery/toyota-proace-city-4-700w.jpg", legende: "Arri\xE8re" },
          { webp: "images/gallery/toyota-proace-city-5.webp", jpg: "images/gallery/toyota-proace-city-5.jpg", thumbWebp: "images/gallery/toyota-proace-city-5-700w.webp", thumbJpg: "images/gallery/toyota-proace-city-5-700w.jpg", legende: "Int\xE9rieur" },
          { webp: "images/gallery/toyota-proace-city-6.webp", jpg: "images/gallery/toyota-proace-city-6.jpg", thumbWebp: "images/gallery/toyota-proace-city-6-700w.webp", thumbJpg: "images/gallery/toyota-proace-city-6-700w.jpg", legende: "Espace de chargement" }
        ],
        places: 5,
        portes: 5,
        transmission: "Manuelle",
        clim: true,
        hybride: false,
        prixJour: 99,
        caution: 800,
        description: "Ludospace polyvalent au grand volume de chargement, id\xE9al bagages, mat\xE9riel ou d\xE9m\xE9nagement."
      }
    ];
    function formatEUR(montant) {
      return montant.toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
    }
    __name(formatEUR, "formatEUR");
    function getVehiculeParId2(id) {
      return VEHICULES.find((v) => v.id === id);
    }
    __name(getVehiculeParId2, "getVehiculeParId");
    function dureeEnHeures(dateDebut, heureDebut, dateFin, heureFin) {
      const debut = /* @__PURE__ */ new Date(`${dateDebut}T${heureDebut || "00:00"}:00`);
      const fin = /* @__PURE__ */ new Date(`${dateFin}T${heureFin || "00:00"}:00`);
      return (fin - debut) / (1e3 * 60 * 60);
    }
    __name(dureeEnHeures, "dureeEnHeures");
    function joursFacturablesDepuisHeures(dureeHeures) {
      if (!isFinite(dureeHeures) || dureeHeures <= 0) return 1;
      return Math.max(Math.ceil(dureeHeures / 24), 1);
    }
    __name(joursFacturablesDepuisHeures, "joursFacturablesDepuisHeures");
    function calculerPrixTotal2({ vehiculeId, dateDebut, heureDebut, dateFin, heureFin, options, codePromo }) {
      const vehicule = getVehiculeParId2(vehiculeId);
      if (!vehicule) return null;
      const dureeHeures = dureeEnHeures(dateDebut, heureDebut, dateFin, heureFin);
      if (!isFinite(dureeHeures) || dureeHeures <= 0) return null;
      const jours = joursFacturablesDepuisHeures(dureeHeures);
      const sousTotalBrut = vehicule.prixJour * jours;
      const palierReduction = reductionDureeApplicable(jours);
      const reductionDureeMontant = palierReduction ? palierReduction.montantParJour * jours : 0;
      const sousTotal = sousTotalBrut - reductionDureeMontant;
      const idsOptions = Array.isArray(options) ? [...new Set(options)] : [];
      const optionsSelectionnees = idsOptions.map((id) => getOptionParId(id)).filter(Boolean).map((opt) => ({
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
    __name(calculerPrixTotal2, "calculerPrixTotal");
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
        getVehiculeParId: getVehiculeParId2,
        dureeEnHeures,
        joursFacturablesDepuisHeures,
        reductionDureeApplicable,
        prixJourMinimum,
        getCodePromo,
        getOptionParId,
        calculerPrixTotal: calculerPrixTotal2
      };
    }
  }
});

// ../lib/server/validate-reservation-input.js
var require_validate_reservation_input = __commonJS({
  "../lib/server/validate-reservation-input.js"(exports, module) {
    init_functionsRoutes_0_5221053579021873();
    var { getVehiculeParId: getVehiculeParId2, LIEUX, LIEU_LIVRAISON, VILLES_LIVRAISON, CGL_VERSION, OPTIONS } = require_data();
    var MAX_LEN = {
      nom: 100,
      prenom: 100,
      email: 254,
      telephone: 30,
      codePromo: 40
    };
    var OPTION_IDS = new Set(OPTIONS.map((o) => o.id));
    function isNonEmptyString(v, max, min = 1) {
      return typeof v === "string" && v.trim().length >= min && v.length <= max;
    }
    __name(isNonEmptyString, "isNonEmptyString");
    function isValidDate(v) {
      return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN((/* @__PURE__ */ new Date(`${v}T00:00:00`)).getTime());
    }
    __name(isValidDate, "isValidDate");
    function isValidHeure(v) {
      return typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
    }
    __name(isValidHeure, "isValidHeure");
    function isValidEmail(v) {
      return typeof v === "string" && v.length <= MAX_LEN.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
    }
    __name(isValidEmail, "isValidEmail");
    function calculerAge(dateNaissanceISO) {
      const naissance = /* @__PURE__ */ new Date(`${dateNaissanceISO}T00:00:00Z`);
      if (!isFinite(naissance.getTime())) return null;
      const aujourdHui = /* @__PURE__ */ new Date();
      let age = aujourdHui.getUTCFullYear() - naissance.getUTCFullYear();
      const moisDiff = aujourdHui.getUTCMonth() - naissance.getUTCMonth();
      if (moisDiff < 0 || moisDiff === 0 && aujourdHui.getUTCDate() < naissance.getUTCDate()) age--;
      return age;
    }
    __name(calculerAge, "calculerAge");
    var PAST_DATE_TOLERANCE_MS = 5 * 60 * 1e3;
    function validateReservationInput2(payload) {
      const errors = [];
      if (!payload || typeof payload !== "object") {
        return { valid: false, errors: ["Requ\xEAte invalide"], vehicule: null };
      }
      const {
        vehiculeId,
        dateDebut,
        heureDebut,
        dateFin,
        heureFin,
        lieuPrise,
        lieuRetour,
        adressePrise,
        adresseRetour,
        options,
        codePromo,
        conducteur,
        idempotencyKey,
        cglAccepted,
        cglVersion
      } = payload;
      const vehicule = typeof vehiculeId === "string" ? getVehiculeParId2(vehiculeId) : null;
      if (!vehicule) errors.push("V\xE9hicule inconnu");
      if (!isValidDate(dateDebut)) errors.push("Date de d\xE9but invalide");
      if (!isValidDate(dateFin)) errors.push("Date de fin invalide");
      if (!isValidHeure(heureDebut)) errors.push("Heure de d\xE9but invalide");
      if (!isValidHeure(heureFin)) errors.push("Heure de fin invalide");
      if (isValidDate(dateDebut) && isValidHeure(heureDebut)) {
        const debut = /* @__PURE__ */ new Date(`${dateDebut}T${heureDebut}:00`);
        if (debut.getTime() < Date.now() - PAST_DATE_TOLERANCE_MS) {
          errors.push("La date de d\xE9but ne peut pas \xEAtre dans le pass\xE9");
        }
      }
      if (isValidDate(dateDebut) && isValidHeure(heureDebut) && isValidDate(dateFin) && isValidHeure(heureFin)) {
        const debut = /* @__PURE__ */ new Date(`${dateDebut}T${heureDebut}:00`);
        const fin = /* @__PURE__ */ new Date(`${dateFin}T${heureFin}:00`);
        if (fin.getTime() <= debut.getTime()) errors.push("La date de fin doit \xEAtre post\xE9rieure \xE0 la date de d\xE9but");
      }
      if (lieuPrise !== void 0 && lieuPrise !== null && !LIEUX.includes(lieuPrise)) {
        errors.push("Lieu de prise en charge invalide");
      }
      if (lieuRetour !== void 0 && lieuRetour !== null && !LIEUX.includes(lieuRetour)) {
        errors.push("Lieu de restitution invalide");
      }
      if (adressePrise !== void 0 && adressePrise !== null && adressePrise !== "") {
        if (lieuPrise !== LIEU_LIVRAISON || !VILLES_LIVRAISON.includes(adressePrise)) {
          errors.push("Ville de livraison (prise en charge) invalide");
        }
      }
      if (adresseRetour !== void 0 && adresseRetour !== null && adresseRetour !== "") {
        if (lieuRetour !== LIEU_LIVRAISON || !VILLES_LIVRAISON.includes(adresseRetour)) {
          errors.push("Ville de livraison (restitution) invalide");
        }
      }
      let optionsNormalisees = [];
      if (options !== void 0 && options !== null) {
        if (!Array.isArray(options) || options.length > 20) {
          errors.push("Options invalides");
        } else {
          const inconnues = options.filter((id) => typeof id !== "string" || !OPTION_IDS.has(id));
          if (inconnues.length > 0) {
            errors.push("Option inconnue");
          } else {
            optionsNormalisees = [...new Set(options)];
          }
        }
      }
      let codePromoNormalise = null;
      if (codePromo !== void 0 && codePromo !== null && codePromo !== "") {
        if (!isNonEmptyString(codePromo, MAX_LEN.codePromo)) {
          errors.push("Code promo invalide");
        } else {
          codePromoNormalise = codePromo;
        }
      }
      if (!conducteur || typeof conducteur !== "object") {
        errors.push("Informations conducteur manquantes");
      } else {
        if (!isNonEmptyString(conducteur.nom, MAX_LEN.nom, 2)) errors.push("Nom invalide");
        if (!isNonEmptyString(conducteur.prenom, MAX_LEN.prenom, 2)) errors.push("Pr\xE9nom invalide");
        if (!isValidEmail(conducteur.email)) errors.push("E-mail invalide");
        const telephoneDigits = typeof conducteur.telephone === "string" ? conducteur.telephone.replace(/\D/g, "") : "";
        if (!isNonEmptyString(conducteur.telephone, MAX_LEN.telephone) || telephoneDigits.length < 8) {
          errors.push("T\xE9l\xE9phone invalide");
        }
        if (!isValidDate(conducteur.naissance)) {
          errors.push("Date de naissance invalide");
        } else {
          const age = calculerAge(conducteur.naissance);
          if (age === null || age < 21 || age > 99) errors.push("Le conducteur doit avoir entre 21 et 99 ans");
        }
      }
      if (idempotencyKey !== void 0 && !(typeof idempotencyKey === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(idempotencyKey))) {
        errors.push("Cl\xE9 d'idempotence invalide");
      }
      if (cglAccepted !== true) {
        errors.push("Vous devez accepter les conditions g\xE9n\xE9rales de location et la politique de confidentialit\xE9");
      }
      if (cglAccepted === true && cglVersion !== CGL_VERSION) {
        errors.push("La version des conditions g\xE9n\xE9rales a \xE9t\xE9 mise \xE0 jour, veuillez recharger la page et r\xE9essayer");
      }
      return { valid: errors.length === 0, errors, vehicule, options: optionsNormalisees, codePromo: codePromoNormalise };
    }
    __name(validateReservationInput2, "validateReservationInput");
    module.exports = { validateReservationInput: validateReservationInput2 };
  }
});

// ../lib/server/reservation-store-kv.js
var require_reservation_store_kv = __commonJS({
  "../lib/server/reservation-store-kv.js"(exports, module) {
    init_functionsRoutes_0_5221053579021873();
    var RESERVATION_TTL_SECONDS = 60 * 60 * 24 * 7;
    var RESERVATION_HOLD_MS = 1e3 * 60 * 30;
    function generateReservationId() {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      return `res_${hex}`;
    }
    __name(generateReservationId, "generateReservationId");
    function periodsOverlap(aStart, aEnd, bStart, bEnd) {
      return aStart < bEnd && bStart < aEnd;
    }
    __name(periodsOverlap, "periodsOverlap");
    function createReservationStore4(kv) {
      if (!kv) {
        throw new Error(
          "[reservation-store-kv] Binding KV manquant (env.RESERVATIONS_KV). Refus de continuer silencieusement \u2014 voir incident Netlify Blobs du 12/08/2026."
        );
      }
      async function createReservation(data) {
        const id = generateReservationId();
        const now = (/* @__PURE__ */ new Date()).toISOString();
        const record = {
          ...data,
          id,
          status: "pending_payment",
          createdAt: now,
          updatedAt: now,
          expiresAt: new Date(Date.now() + RESERVATION_TTL_SECONDS * 1e3).toISOString(),
          paymentId: data.paymentId || null
        };
        await kv.put(id, JSON.stringify(record), { expirationTtl: RESERVATION_TTL_SECONDS });
        return record;
      }
      __name(createReservation, "createReservation");
      async function getReservation(id) {
        if (!id || typeof id !== "string") return null;
        const record = await kv.get(id, { type: "json" });
        return record || null;
      }
      __name(getReservation, "getReservation");
      async function updateReservationStatus(id, status, extra = {}) {
        const record = await getReservation(id);
        if (!record) return null;
        const updated = {
          ...record,
          ...extra,
          id: record.id,
          createdAt: record.createdAt,
          status,
          updatedAt: (/* @__PURE__ */ new Date()).toISOString()
        };
        await kv.put(id, JSON.stringify(updated), { expirationTtl: RESERVATION_TTL_SECONDS });
        if (updated.paymentId) {
          await kv.put(`pay_${updated.paymentId}`, id, { expirationTtl: RESERVATION_TTL_SECONDS });
        }
        return updated;
      }
      __name(updateReservationStatus, "updateReservationStatus");
      async function findReservationByPaymentId(paymentId) {
        if (!paymentId) return null;
        const id = await kv.get(`pay_${paymentId}`);
        if (!id) return null;
        return getReservation(id);
      }
      __name(findReservationByPaymentId, "findReservationByPaymentId");
      async function listActiveReservationsForVehicule(vehiculeId) {
        const records = [];
        let cursor;
        do {
          const page = await kv.list({ cursor });
          for (const key of page.keys) {
            if (key.name.startsWith("pay_")) continue;
            const record = await kv.get(key.name, { type: "json" });
            if (record) records.push(record);
          }
          cursor = page.list_complete ? void 0 : page.cursor;
        } while (cursor);
        const now = Date.now();
        return records.filter((r) => {
          if (r.vehiculeId !== vehiculeId) return false;
          if (r.status === "paid") return true;
          if (r.status === "pending_payment") {
            const createdAt = new Date(r.createdAt).getTime();
            return isFinite(createdAt) && now - createdAt < RESERVATION_HOLD_MS;
          }
          return false;
        });
      }
      __name(listActiveReservationsForVehicule, "listActiveReservationsForVehicule");
      async function hasOverlappingReservation(vehiculeId, periodeDebutISO, periodeFinISO, excludeReservationId) {
        const start = new Date(periodeDebutISO).getTime();
        const end = new Date(periodeFinISO).getTime();
        if (!isFinite(start) || !isFinite(end) || start >= end) return true;
        const reservations = await listActiveReservationsForVehicule(vehiculeId);
        return reservations.some((r) => {
          if (excludeReservationId && r.id === excludeReservationId) return false;
          if (!r.periodeDebut || !r.periodeFin) return false;
          const rStart = new Date(r.periodeDebut).getTime();
          const rEnd = new Date(r.periodeFin).getTime();
          if (!isFinite(rStart) || !isFinite(rEnd)) return false;
          return periodsOverlap(start, end, rStart, rEnd);
        });
      }
      __name(hasOverlappingReservation, "hasOverlappingReservation");
      return {
        createReservation,
        getReservation,
        updateReservationStatus,
        findReservationByPaymentId,
        hasOverlappingReservation,
        generateReservationId
      };
    }
    __name(createReservationStore4, "createReservationStore");
    module.exports = { createReservationStore: createReservationStore4 };
  }
});

// ../lib/server/rate-limiter-kv.js
var require_rate_limiter_kv = __commonJS({
  "../lib/server/rate-limiter-kv.js"(exports, module) {
    init_functionsRoutes_0_5221053579021873();
    function createRateLimiter3(kv) {
      if (!kv) {
        throw new Error(
          "[rate-limiter-kv] Binding KV manquant (env.RATE_LIMITS_KV). Refus de continuer silencieusement \u2014 voir incident Netlify Blobs du 12/08/2026."
        );
      }
      async function checkRateLimit(key, { windowMs, maxRequests }) {
        const now = Date.now();
        const current = await kv.get(key, { type: "json" });
        let count = 1;
        let windowStart = now;
        if (current && isFinite(current.windowStart) && now - current.windowStart < windowMs) {
          windowStart = current.windowStart;
          count = current.count + 1;
        }
        await kv.put(key, JSON.stringify({ count, windowStart }), {
          expirationTtl: Math.ceil(windowMs / 1e3) + 60
        });
        const allowed = count <= maxRequests;
        const retryAfterSeconds = allowed ? 0 : Math.ceil((windowStart + windowMs - now) / 1e3);
        return { allowed, remaining: Math.max(maxRequests - count, 0), retryAfterSeconds };
      }
      __name(checkRateLimit, "checkRateLimit");
      return { checkRateLimit };
    }
    __name(createRateLimiter3, "createRateLimiter");
    module.exports = { createRateLimiter: createRateLimiter3 };
  }
});

// ../lib/server/mollie-client.js
var require_mollie_client = __commonJS({
  "../lib/server/mollie-client.js"(exports, module) {
    init_functionsRoutes_0_5221053579021873();
    var MOLLIE_API_BASE = "https://api.mollie.com/v2";
    function mollieError(status, data) {
      const message = data && (data.detail || data.title) || `Erreur API Mollie (HTTP ${status})`;
      const err = new Error(message);
      err.status = status;
      err.mollieResponse = data;
      return err;
    }
    __name(mollieError, "mollieError");
    async function molliePaymentsCreate2(apiKey, body, idempotencyKey) {
      const headers = {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      };
      if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
      const res = await fetch(`${MOLLIE_API_BASE}/payments`, {
        method: "POST",
        headers,
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) throw mollieError(res.status, data);
      return data;
    }
    __name(molliePaymentsCreate2, "molliePaymentsCreate");
    async function molliePaymentsGet2(apiKey, paymentId) {
      const res = await fetch(`${MOLLIE_API_BASE}/payments/${encodeURIComponent(paymentId)}`, {
        headers: { Authorization: `Bearer ${apiKey}` }
      });
      const data = await res.json();
      if (!res.ok) throw mollieError(res.status, data);
      return data;
    }
    __name(molliePaymentsGet2, "molliePaymentsGet");
    module.exports = { molliePaymentsCreate: molliePaymentsCreate2, molliePaymentsGet: molliePaymentsGet2 };
  }
});

// ../lib/server/http-cors.js
var require_http_cors = __commonJS({
  "../lib/server/http-cors.js"(exports, module) {
    init_functionsRoutes_0_5221053579021873();
    function getAllowedOrigins(env) {
      const origins = /* @__PURE__ */ new Set(["https://getlocation.fr", "https://www.getlocation.fr"]);
      if (env && env.ALLOWED_ORIGINS) {
        env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean).forEach((o) => origins.add(o));
      }
      return origins;
    }
    __name(getAllowedOrigins, "getAllowedOrigins");
    function corsHeaders3(request, env, extraHeaders = {}) {
      const allowed = getAllowedOrigins(env);
      const origin = request.headers.get("origin");
      const headers = new Headers({ "Content-Type": "application/json", Vary: "Origin", ...extraHeaders });
      if (origin && allowed.has(origin)) {
        headers.set("Access-Control-Allow-Origin", origin);
      }
      return headers;
    }
    __name(corsHeaders3, "corsHeaders");
    module.exports = { getAllowedOrigins, corsHeaders: corsHeaders3 };
  }
});

// api/create-payment.js
function clientIp(request) {
  return request.headers.get("cf-connecting-ip") || "unknown";
}
function resolverMontantFacture(prix, codePromoBrut, testDiscountCode) {
  if (testDiscountCode && codePromoBrut && codePromoBrut.trim().toUpperCase() === testDiscountCode.trim().toUpperCase()) {
    return { totalCentimesFacture: TEST_DISCOUNT_CENTIMES, totalFacture: TEST_DISCOUNT_CENTIMES / 100 };
  }
  return { totalCentimesFacture: prix.totalCentimes, totalFacture: prix.total };
}
async function onRequestOptions({ request, env }) {
  const headers = corsHeaders(request, env, {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  return new Response("", { status: 204, headers });
}
async function onRequestPost({ request, env }) {
  const headers = corsHeaders(request, env);
  let rateLimiter;
  let store;
  try {
    rateLimiter = createRateLimiter(env.RATE_LIMITS_KV);
    store = createReservationStore(env.RESERVATIONS_KV);
  } catch (err) {
    console.error("[create-payment] Binding KV manquant :", err && err.message);
    return new Response(JSON.stringify({ error: "Service temporairement indisponible" }), { status: 500, headers });
  }
  const rate = await rateLimiter.checkRateLimit(`create-payment:${clientIp(request)}`, {
    windowMs: 6e4,
    maxRequests: 8
  });
  if (!rate.allowed) {
    headers.set("Retry-After", String(rate.retryAfterSeconds));
    return new Response(JSON.stringify({ error: "Trop de requ\xEAtes, veuillez r\xE9essayer dans un instant." }), {
      status: 429,
      headers
    });
  }
  let payload;
  try {
    const raw = await request.text();
    if (!raw || raw.length > 2e4) throw new Error("corps de requ\xEAte vide ou trop volumineux");
    payload = JSON.parse(raw);
  } catch (e) {
    return new Response(JSON.stringify({ error: "Requ\xEAte invalide" }), { status: 400, headers });
  }
  const { valid, errors, vehicule, options, codePromo } = validateReservationInput(payload);
  if (!valid) {
    return new Response(JSON.stringify({ error: "Requ\xEAte invalide", details: errors }), { status: 400, headers });
  }
  const prix = calculerPrixTotal({ ...payload, options, codePromo });
  if (!prix || !isFinite(prix.totalCentimes) || prix.totalCentimes < 50) {
    return new Response(JSON.stringify({ error: "Impossible de calculer le prix pour cette demande" }), {
      status: 400,
      headers
    });
  }
  const { totalCentimesFacture, totalFacture } = resolverMontantFacture(prix, codePromo, env.TEST_DISCOUNT_CODE);
  if (!env.MOLLIE_API_KEY) {
    return new Response(
      JSON.stringify({ error: "Le paiement en ligne n'est pas encore configur\xE9.", code: "mollie_not_configured" }),
      { status: 503, headers }
    );
  }
  const periodeDebut = (/* @__PURE__ */ new Date(`${payload.dateDebut}T${payload.heureDebut}:00`)).toISOString();
  const periodeFin = (/* @__PURE__ */ new Date(`${payload.dateFin}T${payload.heureFin}:00`)).toISOString();
  const overlap = await store.hasOverlappingReservation(vehicule.id, periodeDebut, periodeFin);
  if (overlap) {
    return new Response(
      JSON.stringify({ error: "Ce v\xE9hicule n'est plus disponible sur les dates s\xE9lectionn\xE9es.", code: "not_available" }),
      { status: 409, headers }
    );
  }
  const reservation = await store.createReservation({
    vehiculeId: vehicule.id,
    dateDebut: payload.dateDebut,
    heureDebut: payload.heureDebut,
    dateFin: payload.dateFin,
    heureFin: payload.heureFin,
    periodeDebut,
    periodeFin,
    lieuPrise: payload.lieuPrise || null,
    lieuRetour: payload.lieuRetour || null,
    adressePrise: payload.adressePrise || null,
    adresseRetour: payload.adresseRetour || null,
    jours: prix.jours,
    sousTotalBrut: prix.sousTotalBrut,
    reductionDuree: prix.reductionDuree,
    options: prix.optionsSelectionnees,
    optionsMontant: prix.optionsMontant,
    codePromo: prix.codePromo,
    reductionPromoMontant: prix.reductionPromoMontant,
    total: totalFacture,
    cglVersion: payload.cglVersion,
    cglAcceptedAt: (/* @__PURE__ */ new Date()).toISOString(),
    conducteur: {
      nom: payload.conducteur.nom.trim(),
      prenom: payload.conducteur.prenom.trim(),
      email: payload.conducteur.email.trim(),
      telephone: payload.conducteur.telephone.trim(),
      naissance: payload.conducteur.naissance
    }
  });
  try {
    const origin = new URL(request.url).origin;
    const payment = await molliePaymentsCreate(
      env.MOLLIE_API_KEY,
      {
        amount: {
          currency: "EUR",
          // toujours EUR — jamais une valeur fournie par le client
          value: (totalCentimesFacture / 100).toFixed(2)
        },
        description: `Location ${vehicule.nom} \u2014 ${prix.jours} jour(s) \u2014 r\xE9servation ${reservation.id}`,
        redirectUrl: `${origin}/confirmation.html?reservation=${encodeURIComponent(reservation.id)}`,
        webhookUrl: `${origin}/api/mollie-webhook`,
        metadata: {
          reservationId: reservation.id,
          vehiculeId: vehicule.id,
          jours: String(prix.jours),
          options: prix.optionsSelectionnees.map((o) => o.id).join(",") || "aucune",
          codePromo: prix.codePromo ? prix.codePromo.code : "aucun"
        }
      },
      payload.idempotencyKey
    );
    await store.updateReservationStatus(reservation.id, "pending_payment", { paymentId: payment.id });
    return new Response(
      JSON.stringify({ checkoutUrl: payment._links.checkout.href, reservationId: reservation.id }),
      { status: 200, headers }
    );
  } catch (err) {
    console.error("[create-payment] Erreur Mollie :", err && err.message);
    await store.updateReservationStatus(reservation.id, "cancelled", { failureReason: "mollie_error" });
    return new Response(JSON.stringify({ error: "Le paiement n'a pas pu \xEAtre initialis\xE9. Veuillez r\xE9essayer." }), {
      status: 500,
      headers
    });
  }
}
var calculerPrixTotal, validateReservationInput, createReservationStore, createRateLimiter, molliePaymentsCreate, corsHeaders, TEST_DISCOUNT_CENTIMES;
var init_create_payment = __esm({
  "api/create-payment.js"() {
    init_functionsRoutes_0_5221053579021873();
    ({ calculerPrixTotal } = require_data());
    ({ validateReservationInput } = require_validate_reservation_input());
    ({ createReservationStore } = require_reservation_store_kv());
    ({ createRateLimiter } = require_rate_limiter_kv());
    ({ molliePaymentsCreate } = require_mollie_client());
    ({ corsHeaders } = require_http_cors());
    __name(clientIp, "clientIp");
    TEST_DISCOUNT_CENTIMES = 99;
    __name(resolverMontantFacture, "resolverMontantFacture");
    __name(onRequestOptions, "onRequestOptions");
    __name(onRequestPost, "onRequestPost");
  }
});

// ../lib/server/process-payment-status.js
var require_process_payment_status = __commonJS({
  "../lib/server/process-payment-status.js"(exports, module) {
    init_functionsRoutes_0_5221053579021873();
    async function resolveReservation(deps, payment) {
      const reservationId = payment.metadata && payment.metadata.reservationId;
      if (reservationId) {
        const byId = await deps.store.getReservation(reservationId);
        if (byId) return byId;
      }
      return deps.store.findReservationByPaymentId(payment.id);
    }
    __name(resolveReservation, "resolveReservation");
    async function handlePaid(deps, payment) {
      const reservation = await resolveReservation(deps, payment);
      if (!reservation) {
        console.error("[mollie-webhook] Aucune r\xE9servation trouv\xE9e pour le paiement (paid).");
        return;
      }
      if (reservation.status === "paid") return;
      const updated = await deps.store.updateReservationStatus(reservation.id, "paid", {
        paymentId: payment.id,
        paidAt: (/* @__PURE__ */ new Date()).toISOString()
      });
      await deps.sendConfirmationEmail(updated);
      await deps.sendContractEmail(updated);
    }
    __name(handlePaid, "handlePaid");
    async function handleFailedOrCanceled(deps, payment) {
      const reservation = await resolveReservation(deps, payment);
      if (!reservation) {
        console.error("[mollie-webhook] Aucune r\xE9servation trouv\xE9e pour le paiement (\xE9chec/annulation/expiration).");
        return;
      }
      if (reservation.status === "paid" || reservation.status === "cancelled") return;
      await deps.store.updateReservationStatus(reservation.id, "cancelled", {
        paymentId: payment.id,
        failureReason: payment.status
      });
    }
    __name(handleFailedOrCanceled, "handleFailedOrCanceled");
    async function processPaymentStatus2(deps, payment) {
      switch (payment.status) {
        case "paid":
          await handlePaid(deps, payment);
          break;
        case "canceled":
        case "expired":
        case "failed":
          await handleFailedOrCanceled(deps, payment);
          break;
        default:
          break;
      }
    }
    __name(processPaymentStatus2, "processPaymentStatus");
    module.exports = { processPaymentStatus: processPaymentStatus2, resolveReservation, handlePaid, handleFailedOrCanceled };
  }
});

// api/mollie-webhook.js
async function sendConfirmationEmailStub() {
  console.warn("[mollie-webhook] Email de confirmation non envoy\xE9 : Resend (B.4) pas encore impl\xE9ment\xE9.");
}
async function sendContractEmailStub() {
  console.warn("[mollie-webhook] Email contrat agence non envoy\xE9 : Resend (B.4) pas encore impl\xE9ment\xE9.");
}
async function onRequestPost2({ request, env }) {
  const apiKey = env.MOLLIE_API_KEY;
  if (!apiKey) {
    console.error("[mollie-webhook] MOLLIE_API_KEY manquante.");
    return new Response("Webhook non configur\xE9", { status: 500 });
  }
  let store;
  try {
    store = createReservationStore2(env.RESERVATIONS_KV);
  } catch (err) {
    console.error("[mollie-webhook] Binding KV manquant :", err && err.message);
    return new Response("Service temporairement indisponible", { status: 500 });
  }
  const deps = { store, sendConfirmationEmail: sendConfirmationEmailStub, sendContractEmail: sendContractEmailStub };
  const rawBody = await request.text();
  const paymentId = new URLSearchParams(rawBody).get("id");
  if (!paymentId) {
    return new Response("id manquant", { status: 400 });
  }
  try {
    const payment = await molliePaymentsGet(apiKey, paymentId);
    await processPaymentStatus(deps, payment);
    return new Response(JSON.stringify({ received: true }), { status: 200 });
  } catch (err) {
    if (err && err.status === 404) {
      console.error("[mollie-webhook] Paiement inconnu de Mollie pour cet id.");
      return new Response(JSON.stringify({ received: true }), { status: 200 });
    }
    console.error("[mollie-webhook] Erreur de traitement :", err && err.message);
    return new Response("Erreur interne", { status: 500 });
  }
}
var molliePaymentsGet, createReservationStore2, processPaymentStatus;
var init_mollie_webhook = __esm({
  "api/mollie-webhook.js"() {
    init_functionsRoutes_0_5221053579021873();
    __name(sendConfirmationEmailStub, "sendConfirmationEmailStub");
    __name(sendContractEmailStub, "sendContractEmailStub");
    ({ molliePaymentsGet } = require_mollie_client());
    ({ createReservationStore: createReservationStore2 } = require_reservation_store_kv());
    ({ processPaymentStatus } = require_process_payment_status());
    __name(onRequestPost2, "onRequestPost");
  }
});

// api/reservation-status.js
function clientIp2(request) {
  return request.headers.get("cf-connecting-ip") || "unknown";
}
function toSafePublicView(reservation) {
  const vehicule = getVehiculeParId(reservation.vehiculeId);
  return {
    id: reservation.id,
    status: reservation.status,
    vehicule: vehicule ? { id: vehicule.id, nom: vehicule.nom, photo: vehicule.photo, photoCutout: vehicule.photoCutout } : null,
    dateDebut: reservation.dateDebut,
    heureDebut: reservation.heureDebut,
    dateFin: reservation.dateFin,
    heureFin: reservation.heureFin,
    lieuPrise: reservation.lieuPrise,
    lieuRetour: reservation.lieuRetour,
    adressePrise: reservation.adressePrise,
    adresseRetour: reservation.adresseRetour,
    assurance: !!reservation.assurance,
    jours: reservation.jours,
    sousTotalBrut: reservation.sousTotalBrut,
    reductionDuree: reservation.reductionDuree || null,
    assuranceMontant: reservation.assuranceMontant,
    options: Array.isArray(reservation.options) ? reservation.options : [],
    optionsMontant: reservation.optionsMontant,
    codePromo: reservation.codePromo || null,
    reductionPromoMontant: reservation.reductionPromoMontant,
    total: reservation.total,
    conducteur: reservation.conducteur ? { prenom: reservation.conducteur.prenom, nom: reservation.conducteur.nom, email: reservation.conducteur.email } : null,
    createdAt: reservation.createdAt
  };
}
async function onRequestOptions2({ request, env }) {
  const headers = corsHeaders2(request, env, {
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  return new Response("", { status: 204, headers });
}
async function onRequestGet({ request, env }) {
  const headers = corsHeaders2(request, env, { "Cache-Control": "no-store" });
  let rateLimiter;
  let store;
  try {
    rateLimiter = createRateLimiter2(env.RATE_LIMITS_KV);
    store = createReservationStore3(env.RESERVATIONS_KV);
  } catch (err) {
    console.error("[reservation-status] Binding KV manquant :", err && err.message);
    return new Response(JSON.stringify({ error: "Service temporairement indisponible" }), { status: 500, headers });
  }
  const rate = await rateLimiter.checkRateLimit(`reservation-status:${clientIp2(request)}`, {
    windowMs: 6e4,
    maxRequests: 30
  });
  if (!rate.allowed) {
    headers.set("Retry-After", String(rate.retryAfterSeconds));
    return new Response(JSON.stringify({ error: "Trop de requ\xEAtes, veuillez r\xE9essayer dans un instant." }), {
      status: 429,
      headers
    });
  }
  const id = new URL(request.url).searchParams.get("id");
  if (!id || !/^res_[a-f0-9]{32}$/.test(id)) {
    return new Response(JSON.stringify({ error: "Identifiant de r\xE9servation invalide" }), { status: 400, headers });
  }
  const reservation = await store.getReservation(id);
  if (!reservation) {
    return new Response(JSON.stringify({ error: "R\xE9servation introuvable" }), { status: 404, headers });
  }
  return new Response(JSON.stringify(toSafePublicView(reservation)), { status: 200, headers });
}
var getVehiculeParId, createReservationStore3, createRateLimiter2, corsHeaders2;
var init_reservation_status = __esm({
  "api/reservation-status.js"() {
    init_functionsRoutes_0_5221053579021873();
    ({ getVehiculeParId } = require_data());
    ({ createReservationStore: createReservationStore3 } = require_reservation_store_kv());
    ({ createRateLimiter: createRateLimiter2 } = require_rate_limiter_kv());
    ({ corsHeaders: corsHeaders2 } = require_http_cors());
    __name(clientIp2, "clientIp");
    __name(toSafePublicView, "toSafePublicView");
    __name(onRequestOptions2, "onRequestOptions");
    __name(onRequestGet, "onRequestGet");
  }
});

// ../.wrangler/tmp/pages-Ln9Vk9/functionsRoutes-0.5221053579021873.mjs
var routes;
var init_functionsRoutes_0_5221053579021873 = __esm({
  "../.wrangler/tmp/pages-Ln9Vk9/functionsRoutes-0.5221053579021873.mjs"() {
    init_create_payment();
    init_create_payment();
    init_mollie_webhook();
    init_reservation_status();
    init_reservation_status();
    routes = [
      {
        routePath: "/api/create-payment",
        mountPath: "/api",
        method: "OPTIONS",
        middlewares: [],
        modules: [onRequestOptions]
      },
      {
        routePath: "/api/create-payment",
        mountPath: "/api",
        method: "POST",
        middlewares: [],
        modules: [onRequestPost]
      },
      {
        routePath: "/api/mollie-webhook",
        mountPath: "/api",
        method: "POST",
        middlewares: [],
        modules: [onRequestPost2]
      },
      {
        routePath: "/api/reservation-status",
        mountPath: "/api",
        method: "GET",
        middlewares: [],
        modules: [onRequestGet]
      },
      {
        routePath: "/api/reservation-status",
        mountPath: "/api",
        method: "OPTIONS",
        middlewares: [],
        modules: [onRequestOptions2]
      }
    ];
  }
});

// ../../../../../.npm/_npx/32026684e21afda6/node_modules/wrangler/templates/pages-template-worker.ts
init_functionsRoutes_0_5221053579021873();

// ../../../../../.npm/_npx/32026684e21afda6/node_modules/path-to-regexp/dist.es2015/index.js
init_functionsRoutes_0_5221053579021873();
function lexer(str) {
  var tokens = [];
  var i = 0;
  while (i < str.length) {
    var char = str[i];
    if (char === "*" || char === "+" || char === "?") {
      tokens.push({ type: "MODIFIER", index: i, value: str[i++] });
      continue;
    }
    if (char === "\\") {
      tokens.push({ type: "ESCAPED_CHAR", index: i++, value: str[i++] });
      continue;
    }
    if (char === "{") {
      tokens.push({ type: "OPEN", index: i, value: str[i++] });
      continue;
    }
    if (char === "}") {
      tokens.push({ type: "CLOSE", index: i, value: str[i++] });
      continue;
    }
    if (char === ":") {
      var name = "";
      var j = i + 1;
      while (j < str.length) {
        var code = str.charCodeAt(j);
        if (
          // `0-9`
          code >= 48 && code <= 57 || // `A-Z`
          code >= 65 && code <= 90 || // `a-z`
          code >= 97 && code <= 122 || // `_`
          code === 95
        ) {
          name += str[j++];
          continue;
        }
        break;
      }
      if (!name)
        throw new TypeError("Missing parameter name at ".concat(i));
      tokens.push({ type: "NAME", index: i, value: name });
      i = j;
      continue;
    }
    if (char === "(") {
      var count = 1;
      var pattern = "";
      var j = i + 1;
      if (str[j] === "?") {
        throw new TypeError('Pattern cannot start with "?" at '.concat(j));
      }
      while (j < str.length) {
        if (str[j] === "\\") {
          pattern += str[j++] + str[j++];
          continue;
        }
        if (str[j] === ")") {
          count--;
          if (count === 0) {
            j++;
            break;
          }
        } else if (str[j] === "(") {
          count++;
          if (str[j + 1] !== "?") {
            throw new TypeError("Capturing groups are not allowed at ".concat(j));
          }
        }
        pattern += str[j++];
      }
      if (count)
        throw new TypeError("Unbalanced pattern at ".concat(i));
      if (!pattern)
        throw new TypeError("Missing pattern at ".concat(i));
      tokens.push({ type: "PATTERN", index: i, value: pattern });
      i = j;
      continue;
    }
    tokens.push({ type: "CHAR", index: i, value: str[i++] });
  }
  tokens.push({ type: "END", index: i, value: "" });
  return tokens;
}
__name(lexer, "lexer");
function parse(str, options) {
  if (options === void 0) {
    options = {};
  }
  var tokens = lexer(str);
  var _a = options.prefixes, prefixes = _a === void 0 ? "./" : _a, _b = options.delimiter, delimiter = _b === void 0 ? "/#?" : _b;
  var result = [];
  var key = 0;
  var i = 0;
  var path = "";
  var tryConsume = /* @__PURE__ */ __name(function(type) {
    if (i < tokens.length && tokens[i].type === type)
      return tokens[i++].value;
  }, "tryConsume");
  var mustConsume = /* @__PURE__ */ __name(function(type) {
    var value2 = tryConsume(type);
    if (value2 !== void 0)
      return value2;
    var _a2 = tokens[i], nextType = _a2.type, index = _a2.index;
    throw new TypeError("Unexpected ".concat(nextType, " at ").concat(index, ", expected ").concat(type));
  }, "mustConsume");
  var consumeText = /* @__PURE__ */ __name(function() {
    var result2 = "";
    var value2;
    while (value2 = tryConsume("CHAR") || tryConsume("ESCAPED_CHAR")) {
      result2 += value2;
    }
    return result2;
  }, "consumeText");
  var isSafe = /* @__PURE__ */ __name(function(value2) {
    for (var _i = 0, delimiter_1 = delimiter; _i < delimiter_1.length; _i++) {
      var char2 = delimiter_1[_i];
      if (value2.indexOf(char2) > -1)
        return true;
    }
    return false;
  }, "isSafe");
  var safePattern = /* @__PURE__ */ __name(function(prefix2) {
    var prev = result[result.length - 1];
    var prevText = prefix2 || (prev && typeof prev === "string" ? prev : "");
    if (prev && !prevText) {
      throw new TypeError('Must have text between two parameters, missing text after "'.concat(prev.name, '"'));
    }
    if (!prevText || isSafe(prevText))
      return "[^".concat(escapeString(delimiter), "]+?");
    return "(?:(?!".concat(escapeString(prevText), ")[^").concat(escapeString(delimiter), "])+?");
  }, "safePattern");
  while (i < tokens.length) {
    var char = tryConsume("CHAR");
    var name = tryConsume("NAME");
    var pattern = tryConsume("PATTERN");
    if (name || pattern) {
      var prefix = char || "";
      if (prefixes.indexOf(prefix) === -1) {
        path += prefix;
        prefix = "";
      }
      if (path) {
        result.push(path);
        path = "";
      }
      result.push({
        name: name || key++,
        prefix,
        suffix: "",
        pattern: pattern || safePattern(prefix),
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    var value = char || tryConsume("ESCAPED_CHAR");
    if (value) {
      path += value;
      continue;
    }
    if (path) {
      result.push(path);
      path = "";
    }
    var open = tryConsume("OPEN");
    if (open) {
      var prefix = consumeText();
      var name_1 = tryConsume("NAME") || "";
      var pattern_1 = tryConsume("PATTERN") || "";
      var suffix = consumeText();
      mustConsume("CLOSE");
      result.push({
        name: name_1 || (pattern_1 ? key++ : ""),
        pattern: name_1 && !pattern_1 ? safePattern(prefix) : pattern_1,
        prefix,
        suffix,
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    mustConsume("END");
  }
  return result;
}
__name(parse, "parse");
function match(str, options) {
  var keys = [];
  var re = pathToRegexp(str, keys, options);
  return regexpToFunction(re, keys, options);
}
__name(match, "match");
function regexpToFunction(re, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.decode, decode = _a === void 0 ? function(x) {
    return x;
  } : _a;
  return function(pathname) {
    var m = re.exec(pathname);
    if (!m)
      return false;
    var path = m[0], index = m.index;
    var params = /* @__PURE__ */ Object.create(null);
    var _loop_1 = /* @__PURE__ */ __name(function(i2) {
      if (m[i2] === void 0)
        return "continue";
      var key = keys[i2 - 1];
      if (key.modifier === "*" || key.modifier === "+") {
        params[key.name] = m[i2].split(key.prefix + key.suffix).map(function(value) {
          return decode(value, key);
        });
      } else {
        params[key.name] = decode(m[i2], key);
      }
    }, "_loop_1");
    for (var i = 1; i < m.length; i++) {
      _loop_1(i);
    }
    return { path, index, params };
  };
}
__name(regexpToFunction, "regexpToFunction");
function escapeString(str) {
  return str.replace(/([.+*?=^!:${}()[\]|/\\])/g, "\\$1");
}
__name(escapeString, "escapeString");
function flags(options) {
  return options && options.sensitive ? "" : "i";
}
__name(flags, "flags");
function regexpToRegexp(path, keys) {
  if (!keys)
    return path;
  var groupsRegex = /\((?:\?<(.*?)>)?(?!\?)/g;
  var index = 0;
  var execResult = groupsRegex.exec(path.source);
  while (execResult) {
    keys.push({
      // Use parenthesized substring match if available, index otherwise
      name: execResult[1] || index++,
      prefix: "",
      suffix: "",
      modifier: "",
      pattern: ""
    });
    execResult = groupsRegex.exec(path.source);
  }
  return path;
}
__name(regexpToRegexp, "regexpToRegexp");
function arrayToRegexp(paths, keys, options) {
  var parts = paths.map(function(path) {
    return pathToRegexp(path, keys, options).source;
  });
  return new RegExp("(?:".concat(parts.join("|"), ")"), flags(options));
}
__name(arrayToRegexp, "arrayToRegexp");
function stringToRegexp(path, keys, options) {
  return tokensToRegexp(parse(path, options), keys, options);
}
__name(stringToRegexp, "stringToRegexp");
function tokensToRegexp(tokens, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.strict, strict = _a === void 0 ? false : _a, _b = options.start, start = _b === void 0 ? true : _b, _c = options.end, end = _c === void 0 ? true : _c, _d = options.encode, encode = _d === void 0 ? function(x) {
    return x;
  } : _d, _e = options.delimiter, delimiter = _e === void 0 ? "/#?" : _e, _f = options.endsWith, endsWith = _f === void 0 ? "" : _f;
  var endsWithRe = "[".concat(escapeString(endsWith), "]|$");
  var delimiterRe = "[".concat(escapeString(delimiter), "]");
  var route = start ? "^" : "";
  for (var _i = 0, tokens_1 = tokens; _i < tokens_1.length; _i++) {
    var token = tokens_1[_i];
    if (typeof token === "string") {
      route += escapeString(encode(token));
    } else {
      var prefix = escapeString(encode(token.prefix));
      var suffix = escapeString(encode(token.suffix));
      if (token.pattern) {
        if (keys)
          keys.push(token);
        if (prefix || suffix) {
          if (token.modifier === "+" || token.modifier === "*") {
            var mod = token.modifier === "*" ? "?" : "";
            route += "(?:".concat(prefix, "((?:").concat(token.pattern, ")(?:").concat(suffix).concat(prefix, "(?:").concat(token.pattern, "))*)").concat(suffix, ")").concat(mod);
          } else {
            route += "(?:".concat(prefix, "(").concat(token.pattern, ")").concat(suffix, ")").concat(token.modifier);
          }
        } else {
          if (token.modifier === "+" || token.modifier === "*") {
            throw new TypeError('Can not repeat "'.concat(token.name, '" without a prefix and suffix'));
          }
          route += "(".concat(token.pattern, ")").concat(token.modifier);
        }
      } else {
        route += "(?:".concat(prefix).concat(suffix, ")").concat(token.modifier);
      }
    }
  }
  if (end) {
    if (!strict)
      route += "".concat(delimiterRe, "?");
    route += !options.endsWith ? "$" : "(?=".concat(endsWithRe, ")");
  } else {
    var endToken = tokens[tokens.length - 1];
    var isEndDelimited = typeof endToken === "string" ? delimiterRe.indexOf(endToken[endToken.length - 1]) > -1 : endToken === void 0;
    if (!strict) {
      route += "(?:".concat(delimiterRe, "(?=").concat(endsWithRe, "))?");
    }
    if (!isEndDelimited) {
      route += "(?=".concat(delimiterRe, "|").concat(endsWithRe, ")");
    }
  }
  return new RegExp(route, flags(options));
}
__name(tokensToRegexp, "tokensToRegexp");
function pathToRegexp(path, keys, options) {
  if (path instanceof RegExp)
    return regexpToRegexp(path, keys);
  if (Array.isArray(path))
    return arrayToRegexp(path, keys, options);
  return stringToRegexp(path, keys, options);
}
__name(pathToRegexp, "pathToRegexp");

// ../../../../../.npm/_npx/32026684e21afda6/node_modules/wrangler/templates/pages-template-worker.ts
var escapeRegex = /[.+?^${}()|[\]\\]/g;
function* executeRequest(request) {
  const requestPath = new URL(request.url).pathname;
  for (const route of [...routes].reverse()) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult) {
      for (const handler of route.middlewares.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: mountMatchResult.path
        };
      }
    }
  }
  for (const route of routes) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: true
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult && route.modules.length) {
      for (const handler of route.modules.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: matchResult.path
        };
      }
      break;
    }
  }
}
__name(executeRequest, "executeRequest");
var pages_template_worker_default = {
  async fetch(originalRequest, env, workerContext) {
    let request = originalRequest;
    const handlerIterator = executeRequest(request);
    let data = {};
    let isFailOpen = false;
    const next = /* @__PURE__ */ __name(async (input, init) => {
      if (input !== void 0) {
        let url = input;
        if (typeof input === "string") {
          url = new URL(input, request.url).toString();
        }
        request = new Request(url, init);
      }
      const result = handlerIterator.next();
      if (result.done === false) {
        const { handler, params, path } = result.value;
        const context = {
          request: new Request(request.clone()),
          functionPath: path,
          next,
          params,
          get data() {
            return data;
          },
          set data(value) {
            if (typeof value !== "object" || value === null) {
              throw new Error("context.data must be an object");
            }
            data = value;
          },
          env,
          waitUntil: workerContext.waitUntil.bind(workerContext),
          passThroughOnException: /* @__PURE__ */ __name(() => {
            isFailOpen = true;
          }, "passThroughOnException")
        };
        const response = await handler(context);
        if (!(response instanceof Response)) {
          throw new Error("Your Pages function should return a Response");
        }
        return cloneResponse(response);
      } else if ("ASSETS") {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      } else {
        const response = await fetch(request);
        return cloneResponse(response);
      }
    }, "next");
    try {
      return await next();
    } catch (error) {
      if (isFailOpen) {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      }
      throw error;
    }
  }
};
var cloneResponse = /* @__PURE__ */ __name((response) => (
  // https://fetch.spec.whatwg.org/#null-body-status
  new Response(
    [101, 204, 205, 304].includes(response.status) ? null : response.body,
    response
  )
), "cloneResponse");
export {
  pages_template_worker_default as default
};
