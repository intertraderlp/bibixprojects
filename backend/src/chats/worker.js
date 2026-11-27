#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Chats worker — a separate, always-on Node process that owns the WhatsApp
// sockets (Baileys needs ONE long-lived process per linked device) and the
// Telegram MTProto clients.
//
// On LiteSpeed/lsnode hosting the web process can be killed, restarted or
// duplicated at any time, which would drop or duplicate the WhatsApp session.
// So the main app never holds a socket there; it talks to this process over
// localhost HTTP, and this process pushes events back to the main app's
// internal endpoint (/api/chats/internal/events). This process opens NO
// database — only the main app writes to monday.db (single-writer rule).
//
// Env:
//   CHATS_WORKER_PORT     port to listen on (127.0.0.1 only), default 3002
//   CHATS_INTERNAL_SECRET shared secret with the main app (required)
//   CHATS_APP_URL         main app base URL for event delivery, default http://127.0.0.1:3001
//   CHATS_AUTH_DIR        where auth state is stored (default backend/data/chats)
//   CHATS_WA_BROWSER      "Bibix,Chrome,1.0.0" — what the phone shows under Linked Devices
//
// Run:  node src/chats/worker.js    (see README.md for keeping it alive with cron)
// ─────────────────────────────────────────────────────────────────────────────
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const express = require('express');
const { createSessionManager } = require('./sessionManager');

const PORT = Number(process.env.CHATS_WORKER_PORT || 3002);
const SECRET = process.env.CHATS_INTERNAL_SECRET || '';
const APP_URL = (process.env.CHATS_APP_URL || 'http://127.0.0.1:' + (process.env.PORT || 3001)).replace(/\/$/, '');
const fetchFn = (typeof fetch === 'function') ? fetch : require('node-fetch');

if (!SECRET) { console.error('[chats-worker] CHATS_INTERNAL_SECRET is required'); process.exit(1); }

// ── Event delivery to the main app, with a retry queue so a web-process restart loses nothing ──
const queue = [];
let draining = false;
async function drain() {
  if (draining) return; draining = true;
  while (queue.length) {
    const ev = queue[0];
    try {
      const r = await fetchFn(APP_URL + '/api/chats/internal/events', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-chats-secret': SECRET },
        body: JSON.stringify(ev),
      });
      if (!r.ok && r.status !== 404) throw new Error('HTTP ' + r.status);
      queue.shift(); ev.attempts = 0;
    } catch (e) {
      ev.attempts = (ev.attempts || 0) + 1;
      if (ev.attempts > 200) { console.warn('[chats-worker] dropping event after 200 attempts', ev.type); queue.shift(); continue; }
      draining = false;
      setTimeout(drain, Math.min(30000, 500 * Math.pow(1.5, Math.min(ev.attempts, 12))));
      return;
    }
  }
  draining = false;
}
function onEvent(account, type, payload) {
  queue.push({ ...account, type, payload, at: Date.now() });
  if (queue.length > 5000) queue.splice(0, queue.length - 5000);
  drain();
}

const manager = createSessionManager({ onEvent });

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use((req, res, next) => {
  if (req.path === '/health') return next();
  if (req.headers['x-chats-secret'] !== SECRET) return res.status(401).json({ error: 'bad secret' });
  next();
});
const wrap = (fn) => async (req, res) => {
  try { res.json(await fn(req)); }
  catch (e) { res.status(e.status || 500).json({ error: e.message }); }
};

app.get('/health', (req, res) => res.json({ ok: true, pid: process.pid, accounts: manager.list().map(a => ({ id: a.accountId, status: a.status })), queued: queue.length }));
app.get('/accounts', wrap(() => manager.list()));
app.post('/accounts/:id/start', wrap((req) => manager.start({ ...req.body, accountId: req.params.id })));
app.get('/accounts/:id/status', wrap((req) => manager.status(req.params.id)));
app.post('/accounts/:id/stop', wrap((req) => manager.stop(req.params.id)));
app.post('/accounts/:id/logout', wrap((req) => manager.logout(req.params.id)));
app.post('/accounts/:id/send', wrap((req) => manager.send(req.params.id, req.body)));
app.post('/accounts/:id/forward', wrap((req) => manager.forward(req.params.id, req.body)));
app.post('/accounts/:id/read', wrap((req) => manager.read(req.params.id, req.body)));
app.post('/accounts/:id/presence', wrap((req) => manager.presence(req.params.id, req.body)));
app.post('/accounts/:id/history', wrap((req) => manager.requestHistory(req.params.id, req.body)));
app.get('/accounts/:id/picture', wrap((req) => manager.profilePicture(req.params.id, req.query.jid)));
app.post('/accounts/:id/resolve', wrap((req) => manager.resolve(req.params.id, req.body)));
// Media: binary in / binary out (metadata in headers so the body stays the raw file).
app.post('/accounts/:id/media', express.raw({ type: '*/*', limit: '80mb' }), async (req, res) => {
  try {
    const meta = JSON.parse(String(req.headers['x-chats-meta'] || '{}'));
    res.json(await manager.sendMedia(req.params.id, { ...meta, buffer: req.body }));
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});
app.post('/accounts/:id/download', async (req, res) => {
  try {
    const r = await manager.download(req.params.id, req.body);
    res.setHeader('Content-Type', r.mimetype || 'application/octet-stream'); res.send(r.buffer);
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

app.listen(PORT, '127.0.0.1', async () => {
  console.log(`[chats-worker] listening on 127.0.0.1:${PORT} pid=${process.pid} → events to ${APP_URL}`);
  const resumed = await manager.resumeAll();
  console.log(`[chats-worker] resumed ${resumed.length} account(s)`);
});

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await manager.shutdown(); process.exit(0); });
process.on('unhandledRejection', (e) => console.warn('[chats-worker] unhandledRejection', e?.message || e));
