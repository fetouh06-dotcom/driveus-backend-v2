const jwt = require("jsonwebtoken");
const { getConfig } = require("../config/env");

const config = getConfig();

/**
 * Middleware JWT standard
 */
function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    return res.status(401).json({ error: "Token manquant" });
  }

  try {
    const payload = jwt.verify(match[1], config.JWT_SECRET);

    // Payload minimal attendu
    if (!payload.id || !payload.role) {
      return res.status(401).json({ error: "Token invalide" });
    }

    req.user = payload;
    return next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Token expiré" });
    }
    return res.status(401).json({ error: "Token invalide" });
  }
}

/**
 * Middleware admin
 */
function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "Non authentifié" });
  }

  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Accès admin requis" });
  }

  return next();
}

module.exports = { auth, requireAdmin };
