// js/contrat-en.js
//
// Version anglaise du CONTRAT DE LOCATION (PDF produit par contrat.html).
//
// Pourquoi un fichier à part et non js/i18n.js : i18n.js est chargé par
// toutes les pages publiques du site ; ces textes-ci ne servent qu'à
// contrat.html, page d'outil agence. Ils n'ont pas à peser sur chaque visite.
//
// PORTÉE JURIDIQUE — à lire avant toute modification :
// la version FRANÇAISE du contrat reste la seule qui fasse foi. Cette
// traduction est fournie au client anglophone pour sa compréhension, et le
// contrat le dit lui-même en tête des conditions (voir AVERTISSEMENT
// ci-dessous). Toute modification d'un article français DOIT être reportée
// ici : tests/contrat-en.test.js échoue sinon, en listant ce qui diverge.
//
// Les articles anglais reprennent les mêmes emplacements de valeurs que la
// version française (<span data-fill="...">) sous forme de jetons {nom} —
// mêmes noms, pour qu'un oubli se voie immédiatement.

(function (racine) {
  "use strict";

  // ---------------------------------------------------------------
  // Avertissement de traduction — en tête des conditions
  // ---------------------------------------------------------------
  //
  // Trois idées, dans cet ordre d'importance juridique :
  //   1. la version française prévaut (c'est la clause qui protège vraiment) ;
  //   2. le contrat est soumis au droit français et aux tribunaux français ;
  //   3. une erreur de traduction ne crée aucun droit ni obligation
  //      supplémentaire — formulée comme une règle d'interprétation, et non
  //      comme une exclusion générale de responsabilité, qui serait
  //      inopérante face à un consommateur (clause abusive).
  var AVERTISSEMENT = {
    titre: "Important — English translation",
    paragraphes: [
      "This document is an English translation of the French rental agreement provided for your convenience. "
        + "The French version is the only legally binding version: in the event of any difference, omission or "
        + "inconsistency between the two, the French wording alone applies.",
      "This agreement is governed by French law and subject to the jurisdiction of the French courts. "
        + "No translation error may create, extend or reduce any right or obligation of either party: the French "
        + "text alone determines what has been agreed.",
      "If any wording is unclear to you, please ask our team before signing — we will be glad to explain it. "
        + "The French version and the full General Rental Conditions are available at getlocation.fr/cgl.html."
    ]
  };

  // ---------------------------------------------------------------
  // Intitulés, libellés et petites phrases du PDF
  // Clé = texte français EXACT tel qu'écrit dans contrat.html.
  // ---------------------------------------------------------------
  var TEXTES = {
    // En-tête et statut
    "Contrat de location": "Rental agreement",
    "TLST SAS — Location de véhicules — Grasse, Alpes-Maritimes": "TLST SAS — Vehicle rental — Grasse, Alpes-Maritimes",
    "Contrat signé électroniquement": "Agreement signed electronically",
    "Aperçu — document non contractuel": "Preview — not a contractual document",
    "En attente de signature du locataire": "Awaiting the renter's signature",
    "En attente de signature": "Awaiting signature",

    // Section 1 — locataire
    "Locataire / conducteur principal": "Renter / main driver",
    "Nom / Prénom": "Name",
    "Date de naissance": "Date of birth",
    "Adresse": "Address",
    "Téléphone": "Telephone",
    "E-mail": "Email",
    "N° de permis": "Licence number",
    "Permis de conduire": "Driving licence",
    "Conducteur supplémentaire": "Additional driver",

    // Section 2 — véhicule
    "Véhicule": "Vehicle",
    "Immatriculation": "Registration",
    "Carburant": "Fuel",
    "N° de série (VIN)": "Chassis number (VIN)",

    // Section 3 — location
    "Location": "Rental",
    "Départ": "Pick-up",
    "Retour": "Return",
    "Lieu de départ et de retour": "Pick-up and return location",
    "Lieu": "Location",
    "Durée": "Duration",
    "Kilométrage inclus": "Mileage included",

    // Section 4 — tarification
    "Tarification": "Pricing",
    "Options": "Extras",
    "Remises": "Discounts",
    "Ajustement tarifaire": "Price adjustment",
    "TOTAL LOCATION": "RENTAL TOTAL",
    "État du règlement": "Payment status",
    "Acompte déjà réglé": "Amount already paid",
    "Reste à payer": "Balance due",
    "Remise commerciale": "Goodwill discount",
    "Ajustement tarif": "Price adjustment",
    "TOTAL": "TOTAL",
    "Total": "Total",
    "Sous-total": "Subtotal",

    // Section 5 — garantie
    "Garantie": "Security deposit",
    "Dépôt de garantie": "Security deposit",
    "Mode": "Method",
    "Franchises assurance": "Insurance excess",
    "Le dépôt de garantie ne constitue pas un paiement de la location : il est restitué selon les conditions de l'article 4.":
      "The security deposit is not a payment towards the rental: it is returned in accordance with Article 4.",

    // Conditions
    "Principales conditions de location": "Main rental conditions",
    "Article": "Article",
    "Déclaration du locataire": "Renter's declaration",
    "Signatures": "Signatures",
    "Signature du locataire": "Renter's signature",
    "Validation GETLOCATION": "GETLOCATION approval",
    "Nom": "Name",
    "Date": "Date",
    "GETLOCATION — TLST SAS": "GETLOCATION — TLST SAS",
    "Contrat établi par l'agence": "Agreement issued by the agency",
    "Identifiant de signature :": "Signature reference:",
    "Remarques particulières": "Special remarks",

    // Annexe — état des lieux
    "Annexe — état des lieux du véhicule": "Appendix — vehicle condition report",
    "Date et heure": "Date and time",
    "Kilométrage": "Odometer",
    "État intérieur (propreté)": "Interior condition (cleanliness)",
    "État extérieur (dommages)": "Exterior condition (damage)",
    "Clés et accessoires": "Keys and accessories",
    "Agent": "Agent",
    "Signature client": "Customer signature",
    "Signature agence": "Agency signature",
    "Distance parcourue": "Distance travelled",
    "Kilométrage supplémentaire": "Additional mileage",
    "Aucun dépassement": "Within the allowance",
    "Kilométrage parcouru calculé une fois les relevés de départ et de retour renseignés.":
      "Distance travelled is calculated once the pick-up and return odometer readings have been entered.",
    "Repères : X = rayure — cercle = bosse / impact — point plein = éclat / petit impact":
      "Key: X = scratch — circle = dent / impact — solid dot = chip / minor impact",
    "Véhicule au départ": "Vehicle at pick-up",
    "Véhicule au retour": "Vehicle at return",
    "Observations au départ": "Observations at pick-up",
    "Observations au retour": "Observations at return",
    "Observations complémentaires": "Further observations",
    "À compléter": "To be completed",
    "Annexe photo": "Photo appendix",

    // Pied de page
    "Contrat de location (pied)": "Rental agreement",

    // Valeurs composées (modes de règlement, options, carburants)
    "Carte bancaire": "Bank card",
    "Espèces": "Cash",
    "Virement bancaire": "Bank transfer",

    // Options et lieux — repris de js/data.js, comme sur le site. Les
    // traductions doivent rester identiques à celles de js/i18n.js :
    // tests/contrat-en.test.js échoue si les deux divergent.
    // « Conducteur supplémentaire » est déjà traduit plus haut (intitulé de
    // bloc) : même texte français, même traduction, une seule entrée.
    "Forfait 200 km supplémentaires": "200 km extra mileage package",
    "Forfait 300 km supplémentaires": "300 km extra mileage package",
    "Forfait 400 km supplémentaires": "400 km extra mileage package",
    "Service de plein / recharge": "Refuelling / recharging service",
    "Siège bébé": "Baby seat",
    "Siège enfant": "Child seat",
    "Rehausseur enfant": "Booster seat",
    "Assurance passagers / accident": "Passenger / accident cover",
    "Livraison du véhicule": "Vehicle delivery",
    "Livraison à l'adresse de votre choix": "Delivery to the address of your choice",
    "Oui": "Yes",
    "Non": "No",
    "durée": "length of rental",
    "remise commerciale": "goodwill discount",
    "Essence": "Petrol",
    "Diesel": "Diesel",
    "Hybride essence": "Petrol hybrid",
    "Hybride": "Hybrid",
    "Électrique": "Electric",
    "Automatique": "Automatic",
    "Manuelle": "Manual"
  };

  // Libellés des cinq vues du schéma de l'état des lieux (voir DMG_VIEWS).
  var VUES = {
    "Avant": "Front",
    "Arrière": "Rear",
    "Côté gauche": "Left side",
    "Côté droit": "Right side",
    "Toit": "Roof",
    "Dessus": "Top"
  };

  // ---------------------------------------------------------------
  // Articles — traduction de #contractText (contrat.html)
  // Les jetons {nom} correspondent aux data-fill de la version française.
  // ---------------------------------------------------------------
  var ARTICLES = [
    {
      titre: "Article 1 — Subject and term",
      paragraphes: [
        "GETLOCATION (TLST SAS) rents to the renter named above the vehicle {vehicule}, registration {immat}, "
          + "from {depart} to {retour} ({duree}). Location: {lieu}."
      ]
    },
    {
      titre: "Article 2 — Price and payment",
      paragraphes: [
        "Total rental amount: {total}. The breakdown (daily rate, any discount, extras) is set out in the financial "
          + "summary above. Deposit payment of {montantRegle}: {detailAcompte}. Remaining balance of {soldeRestant}: {detailSolde}."
      ]
    },
    {
      titre: "Article 3 — Mileage and fuel",
      paragraphes: [
        "The vehicle is rented with an allowance of {kmInclusParJour} km included per rental day, that is {kmInclus} km "
          + "in total for the term of this agreement. Every kilometre beyond that allowance is charged at {supplementKm} / km "
          + "(see the handover and return table for the pick-up and return odometer readings). The vehicle must be returned "
          + "with the same fuel level as at pick-up."
      ],
      gras: ["{kmInclusParJour} km included per rental day", "{supplementKm} / km"]
    },
    {
      titre: "Article 4 — Security deposit and insurance",
      paragraphes: [
        "A security deposit of {caution} is taken before the keys are handed over, paid by {modeCaution}. The vehicle is "
          + "covered by third-party liability insurance and the additional cover in force, taken out with Allianz Assurance; "
          + "the excess applicable in the event of an at-fault accident, theft or glass breakage is not necessarily equal to "
          + "this security deposit — the amounts are set out in the General Rental Conditions. A condition report (photographs, "
          + "odometer reading, fuel level) is carried out at pick-up and at return; any damage not recorded at pick-up will be "
          + "charged on the basis of a repair quotation.",
        "On return of the vehicle and once the joint return condition report has been agreed: where the deposit was taken as a "
          + "card pre-authorisation, GETLOCATION releases it within 7 working days. Where the deposit was paid in cash or by bank "
          + "transfer, it is returned by bank transfer to the account details provided by the renter, within a minimum of 7 working "
          + "days — no cash refund is made on the spot at the time of return. In the event of damage, cleaning required, missing "
          + "fuel or a recorded traffic offence, GETLOCATION may retain all or part of the security deposit for the time needed to "
          + "assess the costs, for no more than 30 days (full details in the General Rental Conditions)."
      ],
      clauses: {
        secondConducteur: "An additional driver, {nom2} (licence no. {permis2}), is authorised to drive the vehicle on the same "
          + "terms as the main renter, who alone remains liable under this agreement.",
        ribClient: "Bank details provided by the renter for the return of the security deposit: IBAN {ribIban}, account holder {ribTitulaire}."
      }
    },
    {
      titre: "Article 5 — Return, late return and incidents",
      paragraphes: [
        "The vehicle must be returned at the agreed place, date and time. Any late return not notified in advance is charged in "
          + "accordance with the scale set out in the General Rental Conditions — no amount is set unilaterally outside that scale. "
          + "In the event of an accident, breakdown, theft or any other incident, the renter must contact GETLOCATION immediately on "
          + "+33 6 67 48 54 30 and follow the procedure described in the General Rental Conditions."
      ],
      gras: ["+33 6 67 48 54 30"]
    },
    {
      titre: "Article 6 — Acceptance of the General Rental Conditions",
      paragraphes: [
        "This agreement sets out the essential points of the rental; the complete rules (driver and licence, cancellation, traffic "
          + "fines, use of the vehicle, territory, extension, no-show, liability in the event of an accident, governing law, etc.) are "
          + "set out in the General Rental Conditions — version {cglVersion}, available at cgl.html and made available to the renter "
          + "before signature. The renter acknowledges having read them and accepts them without reservation, together with all the "
          + "information above. This agreement is governed by French law."
      ]
    }
  ];

  // Déclaration du locataire — même forme que la version française
  // ("intro : point ; point ; …"), pour que le découpage en puces du PDF
  // fonctionne à l'identique.
  var DECLARATION = "By signing this agreement, the renter declares : that the information provided above is accurate ; "
    + "that they hold a valid driving licence ; that they have read this agreement and the General Rental Conditions (cgl.html) ; "
    + "that they accept the rental conditions and the applicable pricing ; that they acknowledge the condition of the vehicle as "
    + "recorded at handover (see the handover and return table).";

  // ---------------------------------------------------------------
  // Fonctions
  // ---------------------------------------------------------------

  // Traduit un intitulé. Renvoie le texte français inchangé s'il n'est pas
  // au dictionnaire : un oubli laisse une ligne en français, jamais un trou
  // ni une clé technique sur un document remis à un client.
  function texte(valeur) {
    var brut = String(valeur === undefined || valeur === null ? "" : valeur);
    if (TEXTES[brut] !== undefined) return TEXTES[brut];
    if (VUES[brut] !== undefined) return VUES[brut];
    return brut;
  }

  // « 5 jours », « 3 heures », « 2 jours 4 heures » -> anglais.
  function duree(valeur) {
    return String(valeur)
      .replace(/(\d+)\s+jours?/g, function (_, n) { return n + " day" + (Number(n) > 1 ? "s" : ""); })
      .replace(/(\d+)\s+heures?/g, function (_, n) { return n + " hour" + (Number(n) > 1 ? "s" : ""); });
  }

  function remplacerJetons(modele, valeurs) {
    return String(modele).replace(/\{([a-zA-Z0-9]+)\}/g, function (entier, nom) {
      var valeur = valeurs[nom];
      return valeur === undefined || valeur === null || valeur === "" ? "…" : String(valeur);
    });
  }

  // Articles anglais prêts à imprimer, dans la forme attendue par le PDF
  // ({ titre, paragraphes }). `valeurs` porte les mêmes noms que les
  // data-fill de la version française ; `options` dit quelles clauses
  // conditionnelles inclure.
  function articles(valeurs, options) {
    var choix = options || {};
    return ARTICLES.map(function (article) {
      var paragraphes = article.paragraphes.map(function (p) { return remplacerJetons(p, valeurs); });
      if (article.clauses) {
        if (choix.secondConducteur && article.clauses.secondConducteur) {
          paragraphes.push(remplacerJetons(article.clauses.secondConducteur, valeurs));
        }
        if (choix.ribClient && article.clauses.ribClient) {
          paragraphes.push(remplacerJetons(article.clauses.ribClient, valeurs));
        }
      }
      return { titre: article.titre, paragraphes: paragraphes };
    });
  }

  // Termes mis en gras à l'intérieur des articles (montants clés), une fois
  // les jetons remplacés.
  function termesEnGras(valeurs) {
    var termes = [];
    ARTICLES.forEach(function (article) {
      (article.gras || []).forEach(function (terme) { termes.push(remplacerJetons(terme, valeurs)); });
    });
    return termes;
  }

  var CONTRAT_EN = {
    AVERTISSEMENT: AVERTISSEMENT,
    TEXTES: TEXTES,
    VUES: VUES,
    ARTICLES: ARTICLES,
    DECLARATION: DECLARATION,
    texte: texte,
    duree: duree,
    articles: articles,
    termesEnGras: termesEnGras,
    remplacerJetons: remplacerJetons
  };

  if (typeof module !== "undefined" && module.exports) module.exports = CONTRAT_EN;
  if (racine) racine.CONTRAT_EN = CONTRAT_EN;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : null));
