// ─────────────────────────────────────────────────────────────────────────────
// Chats — Telegram driver (MTProto user account via teleproto, the maintained
// fork of GramJS). Same event/API contract as whatsapp.js; sessionManager.js
// routes to it when the account's platform is 'telegram'.
//
// Unlike WhatsApp this is the OFFICIAL client API: the account shows up in
// Telegram → Settings → Devices as "Bibix Chats" and there is no ToS problem.
// It needs an API id + hash from https://my.telegram.org (per developer, not
// per user): TELEGRAM_API_ID / TELEGRAM_API_HASH in .env, or the user pastes
// their own pair in Chats → Settings → Accounts.
//
// Link flow (all through start()):  phone → Telegram sends a code to the
// user's other Telegram app/SMS → code → (2FA password) → open.
// Session: a StringSession saved in <authDir>/<userId>/<accountId>/telegram.session
// JIDs:    "<markedPeerId>@tg"  (users positive, chats/channels negative, as in the TL schema)
// Message ids are per peer on Telegram, so msg_id = "<jid>:<messageId>".
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

let lib = null;
function tg() {
  if (!lib) {
    const core = require('teleproto');
    const { StringSession } = require('teleproto/sessions');
    const { NewMessage } = require('teleproto/events');
    let Raw = null; try { Raw = require('teleproto/events').Raw; } catch (_) {}
    const bigInt = require('big-integer');
    lib = { ...core, StringSession, NewMessage, Raw, bigInt };
  }
  return lib;
}

const SUFFIX = '@tg';
const jidOf = (peerId) => String(peerId) + SUFFIX;
const isTgJid = (jid) => typeof jid === 'string' && jid.endsWith(SUFFIX);
const peerOf = (jid) => tg().bigInt(String(jid).slice(0, -SUFFIX.length));
const msgIdOf = (jid, id) => `${jid}:${id}`;
const numOf = (msgId) => Number(String(msgId).split(':').pop());
const ts = (d) => (d ? Number(d) * 1000 : Date.now());

function createTelegramDriver({ onEvent, authDir, logger }) {
  const accounts = new Map();
  const log = logger || { info() {}, warn: (...a) => console.warn('[chats:tg]', ...a) };
  const emit = (acc, type, payload) => { try { onEvent({ accountId: acc.id, userId: acc.userId, platform: 'telegram' }, type, payload); } catch (e) { log.warn('onEvent failed', e.message); } };
  const dirFor = (userId, accountId) => path.join(authDir, String(userId), String(accountId));
  const sessionFile = (acc) => path.join(acc.dir, 'telegram.session');

  function publicState(acc) {
    return {
      accountId: acc.id, userId: acc.userId, platform: 'telegram', status: acc.status, qr: null, pairingCode: null,
      phone: acc.phone || null, name: acc.name || null, reason: acc.reason || null, hint: acc.hint || null,
      lastSeenAt: acc.lastSeenAt || null, reconnectAttempts: 0,
    };
  }
  const get = (id) => accounts.get(String(id)) || null;
  function requireOpen(id) {
    const acc = get(id);
    if (!acc || !acc.client || acc.status !== 'open') throw Object.assign(new Error('Telegram is not connected for this account'), { status: 409 });
    return acc;
  }

  // ── normalisation ──────────────────────────────────────────────────────────
  function peerIdOf(acc, peer) {
    if (!peer) return null;
    try { return acc.client && tg().utils ? tg().utils.getPeerId(peer) : null; } catch (_) {}
    if (peer.userId) return String(peer.userId);
    if (peer.chatId) return '-' + String(peer.chatId);
    if (peer.channelId) return '-100' + String(peer.channelId);
    return null;
  }
  function chatJidOfMessage(acc, m) {
    const pid = peerIdOf(acc, m.peerId);
    if (!pid) return null;
    // outgoing messages in a private chat carry the other user as peerId already; incoming ones too
    return jidOf(pid);
  }
  async function nameOf(acc, peerId) {
    const key = String(peerId);
    if (acc.names.has(key)) return acc.names.get(key);
    let name = null;
    try {
      const e = await acc.client.getEntity(tg().bigInt(key));
      name = e.title || [e.firstName, e.lastName].filter(Boolean).join(' ') || e.username || null;
      if (e.phone) acc.phones.set(key, e.phone);
    } catch (_) {}
    acc.names.set(key, name);
    return name;
  }
  function kindOf(m) {
    const md = m.media; if (!md) return m.action ? 'protocol' : 'text';
    const cn = md.className || '';
    if (/Photo/.test(cn)) return 'image';
    if (/Contact/.test(cn)) return 'contact';
    if (/Geo|Venue/.test(cn)) return 'location';
    if (/Poll/.test(cn)) return 'poll';
    if (/Document/.test(cn)) {
      const mime = md.document?.mimeType || '';
      const attrs = md.document?.attributes || [];
      if (attrs.some(a => /Sticker/.test(a.className))) return 'sticker';
      if (attrs.some(a => /Audio/.test(a.className) && a.voice)) return 'audio';
      if (/^video\//.test(mime)) return 'video';
      if (/^audio\//.test(mime)) return 'audio';
      return 'document';
    }
    if (/WebPage/.test(cn)) return 'text';
    return 'other';
  }
  function mediaOf(m, kind) {
    if (!m.media || kind === 'text' || kind === 'other' || kind === 'contact' || kind === 'location' || kind === 'poll') return null;
    const doc = m.media.document; const attrs = doc?.attributes || [];
    const fn = attrs.find(a => /FileName/.test(a.className))?.fileName || null;
    const vid = attrs.find(a => /Video/.test(a.className)); const img = m.media.photo?.sizes?.slice(-1)[0];
    return { type: kind, mimetype: doc?.mimeType || (kind === 'image' ? 'image/jpeg' : null), fileName: fn, fileLength: doc ? Number(doc.size) : null,
      width: vid?.w || img?.w || null, height: vid?.h || img?.h || null, seconds: vid?.duration || null, tgId: m.id };
  }
  async function normMessage(acc, m, chatJid) {
    if (!m || m.className === 'MessageService' || m.action) return null;
    chatJid = chatJid || chatJidOfMessage(acc, m);
    if (!chatJid) return null;
    const kind = kindOf(m);
    if (kind === 'protocol') return null;
    const isGroup = String(peerOf(chatJid)).startsWith('-');
    const senderPid = m.out ? (acc.selfId || null) : (m.fromId ? peerIdOf(acc, m.fromId) : String(peerOf(chatJid)));
    const senderName = !m.out && senderPid ? await nameOf(acc, senderPid) : null;
    const readMax = acc.readOutbox.get(chatJid) || 0;
    const replyId = m.replyTo?.replyToMsgId;
    return {
      id: msgIdOf(chatJid, m.id), chatJid, fromMe: !!m.out, senderJid: senderPid ? jidOf(senderPid) : null, senderName,
      text: m.message || '', kind, media: mediaOf(m, kind), status: m.out ? (m.id <= readMax ? 4 : 2) : 0, timestamp: ts(m.date),
      quoted: replyId ? { id: msgIdOf(chatJid, replyId), text: '' } : null, forwarded: !!m.fwdFrom, isGroup,
    };
  }
  function normDialog(acc, d) {
    const pid = d.id != null ? String(d.id) : peerIdOf(acc, d.dialog?.peer);
    if (!pid) return null;
    const jid = jidOf(pid);
    const mute = d.dialog?.notifySettings?.muteUntil;
    if (d.dialog?.readOutboxMaxId) acc.readOutbox.set(jid, Number(d.dialog.readOutboxMaxId));
    return {
      jid, isGroup: !!(d.isGroup || d.isChannel), name: d.title || d.name || null,
      unreadCount: Number(d.unreadCount || 0), lastMessageAt: d.date ? ts(d.date) : null,
      archived: !!d.archived, pinned: d.pinned ? 1 : 0, muted: mute ? Number(mute) > Date.now() / 1000 : false,
    };
  }

  // ── session lifecycle ──────────────────────────────────────────────────────
  function writeMeta(acc) {
    fs.mkdirSync(acc.dir, { recursive: true });
    fs.writeFileSync(path.join(acc.dir, 'meta.json'), JSON.stringify({ userId: acc.userId, accountId: acc.id, platform: 'telegram', apiId: acc.apiId, apiHash: acc.apiHash, createdAt: acc.createdAt }));
  }
  function wipe(acc) { try { fs.rmSync(acc.dir, { recursive: true, force: true }); } catch (_) {} }
  function setStatus(acc, status, reason) { acc.status = status; acc.reason = reason || null; emit(acc, 'status', publicState(acc)); }

  // A "gate" is a promise the login callbacks await until the user supplies the code / password via start().
  function gate(acc, what, hint) {
    acc.hint = hint || null;
    setStatus(acc, what);
    return new Promise((resolve, reject) => { acc.gate = { what, resolve, reject }; });
  }

  async function connect(acc) {
    const { TelegramClient, StringSession } = tg();
    let saved = '';
    try { saved = fs.readFileSync(sessionFile(acc), 'utf8').trim(); } catch (_) {}
    const client = new TelegramClient(new StringSession(saved), Number(acc.apiId), String(acc.apiHash), {
      connectionRetries: 10, retryDelay: 2000, autoReconnect: true, useWSS: false,
      deviceModel: process.env.CHATS_TG_DEVICE || 'Bibix Chats', systemVersion: 'Web', appVersion: '1.0',
      baseLogger: undefined,
    });
    try { client.setLogLevel?.('error'); } catch (_) {}
    acc.client = client;
    setStatus(acc, 'connecting');
    await client.connect();
    if (await client.checkAuthorization()) return opened(acc);
    if (!acc.phone) { setStatus(acc, 'phone'); return; }           // UI must send the phone number
    // Login in the background; the callbacks block on gates the UI fills through start().
    acc.login = client.start({
      phoneNumber: acc.phone,
      phoneCode: () => gate(acc, 'code'),
      password: (hint) => gate(acc, 'password', hint),
      onError: (e) => { log.warn('login error', e.message); acc.gate = null; setStatus(acc, 'phone', e.message); return true; },
    }).then(() => opened(acc)).catch(e => { acc.gate = null; setStatus(acc, 'phone', e.message); });
  }
  async function opened(acc) {
    const c = acc.client;
    try { fs.writeFileSync(sessionFile(acc), c.session.save()); } catch (e) { log.warn('session save failed', e.message); }
    try {
      const me = await c.getMe();
      acc.selfId = String(me.id); acc.phone = me.phone || acc.phone; acc.name = [me.firstName, me.lastName].filter(Boolean).join(' ') || me.username || null;
    } catch (_) {}
    acc.lastSeenAt = Date.now(); acc.gate = null; acc.hint = null;
    acc.status = 'open'; acc.reason = null;
    emit(acc, 'status', { ...publicState(acc), isNewLogin: !acc.resumed });
    bindEvents(acc);
    syncDialogs(acc).catch(e => log.warn('dialog sync failed', e.message));
  }
  function bindEvents(acc) {
    const { NewMessage, Raw } = tg(); const c = acc.client;
    if (acc.bound) return; acc.bound = true;
    c.addEventHandler(async (ev) => {
      try {
        const m = ev.message; const n = await normMessage(acc, m);
        if (!n) return;
        emit(acc, 'messages', { messages: [n], type: 'notify' });
        emit(acc, 'chats', [{ jid: n.chatJid, isGroup: n.isGroup, lastMessageAt: n.timestamp }]);
      } catch (e) { log.warn('new message failed', e.message); }
    }, new NewMessage({}));
    if (Raw) c.addEventHandler(async (u) => {
      try {
        const cn = u.className || '';
        if (cn === 'UpdateReadHistoryOutbox') {
          const pid = peerIdOf(acc, u.peer); if (!pid) return;
          const jid = jidOf(pid); acc.readOutbox.set(jid, Number(u.maxId));
          emit(acc, 'read', { chatJid: jid, maxId: Number(u.maxId) });
        } else if (cn === 'UpdateUserTyping' || cn === 'UpdateChatUserTyping' || cn === 'UpdateChannelUserTyping') {
          const pid = cn === 'UpdateUserTyping' ? String(u.userId) : cn === 'UpdateChatUserTyping' ? '-' + String(u.chatId) : '-100' + String(u.channelId);
          const jid = jidOf(pid);
          emit(acc, 'presence', { jid, presences: { [jid]: { lastKnownPresence: /Record/.test(u.action?.className || '') ? 'recording' : 'composing' } } });
        } else if (cn === 'UpdateDialogPinned' || cn === 'UpdateFolderPeers' || cn === 'UpdateNotifySettings') {
          acc.dialogsDirty = true;
        }
      } catch (_) {}
    }, new Raw({}));
  }
  async function syncDialogs(acc, { limit = 200, perChat = 20, chatsWithHistory = 40 } = {}) {
    const c = acc.client;
    const dialogs = await c.getDialogs({ limit });
    const chats = [], contacts = [];
    for (const d of dialogs) {
      const n = normDialog(acc, d); if (!n) continue;
      chats.push(n);
      if (d.entity) {
        const e = d.entity; const key = String(d.id);
        const name = e.title || [e.firstName, e.lastName].filter(Boolean).join(' ') || e.username || null;
        acc.names.set(key, name);
        if (e.phone) { acc.phones.set(key, e.phone); contacts.push({ jid: jidOf(key), name, notify: e.username || null }); }
        else contacts.push({ jid: jidOf(key), name, notify: e.username || null });
      }
    }
    emit(acc, 'history', { chats, contacts, messages: [], isLatest: false, progress: 0, syncType: 'INITIAL' });
    // recent messages of the most recent chats, in small batches so the UI fills up progressively
    const top = dialogs.slice(0, chatsWithHistory);
    for (let i = 0; i < top.length; i++) {
      const d = top[i]; const n = normDialog(acc, d); if (!n) continue;
      try {
        const msgs = await c.getMessages(d.inputEntity || d.entity, { limit: perChat });
        const out = [];
        for (const m of msgs) { const nm = await normMessage(acc, m, n.jid); if (nm) out.push(nm); }
        emit(acc, 'history', { chats: [], contacts: [], messages: out, isLatest: i === top.length - 1, progress: Math.round((i + 1) / top.length * 100), syncType: 'INITIAL' });
      } catch (e) { log.warn('history for', n.jid, e.message); }
    }
  }

  // ── public API (mirrors whatsapp.js) ───────────────────────────────────────
  // start({ accountId, userId, apiId, apiHash, phone?, code?, password? })
  async function start({ accountId, userId, apiId, apiHash, phone, code, password }) {
    accountId = String(accountId); userId = String(userId);
    let acc = accounts.get(accountId);
    if (acc && acc.client) {
      if (acc.gate && code && acc.gate.what === 'code') { const g = acc.gate; acc.gate = null; setStatus(acc, 'connecting'); g.resolve(String(code).replace(/\D/g, '')); return publicState(acc); }
      if (acc.gate && password && acc.gate.what === 'password') { const g = acc.gate; acc.gate = null; setStatus(acc, 'connecting'); g.resolve(String(password)); return publicState(acc); }
      if (acc.status === 'phone' && phone) { acc.phone = String(phone).replace(/[^\d+]/g, ''); if (!acc.phone.startsWith('+')) acc.phone = '+' + acc.phone; await connect(acc); return publicState(acc); }
      if (acc.status === 'open' || acc.status === 'connecting' || acc.gate) return publicState(acc);
    }
    // (re)create
    let meta = {};
    const dir = dirFor(userId, accountId);
    try { meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')); } catch (_) {}
    apiId = apiId || meta.apiId; apiHash = apiHash || meta.apiHash;
    if (!apiId || !apiHash) throw Object.assign(new Error('Telegram API id/hash missing — set TELEGRAM_API_ID and TELEGRAM_API_HASH in backend/.env or paste yours in Settings → Accounts (from https://my.telegram.org)'), { status: 412 });
    if (acc?.client) { try { await acc.client.disconnect(); } catch (_) {} }
    acc = acc || { id: accountId, userId, dir, status: 'starting', phone: null, name: null, selfId: null, reason: null, hint: null, gate: null, client: null, bound: false, names: new Map(), phones: new Map(), readOutbox: new Map(), createdAt: Date.now(), resumed: false };
    acc.apiId = apiId; acc.apiHash = apiHash; acc.bound = false; acc.stopping = false;
    if (phone) { acc.phone = String(phone).replace(/[^\d+]/g, ''); if (!acc.phone.startsWith('+')) acc.phone = '+' + acc.phone; }
    accounts.set(accountId, acc);
    writeMeta(acc);
    await connect(acc);
    return publicState(acc);
  }
  function status(id) { const acc = get(id); return acc ? publicState(acc) : { accountId: String(id), status: 'unlinked', platform: 'telegram' }; }
  function list() { return [...accounts.values()].map(publicState); }
  async function stop(id) {
    const acc = get(id); if (!acc) return { ok: true };
    acc.stopping = true; if (acc.gate) { acc.gate.reject(new Error('stopped')); acc.gate = null; }
    try { await acc.client?.disconnect(); } catch (_) {}
    acc.client = null; acc.bound = false; setStatus(acc, 'stopped', 'stopped');
    return { ok: true };
  }
  async function logout(id) {
    const acc = get(id); if (!acc) return { ok: true };
    if (acc.gate) { acc.gate.reject(new Error('logout')); acc.gate = null; }
    try { if (acc.client && await acc.client.checkAuthorization()) await acc.client.logOut(); } catch (_) {}
    try { await acc.client?.disconnect(); } catch (_) {}
    acc.client = null; wipe(acc); acc.status = 'logged_out'; acc.reason = 'logged_out';
    emit(acc, 'status', publicState(acc));
    accounts.delete(acc.id);
    return { ok: true };
  }
  async function entityFor(acc, jid) { return acc.client.getInputEntity(peerOf(jid)); }
  async function send(id, { jid, text, quoted }) {
    const acc = requireOpen(id);
    if (!jid || !text) throw Object.assign(new Error('jid and text required'), { status: 400 });
    const m = await acc.client.sendMessage(await entityFor(acc, jid), { message: text, replyTo: quoted?.id ? numOf(quoted.id) : undefined, linkPreview: false });
    const n = await normMessage(acc, m, jid);
    return n || { id: msgIdOf(jid, m?.id || Date.now()), chatJid: jid, fromMe: true, text, kind: 'text', status: 2, timestamp: Date.now() };
  }
  async function forward(id, { toJids, message }) {
    const acc = requireOpen(id);
    if (!Array.isArray(toJids) || !toJids.length || !message?.id) throw Object.assign(new Error('toJids and message required'), { status: 400 });
    const from = await entityFor(acc, message.chatJid);
    const out = [];
    for (const jid of toJids) {
      const res = await acc.client.forwardMessages(await entityFor(acc, jid), { messages: [numOf(message.id)], fromPeer: from });
      for (const m of res || []) { const n = await normMessage(acc, m, jid); out.push(n || { id: msgIdOf(jid, m?.id || Date.now()), chatJid: jid, fromMe: true, text: message.text || '', kind: message.kind || 'text', status: 2, timestamp: Date.now(), forwarded: true }); }
    }
    return out;
  }
  async function read(id, { jid }) { const acc = requireOpen(id); await acc.client.markAsRead(await entityFor(acc, jid)); return { ok: true }; }
  async function presence(id, { jid, type }) {
    const acc = requireOpen(id);
    try { await acc.client.setTyping?.(await entityFor(acc, jid), type === 'composing' ? undefined : null); } catch (_) {}
    return { ok: true };
  }
  async function requestHistory(id, { jid, oldestId, count = 50 }) {
    const acc = requireOpen(id);
    const msgs = await acc.client.getMessages(await entityFor(acc, jid), { limit: Math.min(100, count), offsetId: oldestId ? numOf(oldestId) : 0 });
    const out = [];
    for (const m of msgs) { const n = await normMessage(acc, m, jid); if (n) out.push(n); }
    emit(acc, 'history', { chats: [], contacts: [], messages: out, isLatest: false, progress: null, syncType: 'ON_DEMAND' });
    return { ok: true, count: out.length };
  }
  async function profilePicture(id, jid) {
    const acc = requireOpen(id);
    try {
      const buf = await acc.client.downloadProfilePhoto(await entityFor(acc, jid), { isBig: false });
      if (buf && buf.length && buf.length < 200000) return { url: 'data:image/jpeg;base64,' + Buffer.from(buf).toString('base64') };
    } catch (_) {}
    return { url: null };
  }
  // resolve({ phone | username }) → { jid, name } (phone numbers only resolve for Telegram contacts / users who allow it)
  async function resolve(id, { phone, username }) {
    const acc = requireOpen(id);
    const { Api } = tg();
    let entity = null;
    try {
      if (username) entity = await acc.client.getEntity(String(username).replace(/^@/, ''));
      else if (phone) {
        const digits = '+' + String(phone).replace(/\D/g, '');
        try { entity = await acc.client.getEntity(digits); }
        catch (_) {
          const r = await acc.client.invoke(new Api.contacts.ResolvePhone({ phone: digits }));
          entity = r.users?.[0] || null;
        }
      }
    } catch (e) { throw Object.assign(new Error('Telegram could not find that ' + (username ? 'username' : 'number') + ' (' + e.message + ')'), { status: 404 }); }
    if (!entity) throw Object.assign(new Error('Not found on Telegram'), { status: 404 });
    const pid = String(tg().utils.getPeerId(entity));
    const name = entity.title || [entity.firstName, entity.lastName].filter(Boolean).join(' ') || entity.username || null;
    acc.names.set(pid, name);
    return { jid: jidOf(pid), name, exists: true, isGroup: !!entity.title };
  }
  async function download(id, { jid, msgId, media }) {
    const acc = requireOpen(id);
    const msgs = await acc.client.getMessages(await entityFor(acc, jid), { ids: [numOf(msgId)] });
    const m = msgs?.[0]; if (!m?.media) throw Object.assign(new Error('Media no longer available'), { status: 404 });
    const buf = await acc.client.downloadMedia(m, {});
    if (!buf) throw Object.assign(new Error('Download failed'), { status: 502 });
    return { buffer: Buffer.from(buf), mimetype: media?.mimetype || (m.media.photo ? 'image/jpeg' : 'application/octet-stream') };
  }
  async function sendMedia(id, { jid, buffer, mimetype, fileName, caption, kind, quoted }) {
    const acc = requireOpen(id);
    if (!jid || !buffer?.length) throw Object.assign(new Error('jid and file required'), { status: 400 });
    const file = Buffer.from(buffer); file.name = fileName || ('file.' + ((mimetype || '').split('/')[1] || 'bin').replace('jpeg', 'jpg'));
    const asDoc = !(kind === 'image' || kind === 'video' || /^image\/(jpeg|png)/.test(mimetype || '') || /^video\/mp4/.test(mimetype || ''));
    const m = await acc.client.sendFile(await entityFor(acc, jid), { file, caption: caption || undefined, forceDocument: asDoc, replyTo: quoted?.id ? numOf(quoted.id) : undefined });
    const n = await normMessage(acc, m, jid);
    return n || { id: msgIdOf(jid, m?.id || Date.now()), chatJid: jid, fromMe: true, text: caption || '', kind: kind || 'document', status: 2, timestamp: Date.now() };
  }
  function hasState(dir) { return fs.existsSync(path.join(dir, 'telegram.session')); }
  async function resume({ accountId, userId }) { const acc = await start({ accountId, userId }); const a = get(accountId); if (a) a.resumed = true; return acc; }
  async function shutdown() { for (const acc of accounts.values()) { try { await acc.client?.disconnect(); } catch (_) {} } }

  return { platform: 'telegram', start, resume, status, list, stop, logout, send, forward, read, presence, requestHistory, profilePicture, resolve, download, sendMedia, hasState, shutdown, isTgJid };
}

module.exports = { createTelegramDriver, isTgJid, jidOf, peerOf };
