const express = require("express");
const { routeDistanceKm } = require("../services/ors.service");
const { computePrice } = require("../services/pricing.service");
const { getConfig } = require("../config/env");
const router = express.Router();
const config = getConfig();

router.post("/", async (req, res) => {
  try {
    const { pickup_text, dropoff_text, pickup_datetime } = req.body || {};
    if (!pickup_text || !dropoff_text) return res.status(400).json({ error: "pickup_text et dropoff_text requis" });
    const { distanceKm, pickupLabel, dropoffLabel } = await routeDistanceKm(pickup_text, dropoff_text);
    const price = computePrice({
      distanceKm, pickupDatetimeISO: pickup_datetime,
      minFare: config.MIN_FARE_EUR, perKm: config.PRICE_PER_KM_EUR,
      nightPct: config.NIGHT_SURCHARGE_PCT, sundayPct: config.SUNDAY_SURCHARGE_PCT,
      nightStartHour: config.NIGHT_START_HOUR, nightEndHour: config.NIGHT_END_HOUR
    });
    return res.json({ pickup: pickupLabel, dropoff: dropoffLabel, distance: distanceKm, price, pickup_datetime: pickup_datetime || null });
  } catch (e) {
    return res.status(e.statusCode || 500).json({ error: e.message || "Erreur" });
  }
});
module.exports = router;
