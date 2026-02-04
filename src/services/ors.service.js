const axios = require("axios");
const { getConfig } = require("../config/env");
const config = getConfig();

async function geocode(text) {
  if (!config.OPENROUTE_API_KEY) {
    const err = new Error("OPENROUTE_API_KEY manquant");
    err.statusCode = 400;
    throw err;
  }
  const { data } = await axios.get("https://api.openrouteservice.org/geocode/search", {
    params: { api_key: config.OPENROUTE_API_KEY, text },
    timeout: 20000
  });
  const feat = data?.features?.[0];
  if (!feat) {
    const err = new Error("Adresse introuvable (ORS)");
    err.statusCode = 400;
    throw err;
  }
  const [lon, lat] = feat.geometry.coordinates;
  return { lon, lat, label: feat.properties.label };
}

async function routeDistanceKm(pickupText, dropoffText) {
  const a = await geocode(pickupText);
  const b = await geocode(dropoffText);
  const { data } = await axios.post("https://api.openrouteservice.org/v2/directions/driving-car", {
    coordinates: [[a.lon, a.lat], [b.lon, b.lat]]
  }, { headers: { Authorization: config.OPENROUTE_API_KEY }, timeout: 20000 });
  const meters = data?.features?.[0]?.properties?.summary?.distance;
  if (!meters) {
    const err = new Error("Impossible de calculer la distance (ORS)");
    err.statusCode = 400;
    throw err;
  }
  return { distanceKm: Math.round((meters / 1000) * 1000) / 1000, pickupLabel: a.label, dropoffLabel: b.label };
}

module.exports = { routeDistanceKm };
