const TONES = [
  { id: 'excited',              label: '🎉 Excited' },
  { id: 'happy',                label: '😊 Happy' },
  { id: 'gracious',             label: '🤗 Gracious' },
  { id: 'supportive',           label: '👏 Supportive' },
  { id: 'polite',               label: '🙏 Polite' },
  { id: 'witty',                label: '😉 Witty' },
  { id: 'comic',                label: '😄 Comic' },
  { id: 'respectfully_opposed', label: '😐 Respectfully Opposed' },
  { id: 'provocative',          label: '😈 Provocative' },
  { id: 'controversial',        label: '🔥 Controversial' },
  { id: 'disappointed',         label: '😞 Disappointed' },
  { id: 'sad',                  label: '😢 Sad' },
];
const LENGTH_LABELS = ['Brief', 'Medium', 'Long'];
const LENGTH_IDS = ['brief', 'medium', 'long'];

const $ = (sel) => document.querySelector(sel);

function send(type, payload) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type, payload }, (res) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message || 'Background not responding' });
          return;
        }
        resolve(res || { ok: false, error: 'No response from background (reload the extension)' });
      });
    } catch (e) {
      resolve({ ok: false, error: e.message });
    }
  });
}

function showSaved() {
  const el = $('#save-indicator');
  el.hidden = false;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.classList.remove('show'); el.hidden = true; }, 1200);
}

let currentSettings = null;
let saveTimer = null;
function queueSave(patch) {
  Object.assign(currentSettings, patch);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const res = await send('saveSettings', patch);
    if (res.ok) { currentSettings = res.data; showSaved(); }
  }, 350);
}

function setActiveTab(name) {
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p => p.hidden = p.dataset.panel !== name);
}

function populateTones() {
  const sel = $('#tone-select');
  sel.innerHTML = TONES.map(t => `<option value="${t.id}">${t.label}</option>`).join('');
}

function bindCommentTab() {
  const slider = $('#length-slider');
  slider.addEventListener('input', () => {
    const idx = Number(slider.value);
    $('#length-value').textContent = LENGTH_LABELS[idx];
    queueSave({ comment_length: LENGTH_IDS[idx] });
  });
  $('#tone-select').addEventListener('change', e => queueSave({ tone: e.target.value }));
  $('#opt-mention').addEventListener('change',     e => queueSave({ mention_author: e.target.checked ? 1 : 0 }));
  $('#opt-emojis').addEventListener('change',      e => queueSave({ use_emojis: e.target.checked ? 1 : 0 }));
  $('#opt-open-ended').addEventListener('change',  e => queueSave({ open_ended: e.target.checked ? 1 : 0 }));
  $('#opt-services').addEventListener('change', e => {
    queueSave({ offer_services: e.target.checked ? 1 : 0 });
    $('#industry-wrap').hidden = !e.target.checked;
  });
  $('#opt-industry').addEventListener('input', e => queueSave({ industry: e.target.value }));
  $('#enabled-toggle').addEventListener('change', e => queueSave({ enabled: e.target.checked ? 1 : 0 }));

  $('#btn-test-generate').addEventListener('click', async () => {
    const btn = $('#btn-test-generate');
    const out = $('#test-output');
    btn.disabled = true; btn.textContent = '…';
    out.hidden = false; out.textContent = 'Generating sample comment…';
    const sample = 'Just shipped our biggest product update yet — months of work from the team. Curious what you all think of where this is heading.';
    const res = await send('generateComment', {
      postText: sample, authorName: 'Jane Doe', postUrl: 'https://www.linkedin.com/feed/',
    });
    btn.disabled = false; btn.textContent = 'Test ✨';
    out.textContent = res.ok ? res.data.text : `Error: ${res.error || 'unknown'}`;
  });
}

function bindReplyTab() {
  $('#reply-short').addEventListener('change', e => queueSave({ reply_keep_short: e.target.checked ? 1 : 0 }));
  $('#reply-open').addEventListener('change',  e => queueSave({ reply_open_ended:  e.target.checked ? 1 : 0 }));
  $('#reply-ack').addEventListener('change',   e => queueSave({ reply_ack_only_own_posts: e.target.checked ? 1 : 0 }));
}

// ── Actions tab ─────────────────────────────────────────────────────────────
async function getActiveLinkedInTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const t = tabs && tabs[0];
      if (!t || !/^https?:\/\/(?:[a-z0-9-]+\.)*linkedin\.com/i.test(t.url || '')) {
        return resolve(null);
      }
      resolve(t);
    });
  });
}

async function refreshActionsStatus() {
  const el = $('#act-page-status');
  const btn = $('#act-connect-go');
  const t = await getActiveLinkedInTab();
  if (!t) {
    el.className = 'page-status err';
    el.textContent = 'Open a LinkedIn search or My Network page in this tab, then try again.';
    btn.disabled = true;
    return;
  }
  const url = t.url || '';
  const isConnectable = /\/(?:search|mynetwork)\//.test(url);
  if (!isConnectable) {
    el.className = 'page-status warn';
    el.textContent = 'Not on a search/network page. Open linkedin.com/search/results/people/ or /mynetwork/ first.';
    btn.disabled = true;
    return;
  }
  el.className = 'page-status ok';
  el.textContent = '✓ Ready on: ' + url.replace(/^https?:\/\//, '').slice(0, 60);
  btn.disabled = false;
}

function bindActionsTab() {
  $('#act-connect-go').addEventListener('click', async () => {
    const count = Math.max(1, Math.min(20, Number($('#act-connect-count').value) || 10));
    const t = await getActiveLinkedInTab();
    if (!t) { refreshActionsStatus(); return; }
    const prog = $('#act-progress');
    prog.hidden = false;
    prog.className = 'act-progress';
    prog.textContent = 'Starting…';
    $('#act-connect-go').disabled = true;
    chrome.tabs.sendMessage(t.id, { type: 'bibix-start-bulk-connect', count }, (res) => {
      if (chrome.runtime.lastError) {
        prog.className = 'act-progress err';
        prog.textContent = 'Reload the LinkedIn tab (Cmd+R) so the content script picks up this popup.';
        $('#act-connect-go').disabled = false;
      }
    });
  });
}

// Progress messages from the content script arrive here.
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== 'bibix-bulk-connect-progress') return;
  const prog = $('#act-progress');
  if (!prog) return;
  prog.hidden = false;
  prog.textContent = msg.text || '';
  if (msg.done) {
    prog.className = 'act-progress ok';
    $('#act-connect-go').disabled = false;
  } else if (msg.error) {
    prog.className = 'act-progress err';
    $('#act-connect-go').disabled = false;
  }
});

// ── Outreach tab ──────────────────────────────────────────────────────────
async function refreshOutreachSummary() {
  const el = $('#out-summary');
  if (el) el.textContent = 'Checking your campaigns…';
  const res = await send('outreachSummary');
  if (!res.ok) { if (el) el.textContent = res.error || 'Could not load campaigns.'; return; }
  const d = res.data || {};
  if (el) {
    el.textContent = d.ready > 0
      ? `${d.ready} prospect${d.ready === 1 ? '' : 's'} ready to invite across ${d.campaigns.length} active campaign${d.campaigns.length === 1 ? '' : 's'}.`
      : (d.campaigns.length
        ? 'No prospects left within today’s limits. Raise a limit or add prospects in Monday.'
        : 'No active campaigns. Set a campaign to “Active” in Monday → LinkedIn → Outreach.');
  }
  const st = await send('outreachState');
  setOutreachRunning(st.ok && st.data.running);
}

function setOutreachRunning(running) {
  const start = $('#out-start'), stop = $('#out-stop');
  if (start) { start.disabled = running; start.hidden = running; }
  if (stop) stop.hidden = !running;
}

function bindOutreachTab() {
  $('#out-start').addEventListener('click', async () => {
    const limit = Math.max(1, Math.min(50, Number($('#out-limit').value) || 15));
    const prog = $('#out-progress');
    prog.hidden = false; prog.className = 'act-progress'; prog.textContent = 'Starting…';
    setOutreachRunning(true);
    const res = await send('outreachStart', { limit });
    if (!res.ok) {
      prog.className = 'act-progress err';
      prog.textContent = res.error || 'Could not start.';
      setOutreachRunning(false);
    }
  });
  $('#out-stop').addEventListener('click', async () => {
    await send('outreachStop');
    const prog = $('#out-progress');
    if (prog) { prog.hidden = false; prog.textContent = 'Stopping…'; }
  });
}

// Progress from the background runner.
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== 'bibix-outreach-progress') return;
  const prog = $('#out-progress');
  if (!prog) return;
  prog.hidden = false;
  prog.textContent = msg.text || '';
  prog.className = 'act-progress' + (msg.error ? ' err' : msg.done ? ' ok' : '');
  if (msg.done) { setOutreachRunning(false); refreshOutreachSummary(); }
});

// ── Candidates tab ──────────────────────────────────────────────────────────
let candidatesCache = [];

function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function renderCandidates(filter) {
  const list = $('#cand-list');
  const q = (filter || '').toLowerCase().trim();
  const rows = q
    ? candidatesCache.filter((c) => {
        return (c.full_name || '').toLowerCase().includes(q)
          || (c.company || '').toLowerCase().includes(q)
          || (c.position || '').toLowerCase().includes(q);
      })
    : candidatesCache;
  if (rows.length === 0) {
    list.innerHTML = q
      ? '<div class="cand-empty">No matches.</div>'
      : '<div class="cand-empty">No candidates yet. Visit a LinkedIn profile and click the 💾 Save Contact button.</div>';
    return;
  }
  list.innerHTML = rows.map((c) => `
    <div class="cand-row" data-id="${c.id}">
      <div class="cand-main">
        <div class="cand-name">${escapeHtml(c.full_name || '—')}</div>
        <div class="cand-sub">${escapeHtml(c.position || '')}${c.position && c.company ? ' · ' : ''}${escapeHtml(c.company || '')}</div>
        ${c.email ? `<div class="cand-email">${escapeHtml(c.email)}</div>` : ''}
      </div>
      <div class="cand-actions">
        ${c.linkedin_url ? `<a href="${escapeHtml(c.linkedin_url)}" target="_blank" class="cand-link" title="Open profile">↗</a>` : ''}
        <button class="cand-del" data-id="${c.id}" title="Delete">✕</button>
      </div>
    </div>
  `).join('');
  list.querySelectorAll('.cand-del').forEach((b) => {
    b.addEventListener('click', async (e) => {
      const id = Number(e.target.getAttribute('data-id'));
      if (!confirm('Delete this candidate?')) return;
      await send('deleteContact', { contactId: id });
      candidatesCache = candidatesCache.filter((c) => c.id !== id);
      renderCandidates($('#cand-search').value);
    });
  });
}

async function loadCandidates() {
  $('#cand-list').innerHTML = '<div class="cand-empty">Loading…</div>';
  const res = await send('listContacts');
  if (res.ok) {
    candidatesCache = res.data || [];
    renderCandidates($('#cand-search').value);
  } else {
    $('#cand-list').innerHTML = `<div class="cand-empty">Error: ${escapeHtml(res.error || 'failed')}</div>`;
  }
}

function bindCandidatesTab() {
  $('#cand-search').addEventListener('input', (e) => renderCandidates(e.target.value));
  $('#cand-refresh').addEventListener('click', loadCandidates);
}

function bindAccountTab() {
  $('#acct-display-name').addEventListener('input',  e => queueSave({ display_name: e.target.value }));
  $('#acct-headline').addEventListener('input',      e => queueSave({ headline: e.target.value }));
  $('#acct-services-desc').addEventListener('input', e => queueSave({ services_description: e.target.value }));
  $('#btn-logout').addEventListener('click', async () => {
    await send('logout');
    location.reload();
  });
}

function applySettingsToUI(s) {
  currentSettings = s;
  const idx = LENGTH_IDS.indexOf(s.comment_length || 'brief');
  $('#length-slider').value = idx < 0 ? 0 : idx;
  $('#length-value').textContent = LENGTH_LABELS[idx < 0 ? 0 : idx];
  $('#tone-select').value = s.tone || 'gracious';
  $('#opt-mention').checked    = !!s.mention_author;
  $('#opt-emojis').checked     = !!s.use_emojis;
  $('#opt-open-ended').checked = !!s.open_ended;
  $('#opt-services').checked   = !!s.offer_services;
  $('#industry-wrap').hidden   = !s.offer_services;
  $('#opt-industry').value     = s.industry || '';
  $('#enabled-toggle').checked = !!s.enabled;

  $('#reply-short').checked = !!s.reply_keep_short;
  $('#reply-open').checked  = !!s.reply_open_ended;
  $('#reply-ack').checked   = !!s.reply_ack_only_own_posts;

  $('#acct-display-name').value  = s.display_name || '';
  $('#acct-headline').value      = s.headline || '';
  $('#acct-services-desc').value = s.services_description || '';
}

async function loadMainView() {
  $('#view-login').hidden = true;
  $('#view-main').hidden = false;
  const me = await send('me');
  if (me.ok && me.data.user) {
    $('#acct-name').textContent = me.data.user.name || me.data.user.email || '—';
    $('#acct-email').textContent = me.data.user.email || '';
    $('#acct-role').textContent = me.data.user.role || 'user';
  }
  const apiRes = await send('getApiBase');
  if (apiRes.ok && apiRes.data.apiBase) {
    $('#open-monday').href = apiRes.data.apiBase + '/marketing/linkedin';
  }
  const res = await send('getSettings');
  if (res.ok) applySettingsToUI(res.data);
  else if (res.status === 401) showLoginView();
}

function showLoginView() {
  $('#view-main').hidden = true;
  $('#view-login').hidden = false;
  chrome.storage.local.get('apiBase').then(({ apiBase }) => {
    $('#login-api').value = apiBase || 'http://localhost:3001';
  });
}

function bindLogin() {
  $('#btn-login').addEventListener('click', async () => {
    const apiBase = $('#login-api').value.trim().replace(/\/$/, '');
    const email = $('#login-email').value.trim();
    const password = $('#login-password').value;
    if (!email || !password) { $('#login-error').textContent = 'Email and password required.'; return; }
    $('#login-error').textContent = '';
    $('#btn-login').disabled = true; $('#btn-login').textContent = 'Signing in…';
    const res = await send('login', { email, password, apiBase });
    $('#btn-login').disabled = false; $('#btn-login').textContent = 'Sign in';
    if (res.ok) await loadMainView();
    else $('#login-error').textContent = res.error || 'Login failed';
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  populateTones();
  bindCommentTab();
  bindReplyTab();
  bindActionsTab();
  bindOutreachTab();
  bindCandidatesTab();
  bindAccountTab();
  bindLogin();

  document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => {
    setActiveTab(b.dataset.tab);
    if (b.dataset.tab === 'candidates') loadCandidates();
    if (b.dataset.tab === 'actions') refreshActionsStatus();
    if (b.dataset.tab === 'outreach') refreshOutreachSummary();
  }));
  setActiveTab('comment');

  const me = await send('me');
  if (me.ok && me.data.hasToken) {
    await loadMainView();
  } else {
    showLoginView();
  }
});
