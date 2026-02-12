// src/services/ors.service.js
const axios = require("axios");
const { getConfig } = require("../config/env");

const config = getConfig();

/**
 * ORS hardening:
 * - short HTTP timeouts
 * - retry (429/5xx/timeout/network) with exponential backoff + jitter
 * - light circuit breaker (open/half-open/close)
 * - geocode cache + inflight de-duplication
 */

// ---- Tunables
const ORS_HTTP_TIMEOUT_MS = Number(process.env.ORS_HTTP_TIMEOUT_MS || 3500);
const ORS_RETRY_MAX = Number(process.env.ORS_RETRY_MAX || 2);

const ORS_CB_FAIL_THRESHOLD = Number(process.env.ORS_CB_FAIL_THRESHOLD || 5);
const ORS_CB_COOLDOWN_MS = Number(process.env.ORS_CB_COOLDOWN_MS || 30_000);

const ORS_GEOCODE_CACHE_TTL_MS = Number(process.env.ORS_GEOCODE_CACHE_TTL_MS || 24 * 60 * 60 * 1000); // 24h
const ORS_GEOCODE_CACHE_MAX = Number(process.env.ORS_GEOCODE_CACHE_MAX || 5000);

// ---- Circuit breaker state
const cb = {
  state: "CLOSED", // CLOSED | OPEN | HALF_OPEN
  fails: 0,
  openedAt: 0,
  halfOpenInFlight: false
};

function nowMs() {
  return Date.now();
}

function ensureApiKey() {
  if (!config.OPENROUTE_API_KEY) {
    const err = new Error("OPENROUTE_API_KEY manquant");
    err.statusCode = 500;
    throw err;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function backoffDelay(attempt) {
  // attempt: 0..n
  const base = 200; // ms
  const max = 1200; // ms
  const exp = Math.min(max, base * Math.pow(2, attempt));
  const jitter = Math.floor(Math.random() * 120);
  return exp + jitter;
}

function isRetryableAxiosError(err) {
  // axios timeout / network error
  if (err && (err.code === "ECONNABORTED" || err.message?.toLowerCase().includes("timeout"))) return true;
  if (err && err.isAxiosError && !err.response) return true;
  return false;
}

function isRetryableStatus(status) {
  if (!status) return false;
  return status === 429 || (status >= 500 && status <= 599);
}

function toErrStatusCodeFromStatus(status) {
  // For our API, treat upstream failures as 502/503-ish
  if (status === 429) return 429;
  if (status >= 500) return 503;
  return 502;
}

function checkCircuitBreakerBeforeCall() {
  if (cb.state === "OPEN") {
    const elapsed = nowMs() - cb.openedAt;
    if (elapsed >= ORS_CB_COOLDOWN_MS) {
      cb.state = "HALF_OPEN";
      cb.halfOpenInFlight = false;
      return;
    }
    const err = new Error("ORS indisponible (circuit breaker ouvert)");
    err.statusCode = 503;
    err.isCircuitOpen = true;
    throw err;
  }

  if (cb.state === "HALF_OPEN") {
    if (cb.halfOpenInFlight) {
      const err = new Error("ORS indisponible (test en cours)");
      err.statusCode = 503;
      err.isCircuitOpen = true;
      throw err;
    }
    cb.halfOpenInFlight = true;
  }
}

function circuitBreakerOnSuccess() {
  cb.fails = 0;
  cb.openedAt = 0;
  cb.state = "CLOSED";
  cb.halfOpenInFlight = false;
}

function circuitBreakerOnFailure() {
  cb.fails += 1;
  if (cb.state === "HALF_OPEN") {
    cb.state = "OPEN";
    cb.openedAt = nowMs();
    cb.halfOpenInFlight = false;
    return;
  }
  if (cb.fails >= ORS_CB_FAIL_THRESHOLD) {
    cb.state = "OPEN";
    cb.openedAt = nowMs();
  }
}

async function orsRequest(fn) {
  ensureApiKey();

  for (let attempt = 0; attempt <= ORS_RETRY_MAX; attempt++) {
    checkCircuitBreakerBeforeCall();

    try {
      const res = await fn();
      circuitBreakerOnSuccess();
      return res;
    } catch (err) {
      // if we were HALF_OPEN and failed, breaker opens immediately
      circuitBreakerOnFailure();

      const status = err?.response?.status;
      const retryable = isRetryableAxiosError(err) || isRetryableStatus(status);

      // Release half-open lock if any
      if (cb.state === "HALF_OPEN") cb.halfOpenInFlight = false;

      if (!retryable || attempt === ORS_RETRY_MAX) {
        throw err;
      }

      await sleep(backoffDelay(attempt));
    } finally {
      // if half-open succeeded, success handler already reset; if failed, we release above
      if (cb.state === "HALF_OPEN") {
        // in case fn threw synchronously before we released
        cb.halfOpenInFlight = false;
      }
    }
  }

  // Should never reach
  const err = new Error("ORS: erreur inconnue");
  err.statusCode = 503;
  throw err;
}

// ---- Geocode cache + inflight
const geocodeCache = new Map(); // key -> { v, ts }
const geocodeInflight = new Map(); // key -> Promise

function normalizeText(s) {
  return String(s || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function geocodeCacheGet(key) {
  const hit = geocodeCache.get(key);
  if (!hit) return null;
  if (nowMs() - hit.ts > ORS_GEOCODE_CACHE_TTL_MS) {
    geocodeCache.delete(key);
    return null;
  }
  // refresh LRU-ish
  geocodeCache.delete(key);
  geocodeCache.set(key, hit);
  return hit.v;
}

function geocodeCacheSet(key, value) {
  geocodeCache.set(key, { v: value, ts: nowMs() });
  while (geocodeCache.size > ORS_GEOCODE_CACHE_MAX) {
    const oldestKey = geocodeCache.keys().next().value;
    geocodeCache.delete(oldestKey);
  }
}

async function geocode(text) {
  ensureApiKey();

  const t = String(text || "").trim();
  if (!t) {
    const err = new Error("Adresse vide");
    err.statusCode = 400;
    throw err;
  }

  const key = normalizeText(t);

  const cached = geocodeCacheGet(key);
  if (cached) return cached;

  if (geocodeInflight.has(key)) return geocodeInflight.get(key);

  const p = (async () => {
    const resp = await orsRequest(() =>
      axios.get("https://api.openrouteservice.org/geocode/search", {
        params: { api_key: config.OPENROUTE_API_KEY, text: t },
        timeout: ORS_HTTP_TIMEOUT_MS,
        validateStatus: () => true
      })
    );

    // ORS returns errors sometimes with 200; handle both
    if (resp.status >= 400 || resp.data?.error || resp.data?.message) {
      const msg = resp.data?.error?.message || resp.data?.message || "Erreur ORS geocode";
      const err = new Error(msg);
      err.statusCode = toErrStatusCodeFromStatus(resp.status) || 400;
      err.orsStatus = resp.status;
      throw err;
    }

    const feat = resp.data?.features?.[0];
    if (!feat) {
      const err = new Error("Adresse introuvable (ORS)");
      err.statusCode = 400;
      throw err;
    }

    const [lon, lat] = feat.geometry.coordinates;
    const result = { lon, lat, label: feat.properties.label };

    geocodeCacheSet(key, result);
    return result;
  })();

  geocodeInflight.set(key, p);

  try {
    return await p;
  } finally {
    geocodeInflight.delete(key);
  }
}

function extractDistanceMeters(data) {
  // GeoJSON
  const geo = data?.features?.[0]?.properties?.summary?.distance;
  if (typeof geo === "number") return geo;

  // JSON
  const json = data?.routes?.[0]?.summary?.distance;
  if (typeof json === "number") return json;

  // segments fallback
  const seg = data?.routes?.[0]?.segments?.[0]?.distance;
  if (typeof seg === "number") return seg;

  return null;
}

async function routeDistanceKm(pickupText, dropoffText) {
  ensureApiKey();

  // Geocode both (cache + inflight makes this fast)
  const [a, b] = await Promise.all([geocode(pickupText), geocode(dropoffText)]);

  const resp = await orsRequest(() =>
    axios.post(
      "https://api.openrouteservice.org/v2/directions/driving-car",
      { coordinates: [[a.lon, a.lat], [b.lon, b.lat]] },
      {
        headers: {
          Authorization: config.OPENROUTE_API_KEY,
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        timeout: ORS_HTTP_TIMEOUT_MS,
        validateStatus: () => true
      }
    )
  );

  if (resp.status >= 400 || resp.data?.error || resp.data?.message) {
    const msg = resp.data?.error?.message || resp.data?.message || "Erreur ORS directions";
    const err = new Error(msg);
    err.statusCode = toErrStatusCodeFromStatus(resp.status) || 400;
    err.orsStatus = resp.status;
    throw err;
  }

  const meters = extractDistanceMeters(resp.data);
  if (!meters) {
    const err = new Error("ORS: réponse invalide (distance manquante)");
    err.statusCode = 502;
    throw err;
  }

  return {
    distanceKm: Math.round((meters / 1000) * 1000) / 1000,
    pickupLabel: a.label,
    dropoffLabel: b.label
  };
}

module.exports = { routeDistanceKm };
