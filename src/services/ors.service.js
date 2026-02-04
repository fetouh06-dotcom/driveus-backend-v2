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
    timeout: 20000,
    validateStatus: () => true
  });

  if (data?.error || data?.message) {
    console.error("ORS geocode error:", data);
    const err = new Error(data?.error?.message || data?.message || "Erreur ORS geocode");
    err.statusCode = 400;
    throw err;
  }

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

  const resp = await axios.post(
    "https://api.openrouteservice.org/v2/directions/driving-car",
    { coordinates: [[a.lon, a.lat], [b.lon, b.lat]] },
    {
      headers: {
        Authorization: config.OPENROUTE_API_KEY,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      timeout: 20000,
      validateStatus: () => true
    }
  );

  if (resp.status >= 400) {
    console.error("ORS directions status:", resp.status);
    console.error("ORS directions body:", resp.data);
    const msg = resp.data?.error?.message || resp.data?.message || "Erreur ORS directions";
    const err = new Error(msg);
    err.statusCode = 400;
    throw err;
  }

  const meters = resp.data?.features?.[0]?.properties?.summary?.distance;
  if (!meters) {
    console.error("ORS directions malformed:", resp.data);
    const err = new Error("ORS: réponse invalide (distance manquante)");
    err.statusCode = 400;
    throw err;
  }

  return {
    distanceKm: Math.round((meters / 1000) * 1000) / 1000,
    pickupLabel: a.label,
    dropoffLabel: b.label
  };
}

module.exports = { routeDistanceKm };
