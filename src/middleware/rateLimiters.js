const rateLimit = require("express-rate-limit");

/**
 * Rate limiters ciblés (anti-spam / anti-bruteforce)
 * Ajuste les valeurs selon ton trafic.
 */

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 20,                  // 20 tentatives / 15 min / IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Trop de tentatives. Réessayez plus tard." }
});

const publicBookingLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 min
  max: 30,                  // 30 réservations / 10 min / IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Trop de requêtes. Réessayez plus tard." }
});

const paymentsLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 min
  max: 60,                  // 60 créations de sessions / 10 min / IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Trop de requêtes paiement. Réessayez plus tard." }
});

module.exports = { loginLimiter, publicBookingLimiter, paymentsLimiter };
