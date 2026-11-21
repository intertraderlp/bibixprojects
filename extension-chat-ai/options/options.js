// Bibix Chat AI — options page.
const $ = (s, r = document) => r.querySelector(s);
const send = (msg) => chrome.runtime.sendMessage(msg).then(r => { if (!r?.ok) throw new Error(r?.error || 'No response'); return r.data; });

let settings;

function renderLangs() {
  $('#langs').innerHTML = BX_LANGUAGES.map(l => `<option value="${l}">`).join('');
}

function renderProviders() {
  const sel = $('#provider');
  sel.innerHTML = Object.entries(BX_PROVIDERS).map(([id, p]) => `<option value="${id}">${p.name}${p.free ? ' · free tier' : ''}</option>`).join('');
  sel.value = settings.provider;
  const host = $('#providers');
  host.innerHTML = '';
  for (const [id, p] of Object.entries(BX_PROVIDERS)) {
    const cfg = bxProviderConfig(settings, id);
    const card = document.createElement('div');
    card.className = 'pcard' + (id === settings.provider ? ' active' : '');
    card.dataset.id = id;
    card.innerHTML = `
      <div class="head"><h3>${p.name}</h3><span class="badge ${p.free ? '' : 'paid'}">${p.free ? 'free tier' : 'paid'}</span>
        ${p.keyUrl ? `<a href="${p.keyUrl}" target="_blank" rel="noopener">get key ↗</a>` : ''}</div>
      ${p.note ? `<p class="note">${p.note}</p>` : ''}
      ${p.noKey ? '' : `<label>API key <input type="password" class="key" value="${esc(cfg.apiKey)}" placeholder="sk-…" autocomplete="off" /></label>`}
      <label>Model <div class="row"><input class="model" list="models-${id}" value="${esc(cfg.model)}" placeholder="${esc(p.defaultModel)}" /><button class="fetch" title="Fetch available models">↻</button></div>
        <datalist id="models-${id}"></datalist></label>
      ${(p.editableUrl || p.noKey) ? `<label>Base URL <input class="url" value="${esc(cfg.baseUrl)}" placeholder="https://host/v1" /></label>` : ''}
      <div class="row" style="align-items:flex-end"><button class="test">Test translation</button><button class="use" ${id === settings.provider ? 'disabled' : ''}>Use this provider</button></div>
      <div class="result"></div>`;
    host.appendChild(card);
  }
}
function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

function collect() {
  const providers = {};
  for (const card of document.querySelectorAll('.pcard')) {
    const id = card.dataset.id;
    providers[id] = {
      apiKey: $('.key', card)?.value.trim() || '',
      model: $('.model', card).value.trim(),
      baseUrl: $('.url', card)?.value.trim() || '',
    };
  }
  return {
    enabled: $('#enabled').checked,
    provider: $('#provider').value,
    providers,
    myLanguage: $('#myLanguage').value.trim() || 'English',
    targetLanguage: $('#targetLanguage').value.trim() || 'English',
    autoIncoming: $('#autoIncoming').value === '1',
    initialIncoming: Math.max(0, parseInt($('#initialIncoming').value, 10) || 0),
    showOriginalOutgoing: $('#showOriginalOutgoing').value === '1',
    enterTranslates: $('#enterTranslates').value === '1',
    style: $('#style').value.trim(),
  };
}

async function save(silent) {
  const patch = collect();
  // Custom / local endpoints may need a host permission the manifest doesn't list.
  for (const id of ['custom', 'ollama']) {
    const url = patch.providers[id]?.baseUrl;
    if (!url) continue;
    try {
      const origin = new URL(url).origin + '/*';
      const has = await chrome.permissions.contains({ origins: [origin] });
      if (!has && id === patch.provider) await chrome.permissions.request({ origins: [origin] });
    } catch (_) {}
  }
  settings = await send({ type: 'SET_SETTINGS', patch });
  if (!silent) flash('Saved ✓');
  document.querySelectorAll('.pcard').forEach(c => { c.classList.toggle('active', c.dataset.id === settings.provider); $('.use', c).disabled = c.dataset.id === settings.provider; });
}
function flash(msg) { $('#status').textContent = msg; setTimeout(() => { if ($('#status').textContent === msg) $('#status').textContent = ''; }, 2500); }

async function init() {
  settings = await send({ type: 'GET_SETTINGS' });
  renderLangs();
  $('#enabled').checked = settings.enabled;
  $('#myLanguage').value = settings.myLanguage;
  $('#targetLanguage').value = settings.targetLanguage;
  $('#autoIncoming').value = settings.autoIncoming ? '1' : '0';
  $('#initialIncoming').value = settings.initialIncoming;
  $('#showOriginalOutgoing').value = settings.showOriginalOutgoing ? '1' : '0';
  $('#enterTranslates').value = settings.enterTranslates === false ? '0' : '1';
  $('#style').value = settings.style || '';
  renderProviders();

  $('#save').addEventListener('click', () => save(false).catch(e => flash('Error: ' + e.message)));
  $('#provider').addEventListener('change', () => save(true).catch(e => flash('Error: ' + e.message)));

  $('#providers').addEventListener('click', async (e) => {
    const btn = e.target.closest('button'); if (!btn) return;
    const card = btn.closest('.pcard'); const id = card.dataset.id; const out = $('.result', card);
    out.className = 'result';
    if (btn.classList.contains('use')) { $('#provider').value = id; await save(true); flash(`Now using ${BX_PROVIDERS[id].name}`); return; }
    btn.disabled = true;
    try {
      await save(true); // keys must be stored before the worker can use them
      if (btn.classList.contains('fetch')) {
        const { models } = await send({ type: 'LIST_MODELS', providerId: id });
        $(`#models-${id}`).innerHTML = models.map(m => `<option value="${esc(m)}">`).join('');
        out.textContent = `${models.length} models loaded — click the Model field to pick one.`; out.classList.add('ok');
      } else if (btn.classList.contains('test')) {
        out.textContent = 'Testing…';
        const { sample } = await send({ type: 'TEST_PROVIDER', providerId: id });
        out.textContent = `OK → “${sample}”`; out.classList.add('ok');
      }
    } catch (err) { out.textContent = 'Error: ' + err.message; out.classList.add('err'); }
    finally { btn.disabled = false; }
  });
}
init().catch(e => flash('Error: ' + e.message));

// ── Quick answers manager ──────────────────────────────────────────────────────
let qa = [], qaSel = null;
const uid = () => Math.random().toString(36).slice(2, 10);
const qaSave = () => send({ type: 'SET_QA', groups: qa }).catch(e => flash('Error: ' + e.message));

function qaRender() {
  if (!qa.find(g => g.id === qaSel)) qaSel = qa[0]?.id || null;
  const gl = $('.qa-glist');
  gl.innerHTML = qa.map(g => `<div class="qa-g ${g.id === qaSel ? 'active' : ''}" data-id="${g.id}">
      <span class="n">${esc(g.name)}</span><span class="cnt">${g.items.length}</span>
      <span class="act ren" title="Rename">✎</span><span class="act rm" title="Delete group">✕</span></div>`).join('') || '<div class="qa-empty">No groups yet.</div>';
  const g = qa.find(x => x.id === qaSel);
  const il = $('.qa-ilist');
  $('#qa-add-item').disabled = !g;
  il.innerHTML = !g ? '' : (g.items.map(it => `<div class="qa-i" data-id="${it.id}">
      <input class="t" value="${esc(it.title)}" placeholder="Short title (shown in the list)" />
      <button class="del" title="Delete answer">✕</button>
      <textarea placeholder="The answer, in your language…">${esc(it.text)}</textarea></div>`).join('') || '<div class="qa-empty">No answers in this group yet — click “+ Answer”.</div>');
}
async function qaInit() {
  qa = await send({ type: 'GET_QA' });
  qaRender();
  $('#qa-add-group').onclick = () => { const name = (prompt('Group name:') || '').trim(); if (!name) return; const g = { id: uid(), name, items: [] }; qa.push(g); qaSel = g.id; qaSave(); qaRender(); };
  $('#qa-add-item').onclick = () => { const g = qa.find(x => x.id === qaSel); if (!g) return; g.items.push({ id: uid(), title: '', text: '' }); qaSave(); qaRender(); $('.qa-i:last-child input', $('.qa-ilist'))?.focus(); };
  $('.qa-glist').addEventListener('click', (e) => {
    const row = e.target.closest('.qa-g'); if (!row) return; const g = qa.find(x => x.id === row.dataset.id);
    if (e.target.classList.contains('ren')) { const name = (prompt('Group name:', g.name) || '').trim(); if (name) { g.name = name; qaSave(); } }
    else if (e.target.classList.contains('rm')) { if (confirm(`Delete group “${g.name}” and its ${g.items.length} answers?`)) { qa = qa.filter(x => x !== g); qaSave(); } }
    else qaSel = g.id;
    qaRender();
  });
  $('.qa-ilist').addEventListener('input', (e) => {
    const row = e.target.closest('.qa-i'); if (!row) return; const g = qa.find(x => x.id === qaSel); const it = g?.items.find(i => i.id === row.dataset.id); if (!it) return;
    if (e.target.classList.contains('t')) it.title = e.target.value; else if (e.target.tagName === 'TEXTAREA') it.text = e.target.value;
    clearTimeout(qaInit._t); qaInit._t = setTimeout(() => { qaSave(); $(`.qa-g[data-id="${g.id}"] .cnt`).textContent = g.items.length; }, 400);
  });
  $('.qa-ilist').addEventListener('click', (e) => {
    if (!e.target.classList.contains('del')) return;
    const row = e.target.closest('.qa-i'); const g = qa.find(x => x.id === qaSel);
    g.items = g.items.filter(i => i.id !== row.dataset.id); qaSave(); qaRender();
  });
  $('#qa-export').onclick = () => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(qa, null, 2)], { type: 'application/json' }));
    a.download = 'bibix-quick-answers.json'; a.click(); URL.revokeObjectURL(a.href);
  };
  $('#qa-import').onclick = () => $('#qa-file').click();
  $('#qa-file').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!Array.isArray(data) || !data.every(g => g && typeof g.name === 'string' && Array.isArray(g.items))) throw new Error('Expected an array of { name, items:[{ title, text }] }');
      for (const g of data) { g.id = g.id || uid(); for (const it of g.items) { it.id = it.id || uid(); it.title = String(it.title || ''); it.text = String(it.text || ''); } }
      const mode = qa.length ? confirm('OK = add to existing groups, Cancel = replace everything') : true;
      qa = mode ? [...qa, ...data] : data; qaSave(); qaRender(); flash('Imported ✓');
    } catch (err) { flash('Import failed: ' + err.message); }
    e.target.value = '';
  };
}
qaInit().catch(e => flash('Error: ' + e.message));
chrome.runtime.onMessage.addListener((msg) => { if (msg?.type === 'OPTIONS_GOTO' && msg.section) document.getElementById(msg.section)?.scrollIntoView({ behavior: 'smooth' }); });
