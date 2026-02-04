function requireEnv(name, { optional = false } = {}) {
  const v = process.env[name];
  if (!v && !optional) throw new Error(`${name} manquant`);
  return v;
}
function num(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  if (Number.isNaN(n)) throw new Error(`${name} invalide`);
  return n;
}
function getConfig() {
  const NODE_ENV = process.env.NODE_ENV || "development";
  return {
    NODE_ENV,
    PORT: num("PORT", 3000),
    CORS_ORIGIN: process.env.CORS_ORIGIN || (NODE_ENV === "production" ? "" : "*"),
    JWT_SECRET: requireEnv("JWT_SECRET"),
    ADMIN_BOOTSTRAP_EMAIL: process.env.ADMIN_BOOTSTRAP_EMAIL || null,
    ADMIN_BOOTSTRAP_PASSWORD: process.env.ADMIN_BOOTSTRAP_PASSWORD || null,
    MIN_FARE_EUR: num("MIN_FARE_EUR", 25),
    PRICE_PER_KM_EUR: num("PRICE_PER_KM_EUR", 3),
    NIGHT_SURCHARGE_PCT: num("NIGHT_SURCHARGE_PCT", 20),
    SUNDAY_SURCHARGE_PCT: num("SUNDAY_SURCHARGE_PCT", 20),
    NIGHT_START_HOUR: num("NIGHT_START_HOUR", 20),
    NIGHT_END_HOUR: num("NIGHT_END_HOUR", 7),
    OPENROUTE_API_KEY: process.env.OPENROUTE_API_KEY || null,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || null,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || null,
    FRONTEND_URL: process.env.FRONTEND_URL || null,
    DEPOSIT_EUR: num("DEPOSIT_EUR", 10),
    DEPOSIT_EXPIRES_MINUTES: num("DEPOSIT_EXPIRES_MINUTES", 30),
    ADMIN_EMAIL: process.env.ADMIN_EMAIL || "contact@driveus.fr",
  };
}
module.exports = { requireEnv, getConfig };
