const { createClient } = require("@libsql/client");
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const provider = process.env.DB_PROVIDER || "sqlite";

/**
 * TURSO (production)
 */
if (provider === "turso") {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!url || !authToken) {
    throw new Error("TURSO_DATABASE_URL ou TURSO_AUTH_TOKEN manquant");
  }

  const client = createClient({
    url,
    authToken
  });

  module.exports = {
    type: "turso",
    execute: (sql, params = []) => client.execute({ sql, args: params })
  };

  console.log("🟢 DB Turso connectée");
  return;
}

/**
 * SQLITE LOCAL (dev / secours)
 */
const dbDir = path.join(process.cwd(), "database");
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const dbPath = path.join(dbDir, "driveus.db");
const db = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

module.exports = {
  type: "sqlite",
  execute: (sql, params = []) => {
    const stmt = db.prepare(sql);
    if (sql.trim().toLowerCase().startsWith("select")) {
      return { rows: stmt.all(params) };
    }
    stmt.run(params);
    return { rows: [] };
  }
};

console.log("🟡 DB SQLite locale connectée");
