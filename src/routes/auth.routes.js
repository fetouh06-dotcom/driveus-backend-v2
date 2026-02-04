const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const db = require("../db/database");
const { getConfig } = require("../config/env");
const router = express.Router();
const config = getConfig();

router.post("/register", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "email et password requis" });
  const id = uuidv4();
  const hash = await bcrypt.hash(password, 10);
  try {
    db.prepare("INSERT INTO users (id, email, password, role, created_at) VALUES (?, ?, ?, 'user', ?)")
      .run(id, String(email).toLowerCase(), hash, new Date().toISOString());
  } catch {
    return res.status(400).json({ error: "Email déjà utilisé" });
  }
  return res.json({ success: true, id });
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "email et password requis" });
  const user = db.prepare("SELECT * FROM users WHERE email=?").get(String(email).toLowerCase());
  if (!user) return res.status(401).json({ error: "Identifiants invalides" });
  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(401).json({ error: "Identifiants invalides" });
  const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, config.JWT_SECRET, { expiresIn: "7d" });
  return res.json({ token });
});

module.exports = router;
