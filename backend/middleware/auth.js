const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'investingview-dev-secret-2026';

function makeToken(userId) {
  return jwt.sign({ id: userId }, SECRET, { expiresIn: '30d' });
}

// Requires a valid "Authorization: Bearer <token>" header; sets req.userId
function authenticateToken(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token mancante.' });
  try {
    const payload = jwt.verify(token, SECRET);
    req.userId = payload.id;
    next();
  } catch {
    return res.status(401).json({ error: 'Sessione scaduta. Effettua nuovamente il login.' });
  }
}

module.exports = { SECRET, makeToken, authenticateToken };
