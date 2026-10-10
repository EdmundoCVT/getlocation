/* Moteur tarifaire GET LOCATION — configuration et calculs centralisés.
 * Chargé par le navigateur et requis côté Worker : aucun montant client ne
 * fait foi, le Worker recalcule toujours ce devis avant paiement. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.GETLOCATION_PRICING = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  // Les clés restent stables dans le code ; les libellés sont ceux affichés
  // au client. Le rang est explicite afin qu'une période commerciale ne
  // puisse jamais réduire le tarif saisonnier.
  const LEVELS = { low: "BASSE", normal: "NORMALE", high: "FORTE", veryHigh: "TRÈS FORTE", exceptional: "EXCEPTIONNELLE" };
  const LEVEL_PRIORITY = { low: 1, normal: 2, high: 3, veryHigh: 4, exceptional: 5 };
  const VEHICLE_RATES = {
    "opel-corsa": { low: 49, normal: 55, high: 59, veryHigh: 65, exceptional: 79 },
    "peugeot-2008-hybrid": { low: 59, normal: 65, high: 75, veryHigh: 79, exceptional: 95 },
    "peugeot-3008": { low: 99, normal: 99, high: 99, veryHigh: 99, exceptional: 119 },
    "toyota-proace-city": { low: 79, normal: 89, high: 99, veryHigh: 109, exceptional: 129 }
  };
  const MONTH_SEASONS = { 1: "low", 2: "low", 3: "normal", 4: "normal", 5: "high", 6: "high", 7: "veryHigh", 8: "veryHigh", 9: "high", 10: "normal", 11: "low", 12: "low" };
  const SPECIAL_PERIODS = [
    ["MIPCOM", "2026-10-11", "2026-10-16", "veryHigh"], ["IGTM + événements Cannes", "2026-10-20", "2026-10-24", "high"], ["Mare di Moda", "2026-10-27", "2026-10-29", "high"],
    ["MAPIC / Luxe Convergence", "2026-11-02", "2026-11-06", "high"], ["SOFCOT", "2026-11-11", "2026-11-13", "high"], ["World Quantum Cannes Festival", "2026-11-17", "2026-11-18", "high"], ["Meetings Weyou", "2026-11-25", "2026-11-26", "high"], ["ILTM", "2026-11-30", "2026-12-04", "veryHigh"], ["Fêtes de fin d’année", "2026-12-19", "2027-01-03", "high"], ["NOUVEL AN", "2026-12-29", "2027-01-02", "exceptional"],
    ["MIDEM", "2027-01-18", "2027-01-22", "high"], ["Canneseries", "2027-02-10", "2027-02-17", "high"], ["Festival International des Jeux", "2027-02-25", "2027-03-01", "high"], ["MIPIM", "2027-03-15", "2027-03-20", "veryHigh"], ["AMWC", "2027-04-01", "2027-04-03", "high"], ["Health from Space", "2027-04-06", "2027-04-07", "high"], ["Ethereum Community Conference", "2027-04-11", "2027-04-16", "high"], ["Festival de Cannes", "2027-05-10", "2027-05-23", "exceptional"], ["Grand Prix de Monaco", "2027-06-03", "2027-06-07", "exceptional"], ["Cannes Lions", "2027-06-20", "2027-06-26", "exceptional"], ["Monaco Yacht Show", "2027-09-21", "2027-09-26", "exceptional"]
  ].map(([name, start, end, level]) => ({ name, start, end, level }));
  const DURATION_DISCOUNTS = [[5, 6, .05], [7, 13, .10], [14, 29, .15], [30, Infinity, .20]];
  const EXTRA_MILEAGE_PACKAGES = { "km-200": { km: 200, amount: 60 }, "km-supplementaire": { km: 300, amount: 100 }, "km-400": { km: 400, amount: 150 } };
  const DELIVERY = { pickupFee: 20, perKm: 1, minimum: 25 };

  const PARIS_TIME_ZONE = "Europe/Paris";
  const parisDateParts = new Intl.DateTimeFormat("en-CA", { timeZone: PARIS_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const parisOffset = new Intl.DateTimeFormat("en", { timeZone: PARIS_TIME_ZONE, timeZoneName: "longOffset" });

  function parseDateTime(date, time) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || "");
    const timeMatch = /^(\d{2}):(\d{2})$/.exec(time || "");
    if (!match || !timeMatch) return null;
    const [year, month, day] = match.slice(1).map(Number);
    const [hour, minute] = timeMatch.slice(1).map(Number);
    const check = new Date(Date.UTC(year, month - 1, day));
    return month >= 1 && month <= 12 && day >= 1 && day <= 31 && hour <= 23 && minute <= 59 && check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day
      ? { year, month, day, hour, minute }
      : null;
  }
  function partsAt(ms) {
    const parts = parisDateParts.formatToParts(new Date(ms));
    const value = (type) => Number(parts.find((part) => part.type === type).value);
    return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour"), minute: value("minute") };
  }
  function offsetAt(ms) {
    const value = parisOffset.formatToParts(new Date(ms)).find((part) => part.type === "timeZoneName").value;
    const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(value);
    return match ? (match[1] === "+" ? 1 : -1) * (Number(match[2]) * 60 + Number(match[3])) : null;
  }
  function sameParts(a, b) { return a.year === b.year && a.month === b.month && a.day === b.day && a.hour === b.hour && a.minute === b.minute; }
  // Convertit une heure locale Europe/Paris en instant. Les créneaux ambiguës
  // ou inexistants lors du changement d'heure sont refusés : aucun montant ne
  // peut être calculé sur un instant incertain.
  function parisInstant(date, time) {
    const local = parseDateTime(date, time);
    if (!local) return null;
    const naive = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
    const offsets = new Set();
    for (let delta = -36; delta <= 36; delta += 6) {
      const offset = offsetAt(naive + delta * 3600000);
      if (offset !== null) offsets.add(offset);
    }
    const matches = [...offsets]
      .map((offset) => naive - offset * 60000)
      .filter((instant) => sameParts(partsAt(instant), local));
    return matches.length === 1 ? matches[0] : null;
  }
  function dateAtParis(ms) {
    const { year, month, day } = partsAt(ms);
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  function rentalPeriod(dateDebut, heureDebut = "00:00", dateFin, heureFin = "00:00") {
    const start = parisInstant(dateDebut, heureDebut);
    const end = parisInstant(dateFin, heureFin);
    if (start === null || end === null || end <= start) return null;
    const durationMinutes = (end - start) / 60000;
    return { start, end, durationMinutes, days: Math.max(1, Math.ceil(durationMinutes / 1440)) };
  }
  function rentalDays(dateDebut, heureDebut, dateFin, heureFin) {
    if (dateFin === undefined) { dateFin = heureDebut; heureDebut = "00:00"; heureFin = "00:00"; }
    const period = rentalPeriod(dateDebut, heureDebut, dateFin, heureFin);
    return period ? period.days : 0;
  }
  function levelForDate(date, periods = SPECIAL_PERIODS) {
    const month = Number(date.slice(5, 7));
    const seasonalLevel = MONTH_SEASONS[month] || "normal";
    const matchingPeriods = periods.filter((period) => date >= period.start && date <= period.end);
    const applicable = matchingPeriods.reduce((best, period) => (
      !best || LEVEL_PRIORITY[period.level] > LEVEL_PRIORITY[best.level] ? period : best
    ), null);
    // Une période commerciale ne peut que conserver ou augmenter le niveau
    // saisonnier. À niveau égal, elle est gardée dans le snapshot pour que
    // l'événement appliqué reste traçable.
    if (applicable && LEVEL_PRIORITY[applicable.level] >= LEVEL_PRIORITY[seasonalLevel]) {
      return { level: applicable.level, event: applicable.name };
    }
    return { level: seasonalLevel, event: null };
  }
  function discountForDays(days) { const found = DURATION_DISCOUNTS.find(([min, max]) => days >= min && days <= max); return found ? { rate: found[2], label: `${found[0]}${found[1] === Infinity ? " jours et plus" : ` à ${found[1]} jours`}` } : { rate: 0, label: null }; }
  // Le contrat annonce 200 km inclus par jour facturé. Cette fonction est la
  // source de vérité commune au devis, à la réservation et au PDF : aucun
  // palier dégressif ne doit venir contredire cette règle commerciale.
  function includedMileage(_vehicleId, days) { const billedDays = Math.max(0, Number(days) || 0); return billedDays * 200; }
  function deliveryCost(distanceKm) { const km = Number(distanceKm); return Number.isFinite(km) && km >= 0 ? Math.max(DELIVERY.minimum, DELIVERY.pickupFee + km * DELIVERY.perKm) : 0; }
  function calculateQuote({ vehicleId, dateDebut, heureDebut = "00:00", dateFin, heureFin = "00:00", extraMileagePackageId, deliveryDistanceKm }) {
    const rates = VEHICLE_RATES[vehicleId]; const period = rentalPeriod(dateDebut, heureDebut, dateFin, heureFin); if (!rates || !period) return null;
    const { days } = period;
    const dailyRates = Array.from({ length: days }, (_, index) => { const date = dateAtParis(period.start + index * 86400000); const season = levelForDate(date); return { date, level: season.level, levelLabel: LEVELS[season.level], event: season.event, rate: rates[season.level] }; });
    const rentalSubtotalCents = dailyRates.reduce((sum, day) => sum + day.rate * 100, 0); const discount = discountForDays(days); const discountCents = Math.round(rentalSubtotalCents * discount.rate); const rentalAfterDiscountCents = rentalSubtotalCents - discountCents;
    const packageInfo = EXTRA_MILEAGE_PACKAGES[extraMileagePackageId] || null; const deliveryCents = deliveryDistanceKm === undefined || deliveryDistanceKm === null || deliveryDistanceKm === "" ? 0 : Math.round(deliveryCost(deliveryDistanceKm) * 100);
    const includedKm = includedMileage(vehicleId, days); const totalCents = rentalAfterDiscountCents + (packageInfo ? packageInfo.amount * 100 : 0) + deliveryCents;
    return { days, dailyRates, rentalSubtotal: rentalSubtotalCents / 100, rentalSubtotalCents, discountRate: discount.rate, discountLabel: discount.label, discountAmount: discountCents / 100, discountCents, rentalAfterDiscount: rentalAfterDiscountCents / 100, rentalAfterDiscountCents, includedKm, extraMileagePackage: packageInfo ? { id: extraMileagePackageId, ...packageInfo } : null, delivery: deliveryCents ? { distanceKm: Number(deliveryDistanceKm), amount: deliveryCents / 100 } : null, total: totalCents / 100, totalCents };
  }
  return { LEVELS, LEVEL_PRIORITY, VEHICLE_RATES, MONTH_SEASONS, SPECIAL_PERIODS, DURATION_DISCOUNTS, EXTRA_MILEAGE_PACKAGES, DELIVERY, PARIS_TIME_ZONE, parisInstant, rentalPeriod, rentalDays, levelForDate, discountForDays, includedMileage, deliveryCost, calculateQuote };
});
