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
