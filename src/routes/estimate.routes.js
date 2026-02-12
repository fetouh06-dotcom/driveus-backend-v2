// src/routes/estimate.routes.js
const express = require("express");
const { routeDistanceKm } = require("../services/ors.service");
const { computePriceDetails } = require("../services/pricing.service");
const { getConfig } = require("../config/env");

const router = express.Router();
const config = getConfig();

/**
 * Speed + reliability fixes:
 * - Normalize + cache routes (LRU-ish Map with TTL)
 * - In-flight de-duplication (same pickup/dropoff => one ORS call)
 * - SOFT timeout: never return 504 for estimate (fallback instead)
 * - Return breakdown for pricing transparency
 */

const ROUTE_CACHE_TTL_MS = Number(process.env.ESTIMATE_CACHE_TTL_MS || 24 * 60 * 60 * 1000); // 24h
const ROUTE_CACHE_MAX = Number(process.env.ESTIMATE_CACHE_MAX || 5000); // cap memory
const ORS_SOFT_TIMEOUT_MS = Number(process.env.ORS_SOFT_TIMEOUT_MS || 3500); // aim < gateway timeout

// key -> { v: { distanceKm, pickupLabel, dropoffLabel }, ts }
const routeCache = new Map();
// key -> Promise<{ distanceKm, pickupLabel, dropoffLabel }>
const inflight = new Map();

function normalizeText(s) {
  return String(s || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function cacheKey(pickupText, dropoffText) {
  return `${normalizeText(pickupText)}||${normalizeText(dropoffText)}`;
}

function cachePeek(key) {
  // "peek" without refreshing LRU
  const hit = routeCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > ROUTE_CACHE_TTL_MS) {
    routeCache.delete(key);
    return null;
  }
  return hit.v;
}

function cacheGet(key) {
  const hit = routeCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > ROUTE_CACHE_TTL_MS) {
    routeCache.delete(key);
    return null;
  }
  // refresh recency (simple LRU behavior)
  routeCache.delete(key);
  routeCache.set(key, hit);
  return hit.v;
}

function cacheSet(key, value) {
  routeCache.set(key, { v: value, ts: Date.now() });
  while (routeCache.size > ROUTE_CACHE_MAX) {
    const oldestKey = routeCache.keys().next().value;
    routeCache.delete(oldestKey);
  }
}

/**
 * Soft timeout helper:
 * - Rejects with an error carrying isTimeout=true
 * - DOES NOT impose a 504 response by itself
 */
function withSoftTimeout(promise, ms, label = "Timeout calcul itinéraire") {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => {
      const err = new Error(label);
      err.isTimeout = true;
      reject(err);
    }, ms);
  });
  return Promise.race([promise.finally(() => clearTimeout(t)), timeout]);
}

/**
 * Server-side fallback price if ORS is slow/down.
 * Keep it simple + deterministic.
 * NOTE: this is intentionally approximate.
 */
function roughPriceFromText(pickupText, dropoffText) {
  const minFare = Number(config.MIN_FARE_EUR || 25);
  const base = Number.isFinite(minFare) ? minFare : 25;

  const len = String(pickupText || "").length + String(dropoffText || "").length;
  const variable = Math.min(80, Math.max(10, len / 3.2));

  return Math.round((base + variable) * 100) / 100;
}

async function getRouteDistanceCached(pickup_text, dropoff_text) {
  const key = cacheKey(pickup_text, dropoff_text);

  // 1) cache hit
  const cached = cacheGet(key);
  if (cached) return cached;

  // 2) in-flight dedupe
  if (inflight.has(key)) return inflight.get(key);

  // 3) create one shared promise
  const p = (async () => {
    const r = await withSoftTimeout(
      routeDistanceKm(pickup_text, dropoff_text),
      ORS_SOFT_TIMEOUT_MS
    );

    // Cache only if it looks sane
    if (r && Number.isFinite(r.distanceKm) && r.distanceKm >= 0) {
      cacheSet(key, r);
    }
    return r;
  })();

  inflight.set(key, p);

  try {
    return await p;
  } finally {
    inflight.delete(key);
  }
}

router.post("/", async (req, res) => {
  try {
    const { pickup_text, dropoff_text, pickup_datetime } = req.body || {};

    if (!pickup_text || !dropoff_text) {
      return res.status(400).json({ error: "pickup_text et dropoff_text requis" });
    }

    const key = cacheKey(pickup_text, dropoff_text);
    const wasCached = Boolean(cachePeek(key));

    // Try ORS (cached + soft timeout)
    let distanceKm, pickupLabel, dropoffLabel;
    let approximate = false;
    let reason = null;

    try {
      const r = await getRouteDistanceCached(pickup_text, dropoff_text);
      distanceKm = r.distanceKm;
      pickupLabel = r.pickupLabel;
      dropoffLabel = r.dropoffLabel;
    } catch (e) {
      // Soft failure: respond fast with fallback price (no 504)
      approximate = true;
      reason = e?.isTimeout ? "ors_timeout" : "ors_error";

      const price = roughPriceFromText(pickup_text, dropoff_text);

      return res.json({
        pickup: pickup_text,
        dropoff: dropoff_text,
        distance: null,
        price,
        pickup_datetime: pickup_datetime || null,
        approximate,
        reason,
        breakdown: {
          mode: "fallback_text",
          minFare: config.MIN_FARE_EUR,
          note: "Itinéraire indisponible/timeout — prix approximatif basé sur le texte (pas sur la distance)."
        }
      });
    }

    const { price, breakdown } = computePriceDetails({
      distanceKm,
      pickupDatetimeISO: pickup_datetime || null,
      minFare: config.MIN_FARE_EUR,
      perKm: config.PRICE_PER_KM_EUR,
      nightPct: config.NIGHT_SURCHARGE_PCT,
      sundayPct: config.SUNDAY_SURCHARGE_PCT,
      nightStartHour: config.NIGHT_START_HOUR,
      nightEndHour: config.NIGHT_END_HOUR
    });

    return res.json({
      pickup: pickupLabel,
      dropoff: dropoffLabel,
      distance: distanceKm,
      price,
      pickup_datetime: pickup_datetime || null,
      approximate,
      cached: wasCached,
      breakdown
    });
  } catch (e) {
    // For estimate, keep it user-friendly: still try to respond with fallback when possible
    const { pickup_text, dropoff_text, pickup_datetime } = req.body || {};
    if (pickup_text && dropoff_text) {
      const price = roughPriceFromText(pickup_text, dropoff_text);
      return res.json({
        pickup: pickup_text,
        dropoff: dropoff_text,
        distance: null,
        price,
        pickup_datetime: pickup_datetime || null,
        approximate: true,
        reason: "server_error",
        breakdown: {
          mode: "fallback_text",
          minFare: config.MIN_FARE_EUR,
          note: "Erreur serveur — prix approximatif basé sur le texte."
        }
      });
    }

    const status = e.statusCode || e.status || 500;
    return res.status(status).json({ error: e.message || "Erreur" });
  }
});

module.exports = router;
