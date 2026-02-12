function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj && obj[k] !== undefined) out[k] = obj[k];
  return out;
}

function securityEvent(type, req, extra = {}) {
  const evt = {
    ts: new Date().toISOString(),
    type, // ex: auth_failed, admin_action, webhook_error
    request_id: req.id,
    ip: req.ip,
    method: req.method,
    path: req.originalUrl,
    ua: req.headers["user-agent"],
    origin: req.headers.origin,
    referer: req.headers.referer,
    // ⚠️ Ne log PAS de mots de passe/tokens. On garde un body "safe".
    body: pick(req.body, ["email", "booking_id", "status"]),
    ...extra
  };

  // JSON = facile à filtrer dans les logs Render
  console.log(JSON.stringify({ security: evt }));
}

function securityAuditMiddleware(req, res, next) {
  const start = Date.now();

  res.on("finish", () => {
    const ms = Date.now() - start;

    // Log les erreurs HTTP
    if (res.statusCode >= 400) {
      securityEvent("http_error", req, { status: res.statusCode, ms });
    }

    // Audit admin
    if (req.originalUrl.startsWith("/api/admin")) {
      securityEvent("admin_hit", req, { status: res.statusCode, ms });
    }

    // Audit paiements
    if (req.originalUrl.startsWith("/api/payments")) {
      securityEvent("payments_hit", req, { status: res.statusCode, ms });
    }
  });

  next();
}

module.exports = { securityEvent, securityAuditMiddleware };
