Warning: truncated output (original token count: 32524)
Total output lines: 2814

// GETLOCATION — logique du site (catalogue, réservation, paiement, galerie).
// Stockage local (localStorage) : uniquement pour le confort du parcours
// (pré-remplissage, résumé). La confirmation de paiement et le prix qui fait
// foi viennent toujours du serveur (endpoints /api/*, voir src/api/ et
// DEPLOIEMENT.md) — voir P0 (AUDIT.md).
//
// HEURE_OUVERTURE, HEURE_FERMETURE, PRIX_ASSURANCE_JOUR, dureeEnHeures,
// joursFacturablesDepuisHeures et calculerPrixTotal vivent désormais dans
// js/data.js (source unique partagée avec le serveur) — chargé avant ce
// fichier sur chaque page, ils restent donc disponibles ici sans import.

// Note : il n'y a plus de clé "confirmation" — la confirmation de paiement
// est désormais lue depuis le serveur (voir initConfirmationPage), jamais
// depuis localStorage.
const STORAGE = {
  recherche: "gl_recherche",
  selection: "gl_selection",
  reservation: "gl_reservation"
};

function todayISO(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function joursEntre(dateDebut, dateFin) {
  const a = new Date(dateDebut);
  const b = new Date(dateFin);
  const diff = Math.round((b - a) / (1000 * 60 * 60 * 24));
  return Math.max(diff, 1);
}

function formatDateHeureFR(iso, heure) {
  const base = formatDateFR(iso);
  if (!heure) return base;
  return langueSite() === "en" ? `${base} at ${heure}` : `${base} à ${heure}`;
}

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function writeJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function clearJSON(key) {
  try {
    localStorage.removeItem(key);
  } catch (e) {
    // Stockage indisponible (navigation privée stricte, etc.) : sans effet,
    // rien de plus à faire ici.
  }
}

// Durée de vie maximale des données de réservation en cours (dont les
// coordonnées et la date de naissance du conducteur) conservées dans ce
// navigateur : passé ce délai, un panier abandonné est purgé
// automatiquement à la prochaine visite d'une page du tunnel de
// réservation. Ces données sont de toute façon systématiquement effacées
// avec succès dès la confirmation du paiement (voir initPaiementPage).
const RESERVATION_LOCAL_MAX_AGE_MS = 1000 * 60 * 60 * 2; // 2 heures

function writeReservationLocal(data) {
  writeJSON(STORAGE.reservation, { ...data, _savedAt: Date.now() });
}

function readReservationLocal() {
  const data = readJSON(STORAGE.reservation, null);
  if (!data) return null;
  if (!data._savedAt || Date.now() - data._savedAt > RESERVATION_LOCAL_MAX_AGE_MS) {
    clearJSON(STORAGE.reservation);
    return null;
  }
  return data;
}

function setFooterYear() {
  const el = document.getElementById("footer-year");
  if (el) el.textContent = new Date().getFullYear();
}

/* ---------------------------------------------------------
   Menu mobile — bouton .nav-toggle + panneau .main-nav (toutes les pages).
   Avant ce correctif, .main-nav disparaissait purement et simplement en
   dessous de 640px sans aucune alternative (y compris le lien
   "Nous appeler") : plus aucune navigation ni accès téléphone n'était
   possible sur mobile. Voir AUDIT.md, P1.
--------------------------------------------------------- */
function initMobileMenu() {
  const toggle = document.getElementById("nav-toggle");
  const nav = document.getElementById("main-nav");
  if (!toggle || !nav) return;

  function isOpen() {
    return toggle.getAttribute("aria-expanded") === "true";
  }

  function open() {
    toggle.setAttribute("aria-expanded", "true");
    toggle.setAttribute("aria-label", "Fermer le menu");
    nav.classList.add("is-open");
    const firstLink = nav.querySelector("a");
    if (firstLink) firstLink.focus();
    document.addEventListener("keydown", onKeydown);
    document.addEventListener("click", onClickOutside, true);
  }

  function close({ restoreFocus = false } = {}) {
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "Ouvrir le menu");
    nav.classList.remove("is-open");
    document.removeEventListener("keydown", onKeydown);
    document.removeEventListener("click", onClickOutside, true);
    if (restoreFocus) toggle.focus();
  }

  function onKeydown(e) {
    if (e.key === "Escape") {
      close({ restoreFocus: true });
      return;
    }
    // Focus trap simple : Tab/Shift+Tab restent parmi les liens du menu
    // tant qu'il est ouvert.
    if (e.key === "Tab") {
      const focusables = nav.querySelectorAll("a");
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  function onClickOutside(e) {
    if (!nav.contains(e.target) && e.target !== toggle && !toggle.contains(e.target)) {
      close();
    }
  }

  toggle.addEventListener("click", () => {
    if (isOpen()) close({ restoreFocus: true });
    else open();
  });

  // Un clic sur un lien du menu doit le refermer avant de naviguer.
  nav.querySelectorAll("a").forEach((a) => {
    a.addEventListener("click", () => close());
  });

  // Si la fenêtre repasse au-delà du point de rupture mobile (rotation,
  // redimensionnement), on referme proprement plutôt que de laisser le
  // panneau ouvert dans un état incohérent avec le CSS desktop.
  window.addEventListener("resize", () => {
    if (window.innerWidth > 640 && isOpen()) close();
  });
}

// Remplit un <select> avec la liste des horaires autorisés, par pas de
// 30 minutes. La même borne est revalidée côté serveur : cette liste n'est
// jamais la seule protection contre une valeur HTML modifiée.
// Fonction partagée par le formulaire de recherche (initSearchForm) et la
// barre de dates persistante du tunnel de réservation (initDateBar).
function remplirOptionsHeure(select) {
  if (!select || select.options.length) return;
  const [hOuv] = HEURE_OUVERTURE.split(":").map(Number);
  const [hFer, mFer] = HEURE_FERMETURE.split(":").map(Number);
  let minutes = hOuv * 60;
  const fin = hFer * 60 + mFer;
  while (minutes <= fin) {
    const h = String(Math.floor(minutes / 60)).padStart(2, "0");
    const m = String(minutes % 60).padStart(2, "0");
    select.add(new Option(`${h}:${m}`, `${h}:${m}`));
    minutes += 30;
  }
}

function heureReservationAutorisee(heure) {
  if (typeof heure !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(heure)) return false;
  const enMinutes = (valeur) => {
    const [h, m] = valeur.split(":").map(Number);
    return h * 60 + m;
  };
  const valeur = enMinutes(heure);
  return valeur >= enMinutes(HEURE_OUVERTURE) && valeur <= enMinutes(HEURE_FERMETURE);
}

// L'ancienne horloge était une image de fond dessinée à l'intérieur du
// <select>. Sur Safari iOS, elle partageait la même zone que le texte et le
// contrôle natif, d'où le chevauchement à 375–430 px. L'icône vit désormais
// dans un wrapper séparé ; le chevron natif du navigateur garde sa zone.
function initTimeSelects() {
  document.querySelectorAll(".datetime-group select").forEach((select) => {
    if (select.parentElement && select.parentElement.classList.contains("time-select-wrap")) return;
    const wrapper = document.createElement("span");
    wrapper.className = "time-select-wrap";
    select.parentNode.insertBefore(wrapper, select);
    wrapper.appendChild(select);
  });
}

function familyIconClass(family) {
  return family === "utility" ? "vt-icon-utility" : "vt-icon-car";
}

// Mesure la hauteur réelle de l'en-tête et l'expose en variable CSS
// (--header-h) : utilisé pour positionner la barre de dates persistante
// juste en dessous, sans dupliquer une hauteur devinée à la main qui
// pourrait devenir fausse si l'en-tête change (menu mobile, etc.).
function syncHeaderHeightVar() {
  const header = document.querySelector(".site-header");
  if (!header) return;
  document.documentElement.style.setProperty("--header-h", `${header.offsetHeight}px`);
}

// Barre de dates persistante : affichée sous l'en-tête sur les pages du
// tunnel de réservation (véhicules, réservation, paiement) pour permettre au
// client d'ajuster ses dates — par ex. ajouter un jour en voyant le prix
// final — sans revenir en arrière dans le parcours. `getData()` doit
// retourner { dateDebut, heureDebut, dateFin, heureFin, jours } à partir de
// la source de vérité de la page ; `onApply(nouvellesDates)` doit persister
// ces nouvelles dates et re-calculer/ré-afficher le prix de la page.
function initDateBar({ getData, onApply }) {
  const bar = document.getElementById("date-bar");
  if (!bar) return;
  const toggleBtn = document.getElementById("date-bar-toggle");
  const formEl = document.getElementById("date-bar-form");
  const textEl = document.getElementById("date-bar-text");
  const inputDebut = document.getElementById("bar-date-debut");
  const selectHeureDebut = document.getElementById("bar-heure-debut");
  const inputFin = document.getElementById("bar-date-fin");
  const selectHeureFin = document.getElementById("bar-heure-fin");
  const applyBtn = document.getElementById("date-bar-apply");
  const errorEl = document.getElementById("date-bar-error");
  if (!toggleBtn || !formEl || !textEl || !inputDebut || !selectHeureDebut || !inputFin || !selectHeureFin || !applyBtn) return;

  remplirOptionsHeure(selectHeureDebut);
  remplirOptionsHeure(selectHeureFin);
  inputDebut.min = todayISO();

  function refresh() {
    const d = getData();
    const compact = window.matchMedia && window.matchMedia("(max-width: 640px)").matches;
    const locale = langueSite() === "en" ? "en-GB" : "fr-FR";
    const dateOptions = compact ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" };
    const formatDateBar = (iso, heure) => {
      const date = new Date(`${iso}T12:00:00`);
      const dateText = Number.isFinite(date.getTime()) ? date.toLocaleDateString(locale, dateOptions) : formatDateFR(iso);
      return heure ? `${dateText}${langueSite() === "en" ? " at " : " à "}${heure}` : dateText;
    };
    textEl.textContent = t("{debut} → {fin} ({jours})", {
      debut: formatDateBar(d.dateDebut, d.heureDebut),
      fin: formatDateBar(d.dateFin, d.heureFin),
      jours: libelleJours(d.jours)
    });
    inputDebut.value = d.dateDebut;
    selectHeureDebut.value = d.heureDebut;
    inputFin.min = d.dateDebut;
    inputFin.value = d.dateFin;
    selectHeureFin.value = d.heureFin;
  }
  refresh();

  function fermerFormulaire() {
    formEl.style.display = "none";
    toggleBtn.textContent = "Modifier les dates";
    toggleBtn.setAttribute("aria-expanded", "false");
  }

  toggleBtn.addEventListener("click", () => {
    const vaOuvrir = formEl.style.display !== "flex";
    formEl.style.display = vaOuvrir ? "flex" : "none";
    toggleBtn.textContent = vaOuvrir ? "Fermer" : "Modifier les dates";
    toggleBtn.setAttribute("aria-expanded", String(vaOuvrir));
  });

  inputDebut.addEventListener("change", () => {
    if (inputFin.value < inputDebut.value) inputFin.value = inputDebut.value;
    inputFin.min = inputDebut.value;
  });

  applyBtn.addEventListener("click", () => {
    const dateDebut = inputDebut.value;
    const heureDebut = selectHeureDebut.value;
    const dateFin = inputFin.value;
    const heureFin = selectHeureFin.value;
    const duree = dureeEnHeures(dateDebut, heureDebut, dateFin, heureFin);
    if (!heureReservationAutorisee(heureDebut) || !heureReservationAutorisee(heureFin)) {
      if (errorEl) errorEl.textContent = "Les départs et retours sont disponibles à partir de 07:00.";
      return;
    }
    if (!dateDebut || !dateFin || !isFinite(duree) || duree <= 0) {
      if (errorEl) errorEl.textContent = "La date/heure de retour doit être après la date/heure de départ.";
      return;
    }
    if (errorEl) errorEl.textContent = "";
    onApply({ dateDebut, heureDebut, dateFin, heureFin });
    refresh();
    fermerFormulaire();
  });
}

/* ---------------------------------------------------------
   PAGE : index.html — formulaire de recherche
--------------------------------------------------------- */
function initSearchForm() {
  const form = document.getElementById("search-form");
  if (!form) return;

  const selectPrise = document.getElementById("lieu-prise");
  const selectRetour = document.getElementById("lieu-retour");
  const champRetour = document.getElementById("retour-field");
  const boutonToggleRetour = document.getElementById("toggle-retour");
  const inputDebut = document.getElementById("date-debut");
  const inputFin = document.getElementById("date-fin");
  const selectHeureDebut = document.getElementById("heure-debut");
  const selectHeureFin = document.getElementById("heure-fin");
  const champAdressePrise = document.getElementById("adresse-prise-field");
  const selectAdressePrise = document.getElementById("adresse-prise");
  const champAdresseRetour = document.getElementById("adresse-retour-field");
  const selectAdresseRetour = document.getElementById("adresse-retour");
  const toggleTypeVehicule = document.getElementById("vehicle-type-toggle");

  // Sélecteur de famille (Voitures / Utilitaires, voir
  // FAMILLES_VEHICULE dans js/data.js) : choix exclusif, "car" par défaut.
  // Pré-filtre la famille affichée sur vehicules.html (voir
  // initVehiculesPage) sans dupliquer le catalogue.
  let typeVehicule = "car";
  if (toggleTypeVehicule) {
    const optionsType = toggleTypeVehicule.querySelectorAll(".vt-option");
    optionsType.forEach(btn => {
      btn.addEventListener("click", () => {
        typeVehicule = btn.dataset.type;
        optionsType.forEach(b => {
          const actif = b === btn;
          b.classList.toggle("active", actif);
          b.setAttribute("aria-pressed", String(actif));
        });
      });
    });
  }

  LIEUX.forEach(lieu => {
    if (selectPrise) selectPrise.add(new Option(lieu, lieu));
    if (selectRetour) selectRetour.add(new Option(lieu, lieu));
  });
  [selectAdressePrise, selectAdresseRetour].forEach(select => {
    if (!select) return;
    select.add(new Option("Choisissez un lieu de livraison", "", true, true));
    select.options[0].disabled = true;
    select.add(new Option(ADRESSE_PERSONNALISEE, ADRESSE_PERSONNALISEE));
    VILLES_LIVRAISON.forEach(ville => select.add(new Option(ville, ville)));
  });

  function creerChampsAdressePersonnalisee(select, suffixe) {
    if (!select) return null;
    const bloc = document.createElement("div");
    bloc.className = "custom-delivery-address";
    bloc.style.cssText = "display:none;grid-template-columns:2fr 1fr 1.5fr;gap:10px;width:100%;margin-top:10px";
    const champs = [
      { key: "rue", label: "Adresse", placeholder: "Numéro et rue", maxLength: 200 },
      { key: "codePostal", label: "Code postal", placeholder: "06000", maxLength: 5, inputMode: "numeric", pattern: "[0-9]{5}" },
      { key: "ville", label: "Ville", placeholder: "Nice", maxLength: 80 }
    ];
    const inputs = {};
    champs.forEach((champ) => {
      const wrapper = document.createElement("label");
      wrapper.textContent = champ.label;
      const input = document.createElement("input");
      input.type = "text";
      input.id = `adresse-${suffixe}-${champ.key}`;
      input.placeholder = champ.placeholder;
      input.maxLength = champ.maxLength;
      if (champ.inputMode) input.inputMode = champ.inputMode;
      if (champ.pattern) input.pattern = champ.pattern;
      wrapper.appendChild(input);
      bloc.appendChild(wrapper);
      inputs[champ.key] = input;
    });
    select.insertAdjacentElement("afterend", bloc);
    return { bloc, inputs };
  }

  const adressePersonnaliseePrise = creerChampsAdressePersonnalisee(selectAdressePrise, "prise");
  const adressePersonnaliseeRetour = creerChampsAdressePersonnalisee(selectAdresseRetour, "retour");

  function majAdressePersonnalisee(select, groupe) {
    if (!select || !groupe) return;
    const active = select.value === ADRESSE_PERSONNALISEE;
    groupe.bloc.style.display = active ? "grid" : "none";
    Object.values(groupe.inputs).forEach((input) => { input.required = active; });
  }

  function valeurAdresse(select, groupe) {
    if (!select) return "";
    if (select.value !== ADRESSE_PERSONNALISEE) return select.value;
    return formatAdressePersonnalisee(groupe.inputs.rue.value, groupe.inputs.codePostal.value, groupe.inputs.ville.value);
  }

  // GETLOCATION fonctionne désormais uniquement en livraison : le sélecteur
  // technique de mode n'a donc plus d'intérêt visuel. On conserve sa valeur
  // dans le modèle de données pour la compatibilité des réservations et des
  // API existantes, mais le client voit directement le choix utile (ville,
  // gare ou aéroport).
  const livraisonUniquement = LIEUX.length === 1 && LIEUX[0] === LIEU_LIVRAISON;
  if (livraisonUniquement && selectPrise) {
    selectPrise.value = LIEU_LIVRAISON;
    if (selectRetour) selectRetour.value = LIEU_LIVRAISON;
    const champModePrise = selectPrise.closest(".field");
    if (champModePrise) champModePrise.style.display = "none";
  }

  // Lieu de restitution : masqué par défaut et synchronisé sur le lieu de
  // prise en charge (motif Sixt/Europcar — la plupart des locations se
  // terminent au même endroit). Un petit bouton "Restituer à un endroit
  // différent" révèle le champ pour le cas contraire ; une fois révélé, le
  // lieu de restitution redevient indépendant.
  let retourIndependant = false;
  if (boutonToggleRetour && champRetour && selectRetour) {
    // Note : on force l'affichage/masquage via style.display plutôt que la
    // propriété hidden — .field applique display:flex en CSS, qui l'emporte
    // sur la règle [hidden]{display:none} du navigateur (même spécificité,
    // le style de la page passe après la feuille de style par défaut).
    // style.display en ligne, lui, l'emporte toujours.
    champRetour.style.display = "none";
    boutonToggleRetour.addEventListener("click", () => {
      retourIndependant = true;
      champRetour.style.display = livraisonUniquement ? "none" : "";
      boutonToggleRetour.style.display = "none";
      majChampAdresse(selectRetour, champAdresseRetour, selectAdresseRetour);
      (livraisonUniquement ? selectAdresseRetour : selectRetour).focus();
    });
  }

  // Affiche/masque le select de ville selon que "Livraison" est sélectionné
  // comme lieu de prise en charge ou de restitution.
  function majChampAdresse(select, champ, selectVille) {
    if (!champ || !selectVille) return;
    const estLivraison = select.value === LIEU_LIVRAISON;
    champ.style.display = estLivraison ? "" : "none";
    selectVille.required = estLivraison;
    if (!estLivraison) selectVille.value = "";
    majAdressePersonnalisee(selectVille, selectVille === selectAdressePrise ? adressePersonnaliseePrise : adressePersonnaliseeRetour);
  }

  if (selectPrise) {
    majChampAdresse(selectPrise, champAdressePrise, selectAdressePrise);
    selectPrise.addEventListener("change", () => {
      majChampAdresse(selectPrise, champAdressePrise, selectAdressePrise);
      if (!retourIndependant && selectRetour) selectRetour.value = selectPrise.value;
    });
  }
  if (selectAdressePrise) selectAdressePrise.addEventListener("change", () => majAdressePersonnalisee(selectAdressePrise, adressePersonnaliseePrise));
  // Tant que la restitution n'a pas été rendue indépendante, son champ ville
  // reste masqué : elle reprend silencieusement la ville de prise en charge
  // au moment de l'envoi (voir plus bas), pas besoin de la resaisir.
  if (selectRetour) {
    selectRetour.addEventListener("change", () => majChampAdresse(selectRetour, champAdresseRetour, selectAdresseRetour));
  }
  if (selectAdresseRetour) selectAdresseRetour.addEventListener("change", () => majAdressePersonnalisee(selectAdresseRetour, adressePersonnaliseeRetour));

  remplirOptionsHeure(selectHeureDebut);
  remplirOptionsHeure(selectHeureFin);

  inputDebut.min = todayISO();
  inputDebut.value = todayISO(2);
  inputFin.min = todayISO(3);
  inputFin.value = todayISO(5);
  if (selectHeureDebut) selectHeureDebut.value = "10:00";
  if (selectHeureFin) selectHeureFin.value = "10:00";
  [selectHeureDebut, selectHeureFin].forEach((select) => {
    if (select) select.addEventListener("change", () => select.setCustomValidity(""));
  });

  // Si la date/heure de retour tombe avant ou pile sur la date/heure de départ,
  // on corrige automatiquement pour garantir une durée de location positive.
  function corrigerFinSiNecessaire() {
    const duree = dureeEnHeures(inputDebut.value, selectHeureDebut.value, inputFin.value, selectHeureFin.value);
    if (duree <= 0) {
      if (inputFin.value === inputDebut.value) {
        const d = new Date(inputDebut.value);
        d.setDate(d.getDate() + 1);
        inputFin.value = d.toISOString().slice(0, 10);
      } else {
        selectHeureFin.value = selectHeureDebut.value;
      }
    }
  }

  inputDebut.addEventListener("change", () => {
    const d = new Date(inputDebut.value);
    d.setDate(d.getDate() + 1);
    inputFin.min = d.toISOString().slice(0, 10);
    if (inputFin.value < inputDebut.value) {
      inputFin.value = inputDebut.value;
    }
    corrigerFinSiNecessaire();
  });
  inputFin.addEventListener("change", corrigerFinSiNecessaire);
  if (selectHeureDebut) selectHeureDebut.addEventListener("change", corrigerFinSiNecessaire);
  if (selectHeureFin) selectHeureFin.addEventListener("change", corrigerFinSiNecessaire);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    corrigerFinSiNecessaire();

    const horairesValides = heureReservationAutorisee(selectHeureDebut && selectHeureDebut.value)
      && heureReservationAutorisee(selectHeureFin && selectHeureFin.value);
    if (!horairesValides) {
      const cible = !heureReservationAutorisee(selectHeureDebut && selectHeureDebut.value) ? selectHeureDebut : selectHeureFin;
      if (cible) {
        cible.setCustomValidity("Les départs et retours sont disponibles à partir de 07:00.");
        cible.reportValidity();
      }
      return;
    }

    const lieuPriseFinal = selectPrise ? selectPrise.value : LIEU_LIVRAISON;
    const adressePriseFinale = (selectPrise && selectPrise.value === LIEU_LIVRAISON && selectAdressePrise) ? valeurAdresse(selectAdressePrise, adressePersonnaliseePrise) : "";
    // Sans restitution indépendante, on reprend silencieusement le lieu (et
    // la ville de livraison) de la prise en charge : pas besoin de le
    // ressaisir pour le cas le plus courant (même lieu au départ et au retour).
    const lieuRetourFinal = retourIndependant && selectRetour ? selectRetour.value : lieuPriseFinal;
    const adresseRetourFinale = retourIndependant
      ? ((selectRetour.value === LIEU_LIVRAISON && selectAdresseRetour) ? valeurAdresse(selectAdresseRetour, adressePersonnaliseeRetour) : "")
      : adressePriseFinale;

    writeJSON(STORAGE.recherche, {
      lieuPrise: lieuPriseFinal,
      lieuRetour: lieuRetourFinal,
      adressePrise: adressePriseFinale,
      adresseRetour: adresseRetourFinale,
      dateDebut: inputDebut.value,
      dateFin: inputFin.value,
      heureDebut: selectHeureDebut ? selectHeureDebut.value : "10:00",
      heureFin: selectHeureFin ? selectHeureFin.value : "10:00",
      typeVehicule
    });
    allerVers("vehicules.html");
  });
}

// Libellé lisible d'un lieu : si c'est une livraison avec adresse renseignée,
// affiche l'adresse plutôt que le libellé générique.
function libelleLieu(lieu, adresse, type) {
  if (lieu === LIEU_LIVRAISON && adresse) {
    const libelle = t("Livraison — {adresse}", { adresse: libelleAdresseLivraison(adresse) });
    return type === "zone" ? `${libelle} — ${t("adresse exacte à confirmer")}` : libelle;
  }
  // Les lieux viennent de js/data.js, donc en français (« Livraison à
  // l'adresse de votre choix ») : leur traduction est indexée sur ce texte.
  return t(lieu);
}

function vehicleSpecSvg(type) {
  const paths = {
    seats: '<circle cx="9" cy="7" r="2.5"/><path d="M4.5 18v-2.2A4.5 4.5 0 0 1 9 11.3a4.5 4.5 0 0 1 4.5 4.5V18M17 9.5a2 2 0 1 0 0-4M15.5 12.2a4 4 0 0 1 4 4V18"/>',
    transmission: '<circle cx="6" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/><path d="M8 6h8M6 8v8M18 8v8M8 18h8M12 6v12"/>',
    fuel: '<path d="M5 21V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v17M4 21h14M8 6h6v5H8zM17 7h2l2 3v7a2 2 0 0 1-4 0v-3"/>',
    climate: '<path d="M12 2v20M4 6l16 12M20 6 4 18M8.5 3.8 12 6l3.5-2.2M8.5 20.2 12 18l3.5 2.2"/>'
  };
  return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">${paths[type]}</svg>`;
}

/* ---------------------------------------------------------
   PAGE : vehicules.html — catalogue + filtres
--------------------------------------------------------- */
function initVehiculesPage() {
  const grid = document.getElementById("vehicle-grid");
  if (!grid) return;

  // Depuis la flotte de la page d'accueil, ?vehicule=<id> ouvre une fiche
  // ciblée : une seule carte détaillée, ses caractéristiques, ses photos et
  // le bouton de réservation. Un identifiant inconnu revient sans erreur au
  // catalogue complet.
  const vehiculeCibleId = new URLSearchParams(window.location.search).get("vehicule");
  const vehiculeCible = vehiculeCibleId ? getVehiculeParId(vehiculeCibleId) : null;
  if (vehiculeCible) {
    const titre = document.querySelector("h1.section-title");
    if (titre) titre.textContent = vehiculeCible.nom;
    document.title = `${vehiculeCible.nom} — GETLOCATION`;
  }

  const recherche = readJSON(STORAGE.recherche, {
    lieuPrise: LIEUX[0],
    lieuRetour: LIEUX[0],
    adressePrise: "",
    adresseRetour: "",
    dateDebut: todayISO(2),
    dateFin: todayISO(5),
    heureDebut: "10:00",
    heureFin: "10:00"
  });
  // Compatibilité : anciennes recherches enregistrées sans heure / adresse.
  if (!recherche.heureDebut) recherche.heureDebut = "10:00";
  if (!recherche.heureFin) recherche.heureFin = "10:00";
  if (!recherche.adressePrise) recherche.adressePrise = "";
  if (!recherche.adresseRetour) recherche.adresseRetour = "";

  // `jours` est recalculé (pas seulement à l'initialisation) quand le client
  // modifie ses dates depuis la barre de dates persistante (voir
  // initDateBar plus bas) — d'où le `let` plutôt qu'un `const`.
  let jours = joursFacturablesDepuisHeures(
    dureeEnHeures(recherche.dateDebut, recherche.heureDebut, recherche.dateFin, recherche.heureFin)
  );

  const filterBar = document.getElementById("filter-bar");

  // Famille (Voitures/Utilitaires, voir FAMILLES_VEHICULE dans
  // js/data.js) : pré-sélectionnée depuis le choix fait sur la page de
  // recherche (voir initSearchForm). Compatibilité avec les anciennes
  // valeurs stockées ("voiture"/"utilitaire") pour ne pas casser une
  // recherche déjà en cours dans le navigateur d'un client au moment de la
  // mise en ligne de cette nouvelle architecture.
  const FAMILY_COMPAT = { voiture: "car", utilitaire: "utility", "license-free": "car" };
  let activeFamily = FAMILY_COMPAT[recherche.typeVehicule]
    || (FAMILLES_VEHICULE.some(f => f.id === recherche.typeVehicule) ? recherche.typeVehicule : "car");
  let activeType = recherche.typeVehicule === "license-free" ? "license-free" : null;
  let activeFuel = null; // "petrol-diesel" | "hybrid" | "electric"
  let activeAutoOnly = false;
  let activeSeats = null;
  let filtersWereOpen = false;

  if (vehiculeCible && filterBar) filterBar.hidden = true;

  function correspondFiltresVoiture(v) {
    // "Toutes" est représenté par null : il doit inclure les voitures
    // classiques, mais jamais un véhicule de type license-free.
    if (activeType === "license-free") return estVehiculeSansPermis(v);
    if (estVehiculeSansPermis(v)) return false;
    if (activeType && v.type !== activeType) return false;
    if (activeFuel === "petrol-diesel" && v.fuel !== "petrol" && v.fuel !== "diesel") return false;
    if (activeFuel === "hybrid" && v.fuel !== "hybrid") return false;
    if (activeFuel === "electric" && v.fuel !== "electric") return false;
    if (activeAutoOnly && v.transmission !== "Automatique") return false;
    if (activeSeats && v.places !== activeSeats) return false;
    return true;
  }

  // Le filtrage repose sur les identifiants techniques, jamais sur le
  // libellé affiché, afin d'éviter qu'un véhicule sans permis soit inclus
  // dans "Toutes", une catégorie automobile ou les utilitaires.
  function estVehiculeSansPermis(v) {
    return v && (v.vehicleFamily === "license-free" || v.type === "license-free");
  }

  function vehiculesFiltres() {
    const filtered = VEHICULES.filter(v => v.vehicleFamily === activeFamily && (activeType === "license-free" || !estVehiculeSansPermis(v)) && (activeFamily !== "car" || correspondFiltresVoiture(v)));
    // Le produit générique sur demande n'est utile qu'en l'absence d'une
    // voiture sans permis réservable instantanément.
    if (filtered.some(v => v.type === "license-free" && v.bookingMode !== "request")) {
      return filtered.filter(v => v.id !== "sans-permis-request");
    }
    return filtered;
  }

  function renderFamilyTabs() {
    const wrap = document.createElement("div");
    wrap.className = "vehicle-type-toggle family-tabs";
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", "Choisir une famille de véhicule");
    FAMILLES_VEHICULE.forEach(f => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.dataset.type = f.id;
      btn.className = "vt-option" + (f.id === activeFamily ? " active" : "");
      btn.setAttribute("aria-pressed", String(f.id === activeFamily));
      btn.innerHTML = `<span class="vt-icon ${familyIconClass(f.id)}" aria-hidden="true"></span><span>${t(f.label)}</span>`;
      btn.addEventListener("click", () => {
        if (activeFamily === f.id) return;
        activeFamily = f.id;
        activeType = null;
        activeFuel = null;
        activeAutoOnly = false;
        activeSeats = null;
        renderFilterBar();
        renderGrid();
      });
      wrap.appendChild(btn);
    });
    return wrap;
  }

  // Groupe de puces de filtre générique (Type, Motorisation, Places...) —
  // évite de dupliquer le rendu des puces à chaque catégorie de filtre.
  function renderFilterGroup(label, options, valeurDe, valeurActive, onSelect) {
    const groupe = document.createElement("div");
    groupe.className = "filter-group";
    const titre = document.createElement("span");
    titre.className = "filter-group-label";
    titre.textContent = label;
    groupe.appendChild(titre);
    const ligne = document.createElement("div");
    ligne.className = "filter-bar";
    options.forEach(opt => {
      const valeur = valeurDe(opt);
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "filter-chip" + (valeur === valeurActive ? " active" : "");
      chip.textContent = opt.label;
      chip.addEventListener("click", () => {
        onSelect(valeur === valeurActive ? null : valeur);
        renderFilterBar();
        renderGrid();
      });
      ligne.appendChild(chip);
    });
    groupe.appendChild(ligne);
    return groupe;
  }

  function renderCategories() {
    const scroller = document.createElement("div");
    scroller.className = "vehicle-categories";
    scroller.setAttribute("role", "group");
    scroller.setAttribute("aria-label", t("Catégorie de voiture"));
    [{ id: null, label: "Toutes" }, ...TYPES_VOITURE].forEach(opt => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "filter-chip" + (opt.id === activeType ? " active" : "");
      chip.setAttribute("aria-pressed", String(opt.id === activeType));
      chip.textContent = t(opt.label);
      chip.addEventListener("click", () => {
        activeType = opt.id;
        renderFilterBar();
        renderGrid();
      });
      scroller.appendChild(chip);
    });
    return scroller;
  }

  // Les critères techniques restent dans le panneau secondaire.
  function renderCarFilters() {
    const details = document.createElement("details");
    details.className = "filters-drawer";
    details.open = filtersWereOpen;
    const summary = document.createElement("summary");
    summary.textContent = "Filtres";
    details.appendChild(summary);

    details.appendChild(renderFilterGroup("Motorisation", [
      { id: "petrol-diesel", label: "Essence / Diesel" },
      { id: "hybrid", label: "Hybride" },
      { id: "electric", label: "Électrique" }
    ], o => o.id, activeFuel, v => { activeFuel = v; }));
    details.appendChild(renderFilterGroup("Boîte de vitesses", [
      { id: true, label: "Automatique seulement" }
    ], o => o.id, activeAutoOnly, v => { activeAutoOnly = Boolean(v); }));
    details.appendChild(renderFilterGroup("Nombre de places", [2, 4, 5, 7, 9].map(n => ({ id: n, label: String(n) })), o => o.id, activeSeats, v => { activeSeats = v; }));

    return details;
  }

  function renderFilterBar() {
    if (!filterBar) return;
    const existingDetails = filterBar.querySelector(".filters-drawer");
    if (existingDetails) filtersWereOpen = existingDetails.open;
    filterBar.innerHTML = "";
    filterBar.appendChild(renderFamilyTabs());
    if (activeFamily === "car") {
      filterBar.appendChild(renderCategories());
      filterBar.appendChild(renderCarFilters());
    }
  }

  function renderGrid() {
    const liste = vehiculeCible ? [vehiculeCible] : vehiculesFiltres();
    grid.innerHTML = "";
    if (liste.length === 0) {
      const message = "Aucun véhicule ne correspond à cette recherche pour le moment.";
      grid.innerHTML = `<div class="empty-state">${message}</div>`;
      return;
    }
    liste.forEach(v => {
      // Le total affiché tient compte de la réduction durée (5 jours ou
      // plus, voir REDUCTIONS_DUREE dans js/data.js) dès la page catalogue :
      // le client voit l'avantage avant même de choisir son véhicule.
      const prixInfo = calculerPrixTotal({
        vehiculeId: v.id,
        dateDebut: recherche.dateDebut,
        heureDebut: recherche.heureDebut,
        dateFin: recherche.dateFin,
        heureFin: recherche.heureFin
      });
      const total = prixInfo ? prixInfo.total : v.prixJour * jours;
      const remise = prixInfo && prixInfo.reductionDuree ? prixInfo.reductionDuree : null;
      // bookingMode (voir js/data.js) : "instant" = paiement en ligne
      // immédiat (parcours inchangé) ; "request" = demande sans paiement.
      const estInstant = v.bookingMode !== "request";
      const card = document.createElement("article");
      card.className = "vehicle-card vehicle-card-clickable";
      card.id = `vehicule-${v.id}`;
      const nbPhotos = v.photos ? v.photos.length : 0;
      const carburant = CARBURANTS.find((item) => item.id === v.fuel);
      const specsEssentielles = [
        v.places ? `<span>${vehicleSpecSvg("seats")} ${t(`${v.places} places`)}</span>` : "",
        v.transmission ? `<span>${vehicleSpecSvg("transmission")} ${t(v.transmission)}</span>` : "",
        carburant ? `<span>${vehicleSpecSvg("fuel")} ${t(carburant.label)}</span>` : ""
      ].filter(Boolean).join("");
      card.innerHTML = `
        <div class="vehicle-media"${nbPhotos ? ` data-gallery="${v.id}"` : ""}>
          ${pictureVehicule(v, "vehicle-photo", true)}
          ${nbPhotos > 1 ? `<span class="vehicle-photo-count">${nbPhotos}</span>` : ""}
          <span class="vehicle-emoji-fallback">${v.emoji}</span>
        </div>
        <div class="vehicle-body">
          <div class="vehicle-category">${v.categorie}</div>
          <div class="vehicle-name">${v.nom}${v.modelGuaranteed === false ? ' <span class="hint-text">ou similaire</span>' : ""}</div>
          ${!estInstant ? `<div class="booking-mode-badge is-request">${t("Disponibilité à confirmer")}</div>` : ""}
          <div class="vehicle-specs">${specsEssentielles}</div>
          ${v.specsOnRequest ? "" : `<details class="vehicle-details">
            <summary>${t("Détails du véhicule")}</summary>
            <div><span>${v.portes ? `${v.portes} ${t("portes")}` : ""}</span><span>${t(v.clim ? "Climatisation" : "Sans clim")}</span></div>
          </details>`}
          ${v.modelGuaranteed === false ? '<p class="hint-text">Le modèle présenté est indicatif. Un véhicule de catégorie équivalente peut être proposé.</p>' : ""}
          <div class="vehicle-footer">
            ${estInstant
              ? `<div class="price"><span class="price-label">${t("Tarif pour {jours}", { jours: libelleJours(jours) })}</span><strong>${formatEUR(total)}</strong></div>`
              : `<div class="price price-request">${t("Tarif sur demande")}<small>${t("Disponibilité à confirmer")}</small></div>`}
            <button class="btn btn-primary btn-sm" data-id="${v.id}">${estInstant ? t("Choisir ce véhicule") : t(v.id === "sans-permis-request" ? "Faire une demande" : "Demander ce véhicule")}</button>
          </div>
        </div>
      `;
      const choisirVehicule = () => {
        if (estInstant) {
          writeReservationLocal({
            vehiculeId: v.id,
            ...recherche,
            jours
          });
          allerVers("reservation.html");
        } else {
          ouvrirDemandeVehicule(v, recherche);
        }
      };
      card.querySelector(".vehicle-footer .btn").addEventListener("click", choisirVehicule);
      card.addEventListener("click", (event) => {
        if (event.target.closest("button, details, .vehicle-media[data-gallery]")) return;
        choisirVehicule();
      });
      grid.appendChild(card);
    });
  }

  renderFilterBar();
  renderGrid();

  // Barre de dates persistante : le client peut ajuster ses dates ici même
  // sans revenir à l'accueil — la liste des véhicules et le total par
  // véhicule se recalculent immédiatement (voir P2-6 / demande client).
  initDateBar({
    getData: () => ({
      dateDebut: recherche.dateDebut,
      heureDebut: recherche.heureDebut,
      dateFin: recherche.dateFin,
      heureFin: recherche.heureFin,
      jours
    }),
    onApply: (nouvellesDates) => {
      Object.assign(recherche, nouvellesDates);
      writeJSON(STORAGE.recherche, recherche);
      jours = joursFacturablesDepuisHeures(
        dureeEnHeures(recherche.dateDebut, recherche.heureDebut, recherche.dateFin, recherche.heureFin)
      );
      renderGrid();
    }
  });
}

function ouvrirDemandeVehicule(vehicule, recherche) {
  const dialog = document.createElement("dialog");
  dialog.className = "vehicle-request-dialog";
  dialog.innerHTML = `<form method="dialog" class="vehicle-request-form">
    <button type="button" class="request-close" aria-label="${t("Fermer")}">×</button>
    <h2>${t("Faire une demande")}</h2>
    <p><strong>${vehicule.nom}</strong> · ${t("Disponibilité à confirmer")}</p>
    <p>${t("Nous vérifions la disponibilité avant tout paiement.")}</p>
    <label>${t("Votre nom")}<input name="name" autocomplete="name" maxlength="100" required></label>
    <label>${t("Votre adresse e-mail")}<input name="email" type="email" autocomplete="email" maxlength="200" required></label>
    <label>${t("Votre téléphone")}<input name="phone" type="tel" autocomplete="tel" maxlength="40" required></label>
    <p class="request-feedback" role="status" aria-live="polite"></p>
    <button type="submit" class="btn btn-primary">${t("Envoyer m…12524 tokens truncated…hicule = getVehiculeParId(data.vehiculeId);
  if (!vehicule) {
    allerVers("vehicules.html");
    return;
  }
  // Compatibilité : réservations en cours démarrées avant l'ajout des
  // options/code promo.
  if (!Array.isArray(data.options)) data.options = [];
  if ((data.lieuPrise === LIEU_LIVRAISON || data.lieuRetour === LIEU_LIVRAISON) && !data.options.includes("livraison-adresse")) {
    data.options.push("livraison-adresse");
    writeReservationLocal(data);
  }
  if (typeof data.codePromo !== "string") data.codePromo = "";

  // Le lieu de livraison est demandé ici, après le choix du véhicule et des
  // options, mais avant le paiement. Il reste dans les mêmes champs métier
  // qu'auparavant afin de préserver les réservations et les contrats.
  const deliveryFrequent = document.getElementById("payment-adresse-prise-frequent");
  const deliveryPrincipal = document.getElementById("payment-adresse-prise-principal");
  const deliveryOther = document.getElementById("payment-adresse-prise-other");
  const deliveryOtherToggle = document.getElementById("payment-adresse-prise-other-toggle");
  const deliveryCustomToggle = document.getElementById("payment-adresse-prise-custom-toggle");
  const returnFrequent = document.getElementById("payment-adresse-retour-frequent");
  const returnPrincipal = document.getElementById("payment-adresse-retour-principal");
  const returnOther = document.getElementById("payment-adresse-retour-other");
  const returnOtherToggle = document.getElementById("payment-adresse-retour-other-toggle");
  const returnToggle = document.getElementById("payment-retour-different");
  const deliveryCustom = document.getElementById("payment-adresse-prise-custom");
  const returnCustom = document.getElementById("payment-adresse-retour-custom");
  const returnWrap = document.getElementById("payment-adresse-retour-wrap");

  function createDeliveryInputs(container, suffix) {
    if (!container) return null;
    container.textContent = "";
    container.className = "field field-full custom-delivery-address";
    const inputs = {};
    [{ key: "rue", label: "Adresse", placeholder: "Numéro et rue", maxLength: 200 },
      { key: "codePostal", label: "Code postal", placeholder: "06000", maxLength: 5 },
      { key: "ville", label: "Ville", placeholder: "Nice", maxLength: 80 }].forEach(({ key, label, placeholder, maxLength }) => {
      const wrapper = document.createElement("label");
      wrapper.textContent = label;
      const input = document.createElement("input");
      input.type = "text";
      input.id = `payment-${suffix}-${key}`;
      input.placeholder = placeholder;
      input.maxLength = maxLength;
      input.required = false;
      wrapper.appendChild(input);
      container.appendChild(wrapper);
      inputs[key] = input;
    });
    return inputs;
  }

  const deliveryInputs = createDeliveryInputs(deliveryCustom, "adresse-prise");
  const returnInputs = createDeliveryInputs(returnCustom, "adresse-retour");

  function makeChoiceButton(container, value, type, selected, onSelect) {
    if (!container) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "delivery-choice";
    button.textContent = t(value);
    button.setAttribute("aria-pressed", String(selected));
    button.classList.toggle("is-selected", selected);
    button.addEventListener("click", () => onSelect(value, type));
    container.appendChild(button);
  }

  function createDeliveryPicker({ frequent, principal, other, otherToggle, customToggle, custom, inputs, initialValue, initialType, isReturn }) {
    const state = { value: initialValue || "", type: initialType || "" };
    const parsed = parseAdressePersonnalisee(state.value);
    if (parsed && inputs) Object.keys(inputs).forEach((key) => { inputs[key].value = parsed[key]; });
    if (parsed) state.type = "custom";

    function selected(value) { return state.value === value; }
    function openChoiceGroup(container) {
      const disclosure = container && container.closest("details.delivery-disclosure");
      if (!disclosure) return;
      const groupName = disclosure.getAttribute("name");
      if (groupName) {
        document.querySelectorAll(`details.delivery-disclosure[name="${groupName}"]`).forEach((item) => {
          if (item !== disclosure) item.open = false;
        });
      }
      disclosure.open = true;
    }
    function render() {
      [frequent, principal].forEach((container) => { if (container) container.textContent = ""; });
      LIEUX_FREQUENTS_LIVRAISON.forEach((value) => makeChoiceButton(frequent, value, "frequent", selected(value), choose));
      VILLES_PRINCIPALES_LIVRAISON.forEach((value) => makeChoiceButton(principal, value, "zone", selected(value), choose));
      if (other) {
        other.textContent = "";
        other.add(new Option("Choisissez une autre ville", "", true, true));
        other.options[0].disabled = true;
        VILLES_LIVRAISON.filter((value) => !LIEUX_FREQUENTS_LIVRAISON.includes(value) && !VILLES_PRINCIPALES_LIVRAISON.includes(value))
          .forEach((value) => other.add(new Option(t(value), value)));
        other.value = VILLES_PRINCIPALES_LIVRAISON.includes(state.value) || LIEUX_FREQUENTS_LIVRAISON.includes(state.value) ? "" : state.value;
        other.hidden = !other.value && !state.showOther;
      }
      if (custom) custom.style.display = state.type === "custom" ? "grid" : "none";
      if (inputs) Object.values(inputs).forEach((input) => { input.required = state.type === "custom"; });
      if (customToggle) customToggle.classList.toggle("is-selected", state.type === "custom");
      if (state.type === "frequent") openChoiceGroup(frequent);
      if (state.type === "zone" && VILLES_PRINCIPALES_LIVRAISON.includes(state.value)) openChoiceGroup(principal);
    }
    function choose(value, type) {
      state.value = value;
      state.type = type;
      state.showOther = false;
      render();
    }
    if (otherToggle) otherToggle.addEventListener("click", () => { state.showOther = true; render(); if (other) other.focus(); });
    if (other) other.addEventListener("change", () => { if (other.value) choose(other.value, "zone"); });
    if (customToggle) customToggle.addEventListener("click", () => {
      state.type = "custom";
      state.value = ADRESSE_PERSONNALISEE;
      state.showOther = false;
      render();
      if (inputs && inputs.rue) inputs.rue.focus();
    });
    render();
    return {
      getValue() {
        if (state.type !== "custom") return { value: state.value, type: state.type };
        return { value: formatAdressePersonnalisee(inputs.rue.value, inputs.codePostal.value, inputs.ville.value), type: "custom" };
      },
      setValue(value, type) { state.value = value || ""; state.type = type || ""; render(); },
      isReturn
    };
  }

  const initialTypePrise = data.lieuPriseType || (parseAdressePersonnalisee(data.adressePrise) ? "custom" : (LIEUX_FREQUENTS_LIVRAISON.includes(data.adressePrise) ? "frequent" : "zone"));
  const initialTypeRetour = data.lieuRetourType || (parseAdressePersonnalisee(data.adresseRetour) ? "custom" : (LIEUX_FREQUENTS_LIVRAISON.includes(data.adresseRetour) ? "frequent" : "zone"));
  const deliveryPicker = createDeliveryPicker({ frequent: deliveryFrequent, principal: deliveryPrincipal, other: deliveryOther, otherToggle: deliveryOtherToggle, customToggle: deliveryCustomToggle, custom: deliveryCustom, inputs: deliveryInputs, initialValue: data.adressePrise, initialType: initialTypePrise });
  const deliveryDistanceInput = document.getElementById("payment-delivery-distance");
  if (deliveryDistanceInput && Number.isInteger(data.deliveryDistanceKm)) deliveryDistanceInput.value = String(data.deliveryDistanceKm);
  const returnPicker = createDeliveryPicker({ frequent: returnFrequent, principal: returnPrincipal, other: returnOther, otherToggle: returnOtherToggle, custom: returnCustom, inputs: returnInputs, initialValue: data.adresseRetour, initialType: initialTypeRetour, isReturn: true });
  if (data.adresseRetour && data.adresseRetour !== data.adressePrise) {
    if (returnToggle) returnToggle.checked = true;
    if (returnWrap) returnWrap.style.display = "flex";
  }
  if (returnToggle) returnToggle.addEventListener("change", () => {
    if (returnWrap) returnWrap.style.display = returnToggle.checked ? "flex" : "none";
    if (!returnToggle.checked) returnPicker.setValue("", "");
  });

  function validateDelivery() {
    const prise = deliveryPicker.getValue();
    const retour = returnToggle && returnToggle.checked ? returnPicker.getValue() : prise;
    const distance = deliveryDistanceInput ? Number(deliveryDistanceInput.value) : NaN;
    const distanceValide = Number.isInteger(distance) && distance >= 0 && distance <= 500;
    const ok = Boolean(prise.value && retour.value && distanceValide);
    const error = document.getElementById("err-payment-adresse-prise");
    if (error) error.textContent = !prise.value ? "Merci d'indiquer le lieu de livraison." : (!distanceValide ? "Merci d'indiquer une distance de livraison valide." : "");
    if (!prise && deliverySelect) deliverySelect.focus();
    if (ok) {
      data.lieuPrise = LIEU_LIVRAISON;
      data.lieuRetour = LIEU_LIVRAISON;
      data.adressePrise = prise.value;
      data.adresseRetour = retour.value;
      data.lieuPriseType = prise.type;
      data.lieuRetourType = retour.type;
      data.adresseExactePriseAConfirmer = prise.type === "zone";
      data.adresseExacteRetourAConfirmer = retour.type === "zone";
      data.deliveryDistanceKm = distance;
      writeReservationLocal(data);
    }
    return ok;
  }

  // Affichage strictement indicatif : le montant qui fait foi est
  // recalculé côté serveur lors de la création du paiement (voir
  // netlify/functions/create-payment.js). Le client n'envoie jamais
  // ce total au serveur.
  function renderSummary() {
    const prix = calculerPrixTotal({
      vehiculeId: data.vehiculeId,
      dateDebut: data.dateDebut,
      heureDebut: data.heureDebut,
      dateFin: data.dateFin,
      heureFin: data.heureFin,
      options: data.options,
      codePromo: data.codePromo,
      protection: data.protection,
      deliveryDistanceKm: data.deliveryDistanceKm,
      // Compatibilité avec un ancien panier déjà renseigné. Les nouvelles
      // réservations collectent cette information après paiement.
      permisDate: data.conducteur && data.conducteur.permisDate
    });
    if (!prix) return;
    buildPaymentSummary(summary, vehicule, data, prix);
    const totalCompact = document.getElementById("payment-summary-total");
    if (totalCompact) totalCompact.textContent = formatEUR(prix.total);
  }
  if (deliveryDistanceInput) deliveryDistanceInput.addEventListener("input", () => { data.deliveryDistanceKm = Number(deliveryDistanceInput.value); renderSummary(); });
  renderSummary();

  // Barre de dates persistante : le client peut encore ajuster ses dates ici,
  // au moment où il voit le prix final — ex. rajouter un jour — sans revenir
  // en arrière. `data` (référencé par le formulaire de paiement plus bas au
  // moment de l'envoi) est mis à jour en place, donc le paiement Mollie créé
  // au clic sur "Payer" utilisera toujours les dates les plus récentes.
  initDateBar({
    getData: () => ({ dateDebut: data.dateDebut, heureDebut: data.heureDebut, dateFin: data.dateFin, heureFin: data.heureFin, jours: data.jours }),
    onApply: (nouvellesDates) => {
      Object.assign(data, nouvellesDates);
      data.jours = joursFacturablesDepuisHeures(
        dureeEnHeures(data.dateDebut, data.heureDebut, data.dateFin, data.heureFin)
      );
      writeReservationLocal(data);
      renderSummary();
    }
  });

  const form = document.getElementById("payment-form");
  const payButton = document.getElementById("pay-button");
  const paymentErrors = document.getElementById("payment-errors");

  // Insère automatiquement les "/" pendant la saisie (JJ/MM/AAAA) : évite
  // de faire reposer la frappe manuelle des séparateurs sur l'utilisateur,
  // sans dépendre d'un composant de calendrier natif (dont le rendu — menu
  // déroulant, molette — varie trop d'un navigateur à l'autre).
  const naissanceInput = form.querySelector('[name="naissance"]');
  if (naissanceInput) {
    naissanceInput.addEventListener("input", () => insererSlashesDateFr(naissanceInput));
  }

  // Retour arrière sans perte : si le conducteur avait déjà rempli ces
  // champs (ex. retour depuis la page suivante via le bouton précédent du
  // navigateur), on pré-remplit plutôt que de les laisser vides.
  if (data.conducteur) {
    ["nom", "prenom", "email", "telephone", "naissance"].forEach((id) => {
      const input = form.querySelector(`[name="${id}"]`);
      if (input && data.conducteur[id] !== undefined) input.value = data.conducteur[id];
    });
  }

  // Générée une seule fois par chargement de page et réutilisée sur toute
  // nouvelle tentative de soumission : permet au serveur (via l'option
  // idempotencyKey transmise à Mollie) d'éviter de créer un second paiement
  // si l'utilisateur soumet plusieurs fois (double clic, retry réseau)
  // sans avoir rechargé la page.
  const idempotencyKey = (window.crypto && typeof crypto.randomUUID === "function")
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (paymentErrors) paymentErrors.textContent = "";

    if (!validateDelivery()) return;

    // Coordonnées d'abord (haut du formulaire), puis CGL — même ordre que
    // l'affichage, pour que le focus posé sur le premier champ en erreur
    // corresponde toujours à ce que le client voit.
    if (!validateDriverForm(form)) return;
    const formData = new FormData(form);
    data.conducteur = Object.fromEntries(formData.entries());
    writeReservationLocal(data);

    const cglCheckbox = document.getElementById("cgl-accept");
    const errCgl = document.getElementById("err-cgl-accept");
    if (cglCheckbox && !cglCheckbox.checked) {
      if (errCgl) errCgl.textContent = "Merci d'accepter les conditions générales de location et la politique de confidentialité avant de payer.";
      cglCheckbox.setAttribute("aria-invalid", "true");
      cglCheckbox.focus();
      return;
    }
    if (errCgl) errCgl.textContent = "";
    if (cglCheckbox) cglCheckbox.setAttribute("aria-invalid", "false");

    payButton.classList.add("loading");
    payButton.disabled = true;

    try {
      const response = await fetch(`/api/create-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Uniquement des paramètres MÉTIER : jamais de montant, devise ou
          // description — le serveur recalcule tout à partir de
          // js/data.js (voir AUDIT.md, P0).
          vehiculeId: data.vehiculeId,
          dateDebut: data.dateDebut,
          heureDebut: data.heureDebut,
          dateFin: data.dateFin,
          heureFin: data.heureFin,
          lieuPrise: data.lieuPrise,
          lieuRetour: data.lieuRetour,
          adressePrise: data.adressePrise,
          adresseRetour: data.adresseRetour,
          lieuPriseType: data.lieuPriseType,
          lieuRetourType: data.lieuRetourType,
          adresseExactePriseAConfirmer: data.adresseExactePriseAConfirmer,
          adresseExacteRetourAConfirmer: data.adresseExacteRetourAConfirmer,
          options: data.options,
          codePromo: data.codePromo,
          protection: data.protection,
          deliveryDistanceKm: data.deliveryDistanceKm,
          // Le champ "naissance" est saisi et persisté localement au format
          // JJ/MM/AAAA (affichage) ; le serveur (et la clé du même nom
          // stockée dans la réservation) attend systématiquement le format
          // ISO YYYY-MM-DD — seule cette copie envoyée au réseau est
          // convertie, jamais `data.conducteur` lui-même (qui doit rester
          // au format du champ pour un pré-remplissage correct au retour).
          conducteur: {
            ...data.conducteur,
            naissance: naissanceFrVersISO(data.conducteur.naissance)
          },
          // Précisions rattachées à une option : transmises seulement quand
          // l'option correspondante est réellement retenue.
          enfantAge: data.options.includes("siege-enfant") ? data.enfantAge : undefined,
          enfantPoids: data.options.includes("siege-enfant") ? data.enfantPoids : undefined,
          cglAccepted: true,
          cglVersion: CGL_VERSION,
          // Langue dans laquelle le client a réservé : sert plus tard aux
          // e-mails, au WhatsApp et au contrat. Purement informatif, aucune
          // règle de prix ou de disponibilité n'en dépend.
          langue: langueSite(),
          idempotencyKey
        })
      });
      const result = await response.json().catch(() => ({}));

      if (response.status === 503 && result.code === "mollie_not_configured") {
        showPaymentUnavailableFallback("Le paiement en ligne n'est pas encore disponible. Contactez-nous pour finaliser votre réservation :");
        return;
      }
      if (response.status === 409 && result.code === "not_available") {
        throw new Error("Ce véhicule vient d'être réservé sur ces dates. Merci de modifier vos dates ou de choisir un autre véhicule.");
      }
      if (response.status === 429) {
        throw new Error("Trop de tentatives. Merci de patienter quelques instants avant de réessayer.");
      }
      if (!response.ok || result.error || !result.checkoutUrl || !result.reservationId) {
        throw new Error("Le paiement n'a pas pu être initialisé. Merci de réessayer.");
      }

      // La confirmation qui fait foi vit côté serveur (reservation-status,
      // confirmée par mollie-webhook après revérification auprès de
      // l'API Mollie) : la copie locale temporaire des données conducteur
      // (dont la date de naissance) n'est plus nécessaire dans ce navigateur.
      clearJSON(STORAGE.reservation);
      // Redirection vers la page de paiement hébergée par Mollie ; Mollie
      // renvoie ensuite le client vers confirmation.html (redirectUrl fixée
      // côté serveur lors de la création du paiement).
      window.location.href = result.checkoutUrl;
    } catch (err) {
      if (paymentErrors) paymentErrors.textContent = err.message;
      payButton.classList.remove("loading");
      payButton.disabled = false;
    }
  });
}

/* ---------------------------------------------------------
   PAGE : confirmation.html
--------------------------------------------------------- */
// PAGE : confirmation.html — la confirmation fait TOUJOURS foi côté
// serveur (endpoint /.netlify/functions/reservation-status), jamais sur la
// seule base de ce que le navigateur a stocké en localStorage (qui peut
// être absent, périmé, ou modifié). L'identifiant de réservation arrive
// via le paramètre d'URL ?reservation=res_xxx, fixé côté serveur dans le
// `redirectUrl` transmis à Mollie lors de la création du paiement (voir
// netlify/functions/create-payment.js) — Mollie y renvoie le client une
// fois le paiement terminé.
//
// Rendu construit exclusivement via createElement/textContent (jamais
// innerHTML) pour les valeurs issues du conducteur (nom/prénom/e-mail) ou
// d'une adresse de livraison saisie par l'utilisateur : ces valeurs ne
// doivent jamais être interprétées comme du HTML (protection XSS).
function initConfirmationPage() {
  const container = document.getElementById("confirmation-details");
  if (!container) return;

  const params = new URLSearchParams(window.location.search);
  const reservationId = params.get("reservation");

  if (!reservationId || !/^res_[a-f0-9]{32}$/.test(reservationId)) {
    allerVers("index.html");
    return;
  }

  container.textContent = "Chargement de votre confirmation…";

  fetch(`/api/reservation-status?id=${encodeURIComponent(reservationId)}`)
    .then((response) => {
      if (!response.ok) throw new Error("reservation_status_error");
      return response.json();
    })
    .then((data) => {
      if (data.status === "paid") {
        const refEl = document.getElementById("confirmation-ref");
        if (refEl) refEl.textContent = "GL-" + data.id.slice(-8).toUpperCase();
        renderConfirmationDetails(container, data);
      } else {
        renderConfirmationPendingOrError(container, data.status);
      }
    })
    .catch(() => {
      renderConfirmationPendingOrError(container, null);
    });
}

// Construit les lignes détaillées du prix (sous-total, remise durée,
// assurance, options, code promo, total) à partir d'un objet retourné par
// calculerPrixTotal() — ou de la vue publique équivalente renvoyée par
// /.netlify/functions/reservation-status (voir renderConfirmationDetails).
// Réutilisé sur reservation.html, paiement.html et confirmation.html pour
// garantir un affichage cohérent du détail du prix sur tout le tunnel.
function appendBreakdownRows(container, prix) {
  container.appendChild(summaryRow(t("Location ({jours})", { jours: libelleJours(prix.jours) }), formatEUR(prix.sousTotalBrut)));

  if (prix.reductionDuree) {
    const row = summaryRow(
      t("Remise durée ({palier}, -{taux}%)", { palier: t(prix.reductionDuree.libelle), taux: Math.round(prix.reductionDuree.taux * 100) }),
      `− ${formatEUR(prix.reductionDuree.montant)}`
    );
    row.classList.add("discount");
    container.appendChild(row);
  }

  (prix.optionsSelectionnees || []).forEach((opt) => {
    // Le nom de l'option vient de js/data.js, donc en français : sa
    // traduction est indexée sur ce texte dans js/i18n.js.
    container.appendChild(summaryRow(t(opt.nom), formatEUR(opt.montant)));
  });

  if (Number.isFinite(prix.kmInclus)) {
    container.appendChild(summaryRow(t("Kilométrage inclus"), `${prix.kmInclus.toLocaleString("fr-FR")} km`));
  }

  // Protection : toujours affichée, y compris la formule incluse — le client
  // doit voir laquelle s'applique, pas seulement ce qu'elle coûte.
  if (prix.protection) {
    const protection = prix.protection;
    const ligne = summaryRow(
      protection.plafonne
        ? t("Protection {nom} (forfait plafonné à {jours})", { nom: t(protection.nom), jours: libelleJours(protection.joursFactures) })
        : t("Protection {nom} — {jours}", { nom: t(protection.nom), jours: libelleJours(prix.jours) }),
      protection.montant > 0 ? formatEUR(protection.montant) : t("Incluse")
    );
    container.appendChild(ligne);
  }

  // Supplément jeune conducteur : ligne affichée UNIQUEMENT quand il
  // s'applique (permis de moins de 3 ans), jamais une ligne à zéro.
  if (prix.supplementJeuneConducteur) {
    container.appendChild(summaryRow(
      t("Supplément jeune conducteur — {jours}", { jours: libelleJours(prix.jours) }),
      formatEUR(prix.supplementJeuneConducteur.montant)
    ));
  }

  if (prix.codePromo) {
    // .pourcentage OU .montant selon le type de code (voir CODES_PROMO,
    // js/data.js) — jamais les deux à la fois.
    const suffixePromo = prix.codePromo.pourcentage !== undefined ? `-${prix.codePromo.pourcentage}%` : `-${formatEUR(prix.codePromo.montant)}`;
    const row = summaryRow(
      t("Code promo {code} ({remise})", { code: prix.codePromo.code, remise: suffixePromo }),
      `− ${formatEUR(prix.reductionPromoMontant)}`
    );
    row.classList.add("discount");
    container.appendChild(row);
  }

  const totalRow = summaryRow("Total", formatEUR(prix.total));
  totalRow.classList.add("total");
  container.appendChild(totalRow);

  // Le dépôt reste toujours séparé du prix payé : il s'agit d'une
  // préautorisation bancaire, non d'un élément du total de la réservation.
  if (Number.isFinite(prix.caution)) {
    const depositRow = summaryRow(t("Dépôt de garantie"), `${formatEUR(prix.caution)} — ${t("préautorisation bancaire, non débitée sauf frais, dommages ou sommes restant dues")}`);
    depositRow.classList.add("summary-deposit");
    container.appendChild(depositRow);
  }
}

function summaryRow(label, value) {
  const row = document.createElement("div");
  row.className = "summary-row";
  const labelEl = document.createElement("span");
  labelEl.textContent = label;
  const valueEl = document.createElement("span");
  valueEl.textContent = value;
  row.append(labelEl, valueEl);
  return row;
}

function renderConfirmationDetails(container, data) {
  container.textContent = "";
  const vehicule = data.vehicule ? getVehiculeParId(data.vehicule.id) : null;

  const vehicleBlock = document.createElement("div");
  vehicleBlock.className = "summary-vehicle";
  if (vehicule) {
    vehicleBlock.innerHTML = vignetteVehicule(vehicule); // sûr : données véhicule internes uniquement
  }

  const infoDiv = document.createElement("div");
  const nameDiv = document.createElement("div");
  nameDiv.className = "vehicle-name";
  nameDiv.textContent = vehicule ? vehicule.nom : "Véhicule";
  const routeDiv = document.createElement("div");
  routeDiv.className = "hint-text";
  routeDiv.textContent = `${libelleLieu(data.lieuPrise, data.adressePrise, data.lieuPriseType) || ""} → ${libelleLieu(data.lieuRetour, data.adresseRetour, data.lieuRetourType) || ""}`;
  const datesDiv = document.createElement("div");
  datesDiv.className = "hint-text";
  datesDiv.textContent = `${formatDateHeureFR(data.dateDebut, data.heureDebut)} — ${formatDateHeureFR(data.dateFin, data.heureFin)} (${libelleJours(data.jours)})`;
  infoDiv.append(nameDiv, routeDiv, datesDiv);
  vehicleBlock.appendChild(infoDiv);
  container.appendChild(vehicleBlock);

  if (data.conducteur) {
    container.appendChild(summaryRow("Conducteur", `${data.conducteur.prenom} ${data.conducteur.nom}`));
    container.appendChild(summaryRow("E-mail", data.conducteur.email));
  }

  // La vue publique renvoyée par reservation-status.js expose les mêmes
  // champs que calculerPrixTotal(), à l'exception d'"options" (au lieu
  // d'"optionsSelectionnees") — réutilisation directe d'appendBreakdownRows.
  if (typeof data.sousTotalBrut === "number") {
    appendBreakdownRows(container, { ...data, optionsSelectionnees: data.options });
  } else {
    // Repli pour d'anciennes réservations enregistrées avant l'ajout du
    // détail complet (sousTotalBrut/options/codePromo absents en base).
    container.appendChild(summaryRow("Paiement", "Confirmé via Mollie"));
    const totalRow = summaryRow("Montant réglé", formatEUR(data.total));
    totalRow.classList.add("total");
    container.appendChild(totalRow);
  }
}

function renderConfirmationPendingOrError(container, status) {
  container.textContent = "";
  const msg = document.createElement("p");
  msg.className = "hint-text";
  msg.setAttribute("aria-live", "polite");
  if (status === "pending_payment") {
    msg.textContent = "Votre paiement est en cours de confirmation. Rafraîchissez cette page dans quelques instants.";
  } else if (status === "cancelled" || status === "expired") {
    msg.textContent = "Cette réservation n'a pas abouti (paiement refusé, annulé ou expiré). Contactez-nous si vous pensez qu'il s'agit d'une erreur.";
  } else {
    msg.textContent = "Impossible de retrouver cette réservation pour le moment. Si vous venez de payer, patientez quelques instants puis rafraîchissez la page.";
  }
  container.appendChild(msg);
}

/* ---------------------------------------------------------
   PAGE : documents.html — dépôt sécurisé post-paiement
--------------------------------------------------------- */
function initDocumentsPage() {
  const form = document.getElementById("documents-form");
  if (!form) return;
  const loading = document.getElementById("documents-loading");
  const errorCard = document.getElementById("documents-error");
  const errorText = document.getElementById("documents-error-text");
  const success = document.getElementById("documents-success");
  const submitError = document.getElementById("documents-submit-error");
  const submitButton = document.getElementById("documents-submit");

  // Champs date saisis au format JJ/MM/AAAA (voir insererSlashesDateFr) :
  // convertis en YYYY-MM-DD avant envoi juste avant la soumission (voir plus
  // bas), format attendu par le serveur (validate-document-upload.js).
  const DATE_FIELDS_JJMMAAAA = ["birthDate", "permitDate", "secondDriverPermitDate"];
  DATE_FIELDS_JJMMAAAA.forEach((name) => {
    const input = form.querySelector(`[name="${name}"]`);
    if (input) input.addEventListener("input", () => insererSlashesDateFr(input));
  });

  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const token = fragment.get("token") || "";
  // Retire immédiatement le secret de la barre d'adresse et de l'historique.
  if (window.location.hash) history.replaceState(null, "", window.location.pathname);

  function showAccessError(message) {
    loading.hidden = true;
    form.hidden = true;
    errorText.textContent = message;
    errorCard.hidden = false;
  }

  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    showAccessError("Ce lien est invalide ou a expiré. Ouvrez à nouveau le lien reçu par e-mail.");
    return;
  }

  fetch("/api/documents-access", { headers: { Authorization: `Bearer ${token}` } })
    .then(async (response) => {
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Lien invalide ou expiré");
      return body;
    })
    .then((access) => {
      loading.hidden = true;
      document.getElementById("documents-reference").textContent = `Réservation ${access.reference} — ${access.vehicle ? access.vehicle.name : "véhicule"}`;
      const second = document.getElementById("second-driver-fields");
      second.hidden = !access.secondDriverRequired;
      second.querySelectorAll("input").forEach((input) => { input.required = !!access.secondDriverRequired; });
      const delivery = document.getElementById("delivery-fields");
      delivery.hidden = !access.deliveryAddressRequired;
      document.getElementById("deliveryAddress").required = !!access.deliveryAddressRequired;
      if (access.deliveryAddressPrefill) document.getElementById("deliveryAddress").value = access.deliveryAddressPrefill;
      if (access.documentsStatus === "submitted") submitButton.textContent = "Remplacer mon dossier";
      form.hidden = false;
    })
    .catch((err) => showAccessError(err.message));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submitError.textContent = "";
    if (!form.reportValidity()) return;

    // Convertit chaque date JJ/MM/AAAA saisie en YYYY-MM-DD (voir
    // DATE_FIELDS_JJMMAAAA plus haut) — champ ignoré s'il est vide et non
    // requis (ex. secondDriverPermitDate sans second conducteur).
    const datesISO = {};
    for (const name of DATE_FIELDS_JJMMAAAA) {
      const input = form.querySelector(`[name="${name}"]`);
      if (!input || (!input.value.trim() && !input.required)) continue;
      const iso = naissanceFrVersISO(input.value);
      if (!iso) {
        const label = document.querySelector(`label[for="${name}"]`);
        submitError.textContent = t("Date invalide (JJ/MM/AAAA attendu) : {champ}.", { champ: label ? label.textContent : name });
        input.focus();
        return;
      }
      datesISO[name] = iso;
    }

    const files = [...form.querySelectorAll('input[type="file"]')]
      .filter((input) => input.required || input.files.length)
      .flatMap((input) => [...input.files]);
    if (files.some((file) => file.size > 8 * 1024 * 1024)) {
      submitError.textContent = "Chaque fichier doit faire moins de 8 Mo.";
      return;
    }
    submitButton.disabled = true;
    submitButton.textContent = "Envoi en cours…";
    try {
      const formData = new FormData(form);
      Object.entries(datesISO).forEach(([name, iso]) => formData.set(name, iso));
      const response = await fetch("/api/documents-submit", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "L'envoi a échoué");
      form.hidden = true;
      success.hidden = false;
    } catch (err) {
      submitError.textContent = err.message;
      submitButton.disabled = false;
      submitButton.textContent = "Envoyer mon dossier";
    }
  });
}

function initAgencyDocumentsPage() {
  const content = document.getElementById("agency-documents-content");
  if (!content) return;
  const loading = document.getElementById("agency-documents-loading");
  const errorCard = document.getElementById("agency-documents-error");
  const errorText = document.getElementById("agency-documents-error-text");
  const downloadError = document.getElementById("agency-documents-download-error");
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const token = fragment.get("token") || "";
  if (window.location.hash) history.replaceState(null, "", window.location.pathname);

  function fail(message) {
    loading.hidden = true;
    content.hidden = true;
    errorText.textContent = message;
    errorCard.hidden = false;
  }

  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    fail("Ce lien est invalide ou a expiré.");
    return;
  }

  fetch("/api/agency-documents-access", { headers: { Authorization: `Bearer ${token}` } })
    .then(async (response) => {
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Accès indisponible");
      return body;
    })
    .then((dossier) => {
      loading.hidden = true;
      document.getElementById("agency-documents-reference").textContent = `Réservation ${dossier.reference}`;
      document.getElementById("agency-documents-meta").textContent = `${dossier.vehicle} — dossier reçu le ${new Date(dossier.submittedAt).toLocaleString("fr-FR")}`;
      const list = document.getElementById("agency-documents-list");
      dossier.files.forEach((file) => {
        const row = document.createElement("p");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "btn btn-secondary";
        button.textContent = t("Télécharger {type}", { type: file.type });
        button.addEventListener("click", async () => {
          downloadError.textContent = "";
          button.disabled = true;
          try {
            const response = await fetch(`/api/agency-document-file?file=${encodeURIComponent(file.id)}`, { headers: { Authorization: `Bearer ${token}` } });
            if (!response.ok) throw new Error("Téléchargement impossible");
            const blobUrl = URL.createObjectURL(await response.blob());
            const anchor = document.createElement("a");
            anchor.href = blobUrl;
            anchor.download = "";
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
          } catch (err) {
            downloadError.textContent = err.message;
          } finally {
            button.disabled = false;
          }
        });
        row.appendChild(button);
        list.appendChild(row);
      });
      content.hidden = false;
    })
    .catch((err) => fail(err.message));
}

/* ---------------------------------------------------------
   Section "Avis clients".
   Les anciens témoignages étaient des exemples de démonstration
   (faux noms, fausses citations) : les présenter comme de vrais avis
   clients serait trompeur, donc ils ont été retirés (cf. AUDIT.md, P1).
   Cette fonction affiche à la place un état neutre et honnête, sans
   inventer d'avis ni de note. Aucun balisage Schema.org Review/
   AggregateRating ne doit être ajouté tant qu'il n'y a pas de vrais avis
   vérifiables à afficher.
--------------------------------------------------------- */
function initTestimonialsSlider() {
  const root = document.querySelector(".testimonials");
  if (!root) return;
  const track = root.querySelector(".testimonial-track");
  const controls = root.querySelector(".testimonial-controls");
  if (!track) return;

  track.textContent = "";
  const notice = document.createElement("div");
  notice.className = "testimonial-slide active";
  const p = document.createElement("p");
  p.className = "hint-text";
  p.style.textAlign = "center";
  p.textContent = "Les avis de nos clients seront bientôt disponibles ici.";
  notice.appendChild(p);
  track.appendChild(notice);

  // Pas de plusieurs avis à faire défiler pour l'instant : les flèches et
  // points de navigation n'ont pas lieu d'être affichés.
  if (controls) controls.style.display = "none";
}

function initConversionUx() {
  const stickyCta = document.getElementById("mobile-availability-cta");
  const hero = document.querySelector(".hero");
  const searchForm = document.getElementById("search-form");
  const faq = document.getElementById("faq");
  const footer = document.querySelector(".site-footer");
  const equivalentCtas = Array.from(document.querySelectorAll('a[href="#search-form"]')).filter((element) => element !== stickyCta);

  function elementVisible(element) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    return rect.bottom > 0 && rect.top < window.innerHeight;
  }

  function updateStickyCta() {
    if (!stickyCta || !hero || !searchForm) return;
    const mobile = window.matchMedia("(max-width: 640px)").matches;
    const heroMostlyPassed = window.scrollY > hero.offsetHeight * 0.55;
    const equivalentVisible = equivalentCtas.some(elementVisible);
    const protectedContentVisible = elementVisible(faq) || elementVisible(footer);
    const visible = mobile && heroMostlyPassed && !elementVisible(searchForm) && !equivalentVisible && !protectedContentVisible;
    stickyCta.classList.toggle("is-visible", visible);
    document.body.classList.toggle("has-mobile-availability-cta", visible);
  }

  document.querySelectorAll("[data-conversion]").forEach((element) => {
    element.addEventListener("click", () => {
      const detail = { event: "conversion_click", action: element.dataset.conversion };
      window.dispatchEvent(new CustomEvent("getlocation:conversion", { detail }));
      if (Array.isArray(window.dataLayer)) window.dataLayer.push(detail);
    });
  });

  updateStickyCta();
  window.addEventListener("scroll", updateStickyCta, { passive: true });
  window.addEventListener("resize", updateStickyCta);
}

function initHomepageFooterGroups() {
  const groups = document.querySelectorAll(".homepage-footer .footer-group");
  if (!groups.length) return;
  const mobile = window.matchMedia("(max-width: 640px)");
  const sync = () => groups.forEach((group) => group.toggleAttribute("open", !mobile.matches));
  sync();
  mobile.addEventListener("change", sync);
}

document.addEventListener("DOMContentLoaded", () => {
  setFooterYear();
  syncHeaderHeightVar();
  initMobileMenu();
  initTimeSelects();
  initSearchForm();
  initVehiculesPage();
  initReservationPage();
  initPaiementPage();
  initConfirmationPage();
  initDocumentsPage();
  initAgencyDocumentsPage();
  initTestimonialsSlider();
  initConversionUx();
  initHomepageFooterGroups();
  initHomeVehicleLinks();
  initVehicleGalleries();
});

// Réajuste la position de la barre de dates persistante (--header-h) si la
// hauteur de l'en-tête change (rotation d'écran, ouverture du menu mobile
// qui n'affecte pas la hauteur mais par prudence en cas de futurs
// changements responsives).
window.addEventListener("resize", syncHeaderHeightVar);
