// ─────────────────────────────────────────────────────────────────────────────
// Chats — WhatsApp driver (Baileys, multi-device "linked device").
// Used through sessionManager.js, which routes each account to its platform
// driver (this file for WhatsApp, telegram.js for Telegram).
//
// One Baileys socket per Bibix chat account. Auth state lives on disk under
//   <CHATS_AUTH_DIR>/<userId>/<accountId>/   (multi-file auth state + meta.json)
// so a restart resumes every linked account without a new QR scan.
//
// This module touches NO database: it normalises everything WhatsApp sends
// into small plain objects and hands them to `onEvent(account, type, payload)`.
// It can run inside the main app (dev) or inside `worker.js` (a separate
// always-on process on hosting that kills/duplicates the web process).
//
// ─────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const pino = require('pino');
const QRCode = require('qrcode');

const AUTH_DIR = process.env.CHATS_AUTH_DIR || path.join(__dirname, '../../data/chats');
// Shown on the phone under Linked Devices. Format: [platform/OS, browser, version].
// Default makes the phone list it as "Chrome (Bibix)". Override with CHATS_WA_BROWSER="Mac OS,Chrome,14.4.1".
const BROWSER = (process.env.CHATS_WA_BROWSER || 'Bibix,Chrome,1.0.0').split(',').map(s => s.trim());
const LOG_LEVEL = process.env.CHATS_LOG_LEVEL || 'warn';
const RECONNECT_MIN_MS = 1500, RECONNECT_MAX_MS = 60000;

const logger = pino({ level: LOG_LEVEL });

let baileys = null;
async function lib() {
  // Baileys 7 is ESM-only; a dynamic import keeps the rest of the backend CommonJS.
  if (!baileys) baileys = await import('@whiskeysockets/baileys');
  return baileys;
}

// ── helpers ──────────────────────────────────────────────────────────────────
const toNum = (v) => (v == null ? 0 : typeof v === 'number' ? v : typeof v === 'object' && typeof v.toNumber === 'function' ? v.toNumber() : Number(v) || 0);
const tsMs = (v) => { const n = toNum(v); return n > 1e12 ? n : n * 1000; };

const PN_SUFFIX = '@s.whatsapp.net';
function isLid(jid) { return typeof jid === 'string' && jid.endsWith('@lid'); }
function phoneOf(jid) { const m = /^(\d+)(?::\d+)?@s\.whatsapp\.net$/.exec(jid || ''); return m ? m[1] : null; }

// Unwrap the many "envelope" message types WhatsApp uses.
function unwrap(message) {
  let m = message, guard = 0;
  while (m && guard++ < 6) {
    const k = Object.keys(m).find(k => /^(ephemeralMessage|viewOnceMessage|viewOnceMessageV2|viewOnceMessageV2Extension|documentWithCaptionMessage|editedMessage|groupMentionedMessage|botInvokeMessage|lottieStickerMessage)$/.test(k) && m[k]?.message);
    if (!k) break;
    m = m[k].message;
  }
  return m || null;
}

function describe(message) {
  const m = unwrap(message);
  if (!m) return { kind: 'other', text: '' };
  if (m.conversation) return { kind: 'text', text: m.conversation };
  if (m.extendedTextMessage) return { kind: 'text', text: m.extendedTextMessage.text || '' };
  if (m.imageMessage) return { kind: 'image', text: m.imageMessage.caption || '', media: mediaInfo('image', m.imageMessage) };
  if (m.videoMessage) return { kind: 'video', text: m.videoMessage.caption || '', media: mediaInfo('video', m.videoMessage) };
  if (m.audioMessage) return { kind: 'audio', text: '', media: mediaInfo('audio', m.audioMessage) };
  if (m.stickerMessage) return { kind: 'sticker', text: '', media: mediaInfo('sticker', m.stickerMessage) };
  if (m.documentMessage) return { kind: 'document', text: m.documentMessage.caption || m.documentMessage.fileName || '', media: mediaInfo('document', m.documentMessage) };
  if (m.contactMessage) return { kind: 'contact', text: m.contactMessage.displayName || '' };
  if (m.contactsArrayMessage) return { kind: 'contact', text: m.contactsArrayMessage.displayName || '' };
  if (m.locationMessage) return { kind: 'location', text: m.locationMessage.name || m.locationMessage.address || '' };
  if (m.liveLocationMessage) return { kind: 'location', text: m.liveLocationMessage.caption || '' };
  if (m.pollCreationMessage || m.pollCreationMessageV2 || m.pollCreationMessageV3) {
    const p = m.pollCreationMessage || m.pollCreationMessageV2 || m.pollCreationMessageV3;
    return { kind: 'poll', text: p.name || '' };
  }
  if (m.reactionMessage) return { kind: 'reaction', text: m.reactionMessage.text || '' };
  if (m.protocolMessage) return { kind: 'protocol', text: '' };
  if (m.senderKeyDistributionMessage && Object.keys(m).length === 1) return { kind: 'protocol', text: '' };
  if (m.call) return { kind: 'call', text: '' };
  return { kind: 'other', text: '' };
}

// Everything needed to download (or forward) the media later, even after a restart: WhatsApp media is
// an encrypted blob on their CDN; mediaKey + directPath/url are the handle. Small enough to store as JSON.
const b64 = (v) => (v == null ? null : Buffer.from(v).toString('base64'));
function mediaInfo(type, m) {
  if (!m) return null;
  return {
    type, mimetype: m.mimetype || null, url: m.url || null, directPath: m.directPath || null,
    mediaKey: b64(m.mediaKey), fileSha256: b64(m.fileSha256), fileEncSha256: b64(m.fileEncSha256),
    fileLength: toNum(m.fileLength) || null, fileName: m.fileName || null, width: m.width || null, height: m.height || null,
    seconds: m.seconds || null, ptt: !!m.ptt, thumb: m.jpegThumbnail?.length ? 'data:image/jpeg;base64,' + b64(m.jpegThumbnail) : null,
  };
}
const unb64 = (v) => (v ? Buffer.from(v, 'base64') : undefined);
// Rebuild a WhatsApp media message from stored info (for forwarding without the raw message).
function mediaMessageFrom(info, caption) {
  if (!info?.mediaKey || !(info.directPath || info.url)) return null;
  const base = { url: info.url || undefined, directPath: info.directPath || undefined, mediaKey: unb64(info.mediaKey), fileSha256: unb64(info.fileSha256), fileEncSha256: unb64(info.fileEncSha256), mimetype: info.mimetype || undefined, fileLength: info.fileLength || undefined, jpegThumbnail: info.thumb ? unb64(info.thumb.split(',')[1]) : undefined };
  const key = { image: 'imageMessage', video: 'videoMessage', audio: 'audioMessage', sticker: 'stickerMessage', document: 'documentMessage' }[info.type];
  if (!key) return null;
  const msg = { ...base };
  if (caption && (info.type === 'image' || info.type === 'video' || info.type === 'document')) msg.caption = caption;
  if (info.type === 'document') msg.fileName = info.fileName || 'file';
  if (info.type === 'audio') msg.ptt = !!info.ptt;
  return { [key]: msg };
}
function contextOf(message) {
  const m = unwrap(message); if (!m) return null;
  return Object.values(m).find(v => v && typeof v === 'object' && v.contextInfo)?.contextInfo || null;
}
function quotedOf(message) {
  const ctx = contextOf(message);
  if (!ctx?.quotedMessage) return null;
  const d = describe(ctx.quotedMessage);
  return { id: ctx.stanzaId || null, text: d.text || `[${d.kind}]`, senderJid: ctx.participant || null };
}
function isForwarded(message) { const ctx = contextOf(message); return !!(ctx && (ctx.isForwarded || toNum(ctx.forwardingScore) > 0)); }

// ── manager ──────────────────────────────────────────────────────────────────
const RAW_CACHE = 3000; // raw WAMessages kept per account so recent messages can be quoted / forwarded with media

function createWhatsAppDriver({ onEvent }) {
  const accounts = new Map(); // accountId → state
  const emit = (acc, type, payload) => { try { onEvent({ accountId: acc.id, userId: acc.userId, platform: acc.platform }, type, payload); } catch (e) { logger.warn({ err: e.message }, 'onEvent failed'); } };

  function dirFor(userId, accountId) { return path.join(AUTH_DIR, String(userId), String(accountId)); }
  function get(accountId) { return accounts.get(String(accountId)) || null; }

  function publicState(acc) {
    return {
      accountId: acc.id, userId: acc.userId, platform: acc.platform,
      status: acc.status, qr: acc.qr || null, pairingCode: acc.pairingCode || null,
      phone: acc.phone || null, name: acc.name || null, reason: acc.reason || null,
      lastSeenAt: acc.lastSeenAt || null, reconnectAttempts: acc.reconnectAttempts,
    };
  }

  // Normalise a jid: prefer the phone-number form over the LID form.
  async function pnJid(acc, jid, alt) {
    if (!jid) return null;
    if (!isLid(jid)) return jid;
    if (alt && !isLid(alt)) return alt;
    const cached = acc.lidMap.get(jid); if (cached) return cached;
    try {
      const pn = await acc.sock?.signalRepository?.lidMapping?.getPNForLID?.(jid);
      if (pn) { acc.lidMap.set(jid, pn); return pn; }
    } catch (_) {}
    return jid; // unknown mapping — keep the LID; a later lid-mapping.update will fix it
  }

  async function normMessage(acc, msg) {
    const key = msg.key || {};
    const chatJid = await pnJid(acc, key.remoteJid, key.remoteJidAlt);
    if (!chatJid) return null;
    const { isJidBroadcast, isJidStatusBroadcast, isJidGroup } = await lib();
    if (isJidStatusBroadcast(chatJid) || isJidBroadcast(chatJid) || chatJid === 'status@broadcast') return null;
    const d = describe(msg.message);
    if (d.kind === 'protocol' || d.kind === 'reaction') return null;
    const group = isJidGroup(chatJid);
    const senderJid = key.fromMe ? (acc.selfJid || null) : (group ? await pnJid(acc, key.participant, key.participantAlt) : chatJid);
    return {
      id: key.id, chatJid, fromMe: !!key.fromMe, senderJid, senderName: msg.pushName || null,
      text: d.text || '', kind: d.kind, media: d.media || null, status: toNum(msg.status) || (key.fromMe ? 1 : 0),
      timestamp: tsMs(msg.messageTimestamp) || Date.now(), quoted: quotedOf(msg.message), forwarded: isForwarded(msg.message),
      isGroup: group,
    };
  }
  function remember(acc, msg) {
    if (!msg?.key?.id || !msg.message) return;
    acc.raw.set(msg.key.id, { key: msg.key, message: msg.message });
    if (acc.raw.size > RAW_CACHE) acc.raw.delete(acc.raw.keys().next().value);
  }

  async function normChat(acc, c) {
    const { isJidGroup, isJidBroadcast, isJidStatusBroadcast } = await lib();
    const raw = c.pnJid || (c.id && !isLid(c.id) ? c.id : null) || (await pnJid(acc, c.id)) || c.id;
    if (!raw || isJidBroadcast(raw) || isJidStatusBroadcast(raw) || raw === 'status@broadcast') return null;
    const out = { jid: raw, isGroup: isJidGroup(raw) };
    if (c.name != null) out.name = c.name; else if (c.displayName != null) out.name = c.displayName;
    if (c.unreadCount != null) out.unreadCount = toNum(c.unreadCount);
    if (c.conversationTimestamp != null) out.lastMessageAt = tsMs(c.conversationTimestamp);
    if (c.archived != null) out.archived = !!c.archived;
    if (c.pinned != null) out.pinned = toNum(c.pinned) ? 1 : 0;
    if (c.muteEndTime != null) out.muted = toNum(c.muteEndTime) > Date.now() / 1000;
    return out;
  }

  async function normContact(acc, c) {
    const jid = c.phoneNumber || (!isLid(c.id) ? c.id : await pnJid(acc, c.id));
    if (!jid || isLid(jid)) return null;
    return { jid, name: c.name || null, notify: c.notify || null, lid: c.lid || (isLid(c.id) ? c.id : null) };
  }

  async function connect(acc) {
    const B = await lib();
    const makeWASocket = B.makeWASocket || B.default;
    const { state, saveCreds } = await B.useMultiFileAuthState(acc.dir);
    let version;
    try { version = (await B.fetchLatestBaileysVersion()).version; } catch (_) {}

    acc.status = state.creds?.registered ? 'connecting' : 'qr';
    acc.qr = null; acc.pairingCode = null; acc.reason = null;
    emit(acc, 'status', publicState(acc));

    const sock = makeWASocket({
      version,
      auth: { creds: state.creds, keys: B.makeCacheableSignalKeyStore(state.keys, logger) },
      browser: BROWSER,
      logger,
      printQRInTerminal: false,
      syncFullHistory: false,
      markOnlineOnConnect: false,          // keep phone notifications working while we are "online"
      generateHighQualityLinkPreview: false,
      getMessage: async (key) => acc.sent.get(key.id) || undefined,
    });
    acc.sock = sock;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (u) => {
      const { connection, lastDisconnect, qr, isNewLogin } = u;
      if (qr) {
        acc.qr = await QRCode.toDataURL(qr, { margin: 1, width: 320 }).catch(() => null);
        acc.status = 'qr';
        emit(acc, 'status', publicState(acc));
        // Pairing code (link with phone number) — only possible before registration.
        if (acc.pairingPhone && !acc.pairingCode && !state.creds?.registered) {
          try {
            acc.pairingCode = await sock.requestPairingCode(acc.pairingPhone);
            emit(acc, 'status', publicState(acc));
          } catch (e) { logger.warn({ err: e.message }, 'pairing code failed'); acc.reason = 'Pairing code failed: ' + e.message; emit(acc, 'status', publicState(acc)); }
        }
      }
      if (connection === 'open') {
        acc.status = 'open'; acc.qr = null; acc.pairingCode = null; acc.pairingPhone = null; acc.reconnectAttempts = 0;
        acc.lastSeenAt = Date.now();
        const me = sock.user || {};
        acc.selfJid = B.jidNormalizedUser(me.id || '') || null;
        acc.phone = phoneOf(acc.selfJid) || acc.phone;
        acc.name = me.name || acc.name || null;
        emit(acc, 'status', { ...publicState(acc), isNewLogin: !!isNewLogin });
      }
      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode || lastDisconnect?.error?.statusCode || 0;
        const msg = lastDisconnect?.error?.message || '';
        acc.sock = null;
        if (acc.stopping) { acc.status = 'stopped'; acc.reason = 'stopped'; emit(acc, 'status', publicState(acc)); return; }
        if (code === B.DisconnectReason.loggedOut || code === B.DisconnectReason.forbidden) {
          acc.status = 'logged_out'; acc.reason = code === 403 ? 'forbidden' : 'logged_out';
          wipe(acc);
          emit(acc, 'status', publicState(acc));
          return;
        }
        if (code === B.DisconnectReason.connectionReplaced) {
          // Another process opened this session (duplicate worker). Do not fight it.
          acc.status = 'replaced'; acc.reason = 'Session opened elsewhere (440)';
          emit(acc, 'status', publicState(acc));
          return;
        }
        acc.status = 'connecting'; acc.reason = `closed (${code}) ${msg}`.trim();
        emit(acc, 'status', publicState(acc));
        const delay = code === B.DisconnectReason.restartRequired ? 300
          : Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * Math.pow(2, acc.reconnectAttempts++));
        acc.timer = setTimeout(() => { if (accounts.get(acc.id) === acc && !acc.stopping) connect(acc).catch(e => logger.warn({ err: e.message }, 'reconnect failed')); }, delay);
      }
    });

    sock.ev.on('lid-mapping.update', (m) => { if (m?.lid && m?.pn) acc.lidMap.set(m.lid, m.pn); });

    sock.ev.on('messaging-history.set', async ({ chats = [], contacts = [], messages = [], isLatest, progress, syncType, lidPnMappings = [] }) => {
      for (const m of lidPnMappings) if (m?.lid && m?.pn) acc.lidMap.set(m.lid, m.pn);
      const outChats = [], outContacts = [], outMsgs = [];
      for (const c of contacts) { const n = await normContact(acc, c); if (n) outContacts.push(n); }
      for (const c of chats) { const n = await normChat(acc, c); if (n) outChats.push(n); }
      for (const m of messages) { const n = await normMessage(acc, m); if (n) { outMsgs.push(n); remember(acc, m); } }
      emit(acc, 'history', { chats: outChats, contacts: outContacts, messages: outMsgs, isLatest: !!isLatest, progress: progress ?? null, syncType: syncType ?? null });
    });

    sock.ev.on('chats.upsert', async (chats) => {
      const out = []; for (const c of chats) { const n = await normChat(acc, c); if (n) out.push(n); }
      if (out.length) emit(acc, 'chats', out);
    });
    sock.ev.on('chats.update', async (chats) => {
      const out = []; for (const c of chats) { const n = await normChat(acc, c); if (n) out.push(n); }
      if (out.length) emit(acc, 'chats', out);
    });
    sock.ev.on('chats.delete', (ids) => emit(acc, 'chats-deleted', ids));
    sock.ev.on('contacts.upsert', async (cs) => { const out = []; for (const c of cs) { const n = await normContact(acc, c); if (n) out.push(n); } if (out.length) emit(acc, 'contacts', out); });
    sock.ev.on('contacts.update', async (cs) => { const out = []; for (const c of cs) { const n = await normContact(acc, c); if (n) out.push(n); } if (out.length) emit(acc, 'contacts', out); });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      const out = [];
      for (const m of messages) { const n = await normMessage(acc, m); if (n) { out.push(n); remember(acc, m); } }
      if (out.length) emit(acc, 'messages', { messages: out, type });
    });
    sock.ev.on('messages.update', async (updates) => {
      const out = [];
      for (const u of updates) {
        const chatJid = await pnJid(acc, u.key?.remoteJid, u.key?.remoteJidAlt);
        const upd = { id: u.key?.id, chatJid };
        if (u.update?.status != null) upd.status = toNum(u.update.status);
        if (u.update?.message) { const d = describe(u.update.message); if (d.text) upd.text = d.text; }
        if (u.update?.messageStubType != null) upd.stub = toNum(u.update.messageStubType);
        if (upd.id) out.push(upd);
      }
      if (out.length) emit(acc, 'message-updates', out);
    });
    sock.ev.on('message-receipt.update', async (rs) => {
      const out = [];
      for (const r of rs) {
        const chatJid = await pnJid(acc, r.key?.remoteJid, r.key?.remoteJidAlt);
        const rc = r.receipt || {};
        const status = rc.readTimestamp ? 4 : rc.receiptTimestamp ? 3 : null;
        if (r.key?.id && status) out.push({ id: r.key.id, chatJid, status });
      }
      if (out.length) emit(acc, 'message-updates', out);
    });
    sock.ev.on('presence.update', ({ id, presences }) => emit(acc, 'presence', { jid: id, presences }));
    // Voice/video calls: Baileys only sees the signalling (offer / accept / reject / timeout / terminate);
    // the call audio itself never reaches a linked device, so this is a call log, not a call.
    sock.ev.on('call', async (calls) => {
      const out = [];
      for (const c of calls || []) {
        const chatJid = await pnJid(acc, c.chatId || c.from, c.fromAlt);
        if (!c.id || !chatJid) continue;
        out.push({ id: c.id, chatJid, status: c.status, isVideo: !!c.isVideo, isGroup: !!c.isGroup, from: await pnJid(acc, c.from), at: tsMs(c.date) || Date.now(), offline: !!c.offline });
      }
      if (out.length) emit(acc, 'calls', out);
    });
  }

  function wipe(acc) {
    try { fs.rmSync(acc.dir, { recursive: true, force: true }); } catch (_) {}
  }

  function writeMeta(acc) {
    fs.mkdirSync(acc.dir, { recursive: true });
    fs.writeFileSync(path.join(acc.dir, 'meta.json'), JSON.stringify({ userId: acc.userId, accountId: acc.id, platform: acc.platform, createdAt: acc.createdAt }));
  }

  // ── public API ───────────────────────────────────────────────────────────
  async function start({ accountId, userId, platform = 'whatsapp', pairingPhone = null }) {
    accountId = String(accountId); userId = String(userId);
    if (platform !== 'whatsapp') throw new Error(`Platform ${platform} is not supported yet`);
    let acc = accounts.get(accountId);
    if (acc && acc.sock && (acc.status === 'open' || acc.status === 'connecting' || acc.status === 'qr')) {
      if (pairingPhone && !acc.pairingCode && acc.status === 'qr' && acc.sock) {
        acc.pairingPhone = pairingPhone.replace(/\D/g, '');
        try { acc.pairingCode = await acc.sock.requestPairingCode(acc.pairingPhone); emit(acc, 'status', publicState(acc)); }
        catch (e) { acc.reason = 'Pairing code failed: ' + e.message; }
      }
      return publicState(acc);
    }
    if (acc?.timer) clearTimeout(acc.timer);
    acc = acc || {
      id: accountId, userId, platform, dir: dirFor(userId, accountId), status: 'starting', qr: null, pairingCode: null,
      phone: null, name: null, selfJid: null, reason: null, reconnectAttempts: 0, lidMap: new Map(), sent: new Map(), raw: new Map(),
      createdAt: Date.now(), stopping: false, timer: null, sock: null,
    };
    acc.stopping = false; acc.reconnectAttempts = 0;
    acc.pairingPhone = pairingPhone ? String(pairingPhone).replace(/\D/g, '') : null;
    accounts.set(accountId, acc);
    writeMeta(acc);
    await connect(acc);
    return publicState(acc);
  }

  function status(accountId) {
    const acc = get(accountId);
    return acc ? publicState(acc) : { accountId: String(accountId), status: 'unlinked', qr: null };
  }

  function list() { return [...accounts.values()].map(publicState); }

  async function stop(accountId) {
    const acc = get(accountId); if (!acc) return { ok: true };
    acc.stopping = true; if (acc.timer) clearTimeout(acc.timer);
    try { acc.sock?.end?.(new Error('stopped')); } catch (_) {}
    acc.sock = null; acc.status = 'stopped';
    emit(acc, 'status', publicState(acc));
    return { ok: true };
  }

  async function logout(accountId) {
    const acc = get(accountId);
    if (acc) {
      acc.stopping = true; if (acc.timer) clearTimeout(acc.timer);
      try { await acc.sock?.logout?.(); } catch (_) {}
      try { acc.sock?.end?.(); } catch (_) {}
      acc.sock = null; wipe(acc); acc.status = 'logged_out'; acc.reason = 'logged_out';
      emit(acc, 'status', publicState(acc));
      accounts.delete(acc.id);
    }
    return { ok: true };
  }

  function requireOpen(accountId) {
    const acc = get(accountId);
    if (!acc || !acc.sock || acc.status !== 'open') throw Object.assign(new Error('WhatsApp is not connected for this account'), { status: 409 });
    return acc;
  }

  // A WAMessage to quote / forward: the cached original when we still have it (keeps media), else a
  // text-only stand-in built from what the database knows about the message.
  function rawFor(acc, { id, chatJid, fromMe, senderJid, text, kind, media }) {
    const cached = id && acc.raw.get(id);
    if (cached) return cached;
    const key = { remoteJid: chatJid, id: id || undefined, fromMe: !!fromMe, ...(senderJid && senderJid !== chatJid ? { participant: senderJid } : {}) };
    const rebuilt = media && mediaMessageFrom(media, text);
    if (rebuilt) return { key, message: rebuilt };
    return { key, message: { conversation: text || (kind && kind !== 'text' ? `[${kind}]` : '') } };
  }

  // download(id, { media }) → { buffer, mimetype }   (works from stored info; no raw message needed)
  async function download(accountId, { media }) {
    const acc = get(accountId);
    if (!media?.mediaKey) throw Object.assign(new Error('No media handle for this message'), { status: 404 });
    const B = await lib();
    const stream = await B.downloadContentFromMessage({ mediaKey: unb64(media.mediaKey), directPath: media.directPath, url: media.url }, media.type, {});
    const chunks = []; for await (const c of stream) chunks.push(c);
    return { buffer: Buffer.concat(chunks), mimetype: media.mimetype || 'application/octet-stream' };
  }

  // sendMedia(id, { jid, buffer, mimetype, fileName, caption, kind }) → normalised sent message
  async function sendMedia(accountId, { jid, buffer, mimetype, fileName, caption, kind, quoted }) {
    const acc = requireOpen(accountId);
    if (!jid || !buffer?.length) throw Object.assign(new Error('jid and file required'), { status: 400 });
    const mt = mimetype || 'application/octet-stream';
    const k = kind || (/^image\/(jpeg|png|webp|gif)/.test(mt) ? 'image' : /^video\//.test(mt) ? 'video' : /^audio\//.test(mt) ? 'audio' : 'document');
    const content = k === 'image' ? { image: buffer, caption: caption || undefined, mimetype: mt === 'image/webp' || mt === 'image/gif' ? 'image/jpeg' : mt }
      : k === 'video' ? { video: buffer, caption: caption || undefined, mimetype: mt }
      : k === 'audio' ? { audio: buffer, mimetype: mt, ptt: false }
      : k === 'sticker' ? { sticker: buffer, mimetype: 'image/webp' }
      : { document: buffer, mimetype: mt, fileName: fileName || 'file', caption: caption || undefined };
    const opts = quoted?.id ? { quoted: rawFor(acc, { ...quoted, chatJid: quoted.chatJid || jid }) } : {};
    const sent = await acc.sock.sendMessage(jid, content, opts);
    keepSent(acc, sent);
    const n = await normMessage(acc, sent);
    return n || { id: sent?.key?.id, chatJid: jid, fromMe: true, text: caption || '', kind: k, status: 1, timestamp: Date.now() };
  }
  function keepSent(acc, sent) {
    if (sent?.key?.id) {
      acc.sent.set(sent.key.id, sent.message);
      if (acc.sent.size > 500) acc.sent.delete(acc.sent.keys().next().value);
      remember(acc, sent);
    }
  }

  // send(id, { jid, text, quoted? })  quoted = { id, chatJid, fromMe, senderJid, text, kind } → reply with a quote
  async function send(accountId, { jid, text, quoted }) {
    const acc = requireOpen(accountId);
    if (!jid || !text) throw Object.assign(new Error('jid and text required'), { status: 400 });
    const opts = quoted?.id ? { quoted: rawFor(acc, { ...quoted, chatJid: quoted.chatJid || jid }) } : {};
    const sent = await acc.sock.sendMessage(jid, { text }, opts);
    keepSent(acc, sent);
    const n = await normMessage(acc, sent);
    return n || { id: sent?.key?.id, chatJid: jid, fromMe: true, text, kind: 'text', status: 1, timestamp: Date.now(), quoted: quoted ? { id: quoted.id, text: quoted.text } : null };
  }

  // forward(id, { toJids, message: { id, chatJid, fromMe, senderJid, text, kind } }) → one sent message per target
  async function forward(accountId, { toJids, message }) {
    const acc = requireOpen(accountId);
    if (!Array.isArray(toJids) || !toJids.length || !message?.id) throw Object.assign(new Error('toJids and message required'), { status: 400 });
    const raw = rawFor(acc, message);
    const out = [];
    for (const jid of toJids) {
      const sent = await acc.sock.sendMessage(jid, { forward: raw, force: true });
      keepSent(acc, sent);
      const n = await normMessage(acc, sent);
      out.push(n || { id: sent?.key?.id, chatJid: jid, fromMe: true, text: message.text || '', kind: message.kind || 'text', status: 1, timestamp: Date.now(), forwarded: true });
    }
    return out;
  }

  async function read(accountId, { jid, ids, participantJid }) {
    const acc = requireOpen(accountId);
    const keys = (ids || []).map(id => ({ remoteJid: jid, id, fromMe: false, ...(participantJid ? { participant: participantJid } : {}) }));
    if (keys.length) await acc.sock.readMessages(keys);
    return { ok: true };
  }

  async function presence(accountId, { jid, type }) {
    const acc = requireOpen(accountId);
    await acc.sock.sendPresenceUpdate(type || 'available', jid);
    return { ok: true };
  }

  // Ask the phone for older messages (arrive later via a 'history' event with syncType ON_DEMAND).
  async function requestHistory(accountId, { jid, oldestId, oldestFromMe, oldestTimestamp, count = 50 }) {
    const acc = requireOpen(accountId);
    if (!acc.sock.fetchMessageHistory) throw new Error('History fetch not supported by this Baileys version');
    const key = { remoteJid: jid, id: oldestId, fromMe: !!oldestFromMe };
    const id = await acc.sock.fetchMessageHistory(count, key, Math.floor((oldestTimestamp || Date.now()) / 1000));
    return { ok: true, requestId: id };
  }

  // resolve({ phone }) → { jid, name, exists } so a chat can be started with a number that is not in the chat list yet
  async function resolve(accountId, { phone }) {
    const acc = requireOpen(accountId);
    const digits = String(phone || '').replace(/\D/g, '');
    if (digits.length < 7) throw Object.assign(new Error('Enter the full number with country code'), { status: 400 });
    let jid = digits + PN_SUFFIX, exists = null;
    try {
      const r = await acc.sock.onWhatsApp(digits);
      const hit = Array.isArray(r) ? r.find(x => x.exists) : null;
      exists = !!hit; if (hit?.jid) jid = await pnJid(acc, hit.jid) || jid;
    } catch (_) {}
    if (exists === false) throw Object.assign(new Error('That number is not on WhatsApp'), { status: 404 });
    return { jid, name: null, exists, isGroup: false };
  }

  async function profilePicture(accountId, jid) {
    const acc = requireOpen(accountId);
    try { return { url: await acc.sock.profilePictureUrl(jid, 'preview', 5000) }; } catch (_) { return { url: null }; }
  }

  async function shutdown() {
    for (const acc of accounts.values()) { acc.stopping = true; if (acc.timer) clearTimeout(acc.timer); try { acc.sock?.end?.(); } catch (_) {} }
  }

  // The router resumes accounts from disk; this only answers "is there WhatsApp auth state here?"
  function hasState(dir) { return fs.existsSync(path.join(dir, 'creds.json')); }

  return { platform: 'whatsapp', start, status, list, stop, logout, send, forward, read, presence, requestHistory, profilePicture, resolve, download, sendMedia, hasState, shutdown, AUTH_DIR, BROWSER };
}

module.exports = { createWhatsAppDriver, AUTH_DIR, BROWSER, describe, unwrap };
