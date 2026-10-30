const path = require('path');
// Use __dirname so dotenv always finds backend/.env regardless of cwd (Passenger quirk)
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');

const app = express();

// In production the Express server serves both API and the built React app,
// so CORS for the main frontend is only needed in local development (Vite dev server on a different port).
if (process.env.NODE_ENV !== 'production') {
  app.use(cors());
}

// CORS allowing chrome-extension://, linkedin.com and instagram.com origins,
// used by every endpoint the chrome extension calls.
const extensionCors = cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (origin.startsWith('chrome-extension://')) return cb(null, true);
    if (/^https?:\/\/([a-z0-9-]+\.)*linkedin\.com$/i.test(origin)) return cb(null, true);
    if (/^https?:\/\/([a-z0-9-]+\.)*instagram\.com$/i.test(origin)) return cb(null, true);
    if (process.env.NODE_ENV !== 'production') return cb(null, true);
    return cb(null, false);
  },
  credentials: false,
});
app.use('/api/auth',      extensionCors);
app.use('/api/instagram', extensionCors);
app.use('/api/linkedin',  extensionCors);
app.use('/api/contacts',  extensionCors);

app.use(express.json({ limit: '20mb' }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/workspaces', require('./routes/workspaces'));
app.use('/api/boards', require('./routes/boards'));
app.use('/api/boards/:boardId/members', require('./routes/boardMembers'));
app.use('/api/boards/:boardId/import', require('./routes/boardImport'));
app.use('/api/columns', require('./routes/columns'));
app.use('/api/groups', require('./routes/groups'));
app.use('/api/items', require('./routes/items'));
app.use('/api/updates', require('./routes/updates'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/push', require('./routes/push'));
app.use('/api/automations', require('./routes/automations'));
app.use('/api/templates', require('./routes/templates'));
app.use('/api/search', require('./routes/search'));

const attachmentsRouter = require('./routes/attachments');
app.use('/api/items/:itemId/attachments', attachmentsRouter);
app.use('/api/uploads', express.static(attachmentsRouter.UPLOADS_DIR));

app.use('/api/telegram', require('./routes/telegramApi'));
app.use('/api/calendar', require('./routes/calendar'));
app.use('/api/bibixbot', require('./routes/bibixbot'));
app.use('/api/events',      require('./routes/events'));
app.use('/api/scheduling',  require('./routes/scheduling'));
app.use('/api/crm',         require('./routes/crm'));
app.use('/api/invoices',    require('./routes/invoices'));
const instagramRouter = require('./routes/instagram');
app.use('/api/instagram',      instagramRouter);
app.use('/api/linkedin',       require('./routes/linkedin'));
app.use('/api/contacts',       require('./routes/contacts'));
app.use('/api/ai',             require('./routes/ai'));

// Start Telegram bot (only if TELEGRAM_BOT_TOKEN is set)
const tgBot = require('./bot/telegram');

// Webhook endpoint — only active in production (when TELEGRAM_WEBHOOK_URL is set)
if (tgBot.enabled && process.env.TELEGRAM_WEBHOOK_URL && process.env.TELEGRAM_BOT_TOKEN) {
  const whPath = `/api/tgwh/${process.env.TELEGRAM_BOT_TOKEN}`;
  app.post(whPath, (req, res) => {
    tgBot.bot.processUpdate(req.body);
    res.sendStatus(200);
  });
  console.log('[Telegram] Webhook endpoint active at', whPath);
}

const fetch = require('node-fetch');
const SETUP_SECRET = process.env.SETUP_SECRET || 'bibix-setup-2026';

app.get('/api/health', (req, res) => res.json({ status: 'ok', pid: process.pid, v: 5 }));

app.get('/api/ping', (req, res) => res.json({ ok: true, pid: process.pid }));

app.get('/api/wh-info', async (req, res) => {
  if (req.query.secret !== SETUP_SECRET) return res.status(403).json({ error: 'Forbidden' });
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL;
  if (!token) return res.json({ error: 'No token', webhookUrl, pid: process.pid });
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
    const data = await r.json();
    res.json({ pid: process.pid, webhookUrl, telegramInfo: data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Ensure push_sent column exists (reminders are now sent via cron/send-reminders.js)
const db = require('./db/database');
try { db.exec('ALTER TABLE bot_reminders ADD COLUMN push_sent INTEGER DEFAULT 0'); } catch (_) {}

// ── User Groups (inline to guarantee registration) ────────────────────────────
const { v4: uuidv4 } = require('uuid');
const { authenticate, requireSuperAdmin, requireAdmin } = require('./middleware/auth');
try { db.exec("CREATE TABLE IF NOT EXISTS user_groups (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT DEFAULT '#0073ea', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)"); } catch (_) {}
try { db.exec("CREATE TABLE IF NOT EXISTS user_group_members (group_id TEXT NOT NULL, user_id TEXT NOT NULL, PRIMARY KEY (group_id, user_id))"); } catch (_) {}
try { db.exec("ALTER TABLE user_groups ADD COLUMN color TEXT DEFAULT '#0073ea'"); } catch (_) {}
try { db.exec("ALTER TABLE user_groups ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP"); } catch (_) {}

app.get('/api/admin/groups', authenticate, requireAdmin, (req, res) => {
  try {
    const groups = db.prepare("SELECT g.id, g.name, g.color, g.created_at, COUNT(ugm.user_id) as member_count FROM user_groups g LEFT JOIN user_group_members ugm ON ugm.group_id = g.id GROUP BY g.id ORDER BY g.name ASC").all();
    res.json(groups);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/admin/groups', authenticate, requireSuperAdmin, (req, res) => {
  try {
    const { name, color } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
    const id = uuidv4();
    db.prepare("INSERT INTO user_groups (id, name, color) VALUES (?, ?, ?)").run(id, name.trim(), color || '#0073ea');
    res.json(db.prepare("SELECT * FROM user_groups WHERE id = ?").get(id));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/admin/groups/:id', authenticate, requireSuperAdmin, (req, res) => {
  try {
    const { name, color } = req.body;
    db.prepare("UPDATE user_groups SET name = COALESCE(?, name), color = COALESCE(?, color) WHERE id = ?").run(name?.trim() || null, color || null, req.params.id);
    res.json(db.prepare("SELECT * FROM user_groups WHERE id = ?").get(req.params.id));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/admin/groups/:id', authenticate, requireSuperAdmin, (req, res) => {
  try {
    db.prepare("DELETE FROM user_groups WHERE id = ?").run(req.params.id);
    db.prepare("DELETE FROM user_group_members WHERE group_id = ?").run(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/admin/users/:id/groups', authenticate, requireSuperAdmin, (req, res) => {
  try {
    const { group_ids } = req.body;
    if (!Array.isArray(group_ids)) return res.status(400).json({ error: 'group_ids array required' });
    db.prepare("DELETE FROM user_group_members WHERE user_id = ?").run(req.params.id);
    for (const gid of group_ids) {
      try { db.prepare("INSERT INTO user_group_members (group_id, user_id) VALUES (?, ?)").run(gid, req.params.id); } catch (_) {}
    }
    const groups = db.prepare("SELECT g.id, g.name, g.color FROM user_group_members ugm JOIN user_groups g ON g.id = ugm.group_id WHERE ugm.user_id = ?").all(req.params.id);
    res.json(groups);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Global JSON error handler — catches any unhandled route errors ────────────
app.use((err, req, res, _next) => {
  console.error('[Unhandled error]', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ── Serve PWA mobile app ──────────────────────────────────────────────────────
const PWA_DIR = path.join(__dirname, '../../pwa');
app.use('/app', express.static(PWA_DIR));
app.get('/app', (req, res) => res.redirect('/app/'));

// ── Serve built React frontend in production ──────────────────────────────────
const FRONTEND_DIST = path.join(__dirname, '../public');
app.use(express.static(FRONTEND_DIST));
// SPA fallback — any non-API route returns index.html so React Router works
app.get('*', (req, res) => {
  res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Backend running on http://localhost:${PORT}`));
