const db = require("./database");

async function tableInfo(table) {
  const r = await db.execute(`PRAGMA table_info(${table})`);
  return r.rows || [];
}

async function hasColumn(table, col) {
  const info = await tableInfo(table);
  return info.some((c) => c.name === col);
}

async function needsDistanceNullableMigration() {
  const info = await tableInfo("bookings");
  const distance = info.find((c) => c.name === "distance");
  // PRAGMA table_info: notnull is 1 if NOT NULL
  return !!distance && distance.notnull === 1;
}

async function ensureBookingsSchema() {
  // 1) Add public_token if missing
  const hasPublicToken = await hasColumn("bookings", "public_token");
  if (!hasPublicToken) {
    await db.execute("ALTER TABLE bookings ADD COLUMN public_token TEXT");
    // Fill existing rows with a random token
    await db.execute(
      "UPDATE bookings SET public_token = lower(hex(randomblob(16))) WHERE public_token IS NULL"
    );
    await db.execute(
      "CREATE INDEX IF NOT EXISTS idx_bookings_public_token ON bookings(public_token)"
    );
  }

  // 2) Make distance nullable if current schema uses NOT NULL
  const mustMigrateDistance = await needsDistanceNullableMigration();
  if (!mustMigrateDistance) return;

  const hadPublicTokenBefore = hasPublicToken; // if false, column now exists but old table still had NOT NULL distance

  // Create new table with desired schema
  await db.execute(
    `
    CREATE TABLE IF NOT EXISTS bookings_new (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      pickup TEXT NOT NULL,
      dropoff TEXT NOT NULL,
      distance REAL,
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
      invoiced_at TEXT,
      public_token TEXT
    )
  `
  );

  // Copy data
  if (hadPublicTokenBefore) {
    await db.execute(
      `
      INSERT INTO bookings_new (
        id, user_id, pickup, dropoff, distance, price, created_at, pickup_datetime, status,
        customer_name, customer_phone, customer_email, notes,
        deposit_amount, deposit_paid, payment_status, deposit_due_at,
        stripe_session_id, stripe_payment_intent_id, invoice_number, invoiced_at,
        public_token
      )
      SELECT
        id, user_id, pickup, dropoff,
        distance,
        price, created_at, pickup_datetime, status,
        customer_name, customer_phone, customer_email, notes,
        deposit_amount, deposit_paid, payment_status, deposit_due_at,
        stripe_session_id, stripe_payment_intent_id, invoice_number, invoiced_at,
        COALESCE(public_token, lower(hex(randomblob(16))))
      FROM bookings
    `
    );
  } else {
    await db.execute(
      `
      INSERT INTO bookings_new (
        id, user_id, pickup, dropoff, distance, price, created_at, pickup_datetime, status,
        customer_name, customer_phone, customer_email, notes,
        deposit_amount, deposit_paid, payment_status, deposit_due_at,
        stripe_session_id, stripe_payment_intent_id, invoice_number, invoiced_at,
        public_token
      )
      SELECT
        id, user_id, pickup, dropoff,
        distance,
        price, created_at, pickup_datetime, status,
        customer_name, customer_phone, customer_email, notes,
        deposit_amount, deposit_paid, payment_status, deposit_due_at,
        stripe_session_id, stripe_payment_intent_id, invoice_number, invoiced_at,
        lower(hex(randomblob(16)))
      FROM bookings
    `
    );
  }

  await db.execute("DROP TABLE bookings");
  await db.execute("ALTER TABLE bookings_new RENAME TO bookings");

  // Recreate indexes
  await db.execute(
    "CREATE INDEX IF NOT EXISTS idx_bookings_created_at ON bookings(created_at)"
  );
  await db.execute(
    "CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status)"
  );
  await db.execute(
    "CREATE INDEX IF NOT EXISTS idx_bookings_deposit_due ON bookings(deposit_due_at)"
  );
  await db.execute(
    "CREATE INDEX IF NOT EXISTS idx_bookings_public_token ON bookings(public_token)"
  );
}

async function migrate() {
  // USERS
  await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at TEXT NOT NULL
    )
  `);

  // BOOKINGS (desired schema)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      pickup TEXT NOT NULL,
      dropoff TEXT NOT NULL,
      distance REAL,
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
      invoiced_at TEXT,
      public_token TEXT
    )
  `);

  // Index utiles (perf admin / webhook)
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_bookings_created_at
    ON bookings(created_at)
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_bookings_status
    ON bookings(status)
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_bookings_deposit_due
    ON bookings(deposit_due_at)
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_bookings_public_token
    ON bookings(public_token)
  `);

  // Post-create schema fixes for existing databases
  await ensureBookingsSchema();

  console.log("✅ Database migration completed");
}

module.exports = { migrate };
