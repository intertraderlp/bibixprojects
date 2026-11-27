// Background service worker — central place to talk to the Monday backend.
// Content scripts and the popup message this worker, which handles auth + the actual fetches.

const DEFAULT_API_BASE = 'http://localhost:3001';

async function getApiBase() {
  const { apiBase } = await chrome.storage.local.get('apiBase');
  return apiBase || DEFAULT_API_BASE;
}

async function getToken() {
  const { token } = await chrome.storage.local.get('token');
  return token || null;
}

async function apiFetch(path, opts = {}) {
  const base = await getApiBase();
  const token = await getToken();
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(base + path, {
    method: opts.method || 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
  if (!res.ok) {
    if (res.status === 401) await chrome.storage.local.remove(['token', 'user']);
    return { ok: false, status: res.status, error: data.error || res.statusText, data };
  }
  return { ok: true, status: res.status, data };
}

const handlers = {
  async login({ email, password, apiBase }) {
    if (apiBase) await chrome.storage.local.set({ apiBase });
    const res = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    if (res.ok && res.data.token) {
      await chrome.storage.local.set({ token: res.data.token, user: res.data.user });
    }
    return res;
  },
  async logout() {
    await chrome.storage.local.remove(['token', 'user']);
    return { ok: true };
  },
  async me() {
    const { user, token } = await chrome.storage.local.get(['user', 'token']);
    return { ok: true, data: { user: user || null, hasToken: !!token } };
  },
  async getSettings() {
    return apiFetch('/api/linkedin/settings');
  },
  async saveSettings(patch) {
    return apiFetch('/api/linkedin/settings', { method: 'PUT', body: patch });
  },
  async generateComment(body) {
    return apiFetch('/api/linkedin/generate-comment', { method: 'POST', body });
  },
  async generateReply(body) {
    return apiFetch('/api/linkedin/generate-reply', { method: 'POST', body });
  },
  async generateContribution(body) {
    return apiFetch('/api/linkedin/generate-contribution', { method: 'POST', body });
  },
  async getHistory({ limit = 20 } = {}) {
    return apiFetch(`/api/linkedin/history?limit=${limit}`);
  },
  async findEmail(body) {
    return apiFetch('/api/contacts/find-email', { method: 'POST', body });
  },
  async saveCandidate(body) {
    return apiFetch('/api/contacts/save-candidate', { method: 'POST', body });
  },
  async listContacts() {
    return apiFetch('/api/contacts');
  },
  async contactToCrm({ contactId }) {
    return apiFetch(`/api/contacts/${contactId}/to-crm`, { method: 'POST' });
  },
  async deleteContact({ contactId }) {
    return apiFetch(`/api/contacts/${contactId}`, { method: 'DELETE' });
  },
  async setApiBase({ apiBase }) {
    await chrome.storage.local.set({ apiBase });
    return { ok: true };
  },
  async getApiBase() {
    return { ok: true, data: { apiBase: await getApiBase() } };
  },

  // ── Outreach auto-connect ──────────────────────────────────────────────────
  async outreachSummary() {
    return apiFetch('/api/outreach/extension/summary');
  },
  async outreachStart({ limit } = {}) {
    if (outreachRunning) return { ok: false, error: 'Already running' };
    runOutreach(limit || 15); // fire and forget; progress streamed to popup
    return { ok: true };
  },
  async outreachStop() {
    outreachStopFlag = true;
    return { ok: true };
  },
  async outreachState() {
    const { outreachRunning: persisted } = await chrome.storage.local.get('outreachRunning');
    return { ok: true, data: { running: outreachRunning || !!persisted } };
  },
};

// ── Outreach runner ────────────────────────────────────────────────────────────
let outreachRunning = false;
let outreachStopFlag = false;

function outreachProgress(obj) {
  try { chrome.runtime.sendMessage(Object.assign({ type: 'bibix-outreach-progress' }, obj)); } catch (_) {}
}
function wwwUrl(u) {
  try {
    const url = new URL(u);
    if (/^linkedin\.com$/i.test(url.hostname)) url.hostname = 'www.linkedin.com';
    return url.toString();
  } catch (_) { return u; }
}
async function findOrCreateLinkedInTab() {
  const tabs = await chrome.tabs.query({ url: ['https://www.linkedin.com/*', 'https://*.linkedin.com/*'] });
  if (tabs && tabs.length) return tabs[0];
  return await chrome.tabs.create({ url: 'https://www.linkedin.com/feed/', active: true });
}
function waitForTabLoad(tabId, timeout = 25000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError || !tab) return resolve(false);
        if (tab.status === 'complete') return resolve(true);
        if (Date.now() - start > timeout) return resolve(false);
        setTimeout(check, 400);
      });
    };
    setTimeout(check, 600);
  });
}
function sendToTab(tabId, message, timeout = 90000) {
  return new Promise((resolve) => {
    let done = false;
    const to = setTimeout(() => { if (!done) { done = true; resolve({ ok: false, error: 'timeout' }); } }, timeout);
    try {
      chrome.tabs.sendMessage(tabId, message, (res) => {
        if (done) return; done = true; clearTimeout(to);
        if (chrome.runtime.lastError) return resolve({ ok: false, error: chrome.runtime.lastError.message });
        resolve(res || { ok: false, error: 'no response' });
      });
    } catch (e) { if (!done) { done = true; clearTimeout(to); resolve({ ok: false, error: e.message }); } }
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runOutreach(limit) {
  outreachRunning = true; outreachStopFlag = false;
  await chrome.storage.local.set({ outreachRunning: true });
  try {
    const res = await apiFetch('/api/outreach/extension/next?limit=' + limit);
    if (!res.ok) { outreachProgress({ error: true, text: res.error || 'Failed to load queue', done: true }); return res; }
    const items = (res.data && res.data.data) || [];
    if (!items.length) { outreachProgress({ done: true, text: 'Nothing queued to invite right now.' }); return { ok: true }; }

    const tab = await findOrCreateLinkedInTab();
    let sent = 0, failed = 0;
    for (let i = 0; i < items.length; i++) {
      if (outreachStopFlag) { outreachProgress({ done: true, text: `Stopped. Sent ${sent}/${items.length}.` }); break; }
      const it = items[i];
      outreachProgress({ text: `${i + 1}/${items.length} — opening ${it.name || 'profile'}…`, i: i + 1, total: items.length });
      try {
        await chrome.tabs.update(tab.id, { url: wwwUrl(it.linkedin_url), active: true });
        await waitForTabLoad(tab.id);
        await sleep(1500 + Math.random() * 1800); // let the profile actions render
        const r = await sendToTab(tab.id, { type: 'bibix-outreach-connect', note: it.note || '' });
        const ok = !!(r && r.ok);
        await apiFetch('/api/outreach/extension/report', {
          method: 'POST',
          body: { target_id: it.target_id, ok, status: ok ? 'invited' : (r && r.status) || 'failed', error: ok ? null : (r && r.error) || 'failed' },
        });
        if (ok) sent++; else failed++;
        outreachProgress({ text: `${ok ? '✓ invited' : '✗ skipped'} ${it.name || ''} — ${sent} sent${failed ? `, ${failed} skipped` : ''}`, i: i + 1, total: items.length });
      } catch (e) {
        failed++;
        try { await apiFetch('/api/outreach/extension/report', { method: 'POST', body: { target_id: it.target_id, ok: false, error: e.message } }); } catch (_) {}
      }
      if (i < items.length - 1 && !outreachStopFlag) {
        const min = (it.min_delay_sec || 45) * 1000, max = (it.max_delay_sec || 120) * 1000;
        const pause = min + Math.random() * Math.max(0, max - min);
        outreachProgress({ text: `Waiting ${Math.round(pause / 1000)}s before next…` });
        const until = Date.now() + pause;
        while (Date.now() < until) { if (outreachStopFlag) break; await sleep(1000); }
      }
    }
    if (!outreachStopFlag) outreachProgress({ done: true, text: `Done. ${sent} invitation${sent !== 1 ? 's' : ''} sent${failed ? `, ${failed} skipped` : ''}.` });
    return { ok: true, data: { sent, failed } };
  } catch (e) {
    outreachProgress({ error: true, done: true, text: 'Error: ' + e.message });
    return { ok: false, error: e.message };
  } finally {
    outreachRunning = false;
    await chrome.storage.local.set({ outreachRunning: false });
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const fn = handlers[msg && msg.type];
  if (!fn) { sendResponse({ ok: false, error: 'Unknown message type: ' + (msg && msg.type) }); return false; }
  Promise.resolve(fn(msg.payload || {}))
    .then(r => sendResponse(r))
    .catch(e => sendResponse({ ok: false, error: e.message }));
  return true; // keep channel open for async response
});
