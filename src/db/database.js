const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const dbDir = path.join(process.cwd(), "database");
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const dbPath = path.join(dbDir, "driveus.db");
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

module.exports = db;
