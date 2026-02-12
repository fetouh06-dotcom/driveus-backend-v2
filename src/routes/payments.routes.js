/**
 * src/routes/payments.routes.js
 * LIVE-ready (Option A) + évite warnings circular deps
 */

const express = require("express");
const db = require("../db/database");
const stripeService = require("../services/stripe.service");

const { paymentsLimiter } = require("../middleware/rateLimiters");
const { validateDepositSession } = require("../middleware/validate");

// Optionnel (si tu as installé le pack logs sécurité)
let securityEvent = null;
try {
  ({ securityEvent } = require("../middleware/securityLogger"));
} catch (e) {}

const router = express.Router();

router.get("/", (req, res) => res.json({ ok: true, service: "payments" }));

function toNumber(x) {
  const n = typeof x === "string" ? Number(x.replace(",", ".")) : Number(x);
  return Number.isFinite(n) ? n : null;
}

function isPastISO(iso) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && t < Date.now();
}

router.post(
  "/deposit-session",
  paymentsLimiter,
  validateDepositSession,
  async (req, res) => {
    try {
      const { booking_id, public_token } = req.body || {};
      if (!booking_id) return res.status(400).json({ error: "booking_id manquant" });
      if (!public_token) return res.status(400).json({ error: "public_token manquant" });

      const r = await db.execute(
        "SELECT * FROM bookings WHERE id = ? AND public_token = ?",
        [booking_id, public_token]
      );
      const booking = r.rows?.[0] || null;

      if (!booking) return res.status(404).json({ error: "Réservation introuvable" });
      if (booking.status === "cancelled") {
        return res.status(400).json({ error: "Réservation annulée" });
      }
      if (booking.deposit_paid) return res.status(400).json({ error: "Acompte déjà payé" });

      const frontendUrl = stripeService.config?.FRONTEND_URL;
      if (!frontendUrl) return res.status(400).json({ error: "FRONTEND_URL manquant" });

      const stripe = stripeService.getStripe();

      // If session already exists and the due date has NOT passed, return the existing session URL.
      if (booking.stripe_session_id && !isPastISO(booking.deposit_due_at)) {
        try {
          const existing = await stripe.checkout.sessions.retrieve(booking.stripe_session_id);
          if (existing?.url) {
            return res.json({ url: existing.url });
          }
        } catch (_) {
          // fall through to creating a new session
        }
      }

      // If due date passed but booking is still pending, extend the due date and renew the session.
      let effectiveDueAt = booking.deposit_due_at;
      if (isPastISO(booking.deposit_due_at) && booking.status === "pending_payment") {
        const expiresMinutes = Number(stripeService.config?.DEPOSIT_EXPIRES_MINUTES) || 30;
        effectiveDueAt = new Date(Date.now() + expiresMinutes * 60 * 1000).toISOString();
        await db.execute(
          "UPDATE bookings SET deposit_due_at = ?, stripe_session_id = NULL WHERE id = ?",
          [effectiveDueAt, booking_id]
        );
      }

      // booking.deposit_amount is EUR (from DB). Fallback to config.
      const depositEur = toNumber(booking.deposit_amount ?? stripeService.config.DEPOSIT_EUR);
      const safeDepositEur = depositEur != null ? depositEur : toNumber(stripeService.config.DEPOSIT_EUR) || 10;

      // Avoid float issues + clamp
      const depositCents = Math.round(safeDepositEur * 100);
      if (!Number.isFinite(depositCents) || depositCents <= 0) {
        return res.status(400).json({ error: "Montant acompte invalide" });
      }

      const payload = {
        mode: "payment",
        payment_method_types: ["card"],
        customer_email: booking.customer_email || undefined,

        client_reference_id: booking_id,
        metadata: { booking_id },

        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "eur",
              unit_amount: depositCents,
              product_data: {
                name: `Acompte DriveUs (${(depositCents / 100).toFixed(2)}€)`
              }
            }
          }
        ],

        // ✅ frontend statique => fichiers .html
        success_url: `${frontendUrl}/paiement/succes.html?booking_id=${booking_id}&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${frontendUrl}/paiement/annule.html?booking_id=${booking_id}`
      };

      // Idempotency key changes if we renewed dueAt, preventing accidental reuse.
      const idempotencyKey = `deposit-session-${booking_id}-${effectiveDueAt || "nodue"}`;

      const session = await stripe.checkout.sessions.create(payload, { idempotencyKey });

      // Store/replace the session id
      await db.execute(
        "UPDATE bookings SET stripe_session_id = ?, payment_status = 'deposit_pending' WHERE id = ?",
        [session.id, booking_id]
      );

      if (securityEvent) {
        securityEvent("stripe_deposit_session_created", req, {
          booking_id,
          deposit_cents: depositCents
        });
      }

      return res.json({ url: session.url });
    } catch (e) {
      if (securityEvent) {
        securityEvent("stripe_deposit_session_error", req, {
          message: e.message,
          status: e.statusCode || 500
        });
      }
      return res
        .status(e.statusCode || 500)
        .json({ error: e.message || "Erreur paiement (Stripe)" });
    }
  }
);

async function stripeWebhookHandler(req, res) {
  let event;

  try {
    const stripe = stripeService.getStripe();
    const sig = req.headers["stripe-signature"];
    if (!sig) return res.status(400).send("Webhook Error: signature manquante");

    // ✅ IMPORTANT: allow missing webhook secret in dev (but fail gracefully)
    const secret = stripeService.getWebhookSecret();
    if (!secret) {
      // In prod, stripe.service.js should already throw before this point.
      return res.status(400).send("Webhook Error: secret non configuré");
    }

    event = stripe.webhooks.constructEvent(req.body, sig, secret);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    // ✅ LIVE only en prod
    if (process.env.NODE_ENV === "production" && event.livemode !== true) {
      return res.json({ received: true });
    }

    // Primary event for Checkout
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      if (session.mode && session.mode !== "payment") return res.json({ received: true });
      if (session.payment_status && session.payment_status !== "paid") return res.json({ received: true });

      const bookingId = session.metadata?.booking_id || session.client_reference_id;

      if (bookingId) {
        const currentRes = await db.execute(
          "SELECT id, stripe_session_id, deposit_paid FROM bookings WHERE id = ?",
          [bookingId]
        );
        const current = currentRes.rows?.[0] || null;

        // If booking uses a different Stripe session than the one completing, ignore
        if (current && current.stripe_session_id && current.stripe_session_id !== session.id) {
          return res.json({ received: true });
        }

        // ✅ Idempotent update (only if not already paid)
        await db.execute(
          `
          UPDATE bookings
          SET deposit_paid = 1,
              payment_status = 'deposit_paid',
              status = 'confirmed',
              stripe_payment_intent_id = COALESCE(stripe_payment_intent_id, ?)
          WHERE id = ?
            AND deposit_paid = 0
          `,
          [session.payment_intent || null, bookingId]
        );

        if (securityEvent) {
          securityEvent("stripe_webhook_checkout_completed", req, {
            booking_id: bookingId,
            session_id: session.id,
            payment_intent: session.payment_intent || null,
            livemode: event.livemode === true
          });
        }
      }
    }

    return res.json({ received: true });
  } catch (e) {
    if (securityEvent) {
      securityEvent("stripe_webhook_processing_error", req, { message: e.message });
    }
    return res.status(500).send("Webhook processing error");
  }
}

module.exports = router;
module.exports.stripeWebhookHandler = stripeWebhookHandler;
