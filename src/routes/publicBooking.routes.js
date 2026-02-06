const express = require("express");
const { v4: uuidv4 } = require("uuid");
const db = require("../db/database");
const { routeDistanceKm } = require("../services/ors.service");
const { computePrice } = require("../services/pricing.service");
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
        notes
      } = req.body || {};

      const { distanceKm, pickupLabel, dropoffLabel } = await routeDistanceKm(
        pickup_text,
        dropoff_text
      );

      const price = computePrice({
        distanceKm,
        pickupDatetimeISO: pickup_datetime,
        minFare: config.MIN_FARE_EUR,
        perKm: config.PRICE_PER_KM_EUR,
        nightPct: config.NIGHT_SURCHARGE_PCT,
        sundayPct: config.SUNDAY_SURCHARGE_PCT,
        nightStartHour: config.NIGHT_START_HOUR,
        nightEndHour: config.NIGHT_END_HOUR
      });

      const id = uuidv4();
      const createdAt = new Date().toISOString();
      const dueAt = new Date(
        Date.now() + config.DEPOSIT_EXPIRES_MINUTES * 60 * 1000
      ).toISOString();

      db.prepare(
        `
        INSERT INTO bookings (
          id, user_id, pickup, dropoff, distance, price, created_at, pickup_datetime, status,
          customer_name, customer_phone, customer_email, notes,
          deposit_amount, deposit_paid, payment_status, deposit_due_at
        ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, 'pending_payment', ?, ?, ?, ?, ?, 0, 'deposit_pending', ?)
      `
      ).run(
        id,
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
      );

      const booking = db.prepare("SELECT * FROM bookings WHERE id=?").get(id);

      if (securityEvent) {
        securityEvent("public_booking_created", req, {
          booking_id: booking.id,
          email: booking.customer_email || null,
          status: booking.status
        });
      }

      return res.json(booking);
    } catch (e) {
      if (securityEvent) {
        securityEvent("public_booking_error", req, {
          message: e.message,
          status: e.statusCode || 500
        });
      }
      return res
        .status(e.statusCode || 500)
        .json({ error: e.message || "Erreur serveur" });
    }
  }
);

module.exports = router;
