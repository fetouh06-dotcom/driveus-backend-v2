
const crypto = require("crypto");

function randomPublicToken() {
  return crypto.randomBytes(16).toString("hex");
}

async function columnExists(db, table, column) {
  const res = await db.execute(`PRAGMA table_info(${table});`);
  const cols = res.rows || res;
  return cols.some((r) => (r.name || r[1]) === column);
}

async function ensureBookingsPublicToken(db) {
  const has = await columnExists(db, "bookings", "public_token");

  if (!has) {
    console.log("🧩 Migration: adding bookings.public_token");
    await db.execute(`ALTER TABLE bookings ADD COLUMN public_token TEXT;`);
  }

  await db.execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_public_token ON bookings(public_token);`
  );

  const missingRes = await db.execute(
    `SELECT id FROM bookings WHERE public_token IS NULL OR public_token = '';`
  );

  const missing = missingRes.rows || missingRes;

  for (const row of missing) {
    const id = row.id ?? row[0];

    for (let i = 0; i < 5; i++) {
      const tok = randomPublicToken();
      try {
        await db.execute({
          sql: `UPDATE bookings SET public_token = ? WHERE id = ?;`,
          args: [tok, id],
        });
        break;
      } catch (e) {
        if (i === 4) throw e;
      }
    }
  }

  console.log("✅ Migration: bookings.public_token ensured");
}

async function migrate(db) {
  // Ensure table exists (safe create)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      pickup TEXT NOT NULL,
      dropoff TEXT NOT NULL,
      price REAL NOT NULL,
      distance REAL,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // IMPORTANT: ensure public_token BEFORE any query uses it
  await ensureBookingsPublicToken(db);

  console.log("✅ Migrations complete");
}

module.exports = { migrate };
