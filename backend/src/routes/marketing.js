// ── Marketing · Integrations + Media Library + Unified Inbox ──────────────────
// A channel-agnostic marketing surface that lives under the app's "Marketing" tab.
//
//   • Integrations — connect/disconnect multiple accounts per platform
//     (instagram | linkedin | tiktok | facebook), with soft delete + restore.
//   • Media library — a per-account bank of the brand/creator's own images and
//     videos, tagged, to attach in replies.
//   • Unified inbox — DMs across every connected account in one place, with an
//     AI-*assisted* reply: the model DRAFTS a suggestion, a human approves and
//     sends. Accounts are disclosed as a brand/creator and contact opt-out is
//     enforced on send.
//
// Follows the same conventions as the other feature routes: self-contained
// table creation on load, `authenticate` middleware, uuid ids, JSON responses.
//
// NOTE on real delivery: actually pulling DMs from and sending to Instagram /
// LinkedIn / TikTok / Facebook requires each platform's own API credentials
// (or a provider the user connects). This module stores accounts + tokens and
// runs the inbox/draft/approve workflow; wiring a live channel adapter is a
// separate, credentialed step. Until then the inbox can be exercised by
// importing inbound DMs via POST /conversations/:id/inbound (or the seed route).

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { authenticate } = require('../middleware/auth');
const { emit } = require('../sse');
const aiRouter = require('./ai'); // exposes generateReplyForUser(userId, prompt, opts)

const router = express.Router();

// Reuse the shared uploads dir (served at /api/uploads by attachments route).
const UPLOADS_DIR = path.join(__dirname, '../../data/uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`),
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

const PLATFORMS = ['instagram', 'linkedin', 'tiktok', 'facebook'];

// ── Schema ────────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS mkt_accounts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    platform TEXT NOT NULL,              -- instagram | linkedin | tiktok | facebook
    handle TEXT NOT NULL,                -- @handle / profile slug
    display_name TEXT,
    external_id TEXT,                    -- platform-scoped account id (when known)
    disclosure_label TEXT DEFAULT 'Brand/creator account',
    access_token TEXT,                   -- stored server-side; never returned to the client
    token_expires_at DATETIME,
    status TEXT DEFAULT 'connected',     -- connected | disconnected | error
    avatar_url TEXT,
    meta TEXT DEFAULT '{}',
    deleted_at DATETIME,                 -- soft delete
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_mkt_accounts_user ON mkt_accounts(user_id, deleted_at);

  CREATE TABLE IF NOT EXISTS mkt_media (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    kind TEXT NOT NULL,                  -- image | video
    filename TEXT,                       -- stored file (served at /api/uploads/<filename>)
    url TEXT,                            -- or an external URL
    title TEXT,
    tags TEXT DEFAULT '[]',              -- JSON array of strings
    caption TEXT,
    deleted_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_mkt_media_account ON mkt_media(account_id, deleted_at);

  CREATE TABLE IF NOT EXISTS mkt_contacts (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    external_id TEXT,                    -- platform-scoped sender id
    name TEXT,
    handle TEXT,
    opted_out INTEGER DEFAULT 0,         -- 1 = do not message (enforced on send)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(account_id, external_id)
  );

  CREATE TABLE IF NOT EXISTS mkt_conversations (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    contact_id TEXT NOT NULL,
    status TEXT DEFAULT 'open',          -- open | closed
    last_message_at DATETIME,
    last_preview TEXT,
    unread_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(account_id, contact_id)
  );
  CREATE INDEX IF NOT EXISTS idx_mkt_conv_account ON mkt_conversations(account_id, last_message_at);

  CREATE TABLE IF NOT EXISTS mkt_messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    direction TEXT NOT NULL,             -- in | out
    text TEXT,
    media_id TEXT,                       -- optional attached media
    status TEXT DEFAULT 'sent',          -- draft | sent
    source TEXT,                         -- contact | ai | human
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_mkt_messages_conv ON mkt_messages(conversation_id, created_at);
`);

// ── Helpers ─────────────────────────────────────────────────────────────────
// Public shape of an account — deliberately omits access_token.
function publicAccount(a) {
  if (!a) return a;
  const { access_token, ...rest } = a;
  return { ...rest, has_token: !!access_token };
}
function getAccount(userId, id) {
  return db.prepare('SELECT * FROM mkt_accounts WHERE id = ? AND user_id = ?').get(id, userId);
}
// Confirm a conversation belongs to one of this user's accounts (authorization).
function getOwnedConversation(userId, convId) {
  return db.prepare(`
    SELECT c.*, a.user_id AS owner_id, a.platform, a.handle, a.display_name, a.disclosure_label
    FROM mkt_conversations c JOIN mkt_accounts a ON a.id = c.account_id
    WHERE c.id = ? AND a.user_id = ?
  `).get(convId, userId);
}
function touchConversation(convId, text, incoming) {
  const preview = (text || '').slice(0, 120);
  db.prepare(`UPDATE mkt_conversations
              SET last_message_at = CURRENT_TIMESTAMP, last_preview = ?,
                  unread_count = unread_count + ? WHERE id = ?`)
    .run(preview, incoming ? 1 : 0, convId);
}

// ═══════════════════════════════════════════════════════════════════════════
//  INTEGRATIONS — accounts
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/marketing/accounts  (optionally ?platform=&include_deleted=1)
router.get('/accounts', authenticate, (req, res) => {
  try {
    const { platform, include_deleted } = req.query;
    let sql = 'SELECT * FROM mkt_accounts WHERE user_id = ?';
    const params = [req.user.id];
    if (!include_deleted) sql += ' AND deleted_at IS NULL';
    if (platform) { sql += ' AND platform = ?'; params.push(platform); }
    sql += ' ORDER BY platform ASC, created_at DESC';
    const rows = db.prepare(sql).all(...params);
    res.json(rows.map(publicAccount));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/marketing/accounts  — connect / add an account
router.post('/accounts', authenticate, (req, res) => {
  try {
    const { platform, handle, display_name, disclosure_label, access_token, external_id, avatar_url } = req.body;
    if (!PLATFORMS.includes(platform)) {
      return res.status(400).json({ error: `platform must be one of ${PLATFORMS.join(', ')}` });
    }
    if (!handle || !handle.trim()) return res.status(400).json({ error: 'handle required' });
    const id = uuidv4();
    db.prepare(`INSERT INTO mkt_accounts
      (id, user_id, platform, handle, display_name, external_id, disclosure_label, access_token, avatar_url, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'connected')`)
      .run(id, req.user.id, platform, handle.trim(), display_name || null, external_id || null,
        disclosure_label || 'Brand/creator account', access_token || null, avatar_url || null);
    res.json(publicAccount(getAccount(req.user.id, id)));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/marketing/accounts/:id — edit display name / disclosure / token / status
router.patch('/accounts/:id', authenticate, (req, res) => {
  try {
    const acct = getAccount(req.user.id, req.params.id);
    if (!acct) return res.status(404).json({ error: 'Not found' });
    const { display_name, disclosure_label, handle, access_token, status, avatar_url } = req.body;
    if (status && !['connected', 'disconnected', 'error'].includes(status)) {
      return res.status(400).json({ error: 'invalid status' });
    }
    db.prepare(`UPDATE mkt_accounts SET
        display_name = COALESCE(?, display_name),
        disclosure_label = COALESCE(?, disclosure_label),
        handle = COALESCE(?, handle),
        access_token = COALESCE(?, access_token),
        avatar_url = COALESCE(?, avatar_url),
        status = COALESCE(?, status)
      WHERE id = ? AND user_id = ?`)
      .run(display_name ?? null, disclosure_label ?? null, handle ?? null,
        access_token ?? null, avatar_url ?? null, status ?? null, req.params.id, req.user.id);
    res.json(publicAccount(getAccount(req.user.id, req.params.id)));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/marketing/accounts/:id/disconnect — keep the record, drop the token
router.post('/accounts/:id/disconnect', authenticate, (req, res) => {
  try {
    const acct = getAccount(req.user.id, req.params.id);
    if (!acct) return res.status(404).json({ error: 'Not found' });
    db.prepare(`UPDATE mkt_accounts SET status = 'disconnected', access_token = NULL
                WHERE id = ? AND user_id = ?`).run(req.params.id, req.user.id);
    res.json(publicAccount(getAccount(req.user.id, req.params.id)));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/marketing/accounts/:id — soft delete
router.delete('/accounts/:id', authenticate, (req, res) => {
  try {
    const acct = getAccount(req.user.id, req.params.id);
    if (!acct) return res.status(404).json({ error: 'Not found' });
    db.prepare(`UPDATE mkt_accounts SET deleted_at = CURRENT_TIMESTAMP, access_token = NULL
                WHERE id = ? AND user_id = ?`).run(req.params.id, req.user.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/marketing/accounts/:id/restore — undo soft delete
router.post('/accounts/:id/restore', authenticate, (req, res) => {
  try {
    const acct = getAccount(req.user.id, req.params.id);
    if (!acct) return res.status(404).json({ error: 'Not found' });
    db.prepare(`UPDATE mkt_accounts SET deleted_at = NULL, status = 'disconnected'
                WHERE id = ? AND user_id = ?`).run(req.params.id, req.user.id);
    res.json(publicAccount(getAccount(req.user.id, req.params.id)));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
//  MEDIA LIBRARY — per-account image/video bank
// ═══════════════════════════════════════════════════════════════════════════

function publicMedia(m) {
  if (!m) return m;
  let tags = [];
  try { tags = JSON.parse(m.tags || '[]'); } catch {}
  const src = m.filename ? `/api/uploads/${m.filename}` : m.url;
  return { ...m, tags, src };
}

// GET /api/marketing/accounts/:id/media  (optional ?tag=&kind=)
router.get('/accounts/:id/media', authenticate, (req, res) => {
  try {
    const acct = getAccount(req.user.id, req.params.id);
    if (!acct) return res.status(404).json({ error: 'Account not found' });
    const rows = db.prepare(`SELECT * FROM mkt_media WHERE account_id = ? AND deleted_at IS NULL
                             ORDER BY created_at DESC`).all(req.params.id);
    let out = rows.map(publicMedia);
    if (req.query.kind) out = out.filter(m => m.kind === req.query.kind);
    if (req.query.tag) out = out.filter(m => m.tags.includes(req.query.tag));
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/marketing/accounts/:id/media — upload a file OR register an external URL
router.post('/accounts/:id/media', authenticate, upload.single('file'), (req, res) => {
  try {
    const acct = getAccount(req.user.id, req.params.id);
    if (!acct) return res.status(404).json({ error: 'Account not found' });
    const { title, caption, url } = req.body;
    let tags = req.body.tags;
    try { tags = typeof tags === 'string' ? JSON.parse(tags) : (tags || []); } catch { tags = []; }
    if (!Array.isArray(tags)) tags = [];

    let filename = null, kind = req.body.kind;
    if (req.file) {
      filename = req.file.filename;
      kind = (req.file.mimetype || '').startsWith('video') ? 'video' : 'image';
    } else if (!url) {
      return res.status(400).json({ error: 'Provide a file upload or a url' });
    }
    if (!['image', 'video'].includes(kind)) kind = 'image';

    const id = uuidv4();
    db.prepare(`INSERT INTO mkt_media (id, user_id, account_id, kind, filename, url, title, tags, caption)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, req.user.id, req.params.id, kind, filename, filename ? null : url,
        title || null, JSON.stringify(tags), caption || null);
    res.json(publicMedia(db.prepare('SELECT * FROM mkt_media WHERE id = ?').get(id)));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/marketing/media/:id — edit title / tags / caption
router.patch('/media/:id', authenticate, (req, res) => {
  try {
    const m = db.prepare(`SELECT * FROM mkt_media WHERE id = ? AND user_id = ?`).get(req.params.id, req.user.id);
    if (!m) return res.status(404).json({ error: 'Not found' });
    const { title, caption } = req.body;
    let tags = req.body.tags;
    if (tags !== undefined) {
      if (typeof tags === 'string') { try { tags = JSON.parse(tags); } catch { tags = []; } }
      if (!Array.isArray(tags)) tags = [];
    }
    db.prepare(`UPDATE mkt_media SET title = COALESCE(?, title), caption = COALESCE(?, caption),
                tags = COALESCE(?, tags) WHERE id = ? AND user_id = ?`)
      .run(title ?? null, caption ?? null, tags !== undefined ? JSON.stringify(tags) : null,
        req.params.id, req.user.id);
    res.json(publicMedia(db.prepare('SELECT * FROM mkt_media WHERE id = ?').get(req.params.id)));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/marketing/media/:id — soft delete
router.delete('/media/:id', authenticate, (req, res) => {
  try {
    const m = db.prepare(`SELECT * FROM mkt_media WHERE id = ? AND user_id = ?`).get(req.params.id, req.user.id);
    if (!m) return res.status(404).json({ error: 'Not found' });
    db.prepare('UPDATE mkt_media SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
//  UNIFIED INBOX
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/marketing/conversations  (optional ?account_id=&platform=)
router.get('/conversations', authenticate, (req, res) => {
  try {
    const { account_id, platform } = req.query;
    let sql = `
      SELECT c.*, a.platform, a.handle, a.display_name, a.avatar_url,
             ct.name AS contact_name, ct.handle AS contact_handle, ct.opted_out
      FROM mkt_conversations c
      JOIN mkt_accounts a ON a.id = c.account_id
      JOIN mkt_contacts ct ON ct.id = c.contact_id
      WHERE a.user_id = ? AND a.deleted_at IS NULL`;
    const params = [req.user.id];
    if (account_id) { sql += ' AND c.account_id = ?'; params.push(account_id); }
    if (platform) { sql += ' AND a.platform = ?'; params.push(platform); }
    sql += ' ORDER BY COALESCE(c.last_message_at, c.created_at) DESC';
    res.json(db.prepare(sql).all(...params));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/marketing/conversations/:id/messages
router.get('/conversations/:id/messages', authenticate, (req, res) => {
  try {
    const conv = getOwnedConversation(req.user.id, req.params.id);
    if (!conv) return res.status(404).json({ error: 'Not found' });
    db.prepare('UPDATE mkt_conversations SET unread_count = 0 WHERE id = ?').run(req.params.id);
    const messages = db.prepare(`
      SELECT m.*, md.filename AS media_filename, md.url AS media_url, md.kind AS media_kind, md.title AS media_title
      FROM mkt_messages m LEFT JOIN mkt_media md ON md.id = m.media_id
      WHERE m.conversation_id = ? ORDER BY m.created_at ASC`).all(req.params.id);
    res.json(messages.map(m => ({
      ...m,
      media_src: m.media_filename ? `/api/uploads/${m.media_filename}` : m.media_url,
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/marketing/conversations/:id/inbound — record an incoming DM.
// Used to import DMs (from a platform/provider sync) or to exercise the inbox.
router.post('/conversations/:id/inbound', authenticate, (req, res) => {
  try {
    const conv = getOwnedConversation(req.user.id, req.params.id);
    if (!conv) return res.status(404).json({ error: 'Not found' });
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'text required' });
    const id = uuidv4();
    db.prepare(`INSERT INTO mkt_messages (id, conversation_id, direction, text, status, source)
                VALUES (?, ?, 'in', ?, 'sent', 'contact')`).run(id, req.params.id, text.trim());
    touchConversation(req.params.id, text, true);
    const msg = db.prepare('SELECT * FROM mkt_messages WHERE id = ?').get(id);
    emit(req.user.id, 'mkt:message', { conversationId: req.params.id, message: msg });
    res.json(msg);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/marketing/conversations/:id/draft — AI drafts a SUGGESTED reply.
// Does not send. The draft is disclosed, on-brand, and never sent automatically.
router.post('/conversations/:id/draft', authenticate, async (req, res) => {
  try {
    const conv = getOwnedConversation(req.user.id, req.params.id);
    if (!conv) return res.status(404).json({ error: 'Not found' });

    const history = db.prepare(`SELECT direction, text FROM mkt_messages
      WHERE conversation_id = ? AND status = 'sent' ORDER BY created_at DESC LIMIT 12`).all(req.params.id);
    history.reverse();
    const transcript = history
      .map(m => `${m.direction === 'in' ? 'Customer' : 'Us'}: ${m.text || ''}`)
      .join('\n');

    const brandName = conv.display_name || conv.handle || 'our brand';
    const guidance = (req.body.guidance || '').toString().slice(0, 500);

    const prompt = [
      `You are a customer-care / community manager writing a short direct-message reply`,
      `on behalf of "${brandName}" (a ${conv.disclosure_label || 'brand/creator account'}) on ${conv.platform}.`,
      ``,
      `Write ONE helpful, friendly, honest reply to the latest customer message.`,
      `Rules:`,
      `- Be transparent that this is the brand/creator account. Never pretend to be a different real person.`,
      `- No deception, no pressure tactics, no fake urgency, no unsolicited links.`,
      `- Keep it concise and natural (1-3 sentences). Answer the question or move the conversation forward.`,
      `- If you don't know something, say a teammate will follow up rather than inventing facts.`,
      guidance ? `- Extra context from the operator: ${guidance}` : ``,
      ``,
      `Conversation so far:`,
      transcript || '(no messages yet)',
      ``,
      `Your suggested reply (text only):`,
    ].filter(Boolean).join('\n');

    let draft;
    try {
      draft = await aiRouter.generateReplyForUser(req.user.id, prompt, { max_tokens: 160 });
    } catch (e) {
      return res.status(400).json({ error: e.message || 'AI draft failed. Configure an AI provider in Settings.' });
    }
    res.json({ draft: (draft || '').trim() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/marketing/conversations/:id/send — human approves & sends a reply.
// Blocked when the contact has opted out. Records the message as sent.
router.post('/conversations/:id/send', authenticate, (req, res) => {
  try {
    const conv = getOwnedConversation(req.user.id, req.params.id);
    if (!conv) return res.status(404).json({ error: 'Not found' });
    const contact = db.prepare('SELECT * FROM mkt_contacts WHERE id = ?').get(conv.contact_id);
    if (contact && contact.opted_out) {
      return res.status(403).json({ error: 'This contact has opted out — sending is blocked.' });
    }
    const { text, media_id, source } = req.body;
    if ((!text || !text.trim()) && !media_id) {
      return res.status(400).json({ error: 'text or media_id required' });
    }
    if (media_id) {
      const m = db.prepare('SELECT id FROM mkt_media WHERE id = ? AND user_id = ? AND deleted_at IS NULL')
        .get(media_id, req.user.id);
      if (!m) return res.status(400).json({ error: 'media not found' });
    }
    const id = uuidv4();
    db.prepare(`INSERT INTO mkt_messages (id, conversation_id, direction, text, media_id, status, source)
                VALUES (?, ?, 'out', ?, ?, 'sent', ?)`)
      .run(id, req.params.id, text ? text.trim() : null, media_id || null, source === 'ai' ? 'ai' : 'human');
    touchConversation(req.params.id, text || '[media]', false);
    // NOTE: when a live platform adapter is connected, actual delivery happens here.
    const msg = db.prepare('SELECT * FROM mkt_messages WHERE id = ?').get(id);
    emit(req.user.id, 'mkt:message', { conversationId: req.params.id, message: msg });
    res.json(msg);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/marketing/conversations/:id/opt-out — toggle contact opt-out
router.post('/conversations/:id/opt-out', authenticate, (req, res) => {
  try {
    const conv = getOwnedConversation(req.user.id, req.params.id);
    if (!conv) return res.status(404).json({ error: 'Not found' });
    const opted = req.body.opted_out ? 1 : 0;
    db.prepare('UPDATE mkt_contacts SET opted_out = ? WHERE id = ?').run(opted, conv.contact_id);
    res.json({ success: true, opted_out: opted });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/marketing/conversations/:id/status — open | closed
router.post('/conversations/:id/status', authenticate, (req, res) => {
  try {
    const conv = getOwnedConversation(req.user.id, req.params.id);
    if (!conv) return res.status(404).json({ error: 'Not found' });
    const status = req.body.status === 'closed' ? 'closed' : 'open';
    db.prepare('UPDATE mkt_conversations SET status = ? WHERE id = ?').run(status, req.params.id);
    res.json({ success: true, status });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/marketing/accounts/:id/conversations — create a conversation + contact.
// For importing a DM thread (or manually starting one from an inbound message).
router.post('/accounts/:id/conversations', authenticate, (req, res) => {
  try {
    const acct = getAccount(req.user.id, req.params.id);
    if (!acct) return res.status(404).json({ error: 'Account not found' });
    const { contact_name, contact_handle, contact_external_id, first_message } = req.body;
    if (!contact_name && !contact_handle && !contact_external_id) {
      return res.status(400).json({ error: 'A contact name, handle, or id is required' });
    }
    const extId = contact_external_id || contact_handle || `c_${uuidv4().slice(0, 8)}`;
    let contact = db.prepare('SELECT * FROM mkt_contacts WHERE account_id = ? AND external_id = ?')
      .get(req.params.id, extId);
    if (!contact) {
      const cid = uuidv4();
      db.prepare(`INSERT INTO mkt_contacts (id, account_id, external_id, name, handle)
                  VALUES (?, ?, ?, ?, ?)`)
        .run(cid, req.params.id, extId, contact_name || contact_handle || 'Unknown', contact_handle || null);
      contact = db.prepare('SELECT * FROM mkt_contacts WHERE id = ?').get(cid);
    }
    let conv = db.prepare('SELECT * FROM mkt_conversations WHERE account_id = ? AND contact_id = ?')
      .get(req.params.id, contact.id);
    if (!conv) {
      const convId = uuidv4();
      db.prepare('INSERT INTO mkt_conversations (id, account_id, contact_id) VALUES (?, ?, ?)')
        .run(convId, req.params.id, contact.id);
      conv = db.prepare('SELECT * FROM mkt_conversations WHERE id = ?').get(convId);
    }
    if (first_message && first_message.trim()) {
      const mid = uuidv4();
      db.prepare(`INSERT INTO mkt_messages (id, conversation_id, direction, text, status, source)
                  VALUES (?, ?, 'in', ?, 'sent', 'contact')`).run(mid, conv.id, first_message.trim());
      touchConversation(conv.id, first_message, true);
    }
    res.json({ conversation: conv, contact });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
