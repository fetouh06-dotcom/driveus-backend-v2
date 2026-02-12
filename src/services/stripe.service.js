/**
 * src/services/stripe.service.js
 * Service Stripe (sans Express / sans routes) -> évite les dépendances circulaires
 */

const Stripe = require("stripe");
const { getConfig } = require("../config/env");

const config = getConfig();

// Singleton (un seul client Stripe pour tout le process)
let stripeClient = null;

function getStripe() {
  if (!stripeClient) {
    if (!config.STRIPE_SECRET_KEY) {
      const err = new Error("STRIPE_SECRET_KEY manquant");
      err.statusCode = 500;
      throw err;
    }

    // Allow overriding API version via env if you really want to pin it
    const apiVersion = process.env.STRIPE_API_VERSION || undefined;

    stripeClient = new Stripe(config.STRIPE_SECRET_KEY, {
      ...(apiVersion ? { apiVersion } : {})
    });
  }

  return stripeClient;
}

function getWebhookSecret() {
  // In production, MUST be present.
  if (config.NODE_ENV === "production" && !config.STRIPE_WEBHOOK_SECRET) {
    const err = new Error("STRIPE_WEBHOOK_SECRET manquant");
    err.statusCode = 500;
    throw err;
  }

  // In dev, allow missing secret if you don't use webhook locally.
  if (!config.STRIPE_WEBHOOK_SECRET) return null;

  return config.STRIPE_WEBHOOK_SECRET;
}

module.exports = {
  getStripe,
  getWebhookSecret,
  config
};
