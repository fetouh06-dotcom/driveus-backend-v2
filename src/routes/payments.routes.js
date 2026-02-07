const express = require("express");
const db = require("../db/database");
const { getStripe, getWebhookSecret, config } = require("../services/stripe.service");

const { paymentsLimiter } = require("../middleware/rateLimiters");
const { validateDepositSession } = require("../middleware/validate");

// Optionnel (si tu as installé le pack logs sécurité)
let securityEvent = null;
try {
  ({ securityEvent } = require("../middleware/securityLogger"));
} catch (e) {}

const router = express.Router();

router.get("/", (req, res) => res.json({ ok: true, service: "payments" }));

// ✅ anti-spam + validation booking_id
router.post(
  "/deposit-session",
  paymentsLimiter,
  validateDepositSession,
  async (req, res) => {
    try {
      const { booking_id } = req.body || {};

      const r = await db.execute("SELECT * FROM bookings WHERE id = ?", [booking_id]);
      const booking = r.rows?.[0] || null;

      if (!booking) return res.status(404).json({ error: "Réservation introuvable" });
      if (booking.deposit_paid) return res.status(400).json({ error: "Acompte déjà payé" });
      if (!config.FRONTEND_URL) return res.status(400).json({ error: "FRONTEND_URL manquant" });

      const stripe = getStripe();
      const depositCents = Math.round(Number(booking.deposit_amount || config.DEPOSIT_EUR) * 100);

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        customer_email: booking.customer_email || undefined,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "eur",
              unit_amount: depositCents,
              product_data: {
                name: `Acompte DriveUs (${(depositCents / 100).toFixed(0)}€)`
              }
            }
          }
        ],
        metadata: { booking_id },
        success_url: `${config.FRONTEND_URL}/paiement/succes?booking_id=${booking_id}&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${config.FRONTEND_URL}/paiement/annule?booking_id=${booking_id}`
      });

      await db.execute(
        "UPDATE bookings SET stripe_session_id = ?, payment_status = 'deposit_pending' WHERE id = ?",
        [session.id, booking_id]
      );

      if (securityEvent) {
        securityEvent("stripe_deposit_session_created", req, {
          booking_id,
          session_id: session.id
        });
      }

      return res.json({ url: session.url, session_id: session.id });
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
    const stripe = getStripe();
    const sig = req.headers["stripe-signature"];
    if (!sig) return res.status(400).send("Webhook Error: signature manquante");

    event = stripe.webhooks.constructEvent(req.body, sig, getWebhookSecret());
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const bookingId = session.metadata?.booking_id;

      if (bookingId) {
        // ✅ Sécurité: vérifier que la session Stripe correspond à celle enregistrée (si existante)
        const currentRes = await db.execute(
          "SELECT id, stripe_session_id FROM bookings WHERE id = ?",
          [bookingId]
        );
        const current = currentRes.rows?.[0] || null;

        if (current && current.stripe_session_id && current.stripe_session_id !== session.id) {
          // session mismatch => ignore
          return res.json({ received: true });
        }

        await db.execute(
          `
          UPDATE bookings
          SET deposit_paid = 1,
              payment_status = 'deposit_paid',
              status = 'confirmed',
              stripe_payment_intent_id = COALESCE(stripe_payment_intent_id, ?)
          WHERE id = ?
          `,
          [session.payment_intent || null, bookingId]
        );

        if (securityEvent) {
          securityEvent("stripe_webhook_checkout_completed", req, {
            booking_id: bookingId,
            session_id: session.id,
            payment_intent: session.payment_intent || null
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
