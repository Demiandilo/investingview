const express  = require('express');
const fs       = require('fs');
const path     = require('path');
const bcrypt   = require('bcryptjs');
const crypto   = require('crypto');

const router     = express.Router();
const USERS_FILE = path.join(__dirname, '..', 'users.json');
const SECRET     = process.env.JWT_SECRET || 'investingview-dev-secret-2026';

function readUsers() {
  try {
    if (!fs.existsSync(USERS_FILE)) { fs.writeFileSync(USERS_FILE, '[]'); return []; }
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch { return []; }
}

function writeUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// HMAC-based deterministic token — stateless, no DB lookup needed
function makeToken(userId) {
  return crypto.createHmac('sha256', SECRET).update(userId).digest('hex');
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body || {};
    if (!name?.trim() || !email?.trim() || !password)
      return res.status(400).json({ error: 'Tutti i campi sono obbligatori.' });
    if (password.length < 6)
      return res.status(400).json({ error: 'La password deve avere almeno 6 caratteri.' });

    const users = readUsers();
    if (users.find(u => u.email.toLowerCase() === email.toLowerCase().trim()))
      return res.status(409).json({ error: 'Email già registrata. Accedi invece.' });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = {
      id:           Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      name:         name.trim(),
      email:        email.toLowerCase().trim(),
      passwordHash,
      createdAt:    new Date().toISOString(),
    };
    users.push(user);
    writeUsers(users);

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

    const users = readUsers();
    const user  = users.find(u => u.email.toLowerCase() === email.toLowerCase().trim());
    if (!user)
      return res.status(401).json({ error: 'Email o password non corretti.' });

    const ok = await bcrypt.compare(password, user.passwordHash);
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
