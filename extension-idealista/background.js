// Bibix Idealista Scraper — background service worker.
// Owns auth + API calls and orchestrates a multi-page scrape that survives the
// full-page navigations idealista does between result pages. The content script
// scrapes one page and reports back; this worker ingests the rows, then drives
// the tab to the next page until there are none left (or a block is detected).

const DEFAULT_API_BASE = 'http://localhost:3001';

async function getApiBase() {
  const { apiBase } = await chrome.storage.local.get('apiBase');
  // Strip trailing slashes so "https://host/" + "/api/..." doesn't become "host//api/...".
  return (apiBase || DEFAULT_API_BASE).replace(/\/+$/, '');
}
async function getToken() {
  const { token } = await chrome.storage.local.get('token');
  return token || null;
}

async function apiFetch(path, opts = {}) {
  const base = await getApiBase();
  const token = await getToken();
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(base + path, {
    method: opts.method || 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) {
    const msg = (data && (data.error || data.message)) || ('HTTP ' + res.status);
    throw new Error(msg);
  }
  return data;
}

// ── Job state (persisted so the popup can reopen mid-run) ──────────────────────
async function getJob() {
  const { job } = await chrome.storage.local.get('job');
  return job || null;
}
async function setJob(patch) {
  const cur = (await getJob()) || {};
  const job = { ...cur, ...patch };
  await chrome.storage.local.set({ job });
  // Best-effort broadcast to an open popup.
  chrome.runtime.sendMessage({ type: 'JOB_UPDATE', job }).catch(() => {});
  return job;
}
async function clearActive() {
  const job = await getJob();
  if (job) await chrome.storage.local.set({ job: { ...job, active: false } });
}

// ── Message router ─────────────────────────────────────────────────────────────
const handlers = {
  async login({ email, password, apiBase }) {
    if (apiBase) await chrome.storage.local.set({ apiBase });
    const data = await apiFetch('/api/auth/login', { method: 'POST', body: { email, password } });
    if (data && data.token) {
      await chrome.storage.local.set({ token: data.token, user: data.user || null });
    }
    return data;
  },

  async logout() {
    await chrome.storage.local.remove(['token', 'user']);
    return { ok: true };
  },

  async getAuth() {
    const token = await getToken();
    const { user } = await chrome.storage.local.get('user');
    return { loggedIn: !!token, user: user || null, apiBase: await getApiBase() };
  },

  async setApiBase({ apiBase }) {
    await chrome.storage.local.set({ apiBase });
    return { ok: true, apiBase };
  },

  // Flattened list of boards the user can reach, grouped by workspace.
  async getBoards() {
    const workspaces = await apiFetch('/api/workspaces');
    const out = [];
    for (const ws of workspaces || []) {
      let boards = [];
      try { boards = await apiFetch('/api/boards/workspace/' + ws.id); } catch (_) {}
      for (const b of boards || []) {
        out.push({ id: b.id, name: b.name, workspace: ws.name, icon: b.icon || '📋' });
      }
    }
    try {
      const shared = await apiFetch('/api/boards/shared-with-me');
      for (const b of shared || []) {
        if (!out.some(o => o.id === b.id)) {
          out.push({ id: b.id, name: b.name, workspace: (b.workspace_name || 'Shared') + ' (shared)', icon: b.icon || '📋' });
        }
      }
    } catch (_) {}
    return { boards: out };
  },

  // Start a scrape of the current idealista tab.
  async startScrape({ boardId, revealPhones, maxPages }) {
    const token = await getToken();
    if (!token) throw new Error('Not logged in');
    if (!boardId) throw new Error('Pick a board first');

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !/^https:\/\/www\.idealista\.com\//.test(tab.url || '')) {
      throw new Error('Open an idealista.com search results page first');
    }

    await setJob({
      active: true, status: 'running', boardId,
      revealPhones: !!revealPhones,
      maxPages: maxPages && maxPages > 0 ? maxPages : 0, // 0 = all pages
      tabId: tab.id,
      pagesDone: 0, imported: 0, updated: 0, skipped: 0,
      lastError: null, startedAt: Date.now(),
    });
    kickTab(tab.id);
    return { ok: true };
  },

  async stopScrape() {
    await setJob({ active: false, status: 'stopped' });
    return { ok: true };
  },

  async getJob() {
    return { job: await getJob() };
  },

  // From content script: a page has been scraped.
  async pageDone({ rows, nextUrl, page }, sender) {
    const job = await getJob();
    if (!job || !job.active) return { ok: false, stopped: true };

    let result = { imported: 0, updated: 0, skipped: 0 };
    if (rows && rows.length) {
      try {
        result = await apiFetch('/api/scraper/ingest', {
          method: 'POST',
          body: { board_id: job.boardId, source: 'idealista', rows },
        });
      } catch (e) {
        await setJob({ active: false, status: 'error', lastError: e.message });
        return { ok: false, error: e.message };
      }
    }

    const pagesDone = (job.pagesDone || 0) + 1;
    const createdCols = Array.from(new Set([...(job.created_columns || []), ...((result.created_columns) || [])]));
    const updated = await setJob({
      pagesDone,
      imported: (job.imported || 0) + (result.imported || 0),
      updated: (job.updated || 0) + (result.updated || 0),
      skipped: (job.skipped || 0) + (result.skipped || 0),
      created_columns: createdCols,
    });

    const reachedMax = job.maxPages && pagesDone >= job.maxPages;
    if (nextUrl && !reachedMax) {
      // Navigate the tab; content script will re-announce itself on load.
      const tabId = (sender && sender.tab && sender.tab.id) || job.tabId;
      try { await chrome.tabs.update(tabId, { url: nextUrl }); } catch (_) {}
      return { ok: true, continue: true };
    }

    await setJob({ active: false, status: 'done' });
    return { ok: true, continue: false, done: true, job: updated };
  },

  // Content script hit a CAPTCHA / DataDome wall.
  async blocked(_payload) {
    await setJob({ active: false, status: 'blocked', lastError: 'Blocked by idealista (CAPTCHA). Solve it in the tab, then start again.' });
    return { ok: true };
  },
};

// Tell the content script in a tab to scrape the page it's on. If the content
// script isn't there (e.g. the extension was reloaded after the tab loaded),
// inject it on the fly and retry — so Start works without reloading the page.
async function kickTab(tabId) {
  const job = await getJob();
  if (!job || !job.active) return;
  const msg = { type: 'SCRAPE_PAGE', revealPhones: job.revealPhones };
  try {
    await chrome.tabs.sendMessage(tabId, msg);
  } catch (_) {
    try {
      await chrome.scripting.insertCSS({ target: { tabId }, files: ['content/content.css'] }).catch(() => {});
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content/content.js'] });
      // Give the freshly-injected script a tick to register its listener.
      await new Promise(r => setTimeout(r, 300));
      await chrome.tabs.sendMessage(tabId, msg);
    } catch (e2) {
      await setJob({ active: false, status: 'error', lastError: 'Could not reach the page — reload the idealista tab, then Start.' });
    }
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Content script announces it loaded on an idealista page.
  if (msg && msg.type === 'CONTENT_READY') {
    (async () => {
      const job = await getJob();
      if (job && job.active && sender.tab && sender.tab.id === job.tabId) {
        kickTab(sender.tab.id);
      }
    })();
    return; // no response needed
  }

  const fn = handlers[msg && msg.action] || (msg && msg.type === 'PAGE_DONE' ? handlers.pageDone
            : msg && msg.type === 'BLOCKED' ? handlers.blocked : null);
  if (!fn) return;
  Promise.resolve(fn(msg.payload || msg, sender))
    .then(data => sendResponse({ ok: true, data }))
    .catch(err => sendResponse({ ok: false, error: err.message }));
  return true; // async
});
