// GETLOCATION — logique du site (catalogue, réservation, paiement, galerie).
// Stockage local (localStorage) : uniquement pour le confort du parcours
// (pré-remplissage, résumé). La confirmation de paiement et le prix qui fait
// foi viennent toujours du serveur (netlify/functions) — voir P0 (AUDIT.md).
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
  return heure ? `${base} à ${heure}` : base;
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
// coordonnées du conducteur et le numéro de permis) conservées dans ce
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

// Remplit un <select> avec la liste des horaires d'ouverture (08:00 à 19:00,
// par pas de 30 min) : garantit qu'on ne peut choisir qu'un créneau valide.
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
    textEl.textContent = `${formatDateHeureFR(d.dateDebut, d.heureDebut)} → ${formatDateHeureFR(d.dateFin, d.heureFin)} (${d.jours} jour${d.jours > 1 ? "s" : ""})`;
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

  LIEUX.forEach(lieu => {
    selectPrise.add(new Option(lieu, lieu));
    if (selectRetour) selectRetour.add(new Option(lieu, lieu));
  });
  [selectAdressePrise, selectAdresseRetour].forEach(select => {
    if (!select) return;
    select.add(new Option("Choisissez une ville", "", true, true));
    select.options[0].disabled = true;
    VILLES_LIVRAISON.forEach(ville => select.add(new Option(ville, ville)));
  });

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
      champRetour.style.display = "";
      boutonToggleRetour.style.display = "none";
      majChampAdresse(selectRetour, champAdresseRetour, selectAdresseRetour);
      selectRetour.focus();
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
  }

  if (selectPrise) {
    majChampAdresse(selectPrise, champAdressePrise, selectAdressePrise);
    selectPrise.addEventListener("change", () => {
      majChampAdresse(selectPrise, champAdressePrise, selectAdressePrise);
      if (!retourIndependant && selectRetour) selectRetour.value = selectPrise.value;
    });
  }
  // Tant que la restitution n'a pas été rendue indépendante, son champ ville
  // reste masqué : elle reprend silencieusement la ville de prise en charge
  // au moment de l'envoi (voir plus bas), pas besoin de la resaisir.
  if (selectRetour) {
    selectRetour.addEventListener("change", () => majChampAdresse(selectRetour, champAdresseRetour, selectAdresseRetour));
  }

  remplirOptionsHeure(selectHeureDebut);
  remplirOptionsHeure(selectHeureFin);

  inputDebut.min = todayISO();
  inputDebut.value = todayISO(2);
  inputFin.min = todayISO(3);
  inputFin.value = todayISO(5);
  if (selectHeureDebut) selectHeureDebut.value = "10:00";
  if (selectHeureFin) selectHeureFin.value = "10:00";

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

    const adressePriseFinale = (selectPrise.value === LIEU_LIVRAISON && selectAdressePrise) ? selectAdressePrise.value : "";
    // Sans restitution indépendante, on reprend silencieusement le lieu (et
    // la ville de livraison) de la prise en charge : pas besoin de le
    // ressaisir pour le cas le plus courant (même lieu au départ et au retour).
    const lieuRetourFinal = retourIndependant ? selectRetour.value : selectPrise.value;
    const adresseRetourFinale = retourIndependant
      ? ((selectRetour.value === LIEU_LIVRAISON && selectAdresseRetour) ? selectAdresseRetour.value : "")
      : adressePriseFinale;

    writeJSON(STORAGE.recherche, {
      lieuPrise: selectPrise.value,
      lieuRetour: lieuRetourFinal,
      adressePrise: adressePriseFinale,
      adresseRetour: adresseRetourFinale,
      dateDebut: inputDebut.value,
      dateFin: inputFin.value,
      heureDebut: selectHeureDebut ? selectHeureDebut.value : "10:00",
      heureFin: selectHeureFin ? selectHeureFin.value : "10:00"
    });
    window.location.href = "vehicules.html";
  });
}

// Libellé lisible d'un lieu : si c'est une livraison avec adresse renseignée,
// affiche l'adresse plutôt que le libellé générique.
function libelleLieu(lieu, adresse) {
  if (lieu === LIEU_LIVRAISON && adresse) {
    return `Livraison — ${adresse}`;
  }
  return lieu;
}

/* ---------------------------------------------------------
   PAGE : vehicules.html — catalogue + filtres
--------------------------------------------------------- */
function initVehiculesPage() {
  const grid = document.getElementById("vehicle-grid");
  if (!grid) return;

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

  const infoBar = document.getElementById("search-summary");
  function updateInfoBar() {
    if (!infoBar) return;
    infoBar.textContent = `${libelleLieu(recherche.lieuPrise, recherche.adressePrise)} · du ${formatDateHeureFR(recherche.dateDebut, recherche.heureDebut)} au ${formatDateHeureFR(recherche.dateFin, recherche.heureFin)} (${jours} jour${jours > 1 ? "s" : ""})`;
  }
  updateInfoBar();

  const filterBar = document.getElementById("filter-bar");
  let activeCategorie = "Toutes";

  function renderChips() {
    filterBar.innerHTML = "";
    ["Toutes", ...CATEGORIES].forEach(cat => {
      const chip = document.createElement("button");
      chip.className = "filter-chip" + (cat === activeCategorie ? " active" : "");
      chip.textContent = cat;
      chip.addEventListener("click", () => {
        activeCategorie = cat;
        renderChips();
        renderGrid();
      });
      filterBar.appendChild(chip);
    });
  }

  function renderGrid() {
    const liste = VEHICULES.filter(v => activeCategorie === "Toutes" || v.categorie === activeCategorie);
    grid.innerHTML = "";
    if (liste.length === 0) {
      grid.innerHTML = `<div class="empty-state">Aucun véhicule dans cette catégorie pour le moment.</div>`;
      return;
    }
    liste.forEach(v => {
      const total = v.prixJour * jours;
      const card = document.createElement("div");
      card.className = "vehicle-card";
      const nbPhotos = v.photos ? v.photos.length : 0;
      card.innerHTML = `
        <div class="vehicle-media"${nbPhotos ? ` data-gallery="${v.id}"` : ""}>
          ${pictureVehicule(v, "vehicle-photo", true)}
          ${nbPhotos > 1 ? `<span class="vehicle-photo-count">${nbPhotos}</span>` : ""}
          <span class="vehicle-emoji-fallback">${v.emoji}</span>
        </div>
        <div class="vehicle-body">
          <div class="vehicle-category">${v.categorie}</div>
          <div class="vehicle-name">${v.nom}</div>
          <div class="vehicle-specs">
            <span>${v.places} places</span>
            <span>${v.transmission}</span>
            <span>${v.clim ? "Climatisation" : "Sans clim"}</span>
            ${v.hybride ? '<span>Hybride</span>' : ''}
          </div>
          <p class="hint-text">${v.description}</p>
          <div class="vehicle-footer">
            <div class="price"><span class="price-from">À partir de</span>${formatEUR(v.prixJour)}<small> / jour</small></div>
            <button class="btn btn-primary btn-sm" data-id="${v.id}">Réserver</button>
          </div>
          <div class="hint-text">Total pour ${jours} jour${jours > 1 ? "s" : ""} : ${formatEUR(total)}</div>
        </div>
      `;
      card.querySelector("button").addEventListener("click", () => {
        writeReservationLocal({
          vehiculeId: v.id,
          ...recherche,
          jours,
          assurance: false
        });
        window.location.href = "reservation.html";
      });
      grid.appendChild(card);
    });
  }

  renderChips();
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
      updateInfoBar();
      renderGrid();
    }
  });
}

function formatDateFR(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
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
function pictureVehicule(v, imgClass, preferCutout = false) {
  if (preferCutout && v.photoCutout) {
    return `
      <picture>
        <img src="${v.photoCutout}" alt="${v.nom}" class="${imgClass} is-cutout" loading="lazy" decoding="async" width="900" height="620" onerror="this.classList.remove('is-cutout')">
      </picture>
    `;
  }
  if (v.photos && v.photos.length) {
    // Vraie photo professionnelle (première de la galerie) : image principale de la carte.
    const p0 = v.photos[0];
    return `
      <picture>
        <source srcset="${p0.thumbWebp} 700w, ${p0.webp} 1400w" sizes="(max-width: 480px) 90vw, 340px" type="image/webp">
        <img src="${p0.thumbJpg}" alt="${v.nom}" class="${imgClass}" loading="lazy" decoding="async" width="1400" height="1050" onerror="this.remove()">
      </picture>
    `;
  }
  if (v.photoCutout) {
    // Photo détourée (fond transparent) : object-fit:contain via la classe is-cutout,
    // le fond de la carte (gris très clair) fait office de socle.
    return `
      <picture>
        <img src="${v.photoCutout}" alt="${v.nom}" class="${imgClass} is-cutout" loading="lazy" decoding="async" width="900" height="620" onerror="this.classList.remove('is-cutout')">
      </picture>
    `;
  }
  const webp = v.photo.replace(/\.jpe?g$/i, ".webp");
  return `
    <picture>
      <source srcset="${webp}" type="image/webp">
      <img src="${v.photo}" alt="${v.nom}" class="${imgClass}" loading="lazy" decoding="async" width="1000" height="750" onerror="this.remove()">
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

  el.querySelector(".gallery-lightbox-source").srcset = photo.webp;
  const img = el.querySelector(".gallery-lightbox-img");
  img.src = photo.jpg;
  img.alt = `${galleryState.vehiculeNom}${photo.legende ? " — " + photo.legende : ""}`;
  el.querySelector(".gallery-lightbox-caption").textContent = `${galleryState.vehiculeNom}${photo.legende ? " — " + photo.legende : ""}`;
  el.querySelector(".gallery-lightbox-counter").textContent = photos.length > 1 ? `${galleryState.index + 1} / ${photos.length}` : "";
  el.querySelectorAll(".gallery-lightbox-arrow").forEach(btn => { btn.style.display = photos.length > 1 ? "" : "none"; });

  const thumbs = el.querySelector(".gallery-lightbox-thumbs");
  thumbs.innerHTML = photos.length > 1
    ? photos.map((p, pi) => `<img src="${p.thumbJpg}" data-i="${pi}" class="${pi === galleryState.index ? "is-active" : ""}" alt="Photo ${pi + 1}">`).join("")
    : "";
  thumbs.querySelectorAll("img").forEach(t => t.addEventListener("click", () => showGalleryIndex(Number(t.dataset.i))));
}

function initVehicleGalleries() {
  document.addEventListener("click", (e) => {
    const media = e.target.closest("[data-gallery]");
    if (!media) return;
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
    window.location.href = "vehicules.html";
    return;
  }
  const vehicule = getVehiculeParId(data.vehiculeId);
  if (!vehicule) {
    window.location.href = "vehicules.html";
    return;
  }

  const assuranceCheckbox = document.getElementById("assurance");
  assuranceCheckbox.checked = !!data.assurance;

  // Rendu via createElement/textContent (jamais innerHTML) pour les
  // valeurs pouvant contenir une saisie utilisateur (adresse de livraison
  // libre) : protection XSS, cf. AUDIT.md P0-7.
  function render() {
    const sousTotal = vehicule.prixJour * data.jours;
    const assurance = assuranceCheckbox.checked ? PRIX_ASSURANCE_JOUR * data.jours : 0;
    const total = sousTotal + assurance;

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
    routeDiv.textContent = `${libelleLieu(data.lieuPrise, data.adressePrise)} → ${libelleLieu(data.lieuRetour, data.adresseRetour)}`;
    const datesDiv = document.createElement("div");
    datesDiv.className = "hint-text";
    datesDiv.textContent = `${formatDateHeureFR(data.dateDebut, data.heureDebut)} — ${formatDateHeureFR(data.dateFin, data.heureFin)} (${data.jours} jour${data.jours > 1 ? "s" : ""})`;
    infoDiv.append(nameDiv, routeDiv, datesDiv);
    vehicleBlock.appendChild(infoDiv);
    container.appendChild(vehicleBlock);

    container.appendChild(summaryRow(`Location (${data.jours} × ${formatEUR(vehicule.prixJour)})`, formatEUR(sousTotal)));
    container.appendChild(summaryRow("Assurance tous risques", assurance > 0 ? formatEUR(assurance) : "—"));
    const totalRow = summaryRow("Total", formatEUR(total));
    totalRow.classList.add("total");
    container.appendChild(totalRow);
  }

  assuranceCheckbox.addEventListener("change", () => {
    data.assurance = assuranceCheckbox.checked;
    render();
  });

  render();

  // Barre de dates persistante : permet d'ajuster les dates directement
  // depuis cette page (avant de renseigner ses informations conducteur)
  // sans revenir en arrière — le résumé et le total se recalculent aussitôt.
  initDateBar({
    getData: () => ({ dateDebut: data.dateDebut, heureDebut: data.heureDebut, dateFin: data.dateFin, heureFin: data.heureFin, jours: data.jours }),
    onApply: (nouvellesDates) => {
      Object.assign(data, nouvellesDates);
      data.jours = joursFacturablesDepuisHeures(
        dureeEnHeures(data.dateDebut, data.heureDebut, data.dateFin, data.heureFin)
      );
      writeReservationLocal(data);
      render();
    }
  });

  const form = document.getElementById("driver-form");

  // Retour arrière sans perte : si le conducteur avait déjà rempli ce
  // formulaire (ex. retour depuis paiement.html via le bouton précédent du
  // navigateur), on pré-remplit les champs plutôt que de les laisser vides.
  if (data.conducteur) {
    ["nom", "prenom", "email", "telephone", "permis", "age"].forEach((id) => {
      const input = form.querySelector(`[name="${id}"]`);
      if (input && data.conducteur[id] !== undefined) input.value = data.conducteur[id];
    });
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!validateDriverForm(form)) return;

    const formData = new FormData(form);
    const conducteur = Object.fromEntries(formData.entries());

    writeReservationLocal({
      ...data,
      assurance: assuranceCheckbox.checked,
      conducteur
    });
    window.location.href = "paiement.html";
  });
}

function validateDriverForm(form) {
  let valid = true;
  let firstInvalid = null;
  const champs = [
    { id: "nom", test: v => v.trim().length >= 2, msg: "Nom requis (2 caractères min.)" },
    { id: "prenom", test: v => v.trim().length >= 2, msg: "Prénom requis" },
    { id: "email", test: v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), msg: "Adresse e-mail invalide" },
    { id: "telephone", test: v => v.replace(/\D/g, "").length >= 8, msg: "Numéro de téléphone invalide" },
    { id: "permis", test: v => v.trim().length >= 4, msg: "Numéro de permis requis" },
    { id: "age", test: v => Number(v) >= 21, msg: "Le conducteur doit avoir 21 ans ou plus" }
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
   PAGE : paiement.html — paiement réel via Stripe
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

function buildPaymentSummary(container, vehicule, data, sousTotal, assuranceMontant, total) {
  container.textContent = "";
  const vehicleBlock = document.createElement("div");
  vehicleBlock.className = "summary-vehicle";
  vehicleBlock.innerHTML = vignetteVehicule(vehicule); // sûr : données véhicule internes uniquement

  const infoDiv = document.createElement("div");
  const nameDiv = document.createElement("div");
  nameDiv.className = "vehicle-name";
  nameDiv.textContent = vehicule.nom;
  const driverDiv = document.createElement("div");
  driverDiv.className = "hint-text";
  driverDiv.textContent = `${data.conducteur.prenom} ${data.conducteur.nom}`;
  const datesDiv = document.createElement("div");
  datesDiv.className = "hint-text";
  datesDiv.textContent = `${formatDateHeureFR(data.dateDebut, data.heureDebut)} — ${formatDateHeureFR(data.dateFin, data.heureFin)}`;
  infoDiv.append(nameDiv, driverDiv, datesDiv);
  vehicleBlock.appendChild(infoDiv);
  container.appendChild(vehicleBlock);

  container.appendChild(summaryRow(`Location (${data.jours} jours)`, formatEUR(sousTotal)));
  container.appendChild(summaryRow("Assurance", assuranceMontant > 0 ? formatEUR(assuranceMontant) : "—"));
  const totalRow = summaryRow("Total à régler", formatEUR(total));
  totalRow.classList.add("total");
  container.appendChild(totalRow);
}

function initPaiementPage() {
  const summary = document.getElementById("payment-summary");
  if (!summary) return;

  const data = readReservationLocal();
  if (!data || !data.conducteur) {
    window.location.href = "vehicules.html";
    return;
  }
  const vehicule = getVehiculeParId(data.vehiculeId);
  if (!vehicule) {
    window.location.href = "vehicules.html";
    return;
  }

  // Affichage strictement indicatif : le montant qui fait foi est
  // recalculé côté serveur lors de la création du PaymentIntent (voir
  // netlify/functions/create-payment-intent.js). Le client n'envoie jamais
  // ce total au serveur.
  function renderSummary() {
    const sousTotal = vehicule.prixJour * data.jours;
    const assuranceMontant = data.assurance ? PRIX_ASSURANCE_JOUR * data.jours : 0;
    const total = sousTotal + assuranceMontant;
    buildPaymentSummary(summary, vehicule, data, sousTotal, assuranceMontant, total);
  }
  renderSummary();

  // Barre de dates persistante : le client peut encore ajuster ses dates ici,
  // au moment où il voit le prix final — ex. rajouter un jour — sans revenir
  // en arrière. `data` (référencé par le formulaire de paiement plus bas au
  // moment de l'envoi) est mis à jour en place, donc le PaymentIntent créé
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

  const cardName = document.getElementById("card-name");
  const form = document.getElementById("payment-form");
  const payButton = document.getElementById("pay-button");
  const cardErrors = document.getElementById("stripe-card-errors");
  const banner = document.getElementById("info-banner");

  if (typeof Stripe === "undefined" || !window.STRIPE_PUBLISHABLE_KEY || window.STRIPE_PUBLISHABLE_KEY.includes("A_REMPLACER")) {
    showPaymentUnavailableFallback("Le paiement en ligne n'est pas encore configuré. Contactez-nous pour finaliser votre réservation :");
    return;
  }

  const stripe = Stripe(window.STRIPE_PUBLISHABLE_KEY);
  const elements = stripe.elements();
  const cardElement = elements.create("card", {
    style: {
      base: { fontSize: "16px", color: "#2a2438", "::placeholder": { color: "#8a969a" } },
      invalid: { color: "#d64545" }
    }
  });
  cardElement.mount("#stripe-card-element");
  cardElement.on("change", (event) => {
    cardErrors.textContent = event.error ? event.error.message : "";
  });

  // Générée une seule fois par chargement de page et réutilisée sur toute
  // nouvelle tentative de soumission : permet au serveur (via l'option
  // idempotencyKey transmise à Stripe) d'éviter de créer deux PaymentIntent
  // distincts si l'utilisateur soumet plusieurs fois (double clic, retry
  // réseau) sans avoir rechargé la page.
  const idempotencyKey = (window.crypto && typeof crypto.randomUUID === "function")
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    cardErrors.textContent = "";

    if (!cardName.value.trim() || cardName.value.trim().length < 2) {
      document.getElementById("err-card-name").textContent = "Nom du titulaire requis";
      cardName.setAttribute("aria-invalid", "true");
      cardName.focus();
      return;
    }
    document.getElementById("err-card-name").textContent = "";
    cardName.setAttribute("aria-invalid", "false");

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
      const response = await fetch("/.netlify/functions/create-payment-intent", {
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
          assurance: !!data.assurance,
          conducteur: data.conducteur,
          cglAccepted: true,
          cglVersion: CGL_VERSION,
          idempotencyKey
        })
      });
      const result = await response.json().catch(() => ({}));

      if (response.status === 503 && result.code === "stripe_not_configured") {
        showPaymentUnavailableFallback("Le paiement en ligne n'est pas encore disponible. Contactez-nous pour finaliser votre réservation :");
        return;
      }
      if (response.status === 409 && result.code === "not_available") {
        throw new Error("Ce véhicule vient d'être réservé sur ces dates. Merci de modifier vos dates ou de choisir un autre véhicule.");
      }
      if (response.status === 429) {
        throw new Error("Trop de tentatives. Merci de patienter quelques instants avant de réessayer.");
      }
      if (!response.ok || result.error || !result.clientSecret || !result.reservationId) {
        throw new Error("Le paiement n'a pas pu être initialisé. Merci de réessayer.");
      }

      const { paymentIntent, error } = await stripe.confirmCardPayment(result.clientSecret, {
        payment_method: {
          card: cardElement,
          billing_details: { name: cardName.value.trim(), email: data.conducteur.email }
        }
      });

      if (error) {
        throw new Error(error.message || "Paiement refusé.");
      }

      if (paymentIntent && paymentIntent.status === "succeeded") {
        // La confirmation qui fait foi vit désormais côté serveur
        // (reservation-status, confirmée par le webhook Stripe signé) : la
        // copie locale temporaire des données conducteur (dont le permis)
        // n'est plus nécessaire dans ce navigateur, on l'efface donc.
        clearJSON(STORAGE.reservation);
        window.location.href = `confirmation.html?reservation=${encodeURIComponent(result.reservationId)}`;
      } else {
        throw new Error("Le paiement n'a pas abouti (statut : " + (paymentIntent && paymentIntent.status) + ").");
      }
    } catch (err) {
      cardErrors.textContent = err.message;
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
// via le paramètre d'URL ?reservation=res_xxx, positionné par paiement.html
// après création du PaymentIntent (voir initPaiementPage).
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
    window.location.href = "index.html";
    return;
  }

  container.textContent = "Chargement de votre confirmation…";

  fetch(`/.netlify/functions/reservation-status?id=${encodeURIComponent(reservationId)}`)
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
  routeDiv.textContent = `${libelleLieu(data.lieuPrise, data.adressePrise) || ""} → ${libelleLieu(data.lieuRetour, data.adresseRetour) || ""}`;
  const datesDiv = document.createElement("div");
  datesDiv.className = "hint-text";
  datesDiv.textContent = `${formatDateHeureFR(data.dateDebut, data.heureDebut)} — ${formatDateHeureFR(data.dateFin, data.heureFin)} (${data.jours} jour${data.jours > 1 ? "s" : ""})`;
  infoDiv.append(nameDiv, routeDiv, datesDiv);
  vehicleBlock.appendChild(infoDiv);
  container.appendChild(vehicleBlock);

  if (data.conducteur) {
    container.appendChild(summaryRow("Conducteur", `${data.conducteur.prenom} ${data.conducteur.nom}`));
    container.appendChild(summaryRow("E-mail", data.conducteur.email));
  }
  container.appendChild(summaryRow("Paiement", "Confirmé via Stripe"));
  const totalRow = summaryRow("Montant réglé", formatEUR(data.total));
  totalRow.classList.add("total");
  container.appendChild(totalRow);
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

document.addEventListener("DOMContentLoaded", () => {
  setFooterYear();
  syncHeaderHeightVar();
  initMobileMenu();
  initSearchForm();
  initVehiculesPage();
  initReservationPage();
  initPaiementPage();
  initConfirmationPage();
  initTestimonialsSlider();
  initVehicleGalleries();
});

// Réajuste la position de la barre de dates persistante (--header-h) si la
// hauteur de l'en-tête change (rotation d'écran, ouverture du menu mobile
// qui n'affecte pas la hauteur mais par prudence en cas de futurs
// changements responsives).
window.addEventListener("resize", syncHeaderHeightVar);
