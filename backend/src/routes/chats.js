// ─────────────────────────────────────────────────────────────────────────────
// Chats module — REST API for the /chats/ PWA.
//
//   Accounts   GET    /api/chats/accounts                      list my accounts (+ live status)
//              POST   /api/chats/accounts                      create { platform: whatsapp|telegram, label }
//              PUT    /api/chats/accounts/:id                  rename { label }
//              POST   /api/chats/accounts/:id/link             start linking → status
//                        WhatsApp: { pairingPhone? }           (+qr / pairingCode)
//                        Telegram: { phone } → status 'code' → { code } → ('password' → { password }) → open
//              GET    /api/chats/accounts/:id/status           live status (qr data-URL while linking)
//              POST   /api/chats/accounts/:id/stop             disconnect, keep session
//              POST   /api/chats/accounts/:id/logout           unlink (logs the device out on the platform) + delete
//              DELETE /api/chats/accounts/:id                  remove from Bibix only (keeps the device linked)
//   Chats      GET    /api/chats/accounts/:id/chats?archived=0|1|all
//              POST   /api/chats/accounts/:id/chats/new { phone | username }   start a chat with a number not in the list
//              GET    /api/chats/accounts/:id/chats/:jid/messages?before=&limit=
//              POST   /api/chats/accounts/:id/chats/:jid/send  { text, original?, quoted? (message uuid → reply) }
//              POST   /api/chats/messages/:id/forward          { to: [jid, …] }
//              POST   /api/chats/accounts/:id/chats/:jid/read
//              PUT    /api/chats/accounts/:id/chats/:jid/prefs { send_language, send_language_detected, auto_incoming }
//              POST   /api/chats/accounts/:id/chats/:jid/translate-recent { limit }
//              POST   /api/chats/accounts/:id/chats/:jid/load-older { count }   (ask the phone for history)
//   AI         POST   /api/chats/translate { text, from, to, detect }
//              POST   /api/chats/messages/:id/translate
//              POST   /api/chats/transcribe { audio (base64), mime, language? }   speech → text for call captions
//              GET    /api/chats/meta                           languages, provider in use, recent languages
//   Settings   GET/PUT /api/chats/settings                      per-user (my language, defaults, style, provider)
//              GET/PUT /api/chats/quick-answers
//   Internal   POST   /api/chats/internal/events               worker → app (x-chats-secret)
//
// Live updates go out over the existing SSE stream (/api/events?token=):
//   chat:status, chat:chats, chat:message, chat:message-update, chat:translated, chat:history, chat:call
// ─────────────────────────────────────────────────────────────────────────────
const express = require('express');
const db = require('../db/database');
const { authenticate } = require('../middleware/auth');
const sse = require('../sse');
const store = require('../chats/store');
const { createClient, SECRET, WORKER_URL } = require('../chats/client');
const tr = require('../chats/translate');
const { sendPushToUser } = require('../services/pushNotifications');

const router = express.Router();
const wrap = (fn) => async (req, res) => {
  try { const out = await fn(req, res); if (out !== undefined && !res.headersSent) res.json(out); }
  catch (e) { console.warn('[chats]', e.message); if (!res.headersSent) res.status(e.status || 500).json({ error: e.message }); }
};

// ── Event handling (both modes end up here) ──────────────────────────────────
function handleEvent(ev) {
  const { accountId, type, payload } = ev;
  const acc = store.getAccount(accountId);
  if (!acc) return; // account was deleted; ignore late events
  const userId = acc.user_id;
  try {
    if (type === 'status') {
      const patch = { status: payload.status, status_reason: payload.reason || null };
      if (payload.phone) patch.phone = payload.phone;
      if (payload.name) patch.display_name = payload.name;
      if (payload.status === 'open' && (!acc.linked_at || payload.isNewLogin)) patch.linked_at = new Date().toISOString();
      store.updateAccount(accountId, patch);
      sse.emit(userId, 'chat:status', { account_id: accountId, platform: acc.platform, status: payload.status, qr: payload.qr || null, pairingCode: payload.pairingCode || null, hint: payload.hint || null, phone: payload.phone || null, name: payload.name || null, reason: payload.reason || null });
      return;
    }
    if (type === 'history') {
      let inserted = 0;
      store.transaction(() => {
        store.upsertContacts(accountId, payload.contacts || []);
        store.upsertChats(accountId, payload.chats || []);
        for (const m of payload.messages || []) { if (store.upsertMessage(accountId, m).inserted) inserted++; }
      });
      sse.emit(userId, 'chat:history', { account_id: accountId, chats: (payload.chats || []).length, messages: inserted, isLatest: !!payload.isLatest, progress: payload.progress, syncType: payload.syncType });
      return;
    }
    if (type === 'chats') { store.upsertChats(accountId, payload); sse.emit(userId, 'chat:chats', { account_id: accountId, chats: payload.map(c => store.getChat(accountId, c.jid)).filter(Boolean) }); return; }
    if (type === 'contacts') { store.upsertContacts(accountId, payload); return; }
    if (type === 'messages') {
      const settings = store.getSettings(userId);
      for (const m of payload.messages || []) {
        const { row, inserted } = store.upsertMessage(accountId, m);
        if (!row) continue;
        if (inserted && !m.fromMe && payload.type === 'notify') {
          const chat = store.getChat(accountId, m.chatJid);
          store.setUnread(accountId, m.chatJid, (chat?.unread_count || 0) + 1);
        }
        sse.emit(userId, 'chat:message', { account_id: accountId, message: row, chat: store.getChat(accountId, m.chatJid), live: payload.type === 'notify', inserted });
        if (inserted && !m.fromMe && payload.type === 'notify') {
          // Auto-translate incoming (per-chat toggle, default from settings) and adopt the detected language.
          const chat = store.getChat(accountId, m.chatJid);
          const auto = chat?.auto_incoming == null ? settings.autoIncoming : chat.auto_incoming;
          if (auto && row.text) translateIncoming(userId, settings, accountId, row).catch(() => {});
          // Push notification when no browser tab is listening — never for archived / muted chats
          // (and groups only if the user wants them): the phone already decides what it shows.
          if (shouldNotify(settings, chat, m.isGroup || chat?.is_group) && !sse.hasClients(userId)) {
            const title = chat?.name || m.chatJid;
            sendPushToUser(userId, title, (m.isGroup && m.senderName ? m.senderName + ': ' : '') + (row.text || previewKind(row.kind)), { url: '/chats/?account=' + accountId + '&chat=' + encodeURIComponent(m.chatJid), type: 'chat' });
          }
        }
      }
      return;
    }
    if (type === 'message-updates') {
      for (const u of payload) {
        const row = store.updateMessage(accountId, u.id, { status: u.status, text: u.text });
        if (row) sse.emit(userId, 'chat:message-update', { account_id: accountId, message: row });
      }
      return;
    }
    if (type === 'presence') { sse.emit(userId, 'chat:presence', { account_id: accountId, ...payload }); return; }
    if (type === 'read') {   // Telegram: everything up to maxId in this chat was read by the other side
      for (const row of store.markOutgoingRead(accountId, payload.chatJid, payload.maxId)) sse.emit(userId, 'chat:message-update', { account_id: accountId, message: row });
      return;
    }
    if (type === 'calls') {  // WhatsApp call signalling → a call-log line in the chat (+ push on an incoming call)
      const settings = store.getSettings(userId);
      for (const c of payload) {
        const label = c.status === 'offer' ? (c.isVideo ? '📹 Incoming video call' : '📞 Incoming voice call')
          : c.status === 'accept' ? (c.isVideo ? '📹 Video call' : '📞 Voice call')
          : c.status === 'timeout' || c.status === 'reject' ? (c.isVideo ? '📹 Missed video call' : '📞 Missed voice call')
          : c.status === 'terminate' ? (c.isVideo ? '📹 Video call ended' : '📞 Voice call ended') : null;
        if (!label) continue;
        const { row, inserted } = store.upsertMessage(accountId, { id: 'call:' + c.id, chatJid: c.chatJid, fromMe: c.from && c.from !== c.chatJid, kind: 'call', text: label, status: 0, timestamp: c.at || Date.now(), isGroup: c.isGroup });
        if (!row) continue;
        if (!inserted) store.updateMessage(accountId, 'call:' + c.id, { text: label });
        const chat = store.getChat(accountId, c.chatJid);
        sse.emit(userId, 'chat:message', { account_id: accountId, message: store.getMessageByMsgId(accountId, 'call:' + c.id), chat, live: true, inserted });
        sse.emit(userId, 'chat:call', { account_id: accountId, chat_jid: c.chatJid, status: c.status, isVideo: c.isVideo, name: chat?.name || c.chatJid });
        if (c.status === 'offer' && shouldNotify(settings, chat, c.isGroup) && !sse.hasClients(userId)) sendPushToUser(userId, chat?.name || c.chatJid, label + ' — answer it on your phone', { url: '/chats/?account=' + accountId + '&chat=' + encodeURIComponent(c.chatJid), type: 'chat' });
      }
      return;
    }
  } catch (e) { console.warn('[chats] event', type, 'failed:', e.message); }
}
function shouldNotify(settings, chat, isGroup) {
  if (settings.notifications === false) return false;
  if (chat?.archived && !settings.notifyArchived) return false;
  if (chat?.muted && !settings.notifyMuted) return false;
  if (isGroup && settings.notifyGroups === false) return false;
  return true;
}
function previewKind(kind) { return ({ image: '📷 Photo', video: '🎥 Video', audio: '🎤 Voice message', sticker: 'Sticker', document: '📄 Document', contact: '👤 Contact', location: '📍 Location', poll: '📊 Poll' })[kind] || 'New message'; }

const client = createClient(handleEvent);

// Translate one incoming message into "my language", store it, and (maybe) adopt the detected
// language as the chat's send language — mirrors noteDetectedLanguage() in the extension.
async function translateIncoming(userId, settings, accountId, row) {
  const to = settings.myLanguage;
  const r = await tr.translate({ userId, settings, text: row.text, from: 'auto', to, detect: true });
  const same = norm(r.text) === norm(row.text);
  const saved = store.setTranslation(row.id, { translation: same ? '' : r.text, lang: r.lang, target: to });
  sse.emit(userId, 'chat:translated', { account_id: accountId, message: saved });
  if (r.lang && !row.from_me) adoptLanguage(userId, settings, accountId, row.chat_jid, r.lang);
  return saved;
}
function adoptLanguage(userId, settings, accountId, jid, lang) {
  lang = String(lang).replace(/\s*\(.*?\)\s*$/, '').trim();
  if (!lang || /^(unknown|none|mixed|n\/a)$/i.test(lang)) return;
  if (lang.toLowerCase() === String(settings.myLanguage).toLowerCase()) return;
  const chat = store.getChat(accountId, jid); if (!chat) return;
  if (chat.send_language && !chat.send_language_detected) return;   // user chose explicitly — respect it
  if (chat.send_language === lang) return;
  const updated = store.updateChatPrefs(accountId, jid, { send_language: lang, send_language_detected: true });
  sse.emit(userId, 'chat:chats', { account_id: accountId, chats: [updated], detected: lang });
}
const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();

// ── Internal: events from the worker process ─────────────────────────────────
router.post('/internal/events', (req, res) => {
  if (!SECRET || req.headers['x-chats-secret'] !== SECRET) return res.status(401).json({ error: 'bad secret' });
  handleEvent(req.body || {});
  res.json({ ok: true });
});

// Everything below needs a logged-in user.
router.use(authenticate);

function myAccount(req) {
  const acc = store.getUserAccount(req.user.id, req.params.id);
  if (!acc) throw Object.assign(new Error('Account not found'), { status: 404 });
  return acc;
}

// ── Accounts ─────────────────────────────────────────────────────────────────
router.get('/accounts', wrap(async (req) => {
  const rows = store.listAccounts(req.user.id);
  let live = [];
  try { live = await client.list(); } catch (_) {}
  const byId = new Map(live.map(a => [a.accountId, a]));
  return rows.map(a => ({ ...a, live: byId.get(a.id) ? { status: byId.get(a.id).status, reason: byId.get(a.id).reason } : null, unread: 0 }));
}));
const PLATFORMS = ['whatsapp', 'telegram'];
router.post('/accounts', wrap(async (req) => {
  const platform = (req.body?.platform || 'whatsapp').toLowerCase();
  if (!PLATFORMS.includes(platform)) throw Object.assign(new Error('Unknown platform: ' + platform), { status: 400 });
  return store.createAccount(req.user.id, { platform, label: req.body?.label });
}));
router.put('/accounts/:id', wrap(async (req) => { myAccount(req); return store.updateAccount(req.params.id, { label: (req.body?.label || '').trim().slice(0, 60) || null }); }));
function telegramCreds(userId, settings) {
  const apiId = Number(settings?.telegramApiId || process.env.TELEGRAM_API_ID || 0) || null;
  const apiHash = String(settings?.telegramApiHash || process.env.TELEGRAM_API_HASH || '').trim() || null;
  return { apiId, apiHash };
}
router.post('/accounts/:id/link', wrap(async (req) => {
  const acc = myAccount(req);
  const b = req.body || {};
  const opts = { accountId: acc.id, userId: req.user.id, platform: acc.platform };
  if (acc.platform === 'telegram') {
    Object.assign(opts, telegramCreds(req.user.id, store.getSettings(req.user.id)), { phone: b.phone || null, code: b.code || null, password: b.password || null });
  } else {
    opts.pairingPhone = b.pairingPhone || null;
  }
  const st = await client.start(opts);
  const patch = { status: st.status, status_reason: st.reason || null };
  if (st.phone) patch.phone = st.phone; if (st.name) patch.display_name = st.name;
  store.updateAccount(acc.id, patch);
  return st;
}));
router.delete('/accounts/:id', wrap(async (req) => {
  myAccount(req);
  try { await client.stop(req.params.id); } catch (e) { /* worker down: still remove locally */ }
  store.deleteAccount(req.params.id);
  return { ok: true };
}));
router.get('/accounts/:id/status', wrap(async (req) => { myAccount(req); return client.status(req.params.id); }));
router.post('/accounts/:id/stop', wrap(async (req) => { myAccount(req); await client.stop(req.params.id); return store.updateAccount(req.params.id, { status: 'stopped' }); }));
router.post('/accounts/:id/logout', wrap(async (req) => {
  myAccount(req);
  try { await client.logout(req.params.id); } catch (e) { console.warn('[chats] logout:', e.message); }
  store.deleteAccount(req.params.id);
  return { ok: true };
}));

// ── Chats & messages ─────────────────────────────────────────────────────────
router.get('/accounts/:id/chats', wrap(async (req) => {
  myAccount(req);
  return store.listChats(req.params.id, { archived: req.query.archived === 'all' ? 'all' : req.query.archived === '1' ? 1 : 0 });
}));
router.post('/accounts/:id/chats/new', wrap(async (req) => {
  const acc = myAccount(req);
  const r = await client.resolve(acc.id, { phone: req.body?.phone || null, username: req.body?.username || null });
  store.ensureChat(acc.id, r.jid, r.isGroup);
  if (r.name) store.upsertChats(acc.id, [{ jid: r.jid, name: r.name, isGroup: r.isGroup }]);
  const chat = store.getChat(acc.id, r.jid);
  sse.emit(req.user.id, 'chat:chats', { account_id: acc.id, chats: [chat] });
  return chat;
}));
router.get('/accounts/:id/chats/:jid/messages', wrap(async (req) => {
  myAccount(req);
  const before = req.query.before ? Number(req.query.before) : null;
  const limit = Math.min(200, Number(req.query.limit) || 50);
  return { chat: store.getChat(req.params.id, req.params.jid), messages: store.listMessages(req.params.id, req.params.jid, { before, limit }) };
}));
router.post('/accounts/:id/chats/:jid/send', wrap(async (req) => {
  myAccount(req);
  const text = String(req.body?.text || '').trim();
  if (!text) throw Object.assign(new Error('text required'), { status: 400 });
  let quoted = null;
  if (req.body?.quoted) {
    const q = store.getMessage(req.body.quoted);
    if (q && q.account_id === req.params.id) quoted = { id: q.msg_id, chatJid: q.chat_jid, fromMe: q.from_me, senderJid: q.sender_jid, text: q.text, kind: q.kind };
  }
  const sent = await client.send(req.params.id, { jid: req.params.jid, text, quoted });
  if (quoted && !sent.quoted) sent.quoted = { id: quoted.id, text: quoted.text || `[${quoted.kind}]` };
  const { row } = store.upsertMessage(req.params.id, { ...sent, chatJid: sent.chatJid || req.params.jid, fromMe: true, text: sent.text || text, originalText: req.body?.original && req.body.original !== text ? req.body.original : null, status: Math.max(1, sent.status || 1) });
  sse.emit(req.user.id, 'chat:message', { account_id: req.params.id, message: row, chat: store.getChat(req.params.id, req.params.jid), live: false, inserted: true });
  return row;
}));
router.post('/messages/:id/forward', wrap(async (req) => {
  const row = store.getMessage(req.params.id);
  if (!row) throw Object.assign(new Error('Message not found'), { status: 404 });
  const acc = store.getUserAccount(req.user.id, row.account_id);
  if (!acc) throw Object.assign(new Error('Message not found'), { status: 404 });
  const to = [...new Set((req.body?.to || []).map(String).filter(Boolean))].slice(0, 20);
  if (!to.length) throw Object.assign(new Error('Pick at least one chat'), { status: 400 });
  if (row.kind === 'call') throw Object.assign(new Error('Call entries cannot be forwarded'), { status: 400 });
  const sent = await client.forward(acc.id, { toJids: to, message: { id: row.msg_id, chatJid: row.chat_jid, fromMe: row.from_me, senderJid: row.sender_jid, text: row.text, kind: row.kind } });
  const rows = [];
  for (const m of sent) {
    const { row: r } = store.upsertMessage(acc.id, { ...m, fromMe: true, forwarded: true, status: Math.max(1, m.status || 1) });
    if (!r) continue; rows.push(r);
    sse.emit(req.user.id, 'chat:message', { account_id: acc.id, message: r, chat: store.getChat(acc.id, r.chat_jid), live: false, inserted: true });
  }
  return { ok: true, sent: rows.length, messages: rows };
}));
router.post('/accounts/:id/chats/:jid/read', wrap(async (req) => {
  myAccount(req);
  const chat = store.getChat(req.params.id, req.params.jid);
  if (chat && chat.unread_count > 0) {
    const ids = store.unreadIncomingIds(req.params.id, req.params.jid).slice(0, chat.unread_count || 1);
    try { await client.read(req.params.id, { jid: req.params.jid, ids: ids.map(r => r.msg_id), participantJid: chat.is_group ? ids[0]?.sender_jid : undefined }); } catch (e) { /* offline: still clear locally */ }
  }
  store.setUnread(req.params.id, req.params.jid, 0);
  sse.emit(req.user.id, 'chat:chats', { account_id: req.params.id, chats: [store.getChat(req.params.id, req.params.jid)] });
  return { ok: true };
}));
router.put('/accounts/:id/chats/:jid/prefs', wrap(async (req) => {
  myAccount(req);
  const b = req.body || {}; const patch = {};
  if ('send_language' in b) { patch.send_language = b.send_language || null; patch.send_language_detected = !!b.send_language_detected; }
  if ('auto_incoming' in b) patch.auto_incoming = b.auto_incoming;
  const chat = store.updateChatPrefs(req.params.id, req.params.jid, patch);
  sse.emit(req.user.id, 'chat:chats', { account_id: req.params.id, chats: [chat] });
  return chat;
}));
router.post('/accounts/:id/chats/:jid/translate-recent', wrap(async (req) => {
  myAccount(req);
  const settings = store.getSettings(req.user.id);
  const limit = Math.min(50, Number(req.body?.limit) || settings.initialIncoming || 15);
  const rows = store.untranslatedIncoming(req.params.id, req.params.jid, settings.myLanguage, limit);
  const results = await Promise.allSettled(rows.map(r => translateIncoming(req.user.id, settings, req.params.id, r)));
  const failed = results.filter(r => r.status === 'rejected');
  return { requested: rows.length, done: rows.length - failed.length, failed: failed.length, error: failed[0]?.reason?.message || null,
    messages: results.filter(r => r.status === 'fulfilled').map(r => r.value) };
}));
router.post('/accounts/:id/chats/:jid/load-older', wrap(async (req) => {
  myAccount(req);
  const oldest = store.listMessages(req.params.id, req.params.jid, { limit: 1 })[0];
  const all = db.prepare('SELECT msg_id, from_me, timestamp FROM chat_messages WHERE account_id = ? AND chat_jid = ? ORDER BY timestamp ASC LIMIT 1').get(req.params.id, req.params.jid);
  if (!all) throw Object.assign(new Error('No messages yet for this chat'), { status: 400 });
  return client.requestHistory(req.params.id, { jid: req.params.jid, oldestId: all.msg_id, oldestFromMe: !!all.from_me, oldestTimestamp: all.timestamp, count: Math.min(100, Number(req.body?.count) || 50) });
}));
router.get('/accounts/:id/chats/:jid/picture', wrap(async (req) => {
  myAccount(req);
  const r = await client.profilePicture(req.params.id, req.params.jid).catch(() => ({ url: null }));
  if (r?.url) store.updateChatPrefs(req.params.id, req.params.jid, { picture_url: r.url });
  return r;
}));

// ── AI ───────────────────────────────────────────────────────────────────────
router.post('/translate', wrap(async (req) => {
  const settings = store.getSettings(req.user.id);
  const { text, from, to, detect } = req.body || {};
  return tr.translate({ userId: req.user.id, settings, text, from: from || settings.myLanguage, to: to || settings.targetLanguage, detect: !!detect });
}));
router.post('/messages/:id/translate', wrap(async (req) => {
  const row = store.getMessage(req.params.id);
  if (!row) throw Object.assign(new Error('Message not found'), { status: 404 });
  const acc = store.getUserAccount(req.user.id, row.account_id);
  if (!acc) throw Object.assign(new Error('Message not found'), { status: 404 });
  const settings = store.getSettings(req.user.id);
  if (!row.text) throw Object.assign(new Error('No text in that message'), { status: 400 });
  const r = await tr.translate({ userId: req.user.id, settings, text: row.text, from: 'auto', to: settings.myLanguage, detect: true });
  const same = norm(r.text) === norm(row.text);
  const saved = store.setTranslation(row.id, { translation: same ? '' : r.text, lang: r.lang, target: settings.myLanguage });
  sse.emit(req.user.id, 'chat:translated', { account_id: row.account_id, message: saved });
  if (!row.from_me && r.lang) adoptLanguage(req.user.id, settings, row.account_id, row.chat_jid, r.lang);
  return { message: saved, same, lang: r.lang };
}));
router.post('/transcribe', wrap(async (req) => {
  const settings = store.getSettings(req.user.id);
  const { audio, mime, language, prompt } = req.body || {};
  return tr.transcribe({ userId: req.user.id, settings, audio, mime, language, prompt });
}));
router.get('/meta', wrap(async (req) => {
  const settings = store.getSettings(req.user.id);
  const tgc = telegramCreds(req.user.id, settings);
  return {
    platforms: PLATFORMS,
    telegram: { configured: !!(tgc.apiId && tgc.apiHash), fromEnv: !!(process.env.TELEGRAM_API_ID && process.env.TELEGRAM_API_HASH) },
    stt: tr.sttInfo(req.user.id, settings),
    languages: tr.LANGUAGES, recent: store.recentLanguages(req.user.id),
    provider: tr.providerInfo(req.user.id, settings), providers: tr.listProviders(), defaultModels: tr.CHAT_DEFAULT_MODEL,
    worker: await client.health(), mode: client.mode, workerUrl: WORKER_URL || null,
    unread: store.totalUnread(req.user.id),
    vapid: process.env.VAPID_PUBLIC_KEY || null,
  };
}));

// ── Settings & quick answers ─────────────────────────────────────────────────
router.get('/settings', wrap(async (req) => store.getSettings(req.user.id)));
router.put('/settings', wrap(async (req) => {
  const allowed = ['myLanguage', 'targetLanguage', 'autoIncoming', 'initialIncoming', 'showOriginalOutgoing', 'enterTranslates', 'style', 'provider', 'model', 'notifications',
    'notifyGroups', 'notifyArchived', 'notifyMuted', 'sttProvider', 'telegramApiId', 'telegramApiHash'];
  const patch = {}; for (const k of allowed) if (k in (req.body || {})) patch[k] = req.body[k];
  return store.setSettings(req.user.id, patch);
}));
router.get('/quick-answers', wrap(async (req) => store.getQuickAnswers(req.user.id)));
router.put('/quick-answers', wrap(async (req) => {
  const groups = req.body?.groups;
  if (!Array.isArray(groups)) throw Object.assign(new Error('groups array required'), { status: 400 });
  return store.setQuickAnswers(req.user.id, groups.map(g => ({ id: String(g.id || Date.now()), name: String(g.name || 'Group').slice(0, 80), items: (g.items || []).map(i => ({ id: String(i.id || Math.random().toString(36).slice(2)), title: String(i.title || '').slice(0, 120), text: String(i.text || '').slice(0, 4000) })) })));
}));

// Resume linked sessions at boot (in-process mode only; the worker resumes its own).
router.boot = async () => {
  try { const r = await client.resumeAll(); if (r.length) console.log(`[chats] resumed ${r.length} chat session(s) (${client.mode})`); }
  catch (e) { console.warn('[chats] resume failed:', e.message); }
};

module.exports = router;
