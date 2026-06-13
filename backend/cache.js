const crypto = require('crypto');
const db = require('./db');

const getStmt = db.prepare('SELECT value, expires_at FROM cache WHERE key = ?');
const setStmt = db.prepare(`
  INSERT INTO cache (key, value, expires_at) VALUES (?, ?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at
`);
const deleteExpiredStmt = db.prepare('DELETE FROM cache WHERE expires_at IS NOT NULL AND expires_at < ?');

/** Returns the cached value for `key`, or undefined if missing/expired. */
function cacheGet(key) {
  const row = getStmt.get(key);
  if (!row) return undefined;
  if (row.expires_at != null && row.expires_at < Date.now()) return undefined;
  try { return JSON.parse(row.value); } catch { return undefined; }
}

/** Stores `value` under `key`. ttlSeconds === null/undefined means it never expires. */
function cacheSet(key, value, ttlSeconds) {
  const expiresAt = ttlSeconds != null ? Date.now() + ttlSeconds * 1000 : null;
  setStmt.run(key, JSON.stringify(value), expiresAt);
}

/** Get-or-fetch helper: returns the cached value, or calls `fn`, caches and returns its result. */
async function cachedDB(key, fn, ttlSeconds) {
  const hit = cacheGet(key);
  if (hit !== undefined) return hit;
  const data = await fn();
  cacheSet(key, data, ttlSeconds);
  return data;
}

/** Removes all expired (non-permanent) entries. */
function cleanExpiredCache() {
  deleteExpiredStmt.run(Date.now());
}

/** Cache key for a translated text: hash of the source text + target language. */
function translateKey(text, lang) {
  const hash = crypto.createHash('md5').update(text).digest('hex');
  return `translate:${lang}:${hash}`;
}

module.exports = { cacheGet, cacheSet, cachedDB, cleanExpiredCache, translateKey };
