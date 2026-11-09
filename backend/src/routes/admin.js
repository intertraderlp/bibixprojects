const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const jwt = require('jsonwebtoken');
const { authenticate, requireAdmin, requireSuperAdmin, JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

const AVATAR_COLORS = ['#0073ea','#e2445c','#00c875','#ffcb00','#a25ddc','#037f4c','#bb3354','#ff642e','#9aadbd'];

// ── Ensure user_groups tables exist (safe migrations) ────────────────────────
try {
  db.exec(`CREATE TABLE IF NOT EXISTS user_groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#0073ea',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
} catch (_) {}
try {
  db.exec(`CREATE TABLE IF NOT EXISTS user_group_members (
    group_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    PRIMARY KEY (group_id, user_id)
  )`);
} catch (_) {}
try { db.exec("ALTER TABLE user_groups ADD COLUMN color TEXT DEFAULT '#0073ea'"); } catch (_) {}
try { db.exec("ALTER TABLE user_groups ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP"); } catch (_) {}

// ── List users ─────────────────────────────────────────────────────────────────
// super_admin: all users with workspace count
// admin: only users sharing at least one workspace with the caller
router.get('/users', authenticate, requireAdmin, (req, res) => {
  const caller = db.prepare('SELECT role FROM users WHERE id = ?').get(req.user.id);

  const attachGroups = (users) => users.map(u => {
    const groups = db.prepare(`
      SELECT g.id, g.name, g.color FROM user_group_members ugm
      JOIN user_groups g ON g.id = ugm.group_id
      WHERE ugm.user_id = ?
      ORDER BY g.name ASC
    `).all(u.id);
    return { ...u, permissions: JSON.parse(u.permissions || '{}'), groups };
  });

  if (caller.role === 'super_admin') {
    const users = db.prepare(`
      SELECT u.id, u.name, u.email, u.avatar_color, u.role, u.permissions, u.created_at,
             COUNT(DISTINCT wm.workspace_id) AS workspace_count
      FROM users u
      LEFT JOIN workspace_members wm ON wm.user_id = u.id
      GROUP BY u.id
      ORDER BY u.created_at ASC
    `).all();
    return res.json(attachGroups(users));
  }

  // plain admin — only users in shared workspaces
  const users = db.prepare(`
    SELECT DISTINCT u.id, u.name, u.email, u.avatar_color, u.role, u.permissions, u.created_at,
           COUNT(DISTINCT wm2.workspace_id) AS workspace_count
    FROM users u
    JOIN workspace_members wm ON wm.user_id = u.id
    LEFT JOIN workspace_members wm2 ON wm2.user_id = u.id
    WHERE wm.workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = ?
    )
    GROUP BY u.id
    ORDER BY u.created_at ASC
  `).all(req.user.id);
  res.json(attachGroups(users));
});

// ── Change a user's role (super_admin only) ────────────────────────────────────
// Valid promotions: super_admin can set role to 'admin', 'member', or 'super_admin'
// Cannot demote another super_admin (safety: only the caller themselves can do that)
router.put('/users/:id/role', authenticate, requireSuperAdmin, (req, res) => {
  const { role } = req.body;
  const validRoles = ['super_admin', 'admin', 'user', 'readonly'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: `role must be one of: ${validRoles.join(', ')}` });
  }

  const target = db.prepare('SELECT id, role FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found' });

  // Prevent demoting another super_admin (must use /setup to re-promote)
  if (target.role === 'super_admin' && target.id !== req.user.id && role !== 'super_admin') {
    return res.status(403).json({ error: 'Cannot demote another super_admin' });
  }

  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, req.params.id);
  const updated = db.prepare('SELECT id, name, email, avatar_color, role, created_at FROM users WHERE id = ?').get(req.params.id);
  res.json(updated);
});

// ── Impersonate a user — "Sign in as" (admin or super_admin) ──────────────────
// Returns a fresh JWT for the target user so the admin can see the app exactly
// as that user does. A caller may only impersonate someone strictly below them
// in privilege (super_admin > admin > user/readonly). The token carries imp_by
// claims so the session is auditable and the UI can show a "return" banner.
const ROLE_RANK = { super_admin: 3, admin: 2, user: 1, readonly: 1 };
router.post('/users/:id/impersonate', authenticate, requireAdmin, (req, res) => {
  const caller = db.prepare('SELECT id, name, role FROM users WHERE id = ?').get(req.user.id);
  const target = db.prepare('SELECT id, name, email, avatar_color, role FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.id === caller.id) return res.status(400).json({ error: 'You cannot impersonate yourself' });

  const callerRank = ROLE_RANK[caller.role] || 0;
  const targetRank = ROLE_RANK[target.role] || 0;
  if (targetRank >= callerRank) {
    return res.status(403).json({ error: 'You can only sign in as users with lower privileges than you' });
  }
  // Never let an impersonation session itself spawn another impersonation
  if (req.user.imp_by) return res.status(403).json({ error: 'Already impersonating — return to your account first' });

  const token = jwt.sign(
    { id: target.id, name: target.name, email: target.email, role: target.role,
      imp_by: caller.id, imp_by_name: caller.name },
    JWT_SECRET,
    { expiresIn: '2h' }
  );
  console.log(`[impersonate] ${caller.name} (${caller.id}) signed in as ${target.name} (${target.id})`);
  res.json({ token, user: { id: target.id, name: target.name, email: target.email, avatar_color: target.avatar_color, role: target.role } });
});

// ── Update permissions for a user (admin or super_admin) ──────────────────────
router.put('/users/:id/permissions', authenticate, requireAdmin, (req, res) => {
  const { permissions } = req.body;
  if (!permissions || typeof permissions !== 'object') return res.status(400).json({ error: 'permissions object required' });
  db.prepare('UPDATE users SET permissions = ? WHERE id = ?').run(JSON.stringify(permissions), req.params.id);
  const user = db.prepare('SELECT id, name, email, avatar_color, role, permissions, created_at FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ ...user, permissions: JSON.parse(user.permissions || '{}') });
});

// ── Create user (super_admin only) ────────────────────────────────────────────
router.post('/users', authenticate, requireSuperAdmin, (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'name, email, password required' });
  const validRoles = ['super_admin', 'admin', 'user', 'readonly'];
  const userRole = validRoles.includes(role) ? role : 'user';

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return res.status(409).json({ error: 'Email already in use' });

  const id = uuidv4();
  const password_hash = bcrypt.hashSync(password, 10);
  const avatar_color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
  db.prepare('INSERT INTO users (id, name, email, password_hash, avatar_color, role) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, name, email, password_hash, avatar_color, userRole);

  res.json(db.prepare('SELECT id, name, email, avatar_color, role, created_at FROM users WHERE id = ?').get(id));
});

// ── Update user (super_admin only) ────────────────────────────────────────────
router.put('/users/:id', authenticate, requireSuperAdmin, (req, res) => {
  const { name, email, role, password, avatar_color } = req.body;
  const validRoles = ['super_admin', 'admin', 'user', 'readonly'];
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  let password_hash = user.password_hash;
  if (password) password_hash = bcrypt.hashSync(password, 10);

  db.prepare(`UPDATE users SET
    name = COALESCE(?, name),
    email = COALESCE(?, email),
    role = COALESCE(?, role),
    avatar_color = COALESCE(?, avatar_color),
    password_hash = ?
    WHERE id = ?`)
    .run(name || null, email || null,
      validRoles.includes(role) ? role : null,
      avatar_color || null,
      password_hash,
      req.params.id);

  res.json(db.prepare('SELECT id, name, email, avatar_color, role, created_at FROM users WHERE id = ?').get(req.params.id));
});

// ── Delete user (super_admin only) ────────────────────────────────────────────
router.delete('/users/:id', authenticate, requireSuperAdmin, (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });
  const target = db.prepare('SELECT role FROM users WHERE id = ?').get(req.params.id);
  if (target && target.role === 'super_admin') {
    return res.status(403).json({ error: 'Cannot delete a super_admin account' });
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ── Promote self to admin if no admin exists (self-service initial setup) ──────
router.post('/promote-self', authenticate, (req, res) => {
  const count = db.prepare("SELECT COUNT(*) as c FROM users WHERE role IN ('admin', 'super_admin')").get();
  if (count.c > 0) return res.status(403).json({ error: 'Admin already exists' });
  db.prepare("UPDATE users SET role = 'super_admin' WHERE id = ?").run(req.user.id);
  res.json({ success: true });
});

// ── User Groups ───────────────────────────────────────────────────────────────

// List all groups with member count
router.get('/groups', authenticate, requireAdmin, (req, res) => {
  const groups = db.prepare(`
    SELECT g.*, COUNT(ugm.user_id) as member_count
    FROM user_groups g
    LEFT JOIN user_group_members ugm ON ugm.group_id = g.id
    GROUP BY g.id
    ORDER BY g.name ASC
  `).all();
  res.json(groups);
});

// Create group
router.post('/groups', authenticate, requireSuperAdmin, (req, res) => {
  try {
    const { name, color } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
    const existing = db.prepare('SELECT id FROM user_groups WHERE name = ?').get(name.trim());
    if (existing) return res.status(409).json({ error: 'Group name already exists' });
    const id = uuidv4();
    db.prepare('INSERT INTO user_groups (id, name, color) VALUES (?, ?, ?)')
      .run(id, name.trim(), color || '#0073ea');
    const group = db.prepare('SELECT * FROM user_groups WHERE id = ?').get(id);
    res.json(group);
  } catch (e) {
    console.error('[POST /admin/groups]', e);
    res.status(500).json({ error: e.message || 'Internal server error' });
  }
});

// Rename / recolor group
router.put('/groups/:id', authenticate, requireSuperAdmin, (req, res) => {
  const { name, color } = req.body;
  db.prepare('UPDATE user_groups SET name = COALESCE(?, name), color = COALESCE(?, color) WHERE id = ?')
    .run(name?.trim() || null, color || null, req.params.id);
  res.json(db.prepare('SELECT * FROM user_groups WHERE id = ?').get(req.params.id));
});

// Delete group
router.delete('/groups/:id', authenticate, requireSuperAdmin, (req, res) => {
  db.prepare('DELETE FROM user_groups WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Get members of a group
router.get('/groups/:id/members', authenticate, requireAdmin, (req, res) => {
  const members = db.prepare(`
    SELECT u.id, u.name, u.email, u.avatar_color, u.role FROM user_group_members ugm
    JOIN users u ON u.id = ugm.user_id
    WHERE ugm.group_id = ?
    ORDER BY u.name ASC
  `).all(req.params.id);
  res.json(members);
});

// Add user to group
router.post('/groups/:id/members', authenticate, requireSuperAdmin, (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  const existing = db.prepare('SELECT 1 FROM user_group_members WHERE group_id = ? AND user_id = ?')
    .get(req.params.id, user_id);
  if (existing) return res.status(409).json({ error: 'Already in group' });
  db.prepare('INSERT INTO user_group_members (group_id, user_id) VALUES (?, ?)').run(req.params.id, user_id);
  res.json({ success: true });
});

// Remove user from group
router.delete('/groups/:id/members/:userId', authenticate, requireSuperAdmin, (req, res) => {
  db.prepare('DELETE FROM user_group_members WHERE group_id = ? AND user_id = ?')
    .run(req.params.id, req.params.userId);
  res.json({ success: true });
});

// Set all groups for a user (replace)
router.put('/users/:id/groups', authenticate, requireSuperAdmin, (req, res) => {
  const { group_ids } = req.body; // array of group IDs
  if (!Array.isArray(group_ids)) return res.status(400).json({ error: 'group_ids array required' });
  db.prepare('DELETE FROM user_group_members WHERE user_id = ?').run(req.params.id);
  for (const gid of group_ids) {
    db.prepare('INSERT OR IGNORE INTO user_group_members (group_id, user_id) VALUES (?, ?)').run(gid, req.params.id);
  }
  const groups = db.prepare(`
    SELECT g.id, g.name, g.color FROM user_group_members ugm
    JOIN user_groups g ON g.id = ugm.group_id WHERE ugm.user_id = ?
  `).all(req.params.id);
  res.json(groups);
});

module.exports = router;
