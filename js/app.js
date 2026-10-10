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

function libelleDureeEtFacturation(dateDebut, heureDebut, dateFin, heureFin, jours) {
  const heures = dureeEnHeures(dateDebut, heureDebut, dateFin, heureFin);
  if (!isFinite(heures) || heures >= 24) return libelleJours(jours);
  const minutes = Math.round(heures * 60);
  const texteHeures = minutes % 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60}` : `${minutes / 60} h`;
  return langueSite() === "en"
    ? `${texteHeures} — billed as ${libelleJours(jours)}`
    : `${texteHeures} — facturée comme ${libelleJours(jours)}`;
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

// Normalise uniquement les contrôles de date/heure : la règle métier reste
// celle de dureeEnHeures()/joursFacturablesPourPeriode(). Une location peut
// donc commencer et finir le même jour, à condition que le retour soit
// strictement postérieur au départ.
function corrigerPeriodeFormulaire(inputDebut, selectHeureDebut, inputFin, selectHeureFin) {
  if (!inputDebut || !selectHeureDebut || !inputFin || !selectHeureFin || !inputDebut.value) return;
  inputFin.min = inputDebut.value;
  if (!inputFin.value || inputFin.value < inputDebut.value) inputFin.value = inputDebut.value;
  if (inputFin.value !== inputDebut.value) return;

  const duree = dureeEnHeures(inputDebut.value, selectHeureDebut.value, inputFin.value, selectHeureFin.value);
  if (isFinite(duree) && duree > 0) return;
  const prochain = Array.from(selectHeureFin.options).find((option) => option.value > selectHeureDebut.value);
  if (prochain) {
    selectHeureFin.value = prochain.value;
    return;
  }
  // Cas limite : départ au dernier créneau de la journée. Le lendemain est
  // la seule période positive possible ; on choisit le premier horaire admis.
  const lendemain = new Date(`${inputDebut.value}T12:00:00`);
  lendemain.setDate(lendemain.getDate() + 1);
  inputFin.value = lendemain.toISOString().slice(0, 10);
  if (selectHeureFin.options.length) selectHeureFin.value = selectHeureFin.options[0].value;
}

// L'ancienne horloge était une image de fond dessinée à l'intérieur du
// <select>. Elle est volontairement supprimée : Safari iOS garde ainsi une
// seule zone pour le texte et son chevron natif, sans chevauchement.
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
      jours: libelleDureeEtFacturation(d.dateDebut, d.heureDebut, d.dateFin, d.heureFin, d.jours)
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
    corrigerPeriodeFormulaire(inputDebut, selectHeureDebut, inputFin, selectHeureFin);
  });
  [inputFin, selectHeureDebut, selectHeureFin].forEach((input) => input.addEventListener("change", () => {
    corrigerPeriodeFormulaire(inputDebut, selectHeureDebut, inputFin, selectHeureFin);
  }));

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
  inputFin.min = inputDebut.value;
  inputFin.value = todayISO(5);
  if (selectHeureDebut) selectHeureDebut.value = "10:00";
  if (selectHeureFin) selectHeureFin.value = "10:00";
  [selectHeureDebut, selectHeureFin].forEach((select) => {
    if (select) select.addEventListener("change", () => select.setCustomValidity(""));
  });

  // Si le retour est identique ou antérieur au départ, on conserve la même
  // date et propose le créneau suivant. Ce n'est que sans créneau restant
  // dans la journée que le retour passe au lendemain.
  function corrigerFinSiNecessaire() {
    corrigerPeriodeFormulaire(inputDebut, selectHeureDebut, inputFin, selectHeureFin);
  }

  inputDebut.addEventListener("change", () => {
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

  let rechercheEnregistree = readJSON(STORAGE.recherche, null);
  const recherche = rechercheEnregistree || {
    lieuPrise: LIEUX[0],
    lieuRetour: LIEUX[0],
    adressePrise: "",
    adresseRetour: "",
    dateDebut: todayISO(2),
    dateFin: todayISO(5),
    heureDebut: "10:00",
    heureFin: "10:00"
  };
  // Compatibilité : anciennes recherches enregistrées sans heure / adresse.
  if (!recherche.heureDebut) recherche.heureDebut = "10:00";
  if (!recherche.heureFin) recherche.heureFin = "10:00";
  if (!recherche.adressePrise) recherche.adressePrise = "";
  if (!recherche.adresseRetour) recherche.adresseRetour = "";

  // `jours` est recalculé (pas seulement à l'initialisation) quand le client
  // modifie ses dates depuis la barre de dates persistante (voir
  // initDateBar plus bas) — d'où le `let` plutôt qu'un `const`.
  let jours = joursFacturablesPourPeriode(recherche.dateDebut, recherche.heureDebut, recherche.dateFin, recherche.heureFin);

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
      // Aucun tarif n'est affiché tant que le client n'a pas réellement
      // validé ses dates dans la recherche : les valeurs par défaut de la
      // barre ne sont pas une estimation commerciale.
      const prixInfo = rechercheEnregistree && calculerPrixTotal({
        vehiculeId: v.id,
        dateDebut: recherche.dateDebut,
        heureDebut: recherche.heureDebut,
        dateFin: recherche.dateFin,
        heureFin: recherche.heureFin
      });
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
              ? (prixInfo
                ? `<div class="price price-vehicle"><strong>${formatPrixJour(prixInfo.presentationPrix.prixMoyenJour)} / ${t("jour")}</strong>${prixInfo.reductionDuree ? `<span class="price-before-discount">${formatPrixJour(prixInfo.sousTotalBrut / prixInfo.jours)} / ${t("jour")}</span><small>${t("Remise durée appliquée")}</small>` : ""}<span class="price-total">${formatPrixJour(prixInfo.presentationPrix.locationTTC)} ${t("total")}</span><button type="button" class="price-details-trigger" data-price-details>${t("Détails du prix")}</button></div>`
                : `<div class="price price-awaiting-dates"><span>${t("Sélectionnez vos dates pour voir le tarif")}</span></div>`)
              : `<div class="price price-request">${t("Tarif sur demande")}<small>${t("Disponibilité à confirmer")}</small></div>`}
            <button class="btn btn-primary btn-sm" data-id="${v.id}">${estInstant ? t("Choisir ce véhicule") : t(v.id === "sans-permis-request" ? "Faire une demande" : "Demander ce véhicule")}</button>
          </div>
        </div>
      `;
      const priceDetails = card.querySelector("[data-price-details]");
      if (priceDetails) priceDetails.addEventListener("click", (event) => { event.stopPropagation(); ouvrirDetailsPrix(prixInfo); });
      const choisirVehicule = () => {
        if (!rechercheEnregistree) {
          const dateBar = document.getElementById("date-bar");
          if (dateBar) { dateBar.scrollIntoView({ behavior: "smooth", block: "center" }); dateBar.querySelector("#date-bar-toggle")?.click(); }
          return;
        }
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
      rechercheEnregistree = recherche;
      jours = joursFacturablesPourPeriode(recherche.dateDebut, recherche.heureDebut, recherche.dateFin, recherche.heureFin);
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
    <button type="submit" class="btn btn-primary">${t("Envoyer ma demande")}</button>
  </form>`;
  document.body.appendChild(dialog);
  const close = () => { dialog.close(); dialog.remove(); };
  dialog.querySelector(".request-close").addEventListener("click", close);
  dialog.addEventListener("click", event => { if (event.target === dialog) close(); });
  dialog.addEventListener("close", () => dialog.remove());
  dialog.querySelector("form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('[type="submit"]');
    const feedback = form.querySelector(".request-feedback");
    submit.disabled = true;
    feedback.textContent = t("Envoi en cours…");
    const fields = new FormData(form);
    try {
      const response = await fetch("/api/vehicle-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vehicleId: vehicule.id,
          name: fields.get("name"), email: fields.get("email"), phone: fields.get("phone"),
          dateDebut: recherche.dateDebut, heureDebut: recherche.heureDebut,
          dateFin: recherche.dateFin, heureFin: recherche.heureFin,
          adressePrise: recherche.adressePrise || ""
        })
      });
      if (!response.ok) throw new Error("request failed");
      form.querySelectorAll("input").forEach(input => input.disabled = true);
      submit.remove();
      feedback.textContent = t("Demande envoyée. GET LOCATION vous recontactera après vérification de la disponibilité.");
    } catch (_) {
      feedback.textContent = t("Envoi impossible. Réessayez ou contactez-nous par téléphone.");
      submit.disabled = false;
    }
  });
  dialog.showModal();
}

// Rend les cartes de la flotte de l'accueil entièrement cliquables, tout en
// laissant leurs vrais liens/boutons fonctionner normalement. Le clavier
// (Entrée/Espace) bénéficie du même parcours que la souris.
function initHomeVehicleLinks() {
  document.querySelectorAll("[data-vehicle-link]").forEach((card) => {
    // Carte cliquable : même règle de langue que les liens classiques
    // (le visiteur anglais reste sur /en/…).
    const navigate = () => { allerVers(card.dataset.vehicleLink); };
    card.addEventListener("click", (event) => {
      if (event.target.closest("a, button")) return;
      navigate();
    });
    card.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      if (event.target.closest("a, button")) return;
      event.preventDefault();
      navigate();
    });
  });
}

// Langue de l'interface : dictée par l'URL (/en/…), voir js/i18n.js. Repli
// sur le français si le moteur de traduction n'est pas chargé (page agence).
function langueSite() {
  return (window.GLI18N && window.GLI18N.langue()) || "fr";
}
// Traduction d'un texte généré en JS. Sans le moteur de traduction (pages
// agence, qui ne le chargent pas), le texte français est conservé — mais ses
// variables restent substituées, sans quoi le gabarit s'afficherait tel quel.
function t(cle, variables) {
  if (window.GLI18N) return window.GLI18N.t(cle, variables);
  let resultat = cle;
  if (variables) {
    Object.keys(variables).forEach((nom) => {
      resultat = resultat.split(`{${nom}}`).join(String(variables[nom]));
    });
  }
  return resultat;
}

// Présentation des prix consommateurs : le moteur tarifaire fournit déjà un
// prix moyen exact. Cette fonction ne recalcule rien ; elle ne fait que
// l'afficher sans décimales inutiles (59 € plutôt que 59,00 €).
function formatPrixJour(montant) {
  const locale = langueSite() === "en" ? "en-GB" : "fr-FR";
  return new Intl.NumberFormat(locale, { style: "currency", currency: "EUR", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(montant);
}

function ouvrirDetailsPrix(prix) {
  const presentation = prix && prix.presentationPrix;
  if (!presentation) return;
  let dialog = document.getElementById("price-details-dialog");
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.id = "price-details-dialog";
    dialog.className = "price-details-dialog";
    document.body.appendChild(dialog);
  }
  dialog.textContent = "";
  const header = document.createElement("div");
  header.className = "price-details-header";
  const title = document.createElement("h2"); title.textContent = t("Détails du prix");
  const close = document.createElement("button"); close.type = "button"; close.className = "price-details-close"; close.setAttribute("aria-label", t("Fermer")); close.textContent = "×";
  close.addEventListener("click", () => { if (dialog.close) dialog.close(); else dialog.removeAttribute("open"); });
  header.append(title, close); dialog.appendChild(header);

  const addLine = (label, value, className) => {
    const row = summaryRow(label, value);
    if (className) row.classList.add(className);
    dialog.appendChild(row);
  };
  const rentalLabel = `${libelleJours(presentation.jours)} × ${t("tarif calculé")}`;
  addLine(t("Frais de location"), formatPrixJour(presentation.locationAvantRemise));
  const rentalHint = document.createElement("p"); rentalHint.className = "price-details-hint"; rentalHint.textContent = rentalLabel; dialog.appendChild(rentalHint);
  if (presentation.remiseDuree) addLine(t("Remise durée"), `− ${formatPrixJour(presentation.remiseDuree)}`, "discount");
  const taxTitle = document.createElement("h3"); taxTitle.textContent = t("Taxes"); dialog.appendChild(taxTitle);
  addLine(t("TVA 20 % incluse dans la location"), formatPrixJour(presentation.locationTVA));
  const otherLines = presentation.lignes.filter((line) => !["location", "remise-duree"].includes(line.id));
  if (otherLines.length) {
    const otherTitle = document.createElement("h3"); otherTitle.textContent = t("Autres éléments"); dialog.appendChild(otherTitle);
    otherLines.forEach((line) => addLine(t(line.libelle), `${line.montant < 0 ? "− " : ""}${formatPrixJour(Math.abs(line.montant))}`, line.montant < 0 ? "discount" : ""));
  }
  addLine(t("Total"), formatPrixJour(presentation.total), "total");
  const caveat = document.createElement("p"); caveat.className = "price-details-hint"; caveat.textContent = t("La TVA est déjà incluse dans le prix de location et n’est jamais ajoutée au total."); dialog.appendChild(caveat);
  if (dialog.showModal) dialog.showModal(); else dialog.setAttribute("open", "");
}

function appendPriceHighlights(container, prix) {
  const presentation = prix && prix.presentationPrix;
  if (!presentation) return;
  const block = document.createElement("div"); block.className = "price-highlights";
  const daily = document.createElement("strong"); daily.textContent = `${formatPrixJour(presentation.prixMoyenJour)} / ${t("jour")}`;
  const total = document.createElement("span"); total.textContent = `${formatPrixJour(presentation.total)} ${t("total")}`;
  block.append(daily);
  if (presentation.remiseDuree) {
    const previous = document.createElement("span"); previous.className = "price-before-discount"; previous.textContent = `${formatPrixJour(presentation.locationAvantRemise / presentation.jours)} / ${t("jour")}`;
    const discount = document.createElement("small"); discount.textContent = t("Remise durée appliquée");
    block.append(previous, discount);
  }
  block.appendChild(total);
  const details = document.createElement("button"); details.type = "button"; details.className = "price-details-trigger"; details.textContent = t("Détails du prix"); details.addEventListener("click", () => ouvrirDetailsPrix(prix));
  block.appendChild(details); container.appendChild(block);
}

// « 4 jours » / « 4 days » — le pluriel est porté par la traduction elle-même.
function libelleJours(nombre) {
  return t(nombre > 1 ? "{nombre} jours" : "{nombre} jour", { nombre });
}

// Navigation interne : garde le visiteur dans sa langue. Sans le moteur
// (pages agence), se comporte exactement comme avant.
function allerVers(page) {
  window.location.href = window.GLI18N ? window.GLI18N.urlVersLangue(page, window.GLI18N.langue()) : page;
}

function formatDateFR(iso) {
  const d = new Date(iso);
  // Les mois écrits en toutes lettres doivent suivre la langue affichée :
  // « 13 Sept 2026 » sur la version anglaise, « 13 sept. 2026 » en français.
  const locale = langueSite() === "en" ? "en-GB" : "fr-FR";
  return d.toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" });
}

// Vignette véhicule : affiche la vraie photo si le fichier images/xxx.jpg existe,
// sinon repli automatique sur l'emoji (aucune photo fournie pour l'instant).
// Génère un <picture> WebP + repli JPG + repli emoji, avec lazy loading et
// dimensions explicites (évite le layout shift / bon score CLS).
//
// preferCutout=true (grille catalogue vehicules.html) : affiche la photo
// détourée (fond transparent, catalogue façon comparateur) quand elle existe,
// tout en gardant data-gallery/le clic vers les vraies photos (voir l'appelant
// à la ligne ~353). preferCutout=false (résumé réservation/paiement, vignette
// plus petite) garde le comportement d'origine : vraie photo en priorité.
// Les chemins de photos de js/data.js sont RELATIFS ("images/opel-corsa.jpg") :
// justes à la racine du site, ils désignent "/en/images/opel-corsa.jpg" — donc
// rien du tout — sur une adresse anglaise, et la vignette retombait alors sur
// l'emoji de secours. On les rend absolus au moment de l'affichage : js/data.js
// reste la seule source de vérité (règle n°1 du CLAUDE.md), on ne fait que
// résoudre son chemin par rapport à la racine plutôt qu'à la page courante.
function cheminMedia(chemin) {
  const valeur = String(chemin || "").trim();
  if (!valeur || /^(https?:|data:|\/)/i.test(valeur)) return valeur;
  return "/" + valeur.replace(/^\.\//, "");
}

function pictureVehicule(v, imgClass, preferCutout = false) {
  if (preferCutout && v.photoCutout) {
    return `
      <picture>
        <img src="${cheminMedia(v.photoCutout)}" alt="${v.nom}" class="${imgClass} is-cutout" loading="lazy" decoding="async" width="900" height="620" onerror="this.classList.remove('is-cutout')">
      </picture>
    `;
  }
  if (v.photos && v.photos.length) {
    // Vraie photo professionnelle (première de la galerie) : image principale de la carte.
    const p0 = v.photos[0];
    return `
      <picture>
        <source srcset="${cheminMedia(p0.thumbWebp)} 700w, ${cheminMedia(p0.webp)} 1400w" sizes="(max-width: 480px) 90vw, 340px" type="image/webp">
        <img src="${cheminMedia(p0.thumbJpg)}" alt="${v.nom}" class="${imgClass}" loading="lazy" decoding="async" width="1400" height="1050" onerror="this.remove()">
      </picture>
    `;
  }
  if (v.photoCutout) {
    // Photo détourée (fond transparent) : object-fit:contain via la classe is-cutout,
    // le fond de la carte (gris très clair) fait office de socle.
    return `
      <picture>
        <img src="${cheminMedia(v.photoCutout)}" alt="${v.nom}" class="${imgClass} is-cutout" loading="lazy" decoding="async" width="900" height="620" onerror="this.classList.remove('is-cutout')">
      </picture>
    `;
  }
  const webp = cheminMedia(v.photo.replace(/\.jpe?g$/i, ".webp"));
  return `
    <picture>
      <source srcset="${webp}" type="image/webp">
      <img src="${cheminMedia(v.photo)}" alt="${v.nom}" class="${imgClass}" loading="lazy" decoding="async" width="1000" height="750" onerror="this.remove()">
    </picture>
  `;
}

/* ---------------------------------------------------------
   Galerie photo (lightbox) — ouverture au clic sur une vignette véhicule.
   Fonctionne sur toutes les pages listant des véhicules (accueil, catalogue,
   pages locales SEO) puisque VEHICULES / getVehiculeParId viennent de data.js.
--------------------------------------------------------- */
const galleryState = { photos: [], index: 0, vehiculeNom: "" };

function buildGalleryLightbox() {
  if (document.querySelector(".gallery-lightbox")) return document.querySelector(".gallery-lightbox");
  const el = document.createElement("div");
  el.className = "gallery-lightbox";
  el.innerHTML = `
    <div class="gallery-lightbox-inner">
      <div class="gallery-lightbox-frame">
        <button type="button" class="gallery-lightbox-close" aria-label="Fermer la galerie">✕</button>
        <button type="button" class="gallery-lightbox-arrow prev" aria-label="Photo précédente">‹</button>
        <picture>
          <source class="gallery-lightbox-source" type="image/webp">
          <img class="gallery-lightbox-img" alt="">
        </picture>
        <button type="button" class="gallery-lightbox-arrow next" aria-label="Photo suivante">›</button>
      </div>
      <div class="gallery-lightbox-caption"></div>
      <div class="gallery-lightbox-counter"></div>
      <div class="gallery-lightbox-swipe-hint">← Glissez pour naviguer →</div>
      <div class="gallery-lightbox-thumbs"></div>
    </div>
  `;
  document.body.appendChild(el);

  el.querySelector(".gallery-lightbox-close").addEventListener("click", closeGallery);
  el.addEventListener("click", (e) => { if (e.target === el) closeGallery(); });
  el.querySelector(".gallery-lightbox-arrow.prev").addEventListener("click", () => showGalleryIndex(galleryState.index - 1));
  el.querySelector(".gallery-lightbox-arrow.next").addEventListener("click", () => showGalleryIndex(galleryState.index + 1));

  document.addEventListener("keydown", (e) => {
    if (!el.classList.contains("is-open")) return;
    if (e.key === "Escape") closeGallery();
    if (e.key === "ArrowLeft") showGalleryIndex(galleryState.index - 1);
    if (e.key === "ArrowRight") showGalleryIndex(galleryState.index + 1);
  });

  // Support du swipe tactile (mobile) pour naviguer entre les photos.
  const frame = el.querySelector(".gallery-lightbox-frame");
  let touchStartX = 0;
  let touchStartY = 0;
  const SWIPE_THRESHOLD = 40;
  frame.addEventListener("touchstart", (e) => {
    touchStartX = e.changedTouches[0].clientX;
    touchStartY = e.changedTouches[0].clientY;
  }, { passive: true });
  frame.addEventListener("touchend", (e) => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > SWIPE_THRESHOLD) {
      if (dx < 0) showGalleryIndex(galleryState.index + 1);
      else showGalleryIndex(galleryState.index - 1);
    }
  }, { passive: true });

  return el;
}

function openGallery(vehiculeId, startIndex) {
  const v = typeof getVehiculeParId === "function" ? getVehiculeParId(vehiculeId) : null;
  if (!v || !v.photos || !v.photos.length) return;
  const el = buildGalleryLightbox();
  galleryState.photos = v.photos;
  galleryState.vehiculeNom = v.nom;
  showGalleryIndex(startIndex || 0);
  el.classList.add("is-open");
  document.body.style.overflow = "hidden";
}

function closeGallery() {
  const el = document.querySelector(".gallery-lightbox");
  if (el) el.classList.remove("is-open");
  document.body.style.overflow = "";
}

function showGalleryIndex(i) {
  const el = document.querySelector(".gallery-lightbox");
  if (!el) return;
  const photos = galleryState.photos;
  if (!photos.length) return;
  galleryState.index = (i + photos.length) % photos.length;
  const photo = photos[galleryState.index];

  el.querySelector(".gallery-lightbox-source").srcset = cheminMedia(photo.webp);
  const img = el.querySelector(".gallery-lightbox-img");
  img.src = cheminMedia(photo.jpg);
  img.alt = `${galleryState.vehiculeNom}${photo.legende ? " — " + photo.legende : ""}`;
  el.querySelector(".gallery-lightbox-caption").textContent = `${galleryState.vehiculeNom}${photo.legende ? " — " + photo.legende : ""}`;
  el.querySelector(".gallery-lightbox-counter").textContent = photos.length > 1 ? `${galleryState.index + 1} / ${photos.length}` : "";
  el.querySelectorAll(".gallery-lightbox-arrow").forEach(btn => { btn.style.display = photos.length > 1 ? "" : "none"; });

  const thumbs = el.querySelector(".gallery-lightbox-thumbs");
  thumbs.innerHTML = photos.length > 1
    ? photos.map((p, pi) => `<img src="${cheminMedia(p.thumbJpg)}" data-i="${pi}" class="${pi === galleryState.index ? "is-active" : ""}" alt="Photo ${pi + 1}">`).join("")
    : "";
  thumbs.querySelectorAll("img").forEach(t => t.addEventListener("click", () => showGalleryIndex(Number(t.dataset.i))));
}

function initVehicleGalleries() {
  document.addEventListener("click", (e) => {
    const media = e.target.closest("[data-gallery]");
    if (!media) return;
    // Sur l'accueil, la carte mène d'abord à la fiche du véhicule. La
    // galerie reste disponible sur cette fiche, dans vehicules.html.
    if (media.closest("[data-vehicle-link]")) return;
    openGallery(media.dataset.gallery, 0);
  });
}

function vignetteVehicule(v) {
  return `
    <div class="emoji">
      ${pictureVehicule(v, "vehicle-photo-sm")}
      <span class="vehicle-emoji-fallback-sm">${v.emoji}</span>
    </div>
  `;
}

/* ---------------------------------------------------------
   PAGE : reservation.html — infos conducteur
--------------------------------------------------------- */
function initReservationPage() {
  const container = document.getElementById("reservation-summary");
  if (!container) return;

  const data = readReservationLocal();
  if (!data) {
    allerVers("vehicules.html");
    return;
  }
  const vehicule = getVehiculeParId(data.vehiculeId);
  if (!vehicule) {
    allerVers("vehicules.html");
    return;
  }
  // Compatibilité : réservations en cours démarrées avant l'ajout des
  // options/code promo (localStorage déjà rempli sans ces champs).
  if (!Array.isArray(data.options)) data.options = [];
  // La livraison est le mode normal de GETLOCATION, plus une option que le
  // client pourrait décocher. Le serveur applique la même règle pour que le
  // prix ne dépende jamais de cette seule mise à jour navigateur.
  if ((data.lieuPrise === LIEU_LIVRAISON || data.lieuRetour === LIEU_LIVRAISON) && !data.options.includes("livraison-adresse")) {
    data.options.push("livraison-adresse");
    writeReservationLocal(data);
  }
  if (typeof data.codePromo !== "string") data.codePromo = "";

  // Réservation en cours démarrée avant les niveaux de protection : l'ancien
  // choix (« incluse » / « passagers ») est converti, et l'ancienne option
  // facturée séparément est retirée du panier — la protection
  // conducteur/passagers fait désormais partie de Sérénité+.
  const protectionAvant = data.protection;
  if (data.options.includes("assurance-passagers")) {
    data.options = data.options.filter((id) => id !== "assurance-passagers");
    if (!data.protection) data.protection = "serenite-plus";
  }
  if (data.protectionChoice !== undefined) delete data.protectionChoice;
  if (!estProtectionConnue(data.protection)) {
    data.protection = getProtectionParDefaut();
  }
  // La formule retenue est enregistrée dès l'arrivée sur l'étape : c'est
  // elle qui partira au serveur, et le client ne doit pas avoir à cliquer
  // pour confirmer un choix déjà affiché comme sélectionné.
  if (data.protection !== protectionAvant) writeReservationLocal(data);

  function prixCourant() {
    return calculerPrixTotal({
      vehiculeId: data.vehiculeId,
      dateDebut: data.dateDebut,
      heureDebut: data.heureDebut,
      dateFin: data.dateFin,
      heureFin: data.heureFin,
      options: data.options,
      codePromo: data.codePromo,
      protection: data.protection
    });
  }

  // Rendu via createElement/textContent (jamais innerHTML) pour les
  // valeurs pouvant contenir une saisie utilisateur (adresse de livraison
  // libre, code promo) : protection XSS, cf. AUDIT.md P0-7.
  function render() {
    const prix = prixCourant();
    if (!prix) return;

    container.textContent = "";

    const vehicleBlock = document.createElement("div");
    vehicleBlock.className = "summary-vehicle";
    vehicleBlock.innerHTML = vignetteVehicule(vehicule); // sûr : données véhicule internes uniquement

    const infoDiv = document.createElement("div");
    const nameDiv = document.createElement("div");
    nameDiv.className = "vehicle-name";
    nameDiv.textContent = vehicule.nom;
    const routeDiv = document.createElement("div");
    routeDiv.className = "hint-text";
    routeDiv.textContent = `${libelleLieu(data.lieuPrise, data.adressePrise, data.lieuPriseType)} → ${libelleLieu(data.lieuRetour, data.adresseRetour, data.lieuRetourType)}`;
    const datesDiv = document.createElement("div");
    datesDiv.className = "hint-text";
    datesDiv.textContent = `${formatDateHeureFR(data.dateDebut, data.heureDebut)} — ${formatDateHeureFR(data.dateFin, data.heureFin)} (${libelleDureeEtFacturation(data.dateDebut, data.heureDebut, data.dateFin, data.heureFin, data.jours)})`;
    infoDiv.append(nameDiv, routeDiv, datesDiv);
    vehicleBlock.appendChild(infoDiv);
    container.appendChild(vehicleBlock);

    appendBreakdownRows(container, prix);

    // Message de retour sur le code promo (succès/erreur), affiché sous le
    // champ de saisie — reflète toujours l'état réellement pris en compte
    // dans le total ci-dessus (jamais un état optimiste non calculé).
    const promoMessage = document.getElementById("promo-message");
    if (promoMessage) {
      if (!data.codePromo) {
        promoMessage.textContent = "";
        promoMessage.classList.remove("is-success");
      } else if (prix.codePromo) {
        // La remise est reformulée à partir des champs structurés plutôt que
        // du texte tout fait de js/data.js : même phrase en français, et une
        // seule traduction à maintenir au lieu d'une par code promo.
        const remisePromo = prix.codePromo.pourcentage !== undefined
          ? t("{pourcentage} % de réduction", { pourcentage: prix.codePromo.pourcentage })
          : t("{montant} € de réduction", { montant: prix.codePromo.montant });
        promoMessage.textContent = t('Code "{code}" appliqué : {remise}.', { code: prix.codePromo.code, remise: remisePromo });
        promoMessage.classList.add("is-success");
      } else if (data._codePromoTestValide === true) {
        // Code de test interne (TEST_DISCOUNT_CODE) : jamais dans le
        // catalogue public (js/data.js), donc invisible de calculerPrixTotal
        // ci-dessus — sa validité est confirmée par le serveur (voir
        // verifierCodeDeTest) sans jamais exposer le secret lui-même. Le
        // total affiché ci-dessus n'est volontairement pas modifié : seul
        // le serveur applique réellement la réduction, au moment du paiement.
        promoMessage.textContent = `Code "${data.codePromo}" reconnu (code de test interne) : le montant sera ramené à 0,10 € lors du paiement Mollie — le total ci-dessus reste indicatif.`;
        promoMessage.classList.add("is-success");
      } else if (data._codePromoTestValide === null) {
        promoMessage.textContent = "Vérification du code…";
        promoMessage.classList.remove("is-success");
      } else {
        promoMessage.textContent = "Code promo invalide ou expiré.";
        promoMessage.classList.remove("is-success");
      }
    }
  }

  // Étape dédiée à la protection : quatre niveaux comparables, un seul
  // sélectionnable. La formule incluse est retenue par défaut, donc l'étape
  // n'est jamais bloquante — le client peut continuer sans rien changer.
  // Tous les montants et garanties viennent de js/data.js. Les notions
  // juridiques détaillées restent dans le contrat et les CGL.
  const protectionList = document.getElementById("protection-list");
  const continueToOptions = document.getElementById("continue-to-options");
  const protectionError = document.getElementById("protection-error");

  // Niveau visuel explicite, fondé sur l'étendue réelle des garanties et
  // indépendant du prix. Les quatre offres existantes tiennent ainsi dans
  // trois niveaux de comparaison sans modifier le catalogue métier.
  const PROTECTION_COVERAGE_LEVELS = Object.freeze({
    essentiel: 0,
    confort: 1,
    serenite: 2,
    "serenite-plus": 3
  });

  function niveauProtection(protection) {
    return PROTECTION_COVERAGE_LEVELS[protection.id] ?? 1;
  }

  function selectProtection(value) {
    data.protection = value;
    writeReservationLocal(data);
    if (protectionError) protectionError.textContent = "";
    document.querySelectorAll(".protection-card").forEach((card) => {
      card.classList.toggle("is-selected", card.dataset.protection === value);
      const bouton = card.querySelector(".protection-select");
      if (bouton) {
        const choisie = card.dataset.protection === value;
        const libelle = bouton.querySelector(".protection-select-label");
        if (libelle) libelle.textContent = choisie ? t("✓ Sélectionnée") : t("Choisir {protection}", { protection: card.dataset.protectionNom });
        bouton.classList.toggle("is-selected", choisie);
        bouton.setAttribute("aria-label", choisie ? `${t("✓ Sélectionnée")} : ${card.dataset.protectionNom}` : t("Choisir {protection}", { protection: card.dataset.protectionNom }));
        bouton.setAttribute("aria-pressed", choisie ? "true" : "false");
        bouton.setAttribute("aria-checked", choisie ? "true" : "false");
      }
    });
    render();
  }

  // Libellé du prix d'une protection. Le plafond reste dans les données et
  // le calcul, mais la mention « Maximum » n'est plus affichée ici car elle
  // prêtait à confusion.
  function prixProtection(protection) {
    return protection.prixParJour <= 0
      ? { principal: t("Incluse") }
      : { principal: t("{prix} / jour", { prix: formatEUR(protection.prixParJour) }) };
  }

  function addProtectionCard(protection) {
    if (!protectionList) return;
    const card = document.createElement("article");
    card.className = "protection-card";
    card.dataset.protection = protection.id;
    card.dataset.protectionNom = t(protection.nom);

    const entete = document.createElement("div");
    entete.className = "protection-head";
    const titre = document.createElement("h3");
    titre.className = "protection-nom";
    titre.textContent = t(protection.nom);
    entete.appendChild(titre);
    if (protection.recommande) {
      const badge = document.createElement("span");
      badge.className = "protection-badge";
      badge.textContent = t("Recommandé");
      entete.appendChild(badge);
    }

    const choix = document.createElement("button");
    choix.type = "button";
    choix.className = "btn protection-select";
    choix.setAttribute("role", "radio");
    const choisie = data.protection === protection.id;
    const nomProtection = t(protection.nom);
    choix.setAttribute("aria-label", choisie ? `${t("✓ Sélectionnée")} : ${nomProtection}` : t("Choisir {protection}", { protection: nomProtection }));
    choix.setAttribute("aria-pressed", choisie ? "true" : "false");
    choix.setAttribute("aria-checked", choisie ? "true" : "false");
    const marqueChoix = document.createElement("span");
    marqueChoix.className = "protection-radio-marker";
    marqueChoix.setAttribute("aria-hidden", "true");
    const libelleChoix = document.createElement("span");
    libelleChoix.className = "protection-select-label";
    libelleChoix.textContent = choisie ? t("✓ Sélectionnée") : t("Choisir {protection}", { protection: nomProtection });
    choix.append(marqueChoix, libelleChoix);
    choix.classList.toggle("is-selected", choisie);
    choix.addEventListener("click", () => selectProtection(protection.id));
    entete.insertBefore(choix, titre);

    const niveau = niveauProtection(protection);
    const ligneResume = document.createElement("div");
    ligneResume.className = "protection-summary";
    const niveauNode = document.createElement("div");
    niveauNode.className = "protection-level";
    const etoiles = document.createElement("span");
    etoiles.className = "protection-stars";
    etoiles.setAttribute("aria-hidden", "true");
    etoiles.textContent = "★".repeat(niveau) + "☆".repeat(3 - niveau);
    const niveauAccessible = document.createElement("span");
    niveauAccessible.className = "sr-only";
    niveauAccessible.textContent = t("Niveau de protection : {niveau} sur 3", { niveau });
    niveauNode.append(etoiles, niveauAccessible);

    const prix = prixProtection(protection);
    const prixNode = document.createElement("p");
    prixNode.className = "protection-price";
    const prixPrincipal = document.createElement("strong");
    prixPrincipal.textContent = prix.principal;
    prixNode.appendChild(prixPrincipal);

    const detailsId = `protection-details-${protection.id}`;
    const detailsToggle = document.createElement("button");
    detailsToggle.type = "button";
    detailsToggle.className = "protection-details-toggle";
    detailsToggle.setAttribute("aria-expanded", "false");
    detailsToggle.setAttribute("aria-controls", detailsId);
    detailsToggle.setAttribute("aria-label", t("Afficher les détails de {protection}", { protection: t(protection.nom) }));
    const chevron = document.createElement("span");
    chevron.className = "protection-chevron";
    chevron.setAttribute("aria-hidden", "true");
    chevron.textContent = "⌄";
    detailsToggle.appendChild(chevron);

    const details = document.createElement("div");
    details.className = "protection-details";
    details.id = detailsId;
    details.setAttribute("aria-hidden", "true");
    const detailsInner = document.createElement("div");

    const description = document.createElement("p");
    description.className = "protection-description";
    description.textContent = t(protection.description);
    detailsInner.appendChild(description);

    // Garanties : toutes listées, cochées ou non, pour rendre la progression
    // d'un niveau à l'autre immédiatement lisible.
    const liste = document.createElement("ul");
    liste.className = "protection-garanties";
    getProtectionGaranties().forEach((garantie) => {
      const couverte = protection.garanties.includes(garantie.id);
      const ligne = document.createElement("li");
      ligne.className = couverte ? "is-covered" : "is-excluded";
      const marque = document.createElement("span");
      marque.className = "protection-marque";
      marque.setAttribute("aria-hidden", "true");
      marque.textContent = couverte ? "✓" : "✕";
      const texte = document.createElement("span");
      texte.textContent = t(garantie.libelle);
      const etat = document.createElement("span");
      etat.className = "sr-only";
      etat.textContent = couverte ? t("Couvert : ") : t("Non couvert : ");
      ligne.append(marque, etat, texte);
      liste.appendChild(ligne);
    });
    detailsInner.appendChild(liste);
    details.appendChild(detailsInner);
    detailsToggle.addEventListener("click", () => {
      const ouvert = detailsToggle.getAttribute("aria-expanded") === "true";
      detailsToggle.setAttribute("aria-expanded", ouvert ? "false" : "true");
      details.setAttribute("aria-hidden", ouvert ? "true" : "false");
      details.classList.toggle("is-open", !ouvert);
      detailsToggle.setAttribute("aria-label", t(ouvert ? "Afficher les détails de {protection}" : "Masquer les détails de {protection}", { protection: t(protection.nom) }));
    });

    ligneResume.append(niveauNode, prixNode, detailsToggle);
    card.append(entete, ligneResume, details);
    card.classList.toggle("is-selected", choisie);
    protectionList.appendChild(card);
  }

  if (protectionList) {
    protectionList.textContent = "";
    getProtections().forEach(addProtectionCard);

    // Mention prudente sous les cartes : renvoie aux CGL plutôt que de
    // promettre une couverture que le texte contractuel ne décrit pas.
    const mention = document.createElement("p");
    mention.className = "protection-mention";
    mention.textContent = t(getProtectionMention());
    protectionList.appendChild(mention);

    // La formule incluse étant retenue par défaut, l'étape ne bloque jamais.
    if (continueToOptions) continueToOptions.disabled = false;
  }

  function showCheckoutStep(step) {
    const protectionPanel = document.getElementById("protection-step");
    const optionsPanel = document.getElementById("options-step");
    if (protectionPanel) protectionPanel.hidden = step !== "protection";
    if (optionsPanel) optionsPanel.hidden = step !== "options";
    document.querySelectorAll("[data-checkout-step]").forEach((node) => {
      const name = node.dataset.checkoutStep;
      const completed = name === "vehicle" || (step === "options" && name === "protection");
      node.classList.toggle("done", completed);
      node.classList.toggle("current", name === step);
    });
    if (window.history && typeof window.history.replaceState === "function") {
      window.history.replaceState(null, "", step === "options" ? "#options" : "#protection");
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (continueToOptions) {
    continueToOptions.addEventListener("click", () => {
      if (!data.protection) {
        if (protectionError) protectionError.textContent = "Choisissez une protection pour continuer.";
        return;
      }
      showCheckoutStep("options");
    });
  }
  document.querySelectorAll("[data-back-to-protection]").forEach((button) => {
    button.addEventListener("click", () => showCheckoutStep("protection"));
  });

  // Le bouton retour de la page de paiement pointe vers #options : on rend
  // directement le bon écran sans faire répéter le choix de protection.
  if (window.location.hash === "#options" && data.protection) {
    showCheckoutStep("options");
  }

  // Options supplémentaires : ordre volontairement calé sur le parcours
  // demandé (conducteur, kilométrage, plein/recharge, puis enfants).
  const optionsList = document.getElementById("options-list");
  if (optionsList) {
    optionsList.textContent = "";

    function optionIcon(kind) {
      const icon = document.createElement("span");
      icon.className = "option-icon";
      icon.setAttribute("aria-hidden", "true");
      const paths = {
        driver: '<path d="M4 19v-1.5c0-3 2.8-5 6-5s6 2 6 5V19M10 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm9-5v8m-4-4h8"/>',
        mileage: '<path d="M4 17a8 8 0 1 1 16 0M12 17l4-6M7 14h.01M12 10h.01M17 14h.01"/>',
        fuel: '<path d="M5 21V3h10v18M3 21h14M7 7h6v5H7zM15 8h2l3 3v7a2 2 0 0 0 2 2V9"/>',
        child: '<path d="M8 4a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm-2 7h5a4 4 0 0 1 4 4v5H4v-7a2 2 0 0 1 2-2Zm9-4h5v13h-5M15 12h5"/>'
      };
      icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[kind] || paths.child}</svg>`;
      return icon;
    }

    function createOptionCard(opt, iconKind) {
      const card = document.createElement("article");
      card.className = "option-card";

      const label = document.createElement("label");
      label.className = "option-choice";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.id = `option-${opt.id}`;
      checkbox.checked = data.options.includes(opt.id);

      const texte = document.createElement("span");
      texte.className = "option-copy";
      const titre = document.createElement("span");
      titre.className = "option-nom";
      titre.textContent = opt.nom;
      const price = document.createElement("span");
      price.className = "option-price";
      price.textContent = opt.type === "jour"
        ? t("{prix} / jour", { prix: formatEUR(opt.prix) })
        : formatEUR(opt.prix);
      texte.append(titre, price);

      const details = document.createElement("details");
      details.className = "choice-details ui-disclosure";
      const summary = document.createElement("summary");
      summary.textContent = "Voir le détail";
      const detailText = document.createElement("p");
      detailText.textContent = opt.description;
      details.append(summary, detailText);

      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          if (!data.options.includes(opt.id)) data.options.push(opt.id);
        } else {
          data.options = data.options.filter((id) => id !== opt.id);
        }
        writeReservationLocal(data);
        render();
      });

      label.append(optionIcon(iconKind), texte, checkbox);
      card.append(label, details);

      // Certaines options demandent une précision au client (âge et poids de
      // l'enfant pour le siège — voir `saisies` dans js/data.js). Les champs
      // n'apparaissent qu'une fois l'option cochée, et leur valeur est
      // conservée avec la réservation pour que l'agence sache quoi préparer.
      if (Array.isArray(opt.saisies) && opt.saisies.length) {
        const precisions = document.createElement("div");
        precisions.className = "option-precisions";
        opt.saisies.forEach((saisie) => {
          const champ = document.createElement("label");
          champ.className = "option-precision";
          const intitule = document.createElement("span");
          intitule.textContent = t(saisie.libelle);
          const entree = document.createElement("input");
          entree.type = "number";
          entree.inputMode = "numeric";
          entree.id = `option-${opt.id}-${saisie.cle}`;
          entree.min = String(saisie.min);
          entree.max = String(saisie.max);
          entree.step = "1";
          entree.placeholder = t(saisie.unite);
          entree.value = data[saisie.cle] === undefined || data[saisie.cle] === null ? "" : String(data[saisie.cle]);
          entree.addEventListener("input", () => {
            const valeur = entree.value === "" ? null : Number(entree.value);
            data[saisie.cle] = valeur === null || !isFinite(valeur) ? null : valeur;
            writeReservationLocal(data);
          });
          champ.append(intitule, entree);
          precisions.appendChild(champ);
        });
        precisions.hidden = !checkbox.checked;
        card.appendChild(precisions);
        checkbox.addEventListener("change", () => { precisions.hidden = !checkbox.checked; });
      }

      card.classList.toggle("is-selected", checkbox.checked);
      checkbox.addEventListener("change", () => card.classList.toggle("is-selected", checkbox.checked));
      return card;
    }

    const conducteur = getOptionParId("second-conducteur");
    if (conducteur) optionsList.appendChild(createOptionCard(conducteur, "driver"));

    const kmIds = ["km-200", "km-supplementaire", "km-400"];
    const kmOptions = kmIds.map(getOptionParId).filter(Boolean);
    const mileageCard = document.createElement("article");
    mileageCard.className = "option-card mileage-card";
    const mileageHead = document.createElement("div");
    mileageHead.className = "option-group-heading";
    mileageHead.appendChild(optionIcon("mileage"));
    const mileageCopy = document.createElement("div");
    const mileageTitle = document.createElement("h3");
    mileageTitle.textContent = "Forfait kilométrage supplémentaire";
    const mileageHint = document.createElement("p");
    mileageHint.textContent = "Gardez la liberté de prolonger une balade ou d'improviser une étape, sans surveiller chaque kilomètre. Choisissez un seul forfait pour l'ensemble de la location.";
    mileageCopy.append(mileageTitle, mileageHint);
    mileageHead.appendChild(mileageCopy);
    mileageCard.appendChild(mileageHead);

    const mileageChoices = document.createElement("div");
    mileageChoices.className = "mileage-choices";
    const selectedKm = kmIds.find((id) => data.options.includes(id)) || "";
    [{ id: "", nom: "Aucun forfait", prix: 0 }, ...kmOptions].forEach((opt) => {
      const label = document.createElement("label");
      label.className = "mileage-choice";
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "kilometrage-supplementaire";
      radio.id = opt.id ? `option-${opt.id}` : "option-km-none";
      radio.value = opt.id;
      radio.checked = selectedKm === opt.id;
      const name = document.createElement("span");
      name.textContent = opt.nom;
      const price = document.createElement("strong");
      price.textContent = opt.prix ? formatEUR(opt.prix) : "Inclus";
      label.append(radio, name, price);
      radio.addEventListener("change", () => {
        if (!radio.checked) return;
        data.options = data.options.filter((id) => !kmIds.includes(id));
        if (opt.id) data.options.push(opt.id);
        writeReservationLocal(data);
        mileageCard.classList.toggle("is-selected", !!opt.id);
        render();
      });
      mileageChoices.appendChild(label);
    });
    mileageCard.classList.toggle("is-selected", !!selectedKm);
    mileageCard.appendChild(mileageChoices);
    const moreKm = document.createElement("a");
    moreKm.href = "tel:+33667485430";
    moreKm.className = "more-km-link";
    moreKm.textContent = "Besoin de plus de kilomètres ? Nous consulter";
    mileageCard.appendChild(moreKm);
    optionsList.appendChild(mileageCard);

    const servicePlein = getOptionParId("service-plein");
    if (servicePlein) optionsList.appendChild(createOptionCard(servicePlein, "fuel"));

    const childrenGroup = document.createElement("details");
    childrenGroup.className = "child-options-group ui-disclosure";
    const childrenSummary = document.createElement("summary");
    childrenSummary.append(optionIcon("child"), document.createTextNode(" Voyager avec un enfant"));
    const childrenIntro = document.createElement("p");
    childrenIntro.textContent = "Dépliez cette rubrique pour choisir l'équipement adapté à votre enfant.";
    const childrenList = document.createElement("div");
    childrenList.className = "child-options-list";
    // Deux options seulement : le client n'a pas à choisir une catégorie de
    // siège, l'agence la détermine d'après l'âge et le poids saisis.
    ["siege-enfant", "rehausseur"].forEach((id) => {
      const opt = getOptionParId(id);
      if (opt) childrenList.appendChild(createOptionCard(opt, "child"));
    });
    childrenGroup.append(childrenSummary, childrenIntro, childrenList);
    optionsList.appendChild(childrenGroup);
  }

  // Code promo : saisie facultative, validée à l'affichage (voir render())
  // — un code inconnu/expiré n'empêche jamais de continuer la réservation,
  // il est simplement ignoré dans le calcul.
  //
  // Les codes publics (CODES_PROMO, js/data.js) sont validés instantanément
  // ci-dessus via calculerPrixTotal, sans appel serveur. Le code de test
  // interne (TEST_DISCOUNT_CODE) est volontairement absent de ce catalogue
  // public (jamais exposé au navigateur) : seul le serveur peut confirmer
  // sa validité, d'où l'appel à /api/validate-promo ci-dessous — uniquement
  // quand le code saisi n'est pas déjà reconnu localement.
  function verifierCodeDeTest(code) {
    // Navigateur trop ancien pour fetch() (extrêmement rare) : pas de repli
    // plus élaboré possible ici, le code de test reste simplement affiché
    // comme invalide plutôt que de laisser planter le gestionnaire de clic.
    if (typeof fetch !== "function") {
      data._codePromoTestValide = false;
      render();
      return;
    }
    fetch("/api/validate-promo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code })
    })
      .then((r) => (r.ok ? r.json() : { valid: false }))
      .then((res) => {
        // Le champ a pu changer pendant l'appel réseau : n'applique la
        // réponse que si elle correspond toujours au code actuellement saisi.
        if (data.codePromo !== code) return;
        data._codePromoTestValide = !!res.valid;
        render();
      })
      .catch(() => {
        if (data.codePromo !== code) return;
        data._codePromoTestValide = false;
        render();
      });
  }

  const promoInput = document.getElementById("promo-input");
  const promoApply = document.getElementById("promo-apply");
  if (promoInput) promoInput.value = data.codePromo || "";
  if (promoApply) {
    promoApply.addEventListener("click", () => {
      const code = (promoInput.value || "").trim();
      data.codePromo = code;
      data._codePromoTestValide = code ? null : undefined;
      writeReservationLocal(data);
      render();
      if (code && !getCodePromo(code)) verifierCodeDeTest(code);
    });
  }

  render();

  // Retour sur la page avec un code déjà enregistré (localStorage) qui
  // n'est pas dans le catalogue public : peut être le code de test interne,
  // on relance la vérification serveur pour refléter correctement son statut
  // plutôt que d'afficher à tort "Code promo invalide".
  if (data.codePromo && !getCodePromo(data.codePromo)) {
    data._codePromoTestValide = null;
    render();
    verifierCodeDeTest(data.codePromo);
  }

  // Barre de dates persistante : permet d'ajuster les dates directement
  // depuis cette page sans revenir en arrière — le résumé et le total se
  // recalculent aussitôt.
  initDateBar({
    getData: () => ({ dateDebut: data.dateDebut, heureDebut: data.heureDebut, dateFin: data.dateFin, heureFin: data.heureFin, jours: data.jours }),
    onApply: (nouvellesDates) => {
      Object.assign(data, nouvellesDates);
      data.jours = joursFacturablesPourPeriode(data.dateDebut, data.heureDebut, data.dateFin, data.heureFin);
      writeReservationLocal(data);
      render();
    }
  });

  // Demande client : laisser le client ajouter toutes les options
  // nécessaires et voir le prix final AVANT de demander ses coordonnées
  // (nom/prénom/date de naissance/etc.) — ces informations ne sont désormais saisies
  // qu'à l'étape suivante (paiement.html). Chaque interaction ci-dessus
  // (assurance/options/promo/dates) persiste déjà `data` immédiatement, il
  // n'y a donc rien de plus à sauvegarder ici avant de continuer.
  const continueButton = document.getElementById("continue-to-payment");
  if (continueButton) {
    continueButton.addEventListener("click", () => {
      allerVers("paiement.html");
    });
  }
}

// Insère automatiquement les "/" pendant la saisie d'un champ date au
// format JJ/MM/AAAA (naissance sur paiement.html, dates de permis/naissance
// sur documents.html) : évite de faire reposer la frappe manuelle des
// séparateurs sur l'utilisateur, sans dépendre d'un composant de calendrier
// natif (rendu — menu déroulant, molette — ET format d'affichage selon la
// langue du système, trop inconsistants d'un navigateur à l'autre pour
// garantir JJ/MM/AAAA).
function insererSlashesDateFr(input) {
  const chiffres = input.value.replace(/\D/g, "").slice(0, 8);
  let formate = chiffres.slice(0, 2);
  if (chiffres.length > 2) formate += "/" + chiffres.slice(2, 4);
  if (chiffres.length > 4) formate += "/" + chiffres.slice(4, 8);
  input.value = formate;
}

// Convertit une saisie "JJ/MM/AAAA" (champ #naissance sur paiement.html,
// dates de permis/naissance sur documents.html) en "YYYY-MM-DD" — format
// utilisé partout ailleurs (envoi au serveur, validate-reservation-input.js,
// validate-document-upload.js, contrat.html). Renvoie null si la saisie
// n'est pas une date réelle (ex. "31/02/2000"), pas seulement mal formée :
// new Date() accepterait silencieusement un jour hors plage en "roulant"
// sur le mois suivant, d'où la revérification des composants.
function naissanceFrVersISO(v) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((v || "").trim());
  if (!m) return null;
  const [, jj, mm, aaaa] = m;
  const iso = `${aaaa}-${mm}-${jj}`;
  const d = new Date(`${iso}T00:00:00Z`);
  if (!isFinite(d.getTime()) || d.getUTCDate() !== Number(jj) || d.getUTCMonth() + 1 !== Number(mm)) return null;
  return iso;
}

// Calcule l'âge (en années révolues) à partir d'une date de naissance
// "YYYY-MM-DD". Réutilisé côté serveur avec la même logique (voir
// calculerAge() dans validate-reservation-input.js) — l'âge n'est jamais
// transmis tel quel par le client, uniquement recalculé à partir de la
// date, ici comme côté serveur.
function calculerAgeDepuisNaissance(dateISO) {
  const naissance = new Date(`${dateISO}T00:00:00Z`);
  if (!isFinite(naissance.getTime())) return null;
  const aujourdHui = new Date();
  let age = aujourdHui.getUTCFullYear() - naissance.getUTCFullYear();
  const moisDiff = aujourdHui.getUTCMonth() - naissance.getUTCMonth();
  if (moisDiff < 0 || (moisDiff === 0 && aujourdHui.getUTCDate() < naissance.getUTCDate())) age--;
  return age;
}

function validateDriverForm(form) {
  let valid = true;
  let firstInvalid = null;
  const champs = [
    { id: "nom", test: v => v.trim().length >= 2, msg: "Nom requis (2 caractères min.)" },
    { id: "prenom", test: v => v.trim().length >= 2, msg: "Prénom requis" },
    { id: "email", test: v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), msg: "Adresse e-mail invalide" },
    { id: "telephone", test: v => v.replace(/\D/g, "").length >= 8, msg: "Numéro de téléphone invalide" },
    {
      id: "naissance",
      test: v => {
        const iso = naissanceFrVersISO(v);
        if (!iso) return false;
        const age = calculerAgeDepuisNaissance(iso);
        return age !== null && age >= 21 && age <= 99;
      },
      msg: "Date de naissance invalide (JJ/MM/AAAA) — le conducteur doit avoir entre 21 et 99 ans"
    }
  ];

  champs.forEach(({ id, test, msg }) => {
    const input = form.querySelector(`[name="${id}"]`);
    const errorEl = document.getElementById(`err-${id}`);
    const ok = test(input.value || "");
    if (!ok) {
      valid = false;
      if (!firstInvalid) firstInvalid = input;
    }
    if (errorEl) errorEl.textContent = ok ? "" : msg;
    if (input) input.setAttribute("aria-invalid", ok ? "false" : "true");
  });

  // Focus sur le premier champ en erreur : évite qu'un utilisateur au
  // clavier ou avec un lecteur d'écran ne perde le fil après une
  // soumission refusée.
  if (firstInvalid) firstInvalid.focus();

  return valid;
}

/* ---------------------------------------------------------
   PAGE : paiement.html — paiement réel via Mollie
--------------------------------------------------------- */
// Insère un repli honnête (téléphone / WhatsApp) quand le paiement en
// ligne n'est pas disponible — jamais de fausse promesse de paiement
// opérationnel (cf. AUDIT.md, contrainte "ne jamais annoncer une
// fonctionnalité comme opérationnelle sans preuve").
function showPaymentUnavailableFallback(message) {
  const banner = document.getElementById("info-banner");
  if (banner) banner.textContent = message;

  const form = document.getElementById("payment-form");
  if (form) {
    form.querySelectorAll("input, button").forEach((el) => { el.disabled = true; });
  }

  const formCard = form ? form.closest(".card") : null;
  if (!formCard || !formCard.parentNode || document.getElementById("payment-fallback")) return;

  const fallback = document.createElement("div");
  fallback.className = "card";
  fallback.id = "payment-fallback";
  fallback.style.marginTop = "16px";

  const p = document.createElement("p");
  p.textContent = "Vous pouvez finaliser votre réservation directement avec notre équipe :";

  const links = document.createElement("div");
  links.style.display = "flex";
  links.style.gap = "10px";
  links.style.flexWrap = "wrap";

  const tel = document.createElement("a");
  tel.href = "tel:+33667485430";
  tel.className = "btn btn-secondary btn-sm";
  tel.textContent = "📞 Appeler l'agence";

  const wa = document.createElement("a");
  wa.href = "https://wa.me/33667485430";
  wa.target = "_blank";
  wa.rel = "noopener";
  wa.className = "btn btn-secondary btn-sm";
  wa.textContent = "💬 WhatsApp";

  links.append(tel, wa);
  fallback.append(p, links);
  formCard.parentNode.insertBefore(fallback, formCard.nextSibling);
}

function buildPaymentSummary(container, vehicule, data, prix) {
  container.textContent = "";
  const vehicleBlock = document.createElement("div");
  vehicleBlock.className = "summary-vehicle";
  vehicleBlock.innerHTML = vignetteVehicule(vehicule); // sûr : données véhicule internes uniquement

  const infoDiv = document.createElement("div");
  const nameDiv = document.createElement("div");
  nameDiv.className = "vehicle-name";
  nameDiv.textContent = vehicule.nom;
  const datesDiv = document.createElement("div");
  datesDiv.className = "hint-text";
  datesDiv.textContent = `${formatDateHeureFR(data.dateDebut, data.heureDebut)} — ${formatDateHeureFR(data.dateFin, data.heureFin)}`;
  infoDiv.append(nameDiv, datesDiv);
  // Les coordonnées ne sont saisies que sur cette page (voir plus bas) :
  // au premier rendu, `data.conducteur` n'existe pas encore.
  if (data.conducteur) {
    const driverDiv = document.createElement("div");
    driverDiv.className = "hint-text";
    driverDiv.textContent = `${data.conducteur.prenom} ${data.conducteur.nom}`;
    infoDiv.insertBefore(driverDiv, datesDiv);
  }
  vehicleBlock.appendChild(infoDiv);
  container.appendChild(vehicleBlock);

  appendBreakdownRows(container, prix);
}

function initPaiementPage() {
  const summary = document.getElementById("payment-summary");
  if (!summary) return;

  const data = readReservationLocal();
  if (!data) {
    allerVers("vehicules.html");
    return;
  }
  // Demande client : les coordonnées (nom/prénom/date de naissance/etc.) ne sont
  // demandées qu'à cette dernière étape, une fois que le client a déjà vu
  // le prix final avec ses options — `data.conducteur` n'existe donc pas
  // forcément encore ici (voir le formulaire plus bas).
  const vehicule = getVehiculeParId(data.vehiculeId);
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
    if (totalCompact) totalCompact.textContent = formatPrixJour(prix.total);
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
      data.jours = joursFacturablesPourPeriode(data.dateDebut, data.heureDebut, data.dateFin, data.heureFin);
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
  appendPriceHighlights(container, prix);
  container.appendChild(summaryRow(t("Location ({jours})", { jours: libelleJours(prix.jours) }), formatPrixJour(prix.sousTotalBrut)));

  if (prix.reductionDuree) {
    const row = summaryRow(
      t("Remise durée ({palier}, -{taux}%)", { palier: t(prix.reductionDuree.libelle), taux: Math.round(prix.reductionDuree.taux * 100) }),
      `− ${formatPrixJour(prix.reductionDuree.montant)}`
    );
    row.classList.add("discount");
    container.appendChild(row);
  }

  (prix.optionsSelectionnees || []).forEach((opt) => {
    // Le nom de l'option vient de js/data.js, donc en français : sa
    // traduction est indexée sur ce texte dans js/i18n.js.
    container.appendChild(summaryRow(t(opt.nom), formatPrixJour(opt.montant)));
  });

  // Protection : toujours affichée, y compris la formule incluse — le client
  // doit voir laquelle s'applique, pas seulement ce qu'elle coûte.
  if (prix.protection) {
    const protection = prix.protection;
    const ligne = summaryRow(
      protection.plafonne
        ? t("{nom} (forfait plafonné à {jours})", { nom: t(protection.nom), jours: libelleJours(protection.joursFactures) })
        : t("{nom} — {jours}", { nom: t(protection.nom), jours: libelleJours(prix.jours) }),
      protection.montant > 0 ? formatPrixJour(protection.montant) : t("Incluse")
    );
    container.appendChild(ligne);
  }

  // Supplément jeune conducteur : ligne affichée UNIQUEMENT quand il
  // s'applique (permis de moins de 3 ans), jamais une ligne à zéro.
  if (prix.supplementJeuneConducteur) {
    container.appendChild(summaryRow(
      t("Supplément jeune conducteur — {jours}", { jours: libelleJours(prix.jours) }),
      formatPrixJour(prix.supplementJeuneConducteur.montant)
    ));
  }

  if (prix.codePromo) {
    // .pourcentage OU .montant selon le type de code (voir CODES_PROMO,
    // js/data.js) — jamais les deux à la fois.
    const suffixePromo = prix.codePromo.pourcentage !== undefined ? `-${prix.codePromo.pourcentage}%` : `-${formatPrixJour(prix.codePromo.montant)}`;
    const row = summaryRow(
      t("Code promo {code} ({remise})", { code: prix.codePromo.code, remise: suffixePromo }),
      `− ${formatPrixJour(prix.reductionPromoMontant)}`
    );
    row.classList.add("discount");
    container.appendChild(row);
  }

  const totalRow = summaryRow("Total", formatPrixJour(prix.total));
  totalRow.classList.add("total");
  container.appendChild(totalRow);
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
  datesDiv.textContent = `${formatDateHeureFR(data.dateDebut, data.heureDebut)} — ${formatDateHeureFR(data.dateFin, data.heureFin)} (${libelleDureeEtFacturation(data.dateDebut, data.heureDebut, data.dateFin, data.heureFin, data.jours)})`;
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
