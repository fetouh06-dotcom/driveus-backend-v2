// src/services/pricing.service.js

function getParisParts(date) {
  const fmt = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    weekday: "short",
    hour: "2-digit",
    hour12: false
  });

  const parts = fmt.formatToParts(date);
  const weekday = parts.find((p) => p.type === "weekday")?.value || "";
  const hourStr = parts.find((p) => p.type === "hour")?.value || "0";
  const hour = Number(hourStr);

  return { weekday, hour: Number.isFinite(hour) ? hour : 0 };
}

function isSundayParis(date) {
  const { weekday } = getParisParts(date);
  return weekday.toLowerCase().startsWith("dim");
}

function isNightHour(h, startH, endH) {
  return startH > endH ? (h >= startH || h < endH) : (h >= startH && h < endH);
}

function isNightParis(date, startH, endH) {
  const { hour } = getParisParts(date);
  return isNightHour(hour, startH, endH);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Returns { price, breakdown }
 */
function computePriceDetails({
  distanceKm,
  pickupDatetimeISO,
  minFare,
  perKm,
  nightPct,
  sundayPct,
  nightStartHour,
  nightEndHour
}) {
  const dist = Number(distanceKm);
  const minF = Number(minFare);
  const per = Number(perKm);

  const safeDist = Number.isFinite(dist) ? dist : 0;
  const safeMin = Number.isFinite(minF) ? minF : 0;
  const safePer = Number.isFinite(per) ? per : 0;

  const baseRaw = safeDist * safePer;
  const baseApplied = Math.max(safeMin, baseRaw);

  let isSunday = false;
  let isNight = false;

  let mult = 1;

  if (pickupDatetimeISO) {
    const d = new Date(pickupDatetimeISO);
    if (!Number.isNaN(d.getTime())) {
      isSunday = isSundayParis(d);
      isNight = isNightParis(d, Number(nightStartHour) || 0, Number(nightEndHour) || 0);

      if (isSunday) mult *= 1 + (Number(sundayPct) || 0) / 100;
      if (isNight) mult *= 1 + (Number(nightPct) || 0) / 100;
    }
  }

  const price = round2(baseApplied * mult);

  return {
    price,
    breakdown: {
      distanceKm: safeDist,
      perKm: safePer,
      minFare: safeMin,
      baseRaw: round2(baseRaw),
      baseApplied: round2(baseApplied),
      isSunday,
      sundayPct: Number(sundayPct) || 0,
      isNight,
      nightPct: Number(nightPct) || 0,
      multiplier: round2(mult),
      total: price
    }
  };
}

// Backwards compatible
function computePrice(args) {
  return computePriceDetails(args).price;
}

module.exports = { computePrice, computePriceDetails };
