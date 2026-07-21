// Capver Tours — logique du site de démonstration
// Stockage local (localStorage) uniquement, pas de serveur : à remplacer par de vraies
// API (réservation + paiement Stripe côté serveur) pour une mise en production réelle.

const STORAGE = {
  recherche: "ct_recherche",
  selection: "ct_selection",
  reservation: "ct_reservation",
  confirmation: "ct_confirmation"
};

// Horaires d'ouverture pour la prise en charge / restitution des véhicules.
const HEURE_OUVERTURE = "08:00";
const HEURE_FERMETURE = "19:00";

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

function setFooterYear() {
  const el = document.getElementById("footer-year");
  if (el) el.textContent = new Date().getFullYear();
}

/* ---------------------------------------------------------
   PAGE : index.html — formulaire de recherche
--------------------------------------------------------- */
function initSearchForm() {
  const form = document.getElementById("search-form");
  if (!form) return;

  const selectPrise = document.getElementById("lieu-prise");
  const selectRetour = document.getElementById("lieu-retour");
  const inputDebut = document.getElementById("date-debut");
  const inputFin = document.getElementById("date-fin");
  const selectHeureDebut = document.getElementById("heure-debut");
  const selectHeureFin = document.getElementById("heure-fin");
  const champAdressePrise = document.getElementById("adresse-prise-field");
  const inputAdressePrise = document.getElementById("adresse-prise");
  const champAdresseRetour = document.getElementById("adresse-retour-field");
  const inputAdresseRetour = document.getElementById("adresse-retour");

  LIEUX.forEach(lieu => {
    selectPrise.add(new Option(lieu, lieu));
    selectRetour.add(new Option(lieu, lieu));
  });
  selectRetour.value = LIEUX[0];

  // Affiche/masque le champ d'adresse libre selon que "Livraison" est
  // sélectionné comme lieu de prise en charge ou de restitution.
  function majChampAdresse(select, champ, input) {
    if (!champ || !input) return;
    const estLivraison = select.value === LIEU_LIVRAISON;
    champ.style.display = estLivraison ? "" : "none";
    input.required = estLivraison;
    if (!estLivraison) input.value = "";
  }

  if (selectPrise) {
    majChampAdresse(selectPrise, champAdressePrise, inputAdressePrise);
    selectPrise.addEventListener("change", () => majChampAdresse(selectPrise, champAdressePrise, inputAdressePrise));
  }
  if (selectRetour) {
    majChampAdresse(selectRetour, champAdresseRetour, inputAdresseRetour);
    selectRetour.addEventListener("change", () => majChampAdresse(selectRetour, champAdresseRetour, inputAdresseRetour));
  }

  // Remplit un <select> avec la liste des horaires d'ouverture (08:00 à 19:00,
  // par pas de 30 min) : garantit qu'on ne peut choisir qu'un créneau valide.
  function remplirHeures(select) {
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
  remplirHeures(selectHeureDebut);
  remplirHeures(selectHeureFin);

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
    writeJSON(STORAGE.recherche, {
      lieuPrise: selectPrise.value,
      lieuRetour: selectRetour.value,
      adressePrise: (selectPrise.value === LIEU_LIVRAISON && inputAdressePrise) ? inputAdressePrise.value.trim() : "",
      adresseRetour: (selectRetour.value === LIEU_LIVRAISON && inputAdresseRetour) ? inputAdresseRetour.value.trim() : "",
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

  const dureeHeures = dureeEnHeures(recherche.dateDebut, recherche.heureDebut, recherche.dateFin, recherche.heureFin);
  const jours = joursFacturablesDepuisHeures(dureeHeures);

  const infoBar = document.getElementById("search-summary");
  if (infoBar) {
    infoBar.textContent = `${libelleLieu(recherche.lieuPrise, recherche.adressePrise)} · du ${formatDateHeureFR(recherche.dateDebut, recherche.heureDebut)} au ${formatDateHeureFR(recherche.dateFin, recherche.heureFin)} (${jours} jour${jours > 1 ? "s" : ""})`;
  }

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
          ${pictureVehicule(v, "vehicle-photo")}
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
        writeJSON(STORAGE.reservation, {
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
}

function formatDateFR(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

// Vignette véhicule : affiche la vraie photo si le fichier images/xxx.jpg existe,
// sinon repli automatique sur l'emoji (aucune photo fournie pour l'instant).
// Génère un <picture> WebP + repli JPG + repli emoji, avec lazy loading et
// dimensions explicites (évite le layout shift / bon score CLS).
function pictureVehicule(v, imgClass) {
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
const PRIX_ASSURANCE_JOUR = 8;

function initReservationPage() {
  const container = document.getElementById("reservation-summary");
  if (!container) return;

  const data = readJSON(STORAGE.reservation, null);
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

  function render() {
    const sousTotal = vehicule.prixJour * data.jours;
    const assurance = assuranceCheckbox.checked ? PRIX_ASSURANCE_JOUR * data.jours : 0;
    const total = sousTotal + assurance;

    container.innerHTML = `
      <div class="summary-vehicle">
        ${vignetteVehicule(vehicule)}
        <div>
          <div class="vehicle-name">${vehicule.nom}</div>
          <div class="hint-text">${libelleLieu(data.lieuPrise, data.adressePrise)} → ${libelleLieu(data.lieuRetour, data.adresseRetour)}</div>
          <div class="hint-text">${formatDateHeureFR(data.dateDebut, data.heureDebut)} — ${formatDateHeureFR(data.dateFin, data.heureFin)} (${data.jours} jour${data.jours > 1 ? "s" : ""})</div>
        </div>
      </div>
      <div class="summary-row"><span>Location (${data.jours} × ${formatEUR(vehicule.prixJour)})</span><span>${formatEUR(sousTotal)}</span></div>
      <div class="summary-row"><span>Assurance tous risques</span><span>${assurance > 0 ? formatEUR(assurance) : "—"}</span></div>
      <div class="summary-row total"><span>Total</span><span>${formatEUR(total)}</span></div>
    `;
  }

  assuranceCheckbox.addEventListener("change", () => {
    data.assurance = assuranceCheckbox.checked;
    render();
  });

  render();

  const form = document.getElementById("driver-form");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!validateDriverForm(form)) return;

    const formData = new FormData(form);
    const conducteur = Object.fromEntries(formData.entries());

    writeJSON(STORAGE.reservation, {
      ...data,
      assurance: assuranceCheckbox.checked,
      conducteur
    });
    window.location.href = "paiement.html";
  });
}

function validateDriverForm(form) {
  let valid = true;
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
    if (!ok) valid = false;
    if (errorEl) errorEl.textContent = ok ? "" : msg;
  });

  return valid;
}

/* ---------------------------------------------------------
   PAGE : paiement.html — paiement réel via Stripe
--------------------------------------------------------- */
function initPaiementPage() {
  const summary = document.getElementById("payment-summary");
  if (!summary) return;

  const data = readJSON(STORAGE.reservation, null);
  if (!data || !data.conducteur) {
    window.location.href = "vehicules.html";
    return;
  }
  const vehicule = getVehiculeParId(data.vehiculeId);

  const sousTotal = vehicule.prixJour * data.jours;
  const assurance = data.assurance ? PRIX_ASSURANCE_JOUR * data.jours : 0;
  const total = sousTotal + assurance;
  const totalCentimes = Math.round(total * 100);

  summary.innerHTML = `
    <div class="summary-vehicle">
      ${vignetteVehicule(vehicule)}
      <div>
        <div class="vehicle-name">${vehicule.nom}</div>
        <div class="hint-text">${data.conducteur.prenom} ${data.conducteur.nom}</div>
        <div class="hint-text">${formatDateHeureFR(data.dateDebut, data.heureDebut)} — ${formatDateHeureFR(data.dateFin, data.heureFin)}</div>
      </div>
    </div>
    <div class="summary-row"><span>Location (${data.jours} jours)</span><span>${formatEUR(sousTotal)}</span></div>
    <div class="summary-row"><span>Assurance</span><span>${assurance > 0 ? formatEUR(assurance) : "—"}</span></div>
    <div class="summary-row total"><span>Total à régler</span><span>${formatEUR(total)}</span></div>
  `;

  const cardName = document.getElementById("card-name");
  const form = document.getElementById("payment-form");
  const payButton = document.getElementById("pay-button");
  const cardErrors = document.getElementById("stripe-card-errors");
  const banner = document.getElementById("info-banner");

  if (typeof Stripe === "undefined" || !window.STRIPE_PUBLISHABLE_KEY || window.STRIPE_PUBLISHABLE_KEY.includes("A_REMPLACER")) {
    if (banner) {
      banner.textContent = "Paiement non configuré : la clé Stripe publique n'a pas encore été renseignée (js/stripe-config.js).";
    }
    payButton.disabled = true;
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

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    cardErrors.textContent = "";

    if (!cardName.value.trim() || cardName.value.trim().length < 2) {
      document.getElementById("err-card-name").textContent = "Nom du titulaire requis";
      return;
    }
    document.getElementById("err-card-name").textContent = "";

    payButton.classList.add("loading");
    payButton.disabled = true;

    try {
      const response = await fetch("/.netlify/functions/create-payment-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: totalCentimes,
          currency: "eur",
          description: `Location ${vehicule.nom} — ${data.jours} jour(s)`,
          receiptEmail: data.conducteur.email
        })
      });
      const result = await response.json();

      if (!response.ok || result.error) {
        throw new Error(result.error || "Le paiement n'a pas pu être initialisé.");
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
        const reference = "GL-" + paymentIntent.id.slice(-8).toUpperCase();
        writeJSON(STORAGE.confirmation, {
          reference,
          vehiculeId: data.vehiculeId,
          dateDebut: data.dateDebut,
          dateFin: data.dateFin,
          heureDebut: data.heureDebut,
          heureFin: data.heureFin,
          jours: data.jours,
          lieuPrise: data.lieuPrise,
          lieuRetour: data.lieuRetour,
          adressePrise: data.adressePrise,
          adresseRetour: data.adresseRetour,
          conducteur: data.conducteur,
          assurance: data.assurance,
          total,
          paymentIntentId: paymentIntent.id
        });
        window.location.href = "confirmation.html";
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
function initConfirmationPage() {
  const container = document.getElementById("confirmation-details");
  if (!container) return;

  const data = readJSON(STORAGE.confirmation, null);
  if (!data) {
    window.location.href = "index.html";
    return;
  }
  const vehicule = getVehiculeParId(data.vehiculeId);

  document.getElementById("confirmation-ref").textContent = data.reference;

  container.innerHTML = `
    <div class="summary-vehicle">
      ${vignetteVehicule(vehicule)}
      <div>
        <div class="vehicle-name">${vehicule.nom}</div>
        <div class="hint-text">${libelleLieu(data.lieuPrise, data.adressePrise)} → ${libelleLieu(data.lieuRetour, data.adresseRetour)}</div>
        <div class="hint-text">${formatDateHeureFR(data.dateDebut, data.heureDebut)} — ${formatDateHeureFR(data.dateFin, data.heureFin)} (${data.jours} jour${data.jours > 1 ? "s" : ""})</div>
      </div>
    </div>
    <div class="summary-row"><span>Conducteur</span><span>${data.conducteur.prenom} ${data.conducteur.nom}</span></div>
    <div class="summary-row"><span>E-mail</span><span>${data.conducteur.email}</span></div>
    <div class="summary-row"><span>Paiement</span><span>Confirmé via Stripe</span></div>
    <div class="summary-row total"><span>Montant réglé</span><span>${formatEUR(data.total)}</span></div>
  `;
}

/* ---------------------------------------------------------
   Slider "Avis clients" — structure facilement modifiable.
   ATTENTION : ces avis sont des exemples de démonstration (placeholders).
   Remplacer par de vrais avis clients avant mise en production, et ne pas
   ajouter de balisage Schema.org Review/AggregateRating tant que les avis
   ne sont pas authentiques (risque de pénalité Google + tromperie client).
--------------------------------------------------------- */
const TEMOIGNAGES = [
  { texte: "Service impeccable, tout s'est fait en ligne en quelques minutes.", auteur: "Client GETLOCATION" },
  { texte: "Voiture neuve et parfaitement propre à la prise en charge.", auteur: "Client GETLOCATION" },
  { texte: "Livraison à l'aéroport de Nice à l'heure convenue, très pratique.", auteur: "Client GETLOCATION" }
];

function initTestimonialsSlider() {
  const root = document.querySelector(".testimonials");
  if (!root) return;
  const track = root.querySelector(".testimonial-track");
  const dotsWrap = root.querySelector(".testimonial-dots");
  if (!track) return;

  track.innerHTML = TEMOIGNAGES.map((t, i) => `
    <div class="testimonial-slide${i === 0 ? " active" : ""}" role="group" aria-roledescription="slide" aria-label="Avis ${i + 1} sur ${TEMOIGNAGES.length}">
      <div class="testimonial-stars" aria-hidden="true">★★★★★</div>
      <p class="testimonial-quote">« ${t.texte} »</p>
      <div class="testimonial-author">${t.auteur}</div>
    </div>
  `).join("");

  if (dotsWrap) {
    dotsWrap.innerHTML = TEMOIGNAGES.map((_, i) =>
      `<button type="button" class="testimonial-dot${i === 0 ? " active" : ""}" aria-label="Aller à l'avis ${i + 1}"></button>`
    ).join("");
  }

  const slides = root.querySelectorAll(".testimonial-slide");
  const dots = root.querySelectorAll(".testimonial-dot");
  let index = 0;
  let timer = null;

  function show(i) {
    index = (i + slides.length) % slides.length;
    slides.forEach((s, si) => s.classList.toggle("active", si === index));
    dots.forEach((d, di) => d.classList.toggle("active", di === index));
  }

  function restartAutoplay() {
    if (timer) clearInterval(timer);
    if (slides.length > 1) timer = setInterval(() => show(index + 1), 6000);
  }

  root.querySelectorAll(".testimonial-arrow").forEach(btn => {
    btn.addEventListener("click", () => {
      show(index + (btn.dataset.dir === "prev" ? -1 : 1));
      restartAutoplay();
    });
  });

  dots.forEach((d, i) => d.addEventListener("click", () => { show(i); restartAutoplay(); }));

  restartAutoplay();
}

document.addEventListener("DOMContentLoaded", () => {
  setFooterYear();
  initSearchForm();
  initVehiculesPage();
  initReservationPage();
  initPaiementPage();
  initConfirmationPage();
  initTestimonialsSlider();
  initVehicleGalleries();
});
