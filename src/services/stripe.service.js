const Stripe = require("stripe");
const { getConfig, requireEnv } = require("../config/env");
const config = getConfig();

function getStripe() {
  if (!config.STRIPE_SECRET_KEY) {
    const err = new Error("STRIPE_SECRET_KEY manquant");
    err.statusCode = 500;
    throw err;
  }
  return new Stripe(config.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
}
function getWebhookSecret() { return requireEnv("STRIPE_WEBHOOK_SECRET"); }

module.exports = { getStripe, getWebhookSecret, config };
