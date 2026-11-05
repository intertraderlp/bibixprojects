const jwt = require('jsonwebtoken');
const db = require('../db/database');
const JWT_SECRET = process.env.JWT_SECRET || 'monday-secret-key-change-in-prod';

function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const token = header.slice(7);
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// Allows both 'admin' and 'super_admin'
function requireAdmin(req, res, next) {
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(req.user.id);
  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// Allows only 'super_admin'
function requireSuperAdmin(req, res, next) {
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(req.user.id);
  if (!user || user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Super admin access required' });
  }
  next();
}

// Gate a route behind a per-user permission flag (users.permissions JSON).
// Admins/super_admins always pass. For everyone else the key must not be
// explicitly false — absent means allowed (backward-compatible, matches the
// frontend hasPermission()). Use after authenticate.
function requirePermission(key) {
  return (req, res, next) => {
    const user = db.prepare('SELECT role, permissions FROM users WHERE id = ?').get(req.user.id);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    if (user.role === 'admin' || user.role === 'super_admin') return next();
    let perms = {};
    try { perms = JSON.parse(user.permissions || '{}'); } catch { /* malformed → treat as empty */ }
    if (perms[key] === false) return res.status(403).json({ error: 'Not allowed' });
    next();
  };
}

// Accepts either a JWT or an instagram_api_token (used by the browser extension)
function authenticateFlexible(req, res, next) {
  var header = req.headers.authorization || '';
  var token = header.replace(/^Bearer\s+/i, '').trim();
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  // Try JWT first
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch (_) {}

  // Fall back to instagram_api_token
  var user = db.prepare('SELECT id, name, email, role FROM users WHERE instagram_api_token = ?').get(token);
  if (!user) return res.status(401).json({ error: 'Invalid token' });
  req.user = user;
  next();
}

module.exports = { authenticate, authenticateFlexible, requireAdmin, requireSuperAdmin, requirePermission, JWT_SECRET };
