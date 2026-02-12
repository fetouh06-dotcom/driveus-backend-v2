const express = require("express");
const { getConfig } = require("../config/env");

const router = express.Router();
const config = getConfig();

// Expose only SAFE public config values
router.get("/", (req, res) => {
  res.json({
    apiBase: config.NODE_ENV === "production" ? undefined : undefined, // kept for future; frontend can hardcode API_BASE
    googleMapsApiKey: config.GOOGLE_MAPS_API_KEY || null,
    depositEur: Number(config.DEPOSIT_EUR),
    depositExpiresMinutes: Number(config.DEPOSIT_EXPIRES_MINUTES)
  });
});

module.exports = router;
