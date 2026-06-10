const express = require('express');
const bcrypt  = require('bcryptjs');
const crypto  = require('crypto');
const db      = require('../db');

const router = express.Router();
const SECRET = process.env.JWT_SECRET || 'investingview-dev-secret-2026';

// HMAC-based deterministic token — stateless, no DB lookup needed
function makeToken(userId) {
  return crypto.createHmac('sha256', SECRET).update(userId).digest('hex');
}

const getUserByEmail = db.prepare('SELECT * FROM users WHERE email = ?');
const insertUser     = db.prepare('INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)');

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body || {};
    if (!name?.trim() || !email?.trim() || !password)
      return res.status(400).json({ error: 'Tutti i campi sono obbligatori.' });
    if (password.length < 8 || !/[A-Z]/.test(password) || !/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?~`]/.test(password))
      return res.status(400).json({ error: 'La password deve avere almeno 8 caratteri, una lettera maiuscola e un carattere speciale.' });

    const email_ = email.toLowerCase().trim();
    if (getUserByEmail.get(email_))
      return res.status(409).json({ error: 'Email già registrata. Accedi invece.' });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = {
      id:        Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      name:      name.trim(),
      email:     email_,
      createdAt: new Date().toISOString(),
    };
    insertUser.run(user.id, user.name, user.email, passwordHash, user.createdAt);

    const token = makeToken(user.id);
    res.json({
      success: true,
      token,
      user: { id: user.id, name: user.name, email: user.email },
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Errore durante la registrazione.' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email?.trim() || !password)
      return res.status(400).json({ error: 'Inserisci email e password.' });

    const user = getUserByEmail.get(email.toLowerCase().trim());
    if (!user)
      return res.status(401).json({ error: 'Email o password non corretti.' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok)
      return res.status(401).json({ error: 'Email o password non corretti.' });

    const token = makeToken(user.id);
    res.json({
      success: true,
      token,
      user: { id: user.id, name: user.name, email: user.email },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Errore durante il login.' });
  }
});

module.exports = router;
