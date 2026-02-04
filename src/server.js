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
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: config.CORS_ORIGIN === "*" ? "*" : config.CORS_ORIGIN, allowedHeaders: ["Content-Type","Authorization"] }));
app.use(compression());
app.use(morgan("dev"));
app.use(rateLimit({ windowMs: 15*60*1000, max: 300, standardHeaders: true, legacyHeaders: false }));

app.post("/api/payments/webhook", express.raw({ type: "application/json" }), stripeWebhookHandler);
app.use(express.json({ limit: "1mb" }));

migrate();

async function bootstrapAdmin() {
  if (!config.ADMIN_BOOTSTRAP_EMAIL || !config.ADMIN_BOOTSTRAP_PASSWORD) return;
  const email = String(config.ADMIN_BOOTSTRAP_EMAIL).toLowerCase();
  const existing = db.prepare("SELECT id FROM users WHERE email=?").get(email);
  if (existing) return;
  const id = uuidv4();
  const hash = await bcrypt.hash(config.ADMIN_BOOTSTRAP_PASSWORD, 10);
  db.prepare("INSERT INTO users (id, email, password, role, created_at) VALUES (?, ?, ?, 'admin', ?)")
    .run(id, email, hash, new Date().toISOString());
}

function startAutoCancelJob() {
  setInterval(() => {
    const nowISO = new Date().toISOString();
    db.prepare(`
      UPDATE bookings
      SET status='cancelled', payment_status='deposit_failed'
      WHERE deposit_paid=0 AND status='pending_payment'
        AND deposit_due_at IS NOT NULL AND deposit_due_at < ?
    `).run(nowISO);
  }, 60*1000);
}

app.get("/health", (req, res) => res.json({ ok: true, status: "DriveUs V2 running 🚗" }));

app.use("/api/auth", authRoutes);
app.use("/api/estimate", estimateRoutes);
app.use("/api/bookings/public", publicBookingRoutes);
app.use("/api/payments", paymentsRoutes);
app.use("/api/admin", adminRoutes);

app.use(notFound);
app.use(errorHandler);

bootstrapAdmin().then(startAutoCancelJob);
app.listen(config.PORT, () => console.log("🚀 Server running on port", config.PORT));
