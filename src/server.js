require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const { v4: uuidv4 } = require("uuid");

const db = require("./db/database");
const { migrate } = require("./db/migrate");
const { getConfig } = require("./config/env");
const { notFound, errorHandler } = require("./middleware/error");

const authRoutes = require("./routes/auth.routes");
const estimateRoutes = require("./routes/estimate.routes");
const publicBookingRoutes = require("./routes/publicBooking.routes");
const paymentsRoutes = require("./routes/payments.routes");
const { stripeWebhookHandler } = require("./routes/payments.routes");
const adminRoutes = require("./routes/admin.routes");

const config = getConfig();
const app = express();

app.set("trust proxy", 1);

/* =========================
   SECURITY MIDDLEWARE
========================= */

app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(morgan("dev"));

app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false
  })
);

/* =========================
   CORS PRODUCTION STRICT
========================= */

function buildCorsOptions() {
  const raw = String(config.CORS_ORIGIN || "").trim();

  if (raw === "*") {
    return {
      origin: "*",
      allowedHeaders: ["Content-Type", "Authorization"],
      methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"]
    };
  }

  const allowed = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    origin: function (origin, cb) {
      if (!origin) return cb(null, true); // Postman / Stripe
      if (allowed.includes(origin)) return cb(null, true);
      return cb(new Error("CORS: origin non autorisée"), false);
    },
    allowedHeaders: ["Content-Type", "Authorization"],
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"]
  };
}

const corsOptions = buildCorsOptions();
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

/* =========================
   STRIPE WEBHOOK (RAW BODY)
========================= */

app.post(
  "/api/payments/webhook",
  express.raw({ type: "application/json" }),
  stripeWebhookHandler
);

// JSON parser AFTER webhook
app.use(express.json({ limit: "1mb" }));

/* =========================
   ROOT + HEALTH
========================= */

// ✅ évite le 404 sur "/"
app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "DriveUs API",
    health: "/health",
    version: "3.0.0"
  });
});

app.get("/health", (req, res) =>
  res.json({ ok: true, status: "DriveUs V2 running 🚗" })
);

/* =========================
   ADMIN AUTO-BOOTSTRAP (Turso)
========================= */

async function bootstrapAdmin() {
  if (!config.ADMIN_BOOTSTRAP_EMAIL || !config.ADMIN_BOOTSTRAP_PASSWORD) return;

  const email = String(config.ADMIN_BOOTSTRAP_EMAIL).toLowerCase();

  const r = await db.execute("SELECT id FROM users WHERE email = ?", [email]);
  const existing = r.rows?.[0] || null;
  if (existing) return;

  const id = uuidv4();
  const hash = await bcrypt.hash(config.ADMIN_BOOTSTRAP_PASSWORD, 10);

  await db.execute(
    `
    INSERT INTO users (id, email, password, role, created_at)
    VALUES (?, ?, ?, 'admin', ?)
    `,
    [id, email, hash, new Date().toISOString()]
  );

  console.log("✅ Admin bootstrap créé");
}

/* =========================
   AUTO CANCEL JOB (30 min) (Turso)
========================= */

function startAutoCancelJob() {
  setInterval(async () => {
    try {
      const nowISO = new Date().toISOString();

      await db.execute(
        `
        UPDATE bookings
        SET status='cancelled',
            payment_status='deposit_failed'
        WHERE deposit_paid=0
          AND status='pending_payment'
          AND deposit_due_at IS NOT NULL
          AND deposit_due_at < ?
        `,
        [nowISO]
      );
    } catch (e) {
      console.error("Auto-cancel job error:", e.message);
    }
  }, 60 * 1000);
}

/* =========================
   ROUTES
========================= */

app.use("/api/auth", authRoutes);
app.use("/api/estimate", estimateRoutes);
app.use("/api/bookings/public", publicBookingRoutes);
app.use("/api/payments", paymentsRoutes);
app.use("/api/admin", adminRoutes);

/* =========================
   ERROR HANDLING
========================= */

app.use(notFound);
app.use(errorHandler);

/* =========================
   START (await migrate + admin)
========================= */

(async () => {
  try {
    await migrate();
    await bootstrapAdmin();
    startAutoCancelJob();

    app.listen(config.PORT, () => {
      console.log("🚀 Server running on port", config.PORT);
    });
  } catch (e) {
    console.error("❌ Startup failed:", e);
    process.exit(1);
  }
})();
