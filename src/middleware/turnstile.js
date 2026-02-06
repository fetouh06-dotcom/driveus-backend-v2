const axios = require("axios");

function isEnabled() {
  return String(process.env.TURNSTILE_ENABLED || "false").toLowerCase() === "true";
}

async function verifyTurnstile(token, ip) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) throw new Error("TURNSTILE_SECRET_KEY manquant");

  const resp = await axios.post(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    new URLSearchParams({ secret, response: token, remoteip: ip }),
    { timeout: 10000 }
  );

  return resp.data && resp.data.success === true;
}

async function turnstileMiddleware(req, res, next) {
  if (!isEnabled()) return next();

  const token = req.headers["x-turnstile-token"] || req.body?.turnstile_token;
  if (!token) return res.status(400).json({ error: "Captcha requis" });

  try {
    const ok = await verifyTurnstile(String(token), req.ip);
    if (!ok) return res.status(400).json({ error: "Captcha invalide" });
    next();
  } catch (e) {
    return res.status(500).json({ error: "Erreur captcha" });
  }
}

module.exports = { turnstileMiddleware };
