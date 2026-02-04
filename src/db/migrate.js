const db = require("./database");

function migrate() {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at TEXT NOT NULL
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      pickup TEXT NOT NULL,
      dropoff TEXT NOT NULL,
      distance REAL NOT NULL,
      price REAL NOT NULL,
      created_at TEXT NOT NULL,
      pickup_datetime TEXT,
      status TEXT NOT NULL DEFAULT 'pending_payment',
      customer_name TEXT,
      customer_phone TEXT,
      customer_email TEXT,
      notes TEXT,
      deposit_amount REAL NOT NULL DEFAULT 10,
      deposit_paid INTEGER NOT NULL DEFAULT 0,
      payment_status TEXT NOT NULL DEFAULT 'deposit_pending',
      deposit_due_at TEXT,
      stripe_session_id TEXT,
      stripe_payment_intent_id TEXT,
      invoice_number TEXT,
      invoiced_at TEXT
    )
  `).run();
}
module.exports = { migrate };
