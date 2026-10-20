const {
  calculerPrixTotal,
  creerConditionsKilometriquesContrat,
  joursFacturablesPourPeriode,
  joursFacturablesDepuisHeures,
  kmInclusPourJours
} = require("../../js/data.js");

function splitDateTime(value) {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(String(value || ""));
  return match ? { date: match[1], time: match[2] } : null;
}

function billedDays(record) {
  if (record && record.dateDebut && record.heureDebut && record.dateFin && record.heureFin) {
    return joursFacturablesPourPeriode(record.dateDebut, record.heureDebut, record.dateFin, record.heureFin);
  }
  const start = splitDateTime(record && (record.depart || record.periodeDebut));
  const end = splitDateTime(record && (record.retour || record.periodeFin));
  if (start && end) return joursFacturablesPourPeriode(start.date, start.time, end.date, end.time);
  const duration = record && record.periodeDebut && record.periodeFin
    ? (new Date(record.periodeFin) - new Date(record.periodeDebut)) / 3600000
    : NaN;
  return joursFacturablesDepuisHeures(duration);
}

function optionIds(record) {
  if (Array.isArray(record && record.options)) {
    return record.options.map((item) => typeof item === "string" ? item : item && item.id).filter(Boolean);
  }
  const result = [];
  if (record && record.secondConducteur) result.push("second-conducteur");
  if (record && record.livraison) result.push("livraison-adresse");
  if (record && record.kmForfait) result.push(record.kmForfait);
  if (record && record.siegeEnfant) result.push("siege-enfant");
  if (record && record.rehausseur) result.push("rehausseur");
  return result;
}

function standardIncludedMileage(record, days) {
  const snapshot = Number(record && record.pricingSnapshot && record.pricingSnapshot.kilometresInclus);
  if (Number.isFinite(snapshot) && snapshot >= 0) return Math.round(snapshot);
  const start = splitDateTime(record && (record.depart || record.periodeDebut));
  const end = splitDateTime(record && (record.retour || record.periodeFin));
  if (start && end && record && record.vehiculeId) {
    const price = calculerPrixTotal({
      vehiculeId: record.vehiculeId,
      dateDebut: start.date,
      heureDebut: start.time,
      dateFin: end.date,
      heureFin: end.time,
      options: optionIds(record),
      codePromo: record.codePromo || "",
      protection: record.protection
    });
    if (price && Number.isFinite(price.kmInclus)) return Math.round(price.kmInclus);
  }
  return kmInclusPourJours(days, record && record.vehiculeId);
}

function normalizeContractMileage(record, requested) {
  const days = billedDays(record);
  const source = requested && typeof requested === "object" ? requested : {};
  if (source.mode === "custom") {
    const perDay = Number(source.kilometresInclusParJour);
    const cents = Number(source.supplementKmCentimes);
    if (!Number.isInteger(perDay) || perDay < 0 || !Number.isInteger(cents) || cents < 0) {
      const error = new Error("Conditions kilométriques personnalisées invalides");
      error.status = 400;
      throw error;
    }
  }
  const storedStandardTotal = source.mode !== "custom" && Number(source.kilometresInclusTotal);
  return creerConditionsKilometriquesContrat({
    mode: source.mode,
    kilometresInclusParJour: source.kilometresInclusParJour,
    supplementKmCentimes: source.supplementKmCentimes,
    joursFactures: days,
    vehiculeId: record && record.vehiculeId,
    kilometresInclusStandard: Number.isFinite(storedStandardTotal) && storedStandardTotal >= 0
      ? storedStandardTotal
      : standardIncludedMileage(record, days)
  });
}

function agreedTotal(record) {
  const manual = record && record.tarifManuel && record.montantFinalConvenu !== "" && Number.isFinite(Number(record.montantFinalConvenu));
  if (manual) return Math.round(Number(record.montantFinalConvenu) * 100) / 100;
  const total = Number(record && record.total);
  if (Number.isFinite(total)) return Math.round(total * 100) / 100;
  const start = splitDateTime(record && record.depart);
  const end = splitDateTime(record && record.retour);
  if (!start || !end || !record || !record.vehiculeId) return null;
  const price = calculerPrixTotal({
    vehiculeId: record.vehiculeId,
    dateDebut: start.date,
    heureDebut: start.time,
    dateFin: end.date,
    heureFin: end.time,
    options: optionIds(record),
    codePromo: record.codePromo || "",
    protection: record.protection
  });
  return price ? Math.round(price.total * 100) / 100 : null;
}

module.exports = { billedDays, normalizeContractMileage, agreedTotal };
