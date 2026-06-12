const express = require('express');
const db = require('../db');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);

// ─── Watchlist ────────────────────────────────────────────────────────────
const getWatchlist    = db.prepare('SELECT symbol, added_at AS addedAt FROM watchlist WHERE user_id = ? ORDER BY added_at ASC');
const insertWatchlist = db.prepare('INSERT OR IGNORE INTO watchlist (user_id, symbol, added_at) VALUES (?, ?, ?)');
const deleteWatchlist = db.prepare('DELETE FROM watchlist WHERE user_id = ? AND symbol = ?');

router.get('/watchlist', (req, res) => {
  res.json(getWatchlist.all(req.userId));
});

router.post('/watchlist', (req, res) => {
  const { symbol } = req.body || {};
  if (!symbol?.trim()) return res.status(400).json({ error: 'Simbolo richiesto.' });
  insertWatchlist.run(req.userId, symbol.trim().toUpperCase(), new Date().toISOString());
  res.json({ success: true });
});

router.delete('/watchlist/:symbol', (req, res) => {
  deleteWatchlist.run(req.userId, req.params.symbol.toUpperCase());
  res.json({ success: true });
});

// ─── Portfolio ────────────────────────────────────────────────────────────
const getPortfolio   = db.prepare('SELECT id, symbol, quantity, buy_price AS buyPrice, buy_date AS buyDate FROM portfolio WHERE user_id = ? ORDER BY id ASC');
const getPosition    = db.prepare('SELECT * FROM portfolio WHERE id = ? AND user_id = ?');
const insertPosition = db.prepare('INSERT INTO portfolio (user_id, symbol, quantity, buy_price, buy_date) VALUES (?, ?, ?, ?, ?)');
const updatePosition = db.prepare('UPDATE portfolio SET symbol = ?, quantity = ?, buy_price = ?, buy_date = ? WHERE id = ? AND user_id = ?');
const deletePosition = db.prepare('DELETE FROM portfolio WHERE id = ? AND user_id = ?');

router.get('/portfolio', (req, res) => {
  res.json(getPortfolio.all(req.userId));
});

router.post('/portfolio', (req, res) => {
  const { symbol, quantity, buyPrice, buyDate } = req.body || {};
  if (!symbol?.trim() || !quantity) return res.status(400).json({ error: 'Simbolo e quantità richiesti.' });
  const info = insertPosition.run(req.userId, symbol.trim().toUpperCase(), +quantity, +buyPrice || 0, buyDate || new Date().toISOString());
  res.json({ success: true, id: info.lastInsertRowid });
});

router.put('/portfolio/:id', (req, res) => {
  const existing = getPosition.get(req.params.id, req.userId);
  if (!existing) return res.status(404).json({ error: 'Posizione non trovata.' });
  const { symbol, quantity, buyPrice, buyDate } = req.body || {};
  updatePosition.run(
    symbol?.trim() ? symbol.trim().toUpperCase() : existing.symbol,
    quantity != null ? +quantity : existing.quantity,
    buyPrice != null ? +buyPrice : existing.buy_price,
    buyDate || existing.buy_date,
    req.params.id, req.userId,
  );
  res.json({ success: true });
});

router.delete('/portfolio/:id', (req, res) => {
  deletePosition.run(req.params.id, req.userId);
  res.json({ success: true });
});

module.exports = router;
