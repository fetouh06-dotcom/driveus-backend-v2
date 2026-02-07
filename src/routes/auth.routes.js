const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const db = require("../db/database");
const { getConfig } = require("../config/env");

const { loginLimiter } = require("../middleware/rateLimiters");
const { validateLogin } = require("../middleware/validate");

// Optionnel (si tu as installé le pack logs sécurité)
let securityEvent = null;
try {
  ({ securityEvent } = require("../middleware/securityLogger"));
} catch (e) {}

const router = express.Router();
const config = getConfig();

/**
 * POST /api/auth/register
 */
router.post("/register", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "email et password requis" });
    }

    const normalizedEmail = String(email).toLowerCase().trim();

    // Vérifie si déjà utilisé
    const check = await db.execute("SELECT id FROM users WHERE email = ?", [normalizedEmail]);
    if (check.rows && check.rows.length) {
      return res.status(400).json({ error: "Email déjà utilisé" });
    }

    const id = uuidv4();
    const hash = await bcrypt.hash(password, 10);

    await db.execute(
      "INSERT INTO users (id, email, password, role, created_at) VALUES (?, ?, ?, 'user', ?)",
      [id, normalizedEmail, hash, new Date().toISOString()]
    );

    return res.json({ success: true, id });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Erreur serveur" });
  }
});

/**
 * POST /api/auth/login
 * ✅ anti-bruteforce + validation
 */
router.post("/login", loginLimiter, validateLogin, async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const normalizedEmail = String(email).toLowerCase().trim();

    const r = await db.execute("SELECT * FROM users WHERE email = ?", [normalizedEmail]);
    const user = r.rows?.[0] || null;

    if (!user) {
      if (securityEvent) {
        securityEvent("auth_failed", req, {
          email: normalizedEmail,
          reason: "user_not_found"
        });
      }
      return res.status(401).json({ error: "Identifiants invalides" });
    }

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      if (securityEvent) {
        securityEvent("auth_failed", req, {
          email: user.email,
          user_id: user.id,
          reason: "bad_password"
        });
      }
      return res.status(401).json({ error: "Identifiants invalides" });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      config.JWT_SECRET,
      { expiresIn: "7d" }
    );

    if (securityEvent) {
      securityEvent("auth_success", req, {
        email: user.email,
        user_id: user.id,
        role: user.role
      });
    }

    return res.json({ token });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = router;
