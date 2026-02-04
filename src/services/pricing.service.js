function isSunday(d) { return d.getUTCDay() === 0; }
function isNight(d, startH, endH) {
  const h = d.getUTCHours();
  return startH > endH ? (h >= startH || h < endH) : (h >= startH && h < endH);
}
function computePrice({ distanceKm, pickupDatetimeISO, minFare, perKm, nightPct, sundayPct, nightStartHour, nightEndHour }) {
  const base = Math.max(minFare, distanceKm * perKm);
  let mult = 1;
  if (pickupDatetimeISO) {
    const d = new Date(pickupDatetimeISO);
    if (!Number.isNaN(d.getTime())) {
      if (isSunday(d)) mult *= 1 + sundayPct / 100;
      if (isNight(d, nightStartHour, nightEndHour)) mult *= 1 + nightPct / 100;
    }
  }
  return Math.round(base * mult * 100) / 100;
}
module.exports = { computePrice };
