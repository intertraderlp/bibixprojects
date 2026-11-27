// ─────────────────────────────────────────────────────────────────────────────
// Chats — the main app's handle on the session manager.
//
// Two modes, same API:
//   • in-process (default, dev):  CHATS_WORKER_URL unset → Baileys runs inside
//     the web process and events are delivered directly to `handleEvent`.
//   • worker (production):        CHATS_WORKER_URL=http://127.0.0.1:3002 →
//     every call is an HTTP request to worker.js, which posts events back to
//     POST /api/chats/internal/events (see routes/chats.js).
// ─────────────────────────────────────────────────────────────────────────────
const WORKER_URL = (process.env.CHATS_WORKER_URL || '').replace(/\/$/, '');
const SECRET = process.env.CHATS_INTERNAL_SECRET || '';
const fetchFn = (typeof fetch === 'function') ? fetch : require('node-fetch');

let instance = null;

function createClient(handleEvent) {
  if (instance) return instance;

  if (!WORKER_URL) {
    const { createSessionManager } = require('./sessionManager');
    const manager = createSessionManager({ onEvent: (account, type, payload) => handleEvent({ ...account, type, payload }) });
    instance = {
      mode: 'in-process',
      start: (o) => manager.start(o),
      status: (id) => Promise.resolve(manager.status(id)),
      list: () => Promise.resolve(manager.list()),
      stop: (id) => manager.stop(id),
      logout: (id) => manager.logout(id),
      send: (id, b) => manager.send(id, b),
      forward: (id, b) => manager.forward(id, b),
      read: (id, b) => manager.read(id, b),
      presence: (id, b) => manager.presence(id, b),
      requestHistory: (id, b) => manager.requestHistory(id, b),
      profilePicture: (id, jid) => manager.profilePicture(id, jid),
      resolve: (id, b) => manager.resolve(id, b),
      download: (id, b) => manager.download(id, b),
      sendMedia: (id, b) => manager.sendMedia(id, b),
      resumeAll: () => manager.resumeAll(),
      health: () => Promise.resolve({ ok: true, mode: 'in-process', accounts: manager.list().length }),
    };
    return instance;
  }

  async function call(method, p, body) {
    let r;
    try {
      r = await fetchFn(WORKER_URL + p, {
        method, headers: { 'Content-Type': 'application/json', 'x-chats-secret': SECRET },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw Object.assign(new Error('Chats worker is not reachable (' + e.message + '). Is `node src/chats/worker.js` running?'), { status: 503 });
    }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(data.error || 'worker HTTP ' + r.status), { status: r.status });
    return data;
  }
  instance = {
    mode: 'worker',
    start: (o) => call('POST', `/accounts/${encodeURIComponent(o.accountId)}/start`, o),
    status: (id) => call('GET', `/accounts/${encodeURIComponent(id)}/status`),
    list: () => call('GET', '/accounts'),
    stop: (id) => call('POST', `/accounts/${encodeURIComponent(id)}/stop`),
    logout: (id) => call('POST', `/accounts/${encodeURIComponent(id)}/logout`),
    send: (id, b) => call('POST', `/accounts/${encodeURIComponent(id)}/send`, b),
    forward: (id, b) => call('POST', `/accounts/${encodeURIComponent(id)}/forward`, b),
    read: (id, b) => call('POST', `/accounts/${encodeURIComponent(id)}/read`, b),
    presence: (id, b) => call('POST', `/accounts/${encodeURIComponent(id)}/presence`, b),
    requestHistory: (id, b) => call('POST', `/accounts/${encodeURIComponent(id)}/history`, b),
    profilePicture: (id, jid) => call('GET', `/accounts/${encodeURIComponent(id)}/picture?jid=${encodeURIComponent(jid)}`),
    resolve: (id, b) => call('POST', `/accounts/${encodeURIComponent(id)}/resolve`, b),
    download: async (id, b) => {
      const r = await fetchFn(WORKER_URL + `/accounts/${encodeURIComponent(id)}/download`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-chats-secret': SECRET }, body: JSON.stringify(b) });
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw Object.assign(new Error(d.error || 'worker HTTP ' + r.status), { status: r.status }); }
      return { buffer: Buffer.from(await r.arrayBuffer()), mimetype: r.headers.get('content-type') || 'application/octet-stream' };
    },
    sendMedia: async (id, { buffer, ...meta }) => {
      const r = await fetchFn(WORKER_URL + `/accounts/${encodeURIComponent(id)}/media`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'x-chats-secret': SECRET, 'x-chats-meta': JSON.stringify(meta) }, body: buffer });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error(d.error || 'worker HTTP ' + r.status), { status: r.status });
      return d;
    },
    resumeAll: () => Promise.resolve([]),   // the worker resumes its own sessions at boot
    health: () => call('GET', '/health').catch(e => ({ ok: false, mode: 'worker', error: e.message })),
  };
  return instance;
}

module.exports = { createClient, WORKER_URL, SECRET };
