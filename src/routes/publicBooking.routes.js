// src/routes/bookings.public.routes.js
const express = require("express");
const { v4: uuidv4 } = require("uuid");
const crypto = require("crypto");
const db = require("../db/database");
const { computePriceDetails } = require("../services/pricing.service");
const { getConfig } = require("../config/env");

const { publicBookingLimiter } = require("../middleware/rateLimiters");
const { validatePublicBooking } = require("../middleware/validate");
const { turnstileMiddleware } = require("../middleware/turnstile");

// Optionnel (si tu as installé le pack logs sécurité)
let securityEvent = null;
try {
  ({ securityEvent } = require("../middleware/securityLogger"));
} catch (e) {}

const router = express.Router();
const config = getConfig();

function toFiniteNumber(x) {
  const n = typeof x === "string" ? Number(x.replace(",", ".")) : Number(x);
  return Number.isFinite(n) ? n : null;
}

function safeDepositExpiresMinutes() {
  const n = Number(config.DEPOSIT_EXPIRES_MINUTES);
  return Number.isFinite(n) && n > 0 ? n : 30;
}

function normalizeText(s) {
  return String(s || "").trim().replace(/\s+/g, " ");
}

/**
 * Fallback if estimate snapshot is missing:
 * deterministic, no ORS.
 */
function roughPriceFromText(pickupText, dropoffText) {
  const minFare = toFiniteNumber(config.MIN_FARE_EUR);
  const base = minFare != null ? minFare : 25;

  const len = String(pickupText || "").length + String(dropoffText || "").length;
  const variable = Math.min(80, Math.max(10, len / 3.2));

  return Math.round((base + variable) * 100) / 100;
}

// ✅ anti-spam + captcha optionnel + validation
router.post(
  "/",
  publicBookingLimiter,
  turnstileMiddleware,
  validatePublicBooking,
  async (req, res) => {
    try {
      const {
        pickup_text,
        dropoff_text,
        pickup_datetime,
        customer_name,
        customer_phone,
        customer_email,
        notes,

        // ✅ from frontend estimate snapshot (whitelisted by validate.js)
        estimated_price,
        estimated_distance_km,
        estimated_pickup_label,
        estimated_dropoff_label,
        estimated_approximate,
        estimated_at
      } = req.body || {};

      const pickupRaw = normalizeText(pickup_text);
      const dropoffRaw = normalizeText(dropoff_text);

      // Prefer frontend labels, otherwise raw input
      const pickupLabel = normalizeText(estimated_pickup_label) || pickupRaw;
      const dropoffLabel = normalizeText(estimated_dropoff_label) || dropoffRaw;

      // distance: optional
      const distanceKm = toFiniteNumber(estimated_distance_km);

      let price;
      let approximate = !!estimated_approximate;
      let reason = null;
      let breakdown = null;

      if (distanceKm != null) {
        // ✅ Server-side pricing using config (single source of truth)
        const r = computePriceDetails({
          distanceKm,
          pickupDatetimeISO: pickup_datetime || null,
          minFare: config.MIN_FARE_EUR,
          perKm: config.PRICE_PER_KM_EUR,
          nightPct: config.NIGHT_SURCHARGE_PCT,
          sundayPct: config.SUNDAY_SURCHARGE_PCT,
          nightStartHour: config.NIGHT_START_HOUR,
          nightEndHour: config.NIGHT_END_HOUR
        });

        price = r.price;
        breakdown = r.breakdown;

        // If client said approximate but we have distance => we can treat as exact pricing,
        // HOWEVER the distance itself came from client snapshot. Keep approximate if client flagged it.
        if (approximate) {
          reason = "distance_from_client_snapshot_approx";
        }
      } else {
        // No distance => fallback to provided estimated_price if valid, else rough
        const p = toFiniteNumber(estimated_price);

        if (p != null) {
          price = p;
          approximate = true;
          reason = "no_distance_price_from_client";
          breakdown = {
            mode: "client_price_only",
            note: "Prix fourni par le client sans distance (approx)."
          };
        } else {
          price = roughPriceFromText(pickupRaw, dropoffRaw);
          approximate = true;
          reason = "no_estimate_fallback";
          breakdown = {
            mode: "fallback_text",
            minFare: config.MIN_FARE_EUR,
            note: "Aucune distance/prix client — fallback basé sur le texte (approx)."
          };
        }
      }

      const id = uuidv4();
      const publicToken = crypto.randomBytes(16).toString("hex");
      const createdAt = new Date().toISOString();
      const dueAt = new Date(Date.now() + safeDepositExpiresMinutes() * 60 * 1000).toISOString();

      await db.execute(
        `
        INSERT INTO bookings (
          id, public_token, user_id, pickup, dropoff, distance, price, created_at, pickup_datetime, status,
          customer_name, customer_phone, customer_email, notes,
          deposit_amount, deposit_paid, payment_status, deposit_due_at
        ) VALUES (
          ?, ?, NULL, ?, ?, ?, ?, ?, ?, 'pending_payment',
          ?, ?, ?, ?,
          ?, 0, 'deposit_pending', ?
        )
        `,
        [
          id,
          publicToken,
          pickupLabel,
          dropoffLabel,
          distanceKm,
          price,
          createdAt,
          pickup_datetime || null,
          customer_name || null,
          customer_phone || null,
          customer_email || null,
          notes || null,
          config.DEPOSIT_EUR,
          dueAt
        ]
      );
      const payload = {
        id,
        public_token: publicToken,
        pickup: pickupLabel,
        dropoff: dropoffLabel,
        distance: distanceKm,
        price,
        pickup_datetime: pickup_datetime || null,
        status: 'pending_payment',
        deposit_amount: Number(config.DEPOSIT_EUR),
        deposit_due_at: dueAt,
        approximate: !!approximate,
        reason: reason || null,
        estimated_at: estimated_at || null,
        breakdown
      };

      if (securityEvent) {
        securityEvent("public_booking_created", req, {
          booking_id: payload.id,
          email: customer_email || null,
          status: payload.status,
          approximate: !!approximate,
          reason: reason || null
        });
      }

      return res.json(payload);
    } catch (e) {
      if (securityEvent) {
        securityEvent("public_booking_error", req, {
          message: e.message,
          status: e.statusCode || 500
        });
      }
      return res.status(e.statusCode || 500).json({ error: e.message || "Erreur serveur" });
    }
  }
);

module.exports = router;
