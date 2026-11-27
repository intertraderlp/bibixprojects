// Bibix Idealista Scraper — popup UI.
const $ = (id) => document.getElementById(id);
const send = (msg) => new Promise((resolve) => chrome.runtime.sendMessage(msg, (r) => resolve(r || { ok: false, error: 'No response' })));

const els = {};
['apiBase','email','password','loginBtn','loginError','loginView','scrapeView','userLine',
 'boardSelect','refreshBoards','revealPhones','maxPages','startBtn','stopBtn','progress',
 'pStatus','pPages','pImported','pUpdated','jobError','logout','warn']
  .forEach(id => els[id] = $(id));

function show(view) {
  els.loginView.classList.toggle('hidden', view !== 'login');
  els.scrapeView.classList.toggle('hidden', view !== 'scrape');
}

// ── Auth ──────────────────────────────────────────────────────────────────────
async function refreshAuth() {
  const r = await send({ action: 'getAuth' });
  const a = r.data || {};
  if (els.apiBase && !els.apiBase.value) els.apiBase.value = a.apiBase || 'http://localhost:3001';
  if (a.loggedIn) {
    els.userLine.textContent = a.user ? (a.user.name || a.user.email) : 'Signed in';
    show('scrape');
    await loadBoards();
    await refreshJob();
  } else {
    els.userLine.textContent = 'Not signed in';
    show('login');
  }
}

els.loginBtn.addEventListener('click', async () => {
  els.loginError.textContent = '';
  els.loginBtn.disabled = true;
  els.loginBtn.textContent = 'Signing in…';
  const r = await send({ action: 'login', payload: {
    email: els.email.value.trim(),
    password: els.password.value,
    apiBase: els.apiBase.value.trim() || undefined,
  }});
  els.loginBtn.disabled = false;
  els.loginBtn.textContent = 'Sign in';
  if (!r.ok) { els.loginError.textContent = r.error || 'Login failed'; return; }
  await refreshAuth();
});

els.logout.addEventListener('click', async (e) => {
  e.preventDefault();
  await send({ action: 'logout' });
  await refreshAuth();
});

// ── Boards ──────────────────────────────────────────────────────────────────────
async function loadBoards() {
  els.boardSelect.innerHTML = '<option>Loading…</option>';
  const r = await send({ action: 'getBoards' });
  if (!r.ok) { els.boardSelect.innerHTML = '<option value="">Error loading boards</option>'; els.jobError.textContent = r.error || ''; return; }
  const boards = (r.data && r.data.boards) || [];
  const { lastBoard } = await chrome.storage.local.get('lastBoard');
  if (!boards.length) { els.boardSelect.innerHTML = '<option value="">No boards found</option>'; return; }
  els.boardSelect.innerHTML = boards.map(b =>
    `<option value="${b.id}" ${b.id === lastBoard ? 'selected' : ''}>${b.icon} ${b.name} — ${b.workspace}</option>`
  ).join('');
}
els.refreshBoards.addEventListener('click', loadBoards);
els.boardSelect.addEventListener('change', () => chrome.storage.local.set({ lastBoard: els.boardSelect.value }));

// ── Scrape ──────────────────────────────────────────────────────────────────────
els.startBtn.addEventListener('click', async () => {
  els.jobError.textContent = '';
  const boardId = els.boardSelect.value;
  if (!boardId) { els.jobError.textContent = 'Pick a board'; return; }
  await chrome.storage.local.set({ lastBoard: boardId });
  const r = await send({ action: 'startScrape', payload: {
    boardId,
    revealPhones: els.revealPhones.checked,
    maxPages: parseInt(els.maxPages.value, 10) || 0,
  }});
  if (!r.ok) { els.jobError.textContent = r.error || 'Could not start'; return; }
  await refreshJob();
});

els.stopBtn.addEventListener('click', async () => {
  await send({ action: 'stopScrape' });
  await refreshJob();
});

function renderJob(job) {
  const running = job && job.active;
  els.startBtn.classList.toggle('hidden', running);
  els.stopBtn.classList.toggle('hidden', !running);
  els.progress.classList.toggle('hidden', !job);
  if (!job) return;
  els.pStatus.textContent = job.status || '—';
  els.pPages.textContent = job.pagesDone || 0;
  els.pImported.textContent = job.imported || 0;
  els.pUpdated.textContent = job.updated || 0;
  els.jobError.textContent = job.lastError || '';
  if (job.status === 'done' && (job.created_columns || []).length) {
    els.jobError.textContent = 'Added columns: ' + job.created_columns.join(', ');
  }
}

async function refreshJob() {
  const r = await send({ action: 'getJob' });
  renderJob(r.data && r.data.job);
}

// Live updates while the popup is open.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'JOB_UPDATE') renderJob(msg.job);
});

// Warn if the active tab isn't an idealista results page.
(async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const ok = tab && /^https:\/\/www\.idealista\.com\//.test(tab.url || '');
    els.warn.textContent = ok ? '' : 'Open an idealista results page in this tab.';
    els.startBtn.disabled = !ok;
  } catch (_) {}
})();

refreshAuth();
