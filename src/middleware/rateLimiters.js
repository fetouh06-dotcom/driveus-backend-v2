const rateLimit = require("express-rate-limit");

/**
 * Helper: IP extractor safe (trust proxy already enabled in server.js)
 */
function keyGenerator(req) {
  return req.ip || req.headers["x-forwarded-for"] || "unknown";
}

/**
 * Generic handler (uniform error format)
 */
function buildLimiter(options) {
  return rateLimit({
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator,
    handler: (req, res) => {
      res.status(429).json({
        error: options.message?.error || "Trop de requêtes. Réessayez plus tard."
      });
    },
    ...options
  });
}


/* =========================
   REGISTER (anti spam)
========================= */

const registerLimiter = buildLimiter({
  windowMs: 60 * 60 * 1000, // 1h
  max: 10,
  message: { error: "Trop de créations de compte. Réessayez plus tard." }
});

/* =========================
   LOGIN (anti brute-force)
========================= */

const loginLimiter = buildLimiter({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 20,                  // 20 tentatives / 15 min / IP
  skipSuccessfulRequests: true, // important: ne bloque pas si login OK
  message: { error: "Trop de tentatives. Réessayez plus tard." }
});

/* =========================
   PUBLIC BOOKING
========================= */

const publicBookingLimiter = buildLimiter({
  windowMs: 10 * 60 * 1000,
  max: 25, // un peu réduit (30 -> 25) pour être safe
  message: { error: "Trop de requêtes. Réessayez plus tard." }
});

/* =========================
   PAYMENTS (Stripe session creation)
========================= */

const paymentsLimiter = buildLimiter({
  windowMs: 10 * 60 * 1000,
  max: 40, // 60 -> 40 (plus strict)
  message: { error: "Trop de requêtes paiement. Réessayez plus tard." }
});

module.exports = {
  registerLimiter,
  loginLimiter,
  publicBookingLimiter,
  paymentsLimiter
};
