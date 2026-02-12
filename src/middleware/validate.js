function isISODateString(s) {
  return typeof s === "string" && !Number.isNaN(Date.parse(s));
}

// Accepts datetime-local: "YYYY-MM-DDTHH:mm" (no timezone)
function isDateTimeLocalString(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s);
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

function toNumber(x) {
  const n = typeof x === "string" ? Number(x.replace(",", ".")) : Number(x);
  return Number.isFinite(n) ? n : null;
}

/**
 * Normalize pickup_datetime:
 * - Accept ISO strings OR datetime-local strings
 * - Keep as provided string (don’t invent timezone here),
 *   but ensure it is parseable and not in the past.
 */
function normalizePickupDatetime(v) {
  if (v == null || v === "") return null;
  if (typeof v !== "string") return null;

  const s = v.trim();

  // Accept either full ISO or datetime-local
  if (!isISODateString(s) && !isDateTimeLocalString(s)) return null;

  // Validate parseability
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;

  return s;
}

/**
 * Validation booking publique (VTC)
 * Champs attendus:
 * - pickup_text, dropoff_text, pickup_datetime
 * - customer_name, customer_email, customer_phone, notes
 * - (optional) estimated_* snapshot coming from frontend
 */
function validatePublicBooking(req, res, next) {
  const b = req.body || {};

  const pickup_text = clampStr(b.pickup_text, 200);
  const dropoff_text = clampStr(b.dropoff_text, 200);

  const customer_name = clampStr(b.customer_name, 80);
  const customer_email = clampStr(b.customer_email, 120);
  const customer_phone = clampStr(b.customer_phone, 40);
  const notes = clampStr(b.notes, 500);

  const pickup_datetime = normalizePickupDatetime(b.pickup_datetime);

  if (!pickup_text || !dropoff_text) {
    return res.status(400).json({ error: "pickup_text et dropoff_text sont requis" });
  }

  if (!validateEmail(customer_email)) {
    return res.status(400).json({ error: "Email invalide" });
  }

  if (b.pickup_datetime != null && pickup_datetime == null) {
    return res.status(400).json({ error: "pickup_datetime doit être une date valide (ISO ou YYYY-MM-DDTHH:mm)" });
  }

  if (pickup_datetime != null) {
    const dt = new Date(pickup_datetime);
    const now = new Date();

    // allow 5 minutes clock skew
    if (dt.getTime() < now.getTime() - 5 * 60 * 1000) {
      return res.status(400).json({ error: "pickup_datetime ne peut pas être dans le passé" });
    }

    // optional: prevent absurd future dates
    const maxFutureMs = 365 * 24 * 60 * 60 * 1000;
    if (dt.getTime() > now.getTime() + maxFutureMs) {
      return res.status(400).json({ error: "pickup_datetime trop éloigné dans le futur" });
    }
  }

  // ---- Optional estimate snapshot (whitelisted)
  const estimated_price = toNumber(b.estimated_price);
  const estimated_distance_km = toNumber(b.estimated_distance_km);
  const estimated_pickup_label = clampStr(b.estimated_pickup_label, 200);
  const estimated_dropoff_label = clampStr(b.estimated_dropoff_label, 200);
  const estimated_approximate = typeof b.estimated_approximate === "boolean" ? b.estimated_approximate : null;
  const estimated_at = toNumber(b.estimated_at); // ms timestamp from client (optional)

  // ✅ STRICT WHITELIST (do not spread ...b)
  req.body = {
    pickup_text,
    dropoff_text,
    pickup_datetime: pickup_datetime || null,

    customer_name: customer_name || null,
    customer_email: customer_email || null,
    customer_phone: customer_phone || null,
    notes: notes || null,

    // estimate snapshot (optional)
    estimated_price,
    estimated_distance_km,
    estimated_pickup_label: estimated_pickup_label || null,
    estimated_dropoff_label: estimated_dropoff_label || null,
    estimated_approximate,
    estimated_at
  };

  next();
}

function validateLogin(req, res, next) {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "email et password requis" });
  if (typeof email !== "string" || typeof password !== "string") return res.status(400).json({ error: "email/password invalides" });
  if (email.length > 120 || password.length > 200) return res.status(400).json({ error: "Champs trop longs" });

  // normalize
  req.body = { email: email.trim().toLowerCase(), password };

  next();
}


function validateDepositSession(req, res, next) {
  const { booking_id, public_token } = req.body || {};
  if (!booking_id || typeof booking_id !== "string" || booking_id.length > 80) {
    return res.status(400).json({ error: "booking_id manquant ou invalide" });
  }
  if (!public_token || typeof public_token !== "string" || public_token.length > 128) {
    return res.status(400).json({ error: "public_token manquant ou invalide" });
  }

  req.body = { booking_id: booking_id.trim(), public_token: public_token.trim() };
  next();
}

module.exports = { validatePublicBooking, validateLogin, validateDepositSession };
