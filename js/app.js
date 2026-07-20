// Capver Tours — logique du site de démonstration
// Stockage local (localStorage) uniquement, pas de serveur : à remplacer par de vraies
// API (réservation + paiement Stripe côté serveur) pour une mise en production réelle.

const STORAGE = {
  recherche: "ct_recherche",
  selection: "ct_selection",
  reservation: "ct_reservation",
  confirmation: "ct_confirmation"
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

  LIEUX.forEach(lieu => {
    selectPrise.add(new Option(lieu, lieu));
    selectRetour.add(new Option(lieu, lieu));
  });
  selectRetour.value = LIEUX[0];

  inputDebut.min = todayISO();
  inputDebut.value = todayISO(2);
  inputFin.min = todayISO(3);
  inputFin.value = todayISO(5);

  inputDebut.addEventListener("change", () => {
    inputFin.min = todayISO(joursEntreOffset(inputDebut.value));
    if (inputFin.value < inputDebut.value) {
      const d = new Date(inputDebut.value);
      d.setDate(d.getDate() + 1);
      inputFin.value = d.toISOString().slice(0, 10);
    }
  });

  function joursEntreOffset(dateStr) {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + 1);
    return Math.round((d - new Date()) / (1000 * 60 * 60 * 24));
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    writeJSON(STORAGE.recherche, {
      lieuPrise: selectPrise.value,
      lieuRetour: selectRetour.value,
      dateDebut: inputDebut.value,
      dateFin: inputFin.value
    });
    window.location.href = "vehicules.html";
  });
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
    dateDebut: todayISO(2),
    dateFin: todayISO(5)
  });
  const jours = joursEntre(recherche.dateDebut, recherche.dateFin);

  const infoBar = document.getElementById("search-summary");
  if (infoBar) {
    infoBar.textContent = `${recherche.lieuPrise} · du ${formatDateFR(recherche.dateDebut)} au ${formatDateFR(recherche.dateFin)} (${jours} jour${jours > 1 ? "s" : ""})`;
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
      card.innerHTML = `
        <div class="vehicle-media">
          <img src="${v.photo}" alt="${v.nom}" class="vehicle-photo" onerror="this.remove()">
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
            <div class="price">${formatEUR(v.prixJour)}<small> / jour</small></div>
            <button class="btn btn-primary" data-id="${v.id}">Réserver</button>
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
function vignetteVehicule(v) {
  return `
    <div class="emoji">
      <img src="${v.photo}" alt="${v.nom}" class="vehicle-photo-sm" onerror="this.remove()">
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
          <div class="hint-text">${data.lieuPrise} → ${data.lieuRetour}</div>
          <div class="hint-text">${formatDateFR(data.dateDebut)} — ${formatDateFR(data.dateFin)} (${data.jours} jour${data.jours > 1 ? "s" : ""})</div>
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
   PAGE : paiement.html — simulation de paiement (type Stripe)
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

  summary.innerHTML = `
    <div class="summary-vehicle">
      ${vignetteVehicule(vehicule)}
      <div>
        <div class="vehicle-name">${vehicule.nom}</div>
        <div class="hint-text">${data.conducteur.prenom} ${data.conducteur.nom}</div>
        <div class="hint-text">${formatDateFR(data.dateDebut)} — ${formatDateFR(data.dateFin)}</div>
      </div>
    </div>
    <div class="summary-row"><span>Location (${data.jours} jours)</span><span>${formatEUR(sousTotal)}</span></div>
    <div class="summary-row"><span>Assurance</span><span>${assurance > 0 ? formatEUR(assurance) : "—"}</span></div>
    <div class="summary-row total"><span>Total à régler</span><span>${formatEUR(total)}</span></div>
  `;

  const cardNumber = document.getElementById("card-number");
  const cardExpiry = document.getElementById("card-expiry");
  const cardCvc = document.getElementById("card-cvc");
  const cardName = document.getElementById("card-name");
  const form = document.getElementById("payment-form");
  const payButton = document.getElementById("pay-button");

  cardNumber.addEventListener("input", () => {
    let digits = cardNumber.value.replace(/\D/g, "").slice(0, 16);
    cardNumber.value = digits.replace(/(.{4})/g, "$1 ").trim();
  });

  cardExpiry.addEventListener("input", () => {
    let digits = cardExpiry.value.replace(/\D/g, "").slice(0, 4);
    if (digits.length >= 3) digits = digits.slice(0, 2) + "/" + digits.slice(2);
    cardExpiry.value = digits;
  });

  cardCvc.addEventListener("input", () => {
    cardCvc.value = cardCvc.value.replace(/\D/g, "").slice(0, 3);
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!validatePaymentForm()) return;

    payButton.classList.add("loading");
    payButton.disabled = true;

    // Simulation d'un appel serveur Stripe (mode test / démo).
    // En production : créer un PaymentIntent côté serveur et confirmer avec Stripe.js.
    setTimeout(() => {
      const reference = "CT-" + Math.random().toString(36).slice(2, 8).toUpperCase();
      writeJSON(STORAGE.confirmation, {
        reference,
        vehiculeId: data.vehiculeId,
        dateDebut: data.dateDebut,
        dateFin: data.dateFin,
        jours: data.jours,
        lieuPrise: data.lieuPrise,
        lieuRetour: data.lieuRetour,
        conducteur: data.conducteur,
        assurance: data.assurance,
        total,
        carteFin: cardNumber.value.replace(/\s/g, "").slice(-4)
      });
      window.location.href = "confirmation.html";
    }, 1400);
  });

  function validatePaymentForm() {
    let valid = true;
    const rules = [
      { input: cardName, test: v => v.trim().length >= 2, err: "err-card-name", msg: "Nom du titulaire requis" },
      { input: cardNumber, test: v => v.replace(/\s/g, "").length === 16, err: "err-card-number", msg: "Numéro de carte invalide (16 chiffres)" },
      { input: cardExpiry, test: v => /^\d{2}\/\d{2}$/.test(v) && isExpiryValid(v), err: "err-card-expiry", msg: "Date d'expiration invalide" },
      { input: cardCvc, test: v => v.length === 3, err: "err-card-cvc", msg: "CVC invalide" }
    ];
    rules.forEach(({ input, test, err, msg }) => {
      const ok = test(input.value || "");
      if (!ok) valid = false;
      const el = document.getElementById(err);
      if (el) el.textContent = ok ? "" : msg;
    });
    return valid;
  }

  function isExpiryValid(v) {
    const [mm, yy] = v.split("/").map(Number);
    if (mm < 1 || mm > 12) return false;
    const now = new Date();
    const expiry = new Date(2000 + yy, mm);
    return expiry > now;
  }
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
        <div class="hint-text">${data.lieuPrise} → ${data.lieuRetour}</div>
        <div class="hint-text">${formatDateFR(data.dateDebut)} — ${formatDateFR(data.dateFin)} (${data.jours} jour${data.jours > 1 ? "s" : ""})</div>
      </div>
    </div>
    <div class="summary-row"><span>Conducteur</span><span>${data.conducteur.prenom} ${data.conducteur.nom}</span></div>
    <div class="summary-row"><span>E-mail</span><span>${data.conducteur.email}</span></div>
    <div class="summary-row"><span>Carte utilisée</span><span>•••• ${data.carteFin}</span></div>
    <div class="summary-row total"><span>Montant réglé</span><span>${formatEUR(data.total)}</span></div>
  `;
}

document.addEventListener("DOMContentLoaded", () => {
  setFooterYear();
  initSearchForm();
  initVehiculesPage();
  initReservationPage();
  initPaiementPage();
  initConfirmationPage();
});
