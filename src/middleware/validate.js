function isISODateString(s) {
  return typeof s === "string" && !Number.isNaN(Date.parse(s));
}

function clampStr(s, max) {
  if (typeof s !== "string") return "";
  const v = s.trim();
  return v.length > max ? v.slice(0, max) : v;
}

function validateEmail(email) {
  if (!email) return true; // email optionnel
  if (typeof email !== "string") return false;
  return /^\S+@\S+\.\S+$/.test(email.trim());
}

/**
 * Validation booking publique (VTC)
 * Champs attendus: pickup_text, dropoff_text, pickup_datetime, customer_name, customer_email, customer_phone, notes
 */
function validatePublicBooking(req, res, next) {
  const b = req.body || {};

  const pickup_text = clampStr(b.pickup_text, 200);
  const dropoff_text = clampStr(b.dropoff_text, 200);
  const customer_name = clampStr(b.customer_name, 80);
  const customer_email = clampStr(b.customer_email, 120);
  const customer_phone = clampStr(b.customer_phone, 40);
  const notes = clampStr(b.notes, 500);
  const pickup_datetime = b.pickup_datetime;

  if (!pickup_text || !dropoff_text) {
    return res.status(400).json({ error: "pickup_text et dropoff_text sont requis" });
  }

  if (!validateEmail(customer_email)) {
    return res.status(400).json({ error: "Email invalide" });
  }

  if (pickup_datetime != null) {
    if (!isISODateString(pickup_datetime)) {
      return res.status(400).json({ error: "pickup_datetime doit être une date ISO valide" });
    }
    const dt = new Date(pickup_datetime);
    const now = new Date();
    if (dt.getTime() < now.getTime() - 5 * 60 * 1000) {
      return res.status(400).json({ error: "pickup_datetime ne peut pas être dans le passé" });
    }
  }

  req.body = {
    ...b,
    pickup_text,
    dropoff_text,
    customer_name: customer_name || null,
    customer_email: customer_email || null,
    customer_phone: customer_phone || null,
    notes: notes || null
  };

  next();
}

function validateLogin(req, res, next) {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "email et password requis" });
  if (typeof email !== "string" || typeof password !== "string") return res.status(400).json({ error: "email/password invalides" });
  if (email.length > 120 || password.length > 200) return res.status(400).json({ error: "Champs trop longs" });
  next();
}

function validateDepositSession(req, res, next) {
  const { booking_id } = req.body || {};
  if (!booking_id || typeof booking_id !== "string" || booking_id.length > 80) {
    return res.status(400).json({ error: "booking_id manquant ou invalide" });
  }
  next();
}

module.exports = { validatePublicBooking, validateLogin, validateDepositSession };
