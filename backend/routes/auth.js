const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const db      = require('../db');

const router = express.Router();
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

const PASSWORD_RE_UPPER   = /[A-Z]/;
const PASSWORD_RE_SPECIAL = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?~`]/;
function isPasswordValid(pw) {
  return pw && pw.length >= 8 && PASSWORD_RE_UPPER.test(pw) && PASSWORD_RE_SPECIAL.test(pw);
}

const getUserByEmail = db.prepare('SELECT * FROM users WHERE email = ?');
const getUserById    = db.prepare('SELECT * FROM users WHERE id = ?');
const insertUser     = db.prepare('INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)');
const updateNameEmail = db.prepare('UPDATE users SET name = ?, email = ? WHERE id = ?');
const updatePasswordHash = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?');
const deleteUserById = db.prepare('DELETE FROM users WHERE id = ?');

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body || {};
    if (!name?.trim() || !email?.trim() || !password)
      return res.status(400).json({ error: 'Tutti i campi sono obbligatori.' });
    if (!isPasswordValid(password))
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

// PUT /api/auth/profile — update name, and optionally email (requires currentPassword)
router.put('/profile', authenticateToken, async (req, res) => {
  try {
    const { name, email, currentPassword } = req.body || {};
    const user = getUserById.get(req.userId);
    if (!user) return res.status(404).json({ error: 'Utente non trovato.' });

    const newName  = name?.trim();
    const newEmail = email?.trim().toLowerCase();
    let finalEmail = user.email;

    if (newEmail && newEmail !== user.email) {
      if (!currentPassword)
        return res.status(400).json({ error: 'Inserisci la password attuale per cambiare email.' });
      const ok = await bcrypt.compare(currentPassword, user.password_hash);
      if (!ok)
        return res.status(401).json({ error: 'Password attuale non corretta.' });
      const existing = getUserByEmail.get(newEmail);
      if (existing && existing.id !== user.id)
        return res.status(409).json({ error: 'Email già in uso da un altro account.' });
      finalEmail = newEmail;
    }

    const finalName = newName || user.name;
    updateNameEmail.run(finalName, finalEmail, user.id);

    res.json({ success: true, user: { id: user.id, name: finalName, email: finalEmail } });
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ error: "Errore durante l'aggiornamento del profilo." });
  }
});

// PUT /api/auth/password — change password (requires currentPassword)
router.put('/password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword)
      return res.status(400).json({ error: 'Compila tutti i campi.' });
    if (!isPasswordValid(newPassword))
      return res.status(400).json({ error: 'La nuova password deve avere almeno 8 caratteri, una lettera maiuscola e un carattere speciale.' });

    const user = getUserById.get(req.userId);
    if (!user) return res.status(404).json({ error: 'Utente non trovato.' });

    const ok = await bcrypt.compare(currentPassword, user.password_hash);
    if (!ok)
      return res.status(401).json({ error: 'Password attuale non corretta.' });

    const newHash = await bcrypt.hash(newPassword, 10);
    updatePasswordHash.run(newHash, user.id);

    res.json({ success: true });
  } catch (err) {
    console.error('Update password error:', err);
    res.status(500).json({ error: 'Errore durante il cambio password.' });
  }
});

// DELETE /api/auth/account — permanently delete the authenticated user's account
router.delete('/account', authenticateToken, async (req, res) => {
  try {
    const user = getUserById.get(req.userId);
    if (!user) return res.status(404).json({ error: 'Utente non trovato.' });
    deleteUserById.run(user.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete account error:', err);
    res.status(500).json({ error: "Errore durante l'eliminazione dell'account." });
  }
});

module.exports = router;
