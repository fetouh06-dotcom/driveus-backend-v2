const jwt = require("jsonwebtoken");
const { getConfig } = require("../config/env");
const config = getConfig();

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json({ error: "Token manquant" });
  try {
    req.user = jwt.verify(m[1], config.JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ error: "Token invalide" });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") return res.status(403).json({ error: "Accès admin requis" });
  return next();
}

module.exports = { auth, requireAdmin };
