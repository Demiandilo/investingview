const fs       = require('fs');
const path     = require('path');
const Database = require('better-sqlite3');

// /data is a persistent Fly volume in production; falls back to a local file in dev
const DB_DIR  = fs.existsSync('/data') ? '/data' : __dirname;
const DB_PATH = path.join(DB_DIR, 'users.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS watchlist (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id  TEXT NOT NULL,
    symbol   TEXT NOT NULL,
    added_at TEXT NOT NULL,
    UNIQUE(user_id, symbol)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS portfolio (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id   TEXT NOT NULL,
    symbol    TEXT NOT NULL,
    quantity  REAL NOT NULL,
    buy_price REAL NOT NULL,
    buy_date  TEXT NOT NULL
  )
`);

// One-time import from the legacy users.json file (local dev only — gitignored, never deployed)
const LEGACY_FILE = path.join(__dirname, 'users.json');
const { n: userCount } = db.prepare('SELECT COUNT(*) AS n FROM users').get();
if (userCount === 0 && fs.existsSync(LEGACY_FILE)) {
  try {
    const legacy = JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf8'));
    const insert = db.prepare('INSERT OR IGNORE INTO users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)');
    const importAll = db.transaction(users => {
      for (const u of users) insert.run(u.id, u.name, u.email.toLowerCase(), u.passwordHash, u.createdAt);
    });
    importAll(legacy);
    console.log(`Imported ${legacy.length} user(s) from legacy users.json`);
  } catch (err) {
    console.error('Legacy users.json import failed:', err.message);
  }
}

module.exports = db;
