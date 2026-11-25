// ─────────────────────────────────────────────────────────────────────────────
// Chats — persistence in the existing SQLite database (tables prefixed chat_).
// Everything is keyed by account + remote JID so a second platform (Telegram)
// only needs a different `platform` on the account row.
// ─────────────────────────────────────────────────────────────────────────────
const db = require('../db/database');
const { v4: uuidv4 } = require('uuid');

db.exec(`
  CREATE TABLE IF NOT EXISTS chat_accounts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    platform TEXT NOT NULL DEFAULT 'whatsapp',
    label TEXT,
    phone TEXT,
    display_name TEXT,
    status TEXT NOT NULL DEFAULT 'unlinked',
    status_reason TEXT,
    linked_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_chat_accounts_user ON chat_accounts(user_id);

  CREATE TABLE IF NOT EXISTS chat_contacts (
    account_id TEXT NOT NULL,
    jid TEXT NOT NULL,
    name TEXT,
    notify TEXT,
    lid TEXT,
    PRIMARY KEY (account_id, jid)
  );

  CREATE TABLE IF NOT EXISTS chat_chats (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    jid TEXT NOT NULL,
    name TEXT,
    is_group INTEGER NOT NULL DEFAULT 0,
    unread_count INTEGER NOT NULL DEFAULT 0,
    last_message_at INTEGER,
    last_message_text TEXT,
    last_message_from_me INTEGER DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    pinned INTEGER NOT NULL DEFAULT 0,
    muted INTEGER NOT NULL DEFAULT 0,
    send_language TEXT,
    send_language_detected INTEGER NOT NULL DEFAULT 0,
    auto_incoming INTEGER,
    lang_updated_at INTEGER,
    picture_url TEXT,
    UNIQUE (account_id, jid)
  );
  CREATE INDEX IF NOT EXISTS idx_chat_chats_account ON chat_chats(account_id, last_message_at);

  CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    chat_jid TEXT NOT NULL,
    msg_id TEXT NOT NULL,
    from_me INTEGER NOT NULL DEFAULT 0,
    sender_jid TEXT,
    sender_name TEXT,
    kind TEXT NOT NULL DEFAULT 'text',
    text TEXT,
    status INTEGER NOT NULL DEFAULT 0,
    timestamp INTEGER NOT NULL,
    quoted_id TEXT,
    quoted_text TEXT,
    original_text TEXT,
    translation TEXT,
    translation_lang TEXT,
    translation_target TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (account_id, msg_id)
  );
  CREATE INDEX IF NOT EXISTS idx_chat_messages_chat ON chat_messages(account_id, chat_jid, timestamp);

  CREATE TABLE IF NOT EXISTS chat_user_settings (
    user_id TEXT PRIMARY KEY,
    data TEXT NOT NULL DEFAULT '{}',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS chat_stickers (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_chat_stickers_user ON chat_stickers(user_id);

  CREATE TABLE IF NOT EXISTS chat_quick_answers (
    user_id TEXT PRIMARY KEY,
    data TEXT NOT NULL DEFAULT '[]',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Columns added after the first release (CREATE TABLE IF NOT EXISTS does not add them to existing DBs).
function addColumn(table, col, def) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}
addColumn('chat_messages', 'forwarded', 'INTEGER NOT NULL DEFAULT 0');
addColumn('chat_messages', 'media', 'TEXT');

const now = () => Date.now();

// One WhatsApp user, one jid: strip the device part of "<number>:<device>@s.whatsapp.net" (Baileys' LID→PN
// lookups return that form) so messages and chat-list updates for the same person share one chat row.
function canonJid(jid) {
  if (typeof jid !== 'string') return jid;
  const m = /^([^:@]+)(?::\d+)?@(s\.whatsapp\.net|lid|hosted)$/.exec(jid);
  return m ? `${m[1]}@${m[2]}` : jid;
}

// Duplicate chats: merge a "<x>@lid" or "<n>:<dev>@s.whatsapp.net" chat into its phone-number chat (when known)
// or drop it when it holds nothing. Runs at boot and whenever a lid→pn mapping arrives.
function mergeLidChat(accountId, lid, pn) {
  const dup = db.prepare('SELECT id FROM chat_chats WHERE account_id = ? AND jid = ?').get(accountId, lid);
  if (!dup) return false;
  if (pn && pn !== lid) {
    const d0 = db.prepare('SELECT name, archived, pinned, muted, send_language, auto_incoming FROM chat_chats WHERE account_id = ? AND jid = ?').get(accountId, lid);
    const had = !!db.prepare('SELECT id FROM chat_chats WHERE account_id = ? AND jid = ?').get(accountId, pn);
    ensureChat(accountId, pn, 0);
    db.prepare('UPDATE OR IGNORE chat_messages SET chat_jid = ? WHERE account_id = ? AND chat_jid = ?').run(pn, accountId, lid);
    db.prepare('DELETE FROM chat_messages WHERE account_id = ? AND chat_jid = ?').run(accountId, lid);
    const d = db.prepare('SELECT unread_count FROM chat_chats WHERE account_id = ? AND jid = ?').get(accountId, lid);
    if (d?.unread_count) db.prepare('UPDATE chat_chats SET unread_count = unread_count + ? WHERE account_id = ? AND jid = ?').run(d.unread_count, accountId, pn);
    if (!had && d0) db.prepare('UPDATE chat_chats SET name = COALESCE(name, ?), archived = ?, pinned = ?, muted = ?, send_language = COALESCE(send_language, ?), auto_incoming = COALESCE(auto_incoming, ?) WHERE account_id = ? AND jid = ?')
      .run(d0.name, d0.archived || 0, d0.pinned || 0, d0.muted || 0, d0.send_language, d0.auto_incoming, accountId, pn);
    db.prepare('DELETE FROM chat_chats WHERE account_id = ? AND jid = ?').run(accountId, lid);
    // the merged chat's preview
    const last = db.prepare('SELECT kind, text, from_me, timestamp FROM chat_messages WHERE account_id = ? AND chat_jid = ? ORDER BY timestamp DESC LIMIT 1').get(accountId, pn);
    if (last) db.prepare('UPDATE chat_chats SET last_message_at = ?, last_message_text = ?, last_message_from_me = ? WHERE account_id = ? AND jid = ?').run(last.timestamp, previewText({ kind: last.kind, text: last.text }), last.from_me, accountId, pn);
    return true;
  }
  const n = db.prepare('SELECT COUNT(*) AS n FROM chat_messages WHERE account_id = ? AND chat_jid = ?').get(accountId, lid).n;
  if (!n) { db.prepare('DELETE FROM chat_chats WHERE account_id = ? AND jid = ?').run(accountId, lid); return true; }
  return false;
}
function cleanupLidChats() {
  let fixed = 0;
  // "<n>:<dev>@s.whatsapp.net" → "<n>@s.whatsapp.net" (also re-key messages that sit under a device-qualified jid)
  for (const r of db.prepare(`SELECT DISTINCT account_id, chat_jid AS jid FROM chat_messages WHERE chat_jid LIKE '%:%@%' UNION SELECT account_id, jid FROM chat_chats WHERE jid LIKE '%:%@%'`).all()) {
    const to = canonJid(r.jid); if (to === r.jid) continue;
    ensureChat(r.account_id, r.jid, 0);
    if (mergeLidChat(r.account_id, r.jid, to)) fixed++;
  }
  for (const r of db.prepare(`SELECT account_id, jid FROM chat_chats WHERE jid LIKE '%@lid'`).all()) {
    const c = db.prepare('SELECT jid FROM chat_contacts WHERE account_id = ? AND lid = ?').get(r.account_id, r.jid);
    if (mergeLidChat(r.account_id, r.jid, c?.jid || null)) fixed++;
  }
  if (fixed) console.log(`[chats] merged/removed ${fixed} duplicate chat(s)`);
}
try { cleanupLidChats(); } catch (e) { console.warn('[chats] lid cleanup failed:', e.message); }

// ── accounts ─────────────────────────────────────────────────────────────────
function listAccounts(userId) {
  return db.prepare('SELECT * FROM chat_accounts WHERE user_id = ? ORDER BY created_at').all(userId);
}
function getAccount(id) { return db.prepare('SELECT * FROM chat_accounts WHERE id = ?').get(id); }
function getUserAccount(userId, id) { return db.prepare('SELECT * FROM chat_accounts WHERE id = ? AND user_id = ?').get(id, userId); }
function createAccount(userId, { platform = 'whatsapp', label } = {}) {
  const id = uuidv4();
  db.prepare('INSERT INTO chat_accounts (id, user_id, platform, label, status) VALUES (?, ?, ?, ?, ?)').run(id, userId, platform, label || null, 'unlinked');
  return getAccount(id);
}
function updateAccount(id, patch) {
  const cols = [], vals = [];
  for (const [k, v] of Object.entries(patch)) { if (['label', 'phone', 'display_name', 'status', 'status_reason', 'linked_at'].includes(k)) { cols.push(`${k} = ?`); vals.push(v); } }
  if (!cols.length) return getAccount(id);
  cols.push('updated_at = CURRENT_TIMESTAMP');
  db.prepare(`UPDATE chat_accounts SET ${cols.join(', ')} WHERE id = ?`).run(...vals, id);
  return getAccount(id);
}
function deleteAccount(id) {
  db.prepare('DELETE FROM chat_messages WHERE account_id = ?').run(id);
  db.prepare('DELETE FROM chat_chats WHERE account_id = ?').run(id);
  db.prepare('DELETE FROM chat_contacts WHERE account_id = ?').run(id);
  db.prepare('DELETE FROM chat_accounts WHERE id = ?').run(id);
}

// ── contacts ─────────────────────────────────────────────────────────────────
function upsertContacts(accountId, contacts) {
  const stmt = db.prepare(`INSERT INTO chat_contacts (account_id, jid, name, notify, lid) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(account_id, jid) DO UPDATE SET name = COALESCE(excluded.name, name), notify = COALESCE(excluded.notify, notify), lid = COALESCE(excluded.lid, lid)`);
  for (const c of contacts) { if (c?.jid) stmt.run(accountId, c.jid, c.name || null, c.notify || null, c.lid || null); }
}

// ── chats ────────────────────────────────────────────────────────────────────
const CHAT_SELECT = `
  SELECT c.*, ct.name AS contact_name, ct.notify AS contact_notify
  FROM chat_chats c LEFT JOIN chat_contacts ct ON ct.account_id = c.account_id AND ct.jid = c.jid`;

function shapeChat(r) {
  if (!r) return null;
  const phone = /^(\d+)@s\.whatsapp\.net$/.exec(r.jid)?.[1] || null;
  return {
    id: r.id, account_id: r.account_id, jid: r.jid, is_group: !!r.is_group,
    name: (r.name && !/[•·]{2,}/.test(r.name) ? r.name : null) || r.contact_name || r.contact_notify || (phone ? '+' + phone : r.jid.replace(/@.*/, '')),
    phone, unread_count: r.unread_count || 0, last_message_at: r.last_message_at, last_message_text: r.last_message_text, last_message_from_me: !!r.last_message_from_me,
    archived: !!r.archived, pinned: !!r.pinned, muted: !!r.muted,
    send_language: r.send_language || null, send_language_detected: !!r.send_language_detected, auto_incoming: r.auto_incoming == null ? null : !!r.auto_incoming,
    picture_url: r.picture_url || null,
  };
}
function listChats(accountId, { archived = 0, limit = 500 } = {}) {
  if (archived === 'all') return db.prepare(`${CHAT_SELECT} WHERE c.account_id = ? ORDER BY c.archived ASC, c.pinned DESC, COALESCE(c.last_message_at, 0) DESC LIMIT ?`).all(accountId, limit).map(shapeChat);
  return db.prepare(`${CHAT_SELECT} WHERE c.account_id = ? AND c.archived = ? ORDER BY c.pinned DESC, COALESCE(c.last_message_at, 0) DESC LIMIT ?`).all(accountId, archived ? 1 : 0, limit).map(shapeChat);
}
function getChat(accountId, jid) { jid = canonJid(jid); return shapeChat(db.prepare(`${CHAT_SELECT} WHERE c.account_id = ? AND c.jid = ?`).get(accountId, jid)); }
function ensureChat(accountId, jid, isGroup) {
  jid = canonJid(jid);
  const row = db.prepare('SELECT id FROM chat_chats WHERE account_id = ? AND jid = ?').get(accountId, jid);
  if (row) return row.id;
  const id = uuidv4();
  db.prepare('INSERT INTO chat_chats (id, account_id, jid, is_group) VALUES (?, ?, ?, ?)').run(id, accountId, jid, isGroup ? 1 : 0);
  return id;
}
function upsertChats(accountId, chats) {
  for (const c of chats) {
    if (!c?.jid) continue;
    c.jid = canonJid(c.jid);
    ensureChat(accountId, c.jid, c.isGroup);
    const cols = [], vals = [];
    if (c.name) { cols.push('name = ?'); vals.push(c.name); }
    if (c.unreadCount != null) { cols.push('unread_count = ?'); vals.push(Math.max(0, c.unreadCount)); }
    if (c.lastMessageAt) { cols.push('last_message_at = MAX(COALESCE(last_message_at,0), ?)'); vals.push(c.lastMessageAt); }
    if (c.archived != null) { cols.push('archived = ?'); vals.push(c.archived ? 1 : 0); }
    if (c.pinned != null) { cols.push('pinned = ?'); vals.push(c.pinned ? 1 : 0); }
    if (c.muted != null) { cols.push('muted = ?'); vals.push(c.muted ? 1 : 0); }
    if (c.isGroup != null) { cols.push('is_group = ?'); vals.push(c.isGroup ? 1 : 0); }
    if (cols.length) db.prepare(`UPDATE chat_chats SET ${cols.join(', ')} WHERE account_id = ? AND jid = ?`).run(...vals, accountId, c.jid);
  }
}
function updateChatPrefs(accountId, jid, patch) {
  const cols = [], vals = [];
  if ('send_language' in patch) { cols.push('send_language = ?', 'send_language_detected = ?', 'lang_updated_at = ?'); vals.push(patch.send_language || null, patch.send_language_detected ? 1 : 0, now()); }
  if ('auto_incoming' in patch) { cols.push('auto_incoming = ?'); vals.push(patch.auto_incoming == null ? null : (patch.auto_incoming ? 1 : 0)); }
  if ('picture_url' in patch) { cols.push('picture_url = ?'); vals.push(patch.picture_url || null); }
  if (!cols.length) return getChat(accountId, jid);
  db.prepare(`UPDATE chat_chats SET ${cols.join(', ')} WHERE account_id = ? AND jid = ?`).run(...vals, accountId, jid);
  return getChat(accountId, jid);
}
function recentLanguages(userId, limit = 8) {
  return db.prepare(`SELECT DISTINCT c.send_language AS l FROM chat_chats c JOIN chat_accounts a ON a.id = c.account_id
    WHERE a.user_id = ? AND c.send_language IS NOT NULL ORDER BY c.lang_updated_at DESC LIMIT ?`).all(userId, limit).map(r => r.l);
}
function setUnread(accountId, jid, n) { jid = canonJid(jid); db.prepare('UPDATE chat_chats SET unread_count = ? WHERE account_id = ? AND jid = ?').run(n, accountId, jid); }
function totalUnread(userId) {
  return db.prepare(`SELECT COALESCE(SUM(c.unread_count),0) AS n FROM chat_chats c JOIN chat_accounts a ON a.id = c.account_id WHERE a.user_id = ? AND c.archived = 0 AND c.muted = 0`).get(userId).n;
}

// ── messages ─────────────────────────────────────────────────────────────────
function shapeMessage(r) {
  if (!r) return null;
  return {
    id: r.id, account_id: r.account_id, chat_jid: r.chat_jid, msg_id: r.msg_id, from_me: !!r.from_me,
    sender_jid: r.sender_jid, sender_name: r.sender_name, kind: r.kind, text: r.text || '', status: r.status, timestamp: r.timestamp,
    quoted: r.quoted_id || r.quoted_text ? { id: r.quoted_id, text: r.quoted_text } : null,
    original_text: r.original_text || null, forwarded: !!r.forwarded, media: parseMedia(r.media),
    translation: r.translation || null, translation_lang: r.translation_lang || null, translation_target: r.translation_target || null,
  };
}
function parseMedia(s) { if (!s) return null; try { const m = JSON.parse(s); return m && { type: m.type, mimetype: m.mimetype, fileName: m.fileName, fileLength: m.fileLength, width: m.width, height: m.height, seconds: m.seconds, thumb: m.thumb || null, local: !!m.local }; } catch (_) { return null; } }
function mediaRaw(id) { const r = db.prepare('SELECT media FROM chat_messages WHERE id = ?').get(id); try { return r?.media ? JSON.parse(r.media) : null; } catch (_) { return null; } }
function setMediaLocal(id, local) { const m = mediaRaw(id) || {}; m.local = local; db.prepare('UPDATE chat_messages SET media = ? WHERE id = ?').run(JSON.stringify(m), id); }
// Insert or merge. Returns { row, inserted }.
function upsertMessage(accountId, m) {
  if (!m?.id || !m.chatJid) return { row: null, inserted: false };
  m.chatJid = canonJid(m.chatJid); if (m.senderJid) m.senderJid = canonJid(m.senderJid);
  const existing = db.prepare('SELECT * FROM chat_messages WHERE account_id = ? AND msg_id = ?').get(accountId, m.id);
  if (existing) {
    const cols = [], vals = [];
    if (m.status != null && m.status > (existing.status || 0)) { cols.push('status = ?'); vals.push(m.status); }
    if (m.text && m.text !== existing.text) { cols.push('text = ?'); vals.push(m.text); if (m.text !== existing.text && existing.translation) { cols.push('translation = NULL'); } }
    if (m.senderName && !existing.sender_name) { cols.push('sender_name = ?'); vals.push(m.senderName); }
    if (m.originalText && !existing.original_text) { cols.push('original_text = ?'); vals.push(m.originalText); }
    if (m.media && !existing.media) { cols.push('media = ?'); vals.push(JSON.stringify(m.media)); }
    if (cols.length) db.prepare(`UPDATE chat_messages SET ${cols.join(', ')} WHERE id = ?`).run(...vals, existing.id);
    return { row: shapeMessage(db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(existing.id)), inserted: false };
  }
  const id = uuidv4();
  ensureChat(accountId, m.chatJid, m.isGroup);
  db.prepare(`INSERT INTO chat_messages (id, account_id, chat_jid, msg_id, from_me, sender_jid, sender_name, kind, text, status, timestamp, quoted_id, quoted_text, original_text, forwarded, media)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, accountId, m.chatJid, m.id, m.fromMe ? 1 : 0, m.senderJid || null, m.senderName || null, m.kind || 'text', m.text || '', m.status || 0, m.timestamp || now(),
    m.quoted?.id || null, m.quoted?.text || null, m.originalText || null, m.forwarded ? 1 : 0, m.media ? JSON.stringify(m.media) : null);
  // keep the chat's preview current
  db.prepare(`UPDATE chat_chats SET last_message_at = ?, last_message_text = ?, last_message_from_me = ?
    WHERE account_id = ? AND jid = ? AND COALESCE(last_message_at, 0) <= ?`).run(m.timestamp || now(), previewText(m), m.fromMe ? 1 : 0, accountId, m.chatJid, m.timestamp || now());
  return { row: shapeMessage(db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(id)), inserted: true };
}
function previewText(m) {
  if (m.text) return m.text.slice(0, 200);
  const icons = { image: '📷 Photo', video: '🎥 Video', audio: '🎤 Voice message', sticker: '🩵 Sticker', document: '📄 Document', contact: '👤 Contact', location: '📍 Location', poll: '📊 Poll', call: '📞 Call' };
  return icons[m.kind] || '';
}
function updateMessage(accountId, msgId, patch) {
  const cols = [], vals = [];
  if (patch.status != null) { cols.push('status = MAX(status, ?)'); vals.push(patch.status); }
  if (patch.text) { cols.push('text = ?'); vals.push(patch.text); }
  if (!cols.length) return null;
  db.prepare(`UPDATE chat_messages SET ${cols.join(', ')} WHERE account_id = ? AND msg_id = ?`).run(...vals, accountId, msgId);
  return shapeMessage(db.prepare('SELECT * FROM chat_messages WHERE account_id = ? AND msg_id = ?').get(accountId, msgId));
}
function setTranslation(id, { translation, lang, target }) {
  db.prepare('UPDATE chat_messages SET translation = ?, translation_lang = ?, translation_target = ? WHERE id = ?').run(translation, lang || null, target || null, id);
  return getMessage(id);
}
function getMessage(id) { return shapeMessage(db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(id)); }
function getMessageByMsgId(accountId, msgId) { return shapeMessage(db.prepare('SELECT * FROM chat_messages WHERE account_id = ? AND msg_id = ?').get(accountId, msgId)); }
// Paged, newest first; `before` = timestamp cursor.
function listMessages(accountId, jid, { before, limit = 50 } = {}) {
  const rows = before
    ? db.prepare('SELECT * FROM chat_messages WHERE account_id = ? AND chat_jid = ? AND timestamp < ? ORDER BY timestamp DESC, created_at DESC LIMIT ?').all(accountId, jid, before, limit)
    : db.prepare('SELECT * FROM chat_messages WHERE account_id = ? AND chat_jid = ? ORDER BY timestamp DESC, created_at DESC LIMIT ?').all(accountId, jid, limit);
  return rows.map(shapeMessage).reverse();
}
function untranslatedIncoming(accountId, jid, target, limit = 15) {
  return db.prepare(`SELECT * FROM chat_messages WHERE account_id = ? AND chat_jid = ? AND from_me = 0 AND text != '' AND (translation IS NULL OR translation_target IS NOT ?)
    ORDER BY timestamp DESC LIMIT ?`).all(accountId, jid, target, limit).map(shapeMessage);
}
// Telegram read receipts come as "everything up to message N was read" per chat (msg_id = "<jid>:<n>").
function markOutgoingRead(accountId, jid, maxSeq) {
  const rows = db.prepare(`SELECT id, msg_id FROM chat_messages WHERE account_id = ? AND chat_jid = ? AND from_me = 1 AND status < 4 ORDER BY timestamp DESC LIMIT 200`).all(accountId, jid)
    .filter(r => Number(String(r.msg_id).split(':').pop()) <= maxSeq);
  const upd = db.prepare('UPDATE chat_messages SET status = 4 WHERE id = ?');
  for (const r of rows) upd.run(r.id);
  return rows.map(r => getMessage(r.id));
}
function unreadIncomingIds(accountId, jid) {
  return db.prepare(`SELECT msg_id, sender_jid FROM chat_messages WHERE account_id = ? AND chat_jid = ? AND from_me = 0 ORDER BY timestamp DESC LIMIT 50`).all(accountId, jid);
}

// ── settings / quick answers ─────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  myLanguage: 'English', targetLanguage: 'Spanish', autoIncoming: true, initialIncoming: 15,
  showOriginalOutgoing: true, enterTranslates: true, style: '', provider: null, model: null, notifications: true,
  // which chats may push a notification when no Chats tab is open
  notifyGroups: true, notifyArchived: false, notifyMuted: false,
  // speech-to-text provider for call captions (groq | openai | null = whichever has a key)
  sttProvider: null,
  // Telegram API credentials (https://my.telegram.org) — env TELEGRAM_API_ID/HASH is the fallback
  telegramApiId: null, telegramApiHash: null,
};
function getSettings(userId) {
  const r = db.prepare('SELECT data FROM chat_user_settings WHERE user_id = ?').get(userId);
  let d = {}; try { d = r ? JSON.parse(r.data) : {}; } catch (_) {}
  return { ...DEFAULT_SETTINGS, ...d };
}
function setSettings(userId, patch) {
  const next = { ...getSettings(userId), ...patch };
  db.prepare('INSERT INTO chat_user_settings (user_id, data, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = CURRENT_TIMESTAMP').run(userId, JSON.stringify(next));
  return next;
}
const QA_SEED = [{
  id: 'g1', name: 'General', items: [
    { id: 'a1', title: 'Thanks', text: 'Thank you! I will get back to you shortly.' },
    { id: 'a2', title: 'Busy now', text: 'I am in a meeting right now, can I call you back in a bit?' },
    { id: 'a3', title: 'Send details', text: 'Sure. Could you send me the details so I can check and confirm?' },
  ],
}];
function getQuickAnswers(userId) {
  const r = db.prepare('SELECT data FROM chat_quick_answers WHERE user_id = ?').get(userId);
  if (!r) return QA_SEED;
  try { const d = JSON.parse(r.data); return Array.isArray(d) ? d : QA_SEED; } catch (_) { return QA_SEED; }
}
function setQuickAnswers(userId, groups) {
  db.prepare('INSERT INTO chat_quick_answers (user_id, data, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = CURRENT_TIMESTAMP').run(userId, JSON.stringify(groups));
  return groups;
}

// ── stickers (the user's own "emojis": 512×512 webp images sent as stickers) ──
function listStickers(userId) { return db.prepare('SELECT id, name, created_at FROM chat_stickers WHERE user_id = ? ORDER BY created_at DESC').all(userId); }
function addSticker(userId, name) { const id = uuidv4(); db.prepare('INSERT INTO chat_stickers (id, user_id, name) VALUES (?, ?, ?)').run(id, userId, name || null); return { id, name: name || null }; }
function getSticker(userId, id) { return db.prepare('SELECT id, name FROM chat_stickers WHERE id = ? AND user_id = ?').get(id, userId); }
function deleteSticker(userId, id) { return db.prepare('DELETE FROM chat_stickers WHERE id = ? AND user_id = ?').run(id, userId); }

function transaction(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { try { db.exec('ROLLBACK'); } catch (_) {} throw e; }
}

module.exports = {
  listAccounts, getAccount, getUserAccount, createAccount, updateAccount, deleteAccount,
  upsertContacts, listChats, getChat, ensureChat, upsertChats, updateChatPrefs, recentLanguages, setUnread, totalUnread,
  upsertMessage, updateMessage, setTranslation, getMessage, getMessageByMsgId, listMessages, untranslatedIncoming, unreadIncomingIds, markOutgoingRead, mediaRaw, setMediaLocal,
  getSettings, setSettings, getQuickAnswers, setQuickAnswers, DEFAULT_SETTINGS, transaction,
  listStickers, addSticker, getSticker, deleteSticker, mergeLidChat, cleanupLidChats, canonJid,
};
