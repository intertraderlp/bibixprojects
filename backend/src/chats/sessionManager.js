// ─────────────────────────────────────────────────────────────────────────────
// Chats — session manager = router over the platform drivers.
//   whatsapp.js  Baileys linked device      (platform 'whatsapp')
//   telegram.js  teleproto/MTProto account  (platform 'telegram')
// Every driver speaks the same API and emits the same normalised events, so
// routes/chats.js, worker.js and client.js never care which platform it is.
// Auth state for every account lives under <AUTH_DIR>/<userId>/<accountId>/
// with a meta.json naming the platform — that is how resumeAll() routes.
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const { createWhatsAppDriver, AUTH_DIR, BROWSER } = require('./whatsapp');
const { createTelegramDriver } = require('./telegram');

function createSessionManager({ onEvent }) {
  const drivers = {
    whatsapp: createWhatsAppDriver({ onEvent }),
    telegram: createTelegramDriver({ onEvent, authDir: AUTH_DIR }),
  };
  const platformOf = new Map(); // accountId → platform

  function driverFor(accountId, platform) {
    const p = platform || platformOf.get(String(accountId)) || metaPlatform(accountId) || 'whatsapp';
    const d = drivers[p];
    if (!d) throw Object.assign(new Error(`Platform ${p} is not supported`), { status: 400 });
    return d;
  }
  function metaPlatform(accountId) {
    // slow path: look for the account's meta.json on disk
    try {
      for (const u of fs.readdirSync(AUTH_DIR)) {
        const f = path.join(AUTH_DIR, u, String(accountId), 'meta.json');
        if (fs.existsSync(f)) { const p = JSON.parse(fs.readFileSync(f, 'utf8')).platform || 'whatsapp'; platformOf.set(String(accountId), p); return p; }
      }
    } catch (_) {}
    return null;
  }

  async function start(opts) {
    const platform = (opts.platform || platformOf.get(String(opts.accountId)) || 'whatsapp').toLowerCase();
    const d = driverFor(opts.accountId, platform);
    platformOf.set(String(opts.accountId), platform);
    return d.start({ ...opts, platform });
  }
  const route = (name) => (accountId, ...rest) => driverFor(accountId)[name](accountId, ...rest);

  function status(accountId) { const d = driverFor(accountId); return d.status(accountId); }
  function list() { return Object.values(drivers).flatMap(d => d.list()); }

  async function resumeAll() {
    const out = [];
    let users = [];
    try { users = fs.readdirSync(AUTH_DIR); } catch (_) { return out; }
    for (const u of users) {
      let ids = [];
      try { ids = fs.readdirSync(path.join(AUTH_DIR, u)); } catch (_) { continue; }
      for (const id of ids) {
        const dir = path.join(AUTH_DIR, u, id);
        let meta = {};
        try { meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')); } catch (_) {}
        const platform = meta.platform || 'whatsapp';
        const d = drivers[platform]; if (!d || !d.hasState(dir)) continue;
        platformOf.set(String(id), platform);
        try { out.push(await (d.resume ? d.resume({ accountId: id, userId: u }) : d.start({ accountId: id, userId: u, platform }))); }
        catch (e) { console.warn('[chats] resume failed', platform, id, e.message); }
      }
    }
    return out;
  }
  async function shutdown() { for (const d of Object.values(drivers)) await d.shutdown(); }

  return {
    start, status, list, resumeAll, shutdown,
    stop: route('stop'), logout: route('logout'), send: route('send'), forward: route('forward'), read: route('read'),
    presence: route('presence'), requestHistory: route('requestHistory'), profilePicture: route('profilePicture'),
    platforms: Object.keys(drivers), AUTH_DIR, BROWSER,
  };
}

module.exports = { createSessionManager, AUTH_DIR, BROWSER };
