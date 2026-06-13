const express = require('express');
const db = require('../db');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Only this account can access admin endpoints
const ADMIN_EMAIL = 'demianluglio@gmail.com';

const getUserById     = db.prepare('SELECT email FROM users WHERE id = ?');
const countUsers      = db.prepare('SELECT COUNT(*) AS n FROM users');
const countUsersSince = db.prepare('SELECT COUNT(*) AS n FROM users WHERE created_at >= ?');

router.use(authenticateToken);
router.use((req, res, next) => {
  const user = getUserById.get(req.userId);
  if (!user || user.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Accesso negato.' });
  next();
});

// GET /api/admin/stats — basic registration stats (admin only)
router.get('/stats', (req, res) => {
  const now = Date.now();
  const since7  = new Date(now - 7  * 86400000).toISOString();
  const since30 = new Date(now - 30 * 86400000).toISOString();

  res.json({
    totalUsers:          countUsers.get().n,
    newUsersLast7Days:   countUsersSince.get(since7).n,
    newUsersLast30Days:  countUsersSince.get(since30).n,
  });
});

module.exports = router;
