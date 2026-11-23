// Bibix Chats — PWA client. WhatsApp (linked device via the backend) + AI translation.
// The translation UX mirrors the Chrome extension (extension-chat-ai/content/content.js):
// "Send in <language>" per chat with memory + auto-detection, Translate & send / Translate (review) /
// Send as typed, incoming translated inline, 🌐 on any bubble, "you wrote" under sent bubbles, Quick answers.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const isPhone = () => window.matchMedia('(max-width: 767px)').matches;

  // ── State ──────────────────────────────────────────────────────────────────
  const S = {
    token: null, user: null, settings: null, meta: null, accounts: [], account: null,
    chats: new Map(), jid: null, messages: [], oldestTs: null, qa: null, sse: null,
    enabled: localStorage.getItem('chats_enabled') !== '0', lastDraft: null, tab: 0, search: '',
    trState: new Map(), hiddenTr: new Set(), linkPoll: null, typingTimer: null, pushReady: false,
  };

  // ── API ────────────────────────────────────────────────────────────────────
  async function api(path, opts = {}) {
    const r = await fetch('/api' + path, {
      method: opts.method || (opts.body ? 'POST' : 'GET'),
      headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    let data = null; try { data = await r.json(); } catch (_) {}
    if (r.status === 401 && !path.startsWith('/auth/login')) { logout(); throw new Error('Session expired — sign in again'); }
    if (!r.ok) throw new Error(data?.error || ('HTTP ' + r.status));
    return data;
  }
  const put = (path, body) => api(path, { method: 'PUT', body });

  // ── Toast / status ─────────────────────────────────────────────────────────
  let toastTimer = null;
  function toast(msg, ms = 2800) { const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), ms); }
  function status(msg, kind) {
    const el = $('#bx-status'); el.textContent = msg || ''; el.className = 'bx-status' + (kind ? ' ' + kind : ''); el.title = msg || '';
    if (kind === 'ok') setTimeout(() => { if (el.textContent === msg) status(''); }, 3500);
  }

  // ── Auth ───────────────────────────────────────────────────────────────────
  function show(id) { for (const s of $$('.screen')) s.classList.toggle('hidden', s.id !== id); }
  async function boot() {
    S.token = localStorage.getItem('token') || localStorage.getItem('bx_tok');
    if (S.token) {
      try { S.user = await api('/auth/me'); } catch (_) { S.token = null; }
    }
    if (!S.user) { show('s-login'); return; }
    await start();
  }
  function logout() { S.token = null; S.user = null; localStorage.removeItem('token'); localStorage.removeItem('bx_tok'); if (S.sse) S.sse.close(); show('s-login'); }
  $('#login-btn').addEventListener('click', async () => {
    const err = $('#login-err'); err.classList.remove('on');
    $('#login-btn').disabled = true;
    try {
      const d = await api('/auth/login', { body: { email: $('#login-email').value.trim(), password: $('#login-pass').value } });
      S.token = d.token; S.user = d.user; localStorage.setItem('token', d.token);
      await start();
    } catch (e) { err.textContent = e.message; err.classList.add('on'); }
    finally { $('#login-btn').disabled = false; }
  });
  $('#login-pass').addEventListener('keydown', e => { if (e.key === 'Enter') $('#login-btn').click(); });

  // ── Start ──────────────────────────────────────────────────────────────────
  async function start() {
    show('s-main');
    [S.settings, S.meta, S.accounts] = await Promise.all([api('/chats/settings'), api('/chats/meta'), api('/chats/accounts')]);
    fillStaticLangs();
    renderAccounts();
    connectSSE();
    registerSW();
    const url = new URL(location.href);
    const wanted = url.searchParams.get('account');
    S.account = S.accounts.find(a => a.id === wanted) || S.accounts.find(a => a.status === 'open') || S.accounts[0] || null;
    if (!S.account) { renderBanner(); renderChatList(); openLinkModal(); return; }
    $('#account-select').value = S.account.id; renderBanner();
    await loadChats();
    const chat = url.searchParams.get('chat');
    if (chat) openChat(chat);
    if (S.meta.worker && S.meta.worker.ok === false) toast('Chats worker is not running: ' + (S.meta.worker.error || ''), 6000);
  }

  // ── Accounts ───────────────────────────────────────────────────────────────
  function renderAccounts() {
    const sel = $('#account-select');
    sel.innerHTML = S.accounts.map(a => `<option value="${a.id}">${esc(accountLabel(a))}</option>`).join('') || '<option value="">No account linked</option>';
    if (S.account) sel.value = S.account.id;
    renderBanner();
  }
  function accountLabel(a) { return (a.label || a.display_name || (a.phone ? '+' + a.phone : 'WhatsApp')) + (a.platform === 'whatsapp' ? '' : ' (' + a.platform + ')'); }
  function renderBanner() {
    const b = $('#account-banner'); const a = S.account;
    b.className = 'banner hidden';
    if (!a) { b.className = 'banner'; b.innerHTML = 'No WhatsApp linked yet. <button id="banner-link">Link WhatsApp</button>'; $('#banner-link').onclick = openLinkModal; return; }
    const st = a.live?.status || a.status;
    if (st === 'open') return;
    b.className = 'banner' + (st === 'logged_out' || st === 'replaced' ? ' err' : '');
    const txt = { qr: 'Waiting for the QR scan…', connecting: 'Connecting to WhatsApp…', stopped: 'Disconnected.', logged_out: 'This device was logged out on the phone.', replaced: 'Session opened elsewhere (another worker?).', unlinked: 'Not linked yet.', starting: 'Starting…' }[st] || ('Status: ' + st);
    b.innerHTML = esc(txt) + ' <button id="banner-link">' + (st === 'qr' || st === 'unlinked' || st === 'logged_out' ? 'Link' : 'Reconnect') + '</button>' + (a.status_reason ? ' <small class="muted">' + esc(a.status_reason) + '</small>' : '');
    $('#banner-link').onclick = () => (st === 'stopped' || st === 'replaced' || st === 'connecting') ? relink() : openLinkModal();
  }
  async function relink() {
    try { await api(`/chats/accounts/${S.account.id}/link`, { body: {} }); toast('Reconnecting…'); } catch (e) { toast(e.message, 5000); }
  }
  $('#account-select').addEventListener('change', async () => {
    S.account = S.accounts.find(a => a.id === $('#account-select').value) || null;
    S.jid = null; closeThread(); renderBanner(); await loadChats();
  });
  $('#btn-add-account').addEventListener('click', () => openLinkModal(true));

  // ── Link modal ─────────────────────────────────────────────────────────────
  let linking = null; // account being linked
  async function openLinkModal(forceNew) {
    $('#m-link').classList.remove('hidden');
    $('#link-qr').innerHTML = '<div class="spinner"></div>'; $('#link-code').classList.add('hidden'); $('#link-status').textContent = 'Starting…';
    try {
      linking = (!forceNew && S.account && S.account.status !== 'open') ? S.account : null;
      if (!linking) {
        const reusable = S.accounts.find(a => a.status !== 'open' && a.status !== 'connecting');
        linking = (!forceNew && reusable) || await api('/chats/accounts', { body: { platform: 'whatsapp' } });
        if (!S.accounts.find(a => a.id === linking.id)) S.accounts.push(linking);
        renderAccounts();
      }
      const st = await api(`/chats/accounts/${linking.id}/link`, { body: {} });
      applyLinkStatus(st);
      clearInterval(S.linkPoll);
      S.linkPoll = setInterval(async () => { if ($('#m-link').classList.contains('hidden')) return clearInterval(S.linkPoll); try { applyLinkStatus(await api(`/chats/accounts/${linking.id}/status`)); } catch (_) {} }, 3000);
    } catch (e) { $('#link-status').textContent = e.message; }
  }
  function applyLinkStatus(st) {
    if (!st) return;
    const box = $('#link-qr');
    if (st.qr) { box.innerHTML = `<img src="${st.qr}" alt="QR code">`; $('#link-status').textContent = 'Scan the code with your phone (it refreshes every ~20 s).'; }
    else if (st.status === 'qr') { box.innerHTML = '<div class="spinner"></div>'; $('#link-status').textContent = 'Waiting for QR…'; }
    if (st.pairingCode) { $('#link-code').textContent = st.pairingCode.replace(/(.{4})(.{4})/, '$1-$2'); $('#link-code').classList.remove('hidden'); $('#link-phone-wrap').open = true; }
    if (st.status === 'connecting') { box.innerHTML = '<div class="spinner"></div>'; $('#link-status').textContent = 'Connecting…'; }
    if (st.status === 'open') {
      $('#link-status').textContent = 'Linked ✔'; box.innerHTML = '<div style="font-size:48px">✅</div>';
      clearInterval(S.linkPoll);
      setTimeout(async () => { closeModal('m-link'); S.accounts = await api('/chats/accounts'); S.account = S.accounts.find(a => a.id === linking.id) || S.account; renderAccounts(); await loadChats(); toast('WhatsApp linked — syncing chats…'); }, 800);
    }
    if (st.reason && st.status !== 'open') $('#link-status').textContent = st.reason;
  }
  $('#link-phone-btn').addEventListener('click', async () => {
    const phone = $('#link-phone').value.replace(/\D/g, '');
    if (phone.length < 8) return toast('Enter the full number with country code');
    $('#link-phone-btn').disabled = true;
    try { applyLinkStatus(await api(`/chats/accounts/${linking.id}/link`, { body: { pairingPhone: phone } })); $('#link-status').textContent = 'Code requested — it can take a few seconds to appear.'; }
    catch (e) { toast(e.message, 5000); } finally { $('#link-phone-btn').disabled = false; }
  });
  function closeModal(id) { $('#' + id).classList.add('hidden'); if (id === 'm-link') clearInterval(S.linkPoll); }
  for (const x of $$('[data-close]')) x.addEventListener('click', () => closeModal(x.dataset.close));
  for (const m of $$('.modal')) m.addEventListener('mousedown', e => { if (e.target === m) closeModal(m.id); });

  // ── Chat list ──────────────────────────────────────────────────────────────
  async function loadChats() {
    S.chats.clear(); renderChatList();
    if (!S.account) return;
    const rows = await api(`/chats/accounts/${S.account.id}/chats?archived=${S.tab}`);
    for (const c of rows) S.chats.set(c.jid, c);
    renderChatList(); updateBadge();
  }
  function fmtTime(ts) {
    if (!ts) return '';
    const d = new Date(ts), now = new Date();
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return 'Yesterday';
    if (now - d < 6 * 864e5) return d.toLocaleDateString([], { weekday: 'short' });
    return d.toLocaleDateString([], { day: '2-digit', month: '2-digit' });
  }
  function initials(name) { return (name || '?').replace(/^\+/, '').split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase().slice(0, 2) || '?'; }
  function renderChatList() {
    const list = $('#chat-list'); const q = S.search.toLowerCase();
    const rows = [...S.chats.values()].filter(c => !q || (c.name || '').toLowerCase().includes(q) || (c.phone || '').includes(q))
      .sort((a, b) => (b.pinned - a.pinned) || ((b.last_message_at || 0) - (a.last_message_at || 0)));
    list.innerHTML = rows.map(c => `
      <div class="chat-item ${c.jid === S.jid ? 'on' : ''} ${c.pinned ? 'pinned' : ''}" data-jid="${esc(c.jid)}">
        <div class="avatar ${c.is_group ? 'group' : ''}">${c.picture_url ? `<img src="${esc(c.picture_url)}" alt="">` : esc(initials(c.name))}</div>
        <div class="ci-main">
          <div class="ci-top"><span class="ci-name">${esc(c.name)}</span><span class="ci-time">${fmtTime(c.last_message_at)}</span></div>
          <div class="ci-bot"><span class="ci-prev">${c.last_message_from_me ? '<span class="muted">You: </span>' : ''}${esc(c.last_message_text || '')}</span>
            ${c.send_language ? `<span class="ci-lang ${c.send_language_detected ? 'detected' : ''}" title="${c.send_language_detected ? 'Auto-detected' : 'Chosen by you'}">${esc(c.send_language)}</span>` : ''}
            ${c.unread_count ? `<span class="ci-badge">${c.unread_count}</span>` : ''}</div>
        </div></div>`).join('');
    const empty = $('#list-empty');
    if (!rows.length) { empty.classList.remove('hidden'); empty.textContent = S.account ? (S.account.status === 'open' ? 'No chats yet — they appear as the phone syncs.' : 'Link WhatsApp to see your chats.') : 'Link WhatsApp to see your chats.'; }
    else empty.classList.add('hidden');
  }
  $('#chat-list').addEventListener('click', e => { const it = e.target.closest('[data-jid]'); if (it) openChat(it.dataset.jid); });
  $('#chat-search').addEventListener('input', e => { S.search = e.target.value; renderChatList(); });
  for (const t of $$('#pane-list .tab')) t.addEventListener('click', async () => { $$('#pane-list .tab').forEach(x => x.classList.toggle('on', x === t)); S.tab = Number(t.dataset.tab); await loadChats(); });
  function updateBadge() {
    const n = [...S.chats.values()].filter(c => !c.muted).reduce((a, c) => a + (c.unread_count || 0), 0);
    document.title = (n ? `(${n}) ` : '') + 'Bibix Chats';
    if (navigator.setAppBadge) { try { n ? navigator.setAppBadge(n) : navigator.clearAppBadge(); } catch (_) {} }
  }

  // ── Thread ─────────────────────────────────────────────────────────────────
  const chat = () => S.chats.get(S.jid) || null;
  function targetLang() { const c = chat(); return c?.send_language || S.settings.targetLanguage; }
  function autoIncoming() { const c = chat(); return c?.auto_incoming == null ? !!S.settings.autoIncoming : !!c.auto_incoming; }
  function closeThread() { S.jid = null; $('#s-main').classList.remove('in-thread'); $('#pane-thread').classList.add('hidden'); $('#thread-placeholder').classList.remove('hidden'); history.replaceState(null, '', '/chats/' + (S.account ? '?account=' + S.account.id : '')); }
  $('#btn-back').addEventListener('click', closeThread);

  async function openChat(jid) {
    if (!S.account) return;
    S.jid = jid; S.messages = []; S.oldestTs = null; S.trState.clear(); S.hiddenTr.clear();
    $('#s-main').classList.add('in-thread'); $('#pane-thread').classList.remove('hidden'); $('#thread-placeholder').classList.add('hidden');
    history.replaceState(null, '', `/chats/?account=${S.account.id}&chat=${encodeURIComponent(jid)}`);
    renderChatList(); renderThreadHead(); syncBar();
    $('#messages-inner').innerHTML = '<div class="day">Loading…</div>';
    try {
      const d = await api(`/chats/accounts/${S.account.id}/chats/${encodeURIComponent(jid)}/messages?limit=60`);
      if (S.jid !== jid) return;
      if (d.chat) S.chats.set(jid, d.chat);
      S.messages = d.messages; S.oldestTs = d.messages[0]?.timestamp || null;
      renderMessages(true); renderThreadHead(); syncBar();
      if (chat()?.unread_count) markRead();
      if (S.enabled && autoIncoming()) translateRecent(S.settings.initialIncoming);
      if (!chat()?.picture_url && !chat()?.is_group) api(`/chats/accounts/${S.account.id}/chats/${encodeURIComponent(jid)}/picture`).then(r => { if (r?.url && chat()) { chat().picture_url = r.url; renderThreadHead(); renderChatList(); } }).catch(() => {});
    } catch (e) { $('#messages-inner').innerHTML = `<div class="day">${esc(e.message)}</div>`; }
    if (!isPhone()) $('#draft').focus();
  }
  function renderThreadHead() {
    const c = chat(); if (!c) return;
    $('#thread-name').textContent = c.name;
    $('#thread-avatar').className = 'avatar' + (c.is_group ? ' group' : '');
    $('#thread-avatar').innerHTML = c.picture_url ? `<img src="${esc(c.picture_url)}" alt="">` : esc(initials(c.name));
    $('#thread-sub').textContent = c.is_group ? 'Group' : (c.phone ? '+' + c.phone : c.jid);
  }
  async function markRead() {
    const c = chat(); if (!c) return;
    c.unread_count = 0; renderChatList(); updateBadge();
    try { await api(`/chats/accounts/${S.account.id}/chats/${encodeURIComponent(S.jid)}/read`, { body: {} }); } catch (_) {}
  }

  // ── Messages rendering ─────────────────────────────────────────────────────
  const dayLabel = (ts) => { const d = new Date(ts), n = new Date(); if (d.toDateString() === n.toDateString()) return 'Today'; const y = new Date(n); y.setDate(n.getDate() - 1); if (d.toDateString() === y.toDateString()) return 'Yesterday'; return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: d.getFullYear() !== n.getFullYear() ? 'numeric' : undefined }); };
  const ticks = (m) => !m.from_me ? '' : m.status >= 4 ? '<span class="tick read">✓✓</span>' : m.status >= 3 ? '<span class="tick">✓✓</span>' : m.status >= 2 ? '<span class="tick">✓</span>' : '<span class="tick">🕓</span>';
  const kindText = { image: '📷 Photo', video: '🎥 Video', audio: '🎤 Voice message', sticker: 'Sticker', document: '📄 Document', contact: '👤 Contact', location: '📍 Location', poll: '📊 Poll', call: '📞 Call', other: 'Unsupported message' };

  function msgHtml(m) {
    const c = chat();
    const st = S.trState.get(m.id);
    let notes = '';
    const hidden = S.hiddenTr.has(m.id);
    if (!hidden) {
      if (st?.state === 'pending') notes += `<div class="tr pending"><span class="tag">${esc(S.settings.myLanguage)}</span>translating…</div>`;
      else if (st?.state === 'fail') notes += `<div class="tr fail"><span class="tag">${esc(S.settings.myLanguage)}</span>${esc(st.error)}<span class="act" data-hide="${m.id}">✕</span></div>`;
      else if (m.translation) notes += `<div class="tr"><span class="tag">${esc(m.translation_lang ? m.translation_lang + ' → ' + (m.translation_target || S.settings.myLanguage) : (m.translation_target || S.settings.myLanguage))}</span>${esc(m.translation)}<span class="act" data-hide="${m.id}" title="Hide">✕</span></div>`;
    }
    if (m.from_me && m.original_text && S.settings.showOriginalOutgoing) notes += `<div class="tr orig"><span class="tag">you wrote</span>${esc(m.original_text)}</div>`;
    const body = m.text ? esc(m.text) : `<span class="media">${esc(kindText[m.kind] || kindText.other)}</span>`;
    const caption = m.text && m.kind !== 'text' ? `<div class="media">${esc(kindText[m.kind] || '')}</div>` : '';
    return `<div class="msg ${m.from_me ? 'out' : 'in'}" data-id="${m.id}" data-ts="${m.timestamp}">
      <div class="bubble">${c?.is_group && !m.from_me && m.sender_name ? `<div class="sender">${esc(m.sender_name)}</div>` : ''}${m.quoted ? `<div class="quoted">${esc(m.quoted.text)}</div>` : ''}${caption}${body}<div class="meta">${new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ${ticks(m)}</div></div>
      ${notes}${m.text ? `<span class="tbtn" data-tr="${m.id}" title="Translate this message → ${esc(S.settings.myLanguage)}">🌐</span>` : ''}</div>`;
  }
  function renderMessages(scrollBottom) {
    const box = $('#messages'); const inner = $('#messages-inner');
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    let html = S.messages.length >= 60 || S.oldestTs ? '<button class="sm load-more" id="btn-earlier">Load earlier messages</button>' : '';
    let lastDay = '';
    for (const m of S.messages) {
      const d = new Date(m.timestamp).toDateString();
      if (d !== lastDay) { html += `<div class="day">${dayLabel(m.timestamp)}</div>`; lastDay = d; }
      html += msgHtml(m);
    }
    if (!S.messages.length) html += '<div class="day">No messages yet</div>';
    inner.innerHTML = html;
    if (scrollBottom || atBottom) box.scrollTop = box.scrollHeight;
  }
  function patchMessage(m) {
    const i = S.messages.findIndex(x => x.id === m.id);
    if (i >= 0) S.messages[i] = { ...S.messages[i], ...m };
    const el = $(`#messages-inner .msg[data-id="${m.id}"]`);
    if (el) { el.outerHTML = msgHtml(S.messages[i] || m); }
  }
  $('#messages').addEventListener('click', async e => {
    const h = e.target.closest('[data-hide]'); if (h) { S.hiddenTr.add(h.dataset.hide); S.trState.delete(h.dataset.hide); patchMessage({ id: h.dataset.hide }); return; }
    const b = e.target.closest('[data-tr]'); if (b) { toggleTranslate(b.dataset.tr); return; }
    if (e.target.id === 'btn-earlier') loadEarlier();
  });
  async function toggleTranslate(id) {
    const m = S.messages.find(x => x.id === id); if (!m) return;
    if (S.hiddenTr.has(id)) { S.hiddenTr.delete(id); patchMessage({ id }); if (m.translation) return; }
    else if (m.translation && !S.trState.get(id)) { S.hiddenTr.add(id); patchMessage({ id }); return; }
    await translateMessage(m, true);
  }
  async function translateMessage(m, verbose) {
    if (!m.text) { if (verbose) status('No text in that message', 'err'); return 'notext'; }
    S.trState.set(m.id, { state: 'pending' }); patchMessage({ id: m.id });
    try {
      const r = await api(`/chats/messages/${m.id}/translate`, { body: {} });
      S.trState.delete(m.id);
      Object.assign(m, r.message); patchMessage(m);
      if (r.same && verbose) status(`That message is already in ${S.settings.myLanguage}`, 'ok');
      return r.same ? 'same' : 'done';
    } catch (e) { S.trState.set(m.id, { state: 'fail', error: e.message }); patchMessage({ id: m.id }); return 'fail'; }
  }
  async function translateRecent(limit, verbose) {
    if (!S.jid) return;
    const pending = S.messages.filter(m => !m.from_me && m.text && (!m.translation && m.translation_target !== S.settings.myLanguage)).slice(-(limit || 15));
    if (!pending.length) { if (verbose) status(`Nothing to translate (${S.messages.filter(m => !m.from_me).length} incoming visible)`, 'ok'); return; }
    if (verbose) status(`Translating ${pending.length} incoming…`, 'busy');
    for (const m of pending) { S.trState.set(m.id, { state: 'pending' }); patchMessage({ id: m.id }); }
    try {
      const r = await api(`/chats/accounts/${S.account.id}/chats/${encodeURIComponent(S.jid)}/translate-recent`, { body: { limit: pending.length } });
      // results also arrive over SSE (chat:translated); apply the response directly as the fallback
      for (const t of r.messages || []) { S.trState.delete(t.id); upsertLocal(t, false); }
      for (const m of pending) if (S.trState.get(m.id)?.state === 'pending') { S.trState.set(m.id, { state: 'fail', error: r.error || 'not translated' }); patchMessage({ id: m.id }); }
      if (verbose) status(`${r.done} translated${r.failed ? `, ${r.failed} failed (${r.error})` : ''}`, r.failed ? 'err' : 'ok');
      else if (r.failed && r.error) status(r.error, 'err');
    } catch (e) { for (const m of pending) { S.trState.set(m.id, { state: 'fail', error: e.message }); patchMessage({ id: m.id }); } status(e.message, 'err'); }
  }
  async function loadEarlier() {
    if (!S.oldestTs) return;
    const btn = $('#btn-earlier'); if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }
    try {
      const d = await api(`/chats/accounts/${S.account.id}/chats/${encodeURIComponent(S.jid)}/messages?limit=60&before=${S.oldestTs}`);
      if (!d.messages.length) { if (btn) btn.textContent = 'No earlier messages here — use "Older…" to ask the phone'; S.oldestTs = null; return; }
      const box = $('#messages'); const h = box.scrollHeight;
      S.messages = [...d.messages, ...S.messages]; S.oldestTs = d.messages[0].timestamp;
      renderMessages(false); box.scrollTop = box.scrollHeight - h;
    } catch (e) { status(e.message, 'err'); }
  }
  $('#bx-older').addEventListener('click', async () => {
    try { status('Asking the phone for older messages…', 'busy'); await api(`/chats/accounts/${S.account.id}/chats/${encodeURIComponent(S.jid)}/load-older`, { body: { count: 50 } }); status('Requested — older messages arrive in a moment', 'ok'); }
    catch (e) { status(e.message, 'err'); }
  });
  $('#bx-visible').addEventListener('click', () => translateRecent(30, true));

  // ── Toolbar (per-chat language, incoming toggle, enabled) ──────────────────
  function fillStaticLangs() {
    const opts = S.meta.languages.map(l => `<option>${esc(l)}</option>`).join('');
    $('#st-my').innerHTML = opts; $('#st-target').innerHTML = opts;
  }
  function fillLangSelect() {
    const sel = $('#bx-target'); const cur = targetLang(); const recent = (S.meta.recent || []).filter(Boolean);
    const rest = S.meta.languages.filter(l => !recent.includes(l));
    const opt = (l) => `<option value="${esc(l)}">${esc(l)}</option>`;
    sel.innerHTML = [
      cur && !recent.includes(cur) && !rest.includes(cur) ? opt(cur) : '',
      recent.length ? `<optgroup label="Recent">${recent.map(opt).join('')}</optgroup>` : '',
      `<optgroup label="All languages">${rest.map(opt).join('')}</optgroup>`,
      `<option value="__other">Other…</option>`,
    ].join('');
    sel.value = cur;
  }
  function syncBar() {
    const c = chat();
    $('#bx-bar').classList.toggle('off', !S.enabled);
    $('#bx-enabled').classList.toggle('on', S.enabled);
    fillLangSelect();
    $('#bx-target').classList.toggle('detected', !!c?.send_language_detected);
    $('#bx-target').title = c?.send_language ? (c.send_language_detected ? 'Auto-detected from this chat — pick another to override' : 'Chosen by you for this chat') : 'Default language (pick one here for this chat, or it is auto-detected from incoming messages)';
    $('#bx-auto').checked = autoIncoming();
    $('#bx-mylang').textContent = S.settings.myLanguage;
    $('#btn-send').textContent = S.enabled ? 'Translate & send' : 'Send';
    $('#btn-inplace').disabled = $('#bx-visible').disabled = !S.enabled;
    $('#composer-hint').textContent = S.enabled ? `Enter sends in ${targetLang()}${c?.send_language ? (c.send_language_detected ? ' (auto-detected)' : '') : ' (default)'} · Shift+Enter = newline` : 'Translation off — messages go out as typed';
  }
  $('#bx-enabled').addEventListener('click', () => { S.enabled = !S.enabled; localStorage.setItem('chats_enabled', S.enabled ? '1' : '0'); syncBar(); if (S.enabled && autoIncoming()) translateRecent(S.settings.initialIncoming); });
  $('#bx-target').addEventListener('change', async () => {
    let v = $('#bx-target').value;
    if (v === '__other') v = (window.prompt('Language to send this chat\'s messages in (e.g. Hebrew, Arabic, Japanese):', '') || '').trim();
    if (!v) return syncBar();
    try { const c = await put(`/chats/accounts/${S.account.id}/chats/${encodeURIComponent(S.jid)}/prefs`, { send_language: v, send_language_detected: false }); S.chats.set(S.jid, c); if (!S.meta.recent.includes(v)) S.meta.recent.unshift(v); }
    catch (e) { status(e.message, 'err'); }
    syncBar(); renderChatList();
  });
  $('#bx-auto').addEventListener('change', async () => {
    try { const c = await put(`/chats/accounts/${S.account.id}/chats/${encodeURIComponent(S.jid)}/prefs`, { auto_incoming: $('#bx-auto').checked }); S.chats.set(S.jid, c); } catch (e) { status(e.message, 'err'); }
    if ($('#bx-auto').checked) translateRecent(S.settings.initialIncoming);
  });

  // ── Composer ───────────────────────────────────────────────────────────────
  const draft = $('#draft');
  function autosize() { draft.style.height = 'auto'; draft.style.height = Math.min(140, draft.scrollHeight) + 'px'; }
  draft.addEventListener('input', autosize);
  draft.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && !e.isComposing) {
      if (S.settings.enterTranslates === false && S.enabled) return; // plain Enter = newline when the option is off
      if (!norm(draft.value)) return;
      e.preventDefault(); translateDraft(true); return;
    }
    if (!(e.ctrlKey || e.metaKey) || !e.shiftKey) return;
    if (e.key === 'Enter') { e.preventDefault(); translateDraft(true); }
    else if (e.key.toLowerCase() === 't') { e.preventDefault(); translateDraft(false); }
    else if (e.key.toLowerCase() === 'u') { e.preventDefault(); undoDraft(); }
    else if (e.key.toLowerCase() === 'q') { e.preventDefault(); toggleQA(); }
  });
  document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'q' && S.jid) { e.preventDefault(); toggleQA(); } if (e.key === 'Escape') { toggleQA(false); for (const m of $$('.modal')) if (!m.classList.contains('hidden')) closeModal(m.id); } });
  $('#btn-send').addEventListener('click', () => translateDraft(true));
  $('#btn-inplace').addEventListener('click', () => translateDraft(false));
  $('#btn-undo').addEventListener('click', undoDraft);
  $('#btn-raw').addEventListener('click', () => sendText(draft.value.trim(), null));

  let sending = false;
  async function translateDraft(andSend) {
    if (sending || !S.jid) return;
    const text = draft.value.trim(); if (!text) { status('Type a message first', 'err'); return; }
    if (!S.enabled) return sendText(text, null);
    const to = targetLang();
    sending = true; $('#btn-send').disabled = $('#btn-inplace').disabled = true;
    try {
      status(`Translating → ${to}…`, 'busy');
      const r = await api('/chats/translate', { body: { text, from: S.settings.myLanguage, to } });
      S.lastDraft = text;
      if (andSend) { await sendText(r.text, text); S.lastDraft = null; $('#btn-undo').classList.add('hidden'); }
      else { draft.value = r.text; autosize(); $('#btn-undo').classList.remove('hidden'); status('Translated — review, then Enter sends it as is', 'ok'); S.reviewed = true; }
    } catch (e) { status(e.message, 'err'); }
    finally { sending = false; $('#btn-send').disabled = false; $('#btn-inplace').disabled = !S.enabled; }
  }
  function undoDraft() { if (S.lastDraft == null) return; draft.value = S.lastDraft; autosize(); S.lastDraft = null; S.reviewed = false; $('#btn-undo').classList.add('hidden'); status('Restored', 'ok'); }
  async function sendText(text, original) {
    if (!text || !S.jid) return;
    // After "Translate (review)", Enter sends the reviewed text as is and remembers what was typed.
    if (original == null && S.reviewed && S.lastDraft) { original = S.lastDraft; }
    S.reviewed = false;
    try {
      status('Sending…', 'busy');
      const m = await api(`/chats/accounts/${S.account.id}/chats/${encodeURIComponent(S.jid)}/send`, { body: { text, original: original && original !== text ? original : null } });
      draft.value = ''; autosize(); S.lastDraft = null; $('#btn-undo').classList.add('hidden');
      upsertLocal(m, true); status('Sent: ' + text, 'ok');
    } catch (e) { status(e.message, 'err'); }
    if (!isPhone()) draft.focus();
  }
  function upsertLocal(m, scroll) {
    if (m.chat_jid !== S.jid) return;
    const i = S.messages.findIndex(x => x.id === m.id || x.msg_id === m.msg_id);
    if (i >= 0) { S.messages[i] = { ...S.messages[i], ...m }; patchMessage(S.messages[i]); return; }
    S.messages.push(m); S.messages.sort((a, b) => a.timestamp - b.timestamp);
    renderMessages(scroll || true);
  }

  // ── Quick answers ──────────────────────────────────────────────────────────
  let qaSel = null, qaQuery = '', qaLastClick = { id: null, at: 0 }, qaPending = null, qaCloseTimer = null;
  async function loadQA() { try { S.qa = await api('/chats/quick-answers'); } catch (_) { S.qa = []; } }
  function toggleQA(force) {
    const panel = $('#qa-panel'); const open = force ?? panel.classList.contains('hidden');
    if (!open) { panel.classList.add('hidden'); return; }
    if (!S.jid) return;
    (S.qa ? Promise.resolve() : loadQA()).then(() => { panel.classList.remove('hidden'); renderQA(); $('#qa-search').focus(); });
  }
  function qaVisible() {
    const groups = S.qa || [];
    if (qaQuery) return groups.flatMap(g => g.items.map(it => ({ ...it, _g: g.name }))).filter(it => (it.title + ' ' + it.text).toLowerCase().includes(qaQuery));
    return (groups.find(g => g.id === qaSel)?.items || []).map(it => ({ ...it, _g: '' }));
  }
  function findQA(id) { for (const g of S.qa || []) { const it = g.items.find(i => i.id === id); if (it) return it; } return null; }
  function renderQA() {
    const groups = S.qa || [];
    if (!groups.find(g => g.id === qaSel)) qaSel = groups[0]?.id || null;
    $('#qa-groups').innerHTML = groups.map(g => `<div class="qa-g ${g.id === qaSel ? 'on' : ''}" data-g="${esc(g.id)}">${esc(g.name)} <small>${g.items.length}</small></div>`).join('') || '<div class="qa-empty">No quick answers yet.<br>Click “Manage” to create groups and answers.</div>';
    const items = qaVisible();
    $('#qa-list').innerHTML = items.map(it => `<div class="qa-i" data-i="${esc(it.id)}"><div class="qa-t">${esc(it.title || it.text.slice(0, 40))}${qaQuery ? ` <small>${esc(it._g)}</small>` : ''}</div><div class="qa-x">${esc(it.text)}</div><span class="qa-send" title="Translate & send now">➤</span></div>`).join('')
      || `<div class="qa-empty">${qaQuery ? 'No match.' : 'This group is empty.'}</div>`;
  }
  $('#qa-groups').addEventListener('click', e => { const g = e.target.closest('[data-g]'); if (g) { qaSel = g.dataset.g; renderQA(); } });
  $('#qa-list').addEventListener('click', e => {
    const row = e.target.closest('[data-i]'); if (!row) return;
    const item = findQA(row.dataset.i); if (!item) return;
    const now = Date.now();
    const second = e.target.closest('.qa-send') || (qaLastClick.id === item.id && now - qaLastClick.at < 600);
    qaLastClick = second ? { id: null, at: 0 } : { id: item.id, at: now };
    if (second) { clearTimeout(qaCloseTimer); useQuickAnswer(item, true); }
    else qaPending = useQuickAnswer(item, false);
  });
  $('#qa-search').addEventListener('input', e => { qaQuery = e.target.value.toLowerCase().trim(); renderQA(); });
  $('#qa-search').addEventListener('keydown', e => { if (e.key === 'Enter') { const first = qaVisible()[0]; if (first) useQuickAnswer(first, e.shiftKey); } });
  $('#qa-close').addEventListener('click', () => toggleQA(false));
  $('#qa-manage').addEventListener('click', () => { toggleQA(false); openSettings('qa'); });
  $('#btn-qa').addEventListener('click', () => toggleQA());
  document.addEventListener('mousedown', e => { const p = $('#qa-panel'); if (!p.classList.contains('hidden') && !p.contains(e.target) && !e.target.closest('#btn-qa')) toggleQA(false); }, true);
  async function useQuickAnswer(item, sendNow) {
    const text = (item.text || '').trim(); if (!text) return;
    if (!sendNow) {
      clearTimeout(qaCloseTimer); qaCloseTimer = setTimeout(() => toggleQA(false), 500);
      draft.value = text; autosize(); draft.focus();
      status(`Inserted “${item.title || text.slice(0, 30)}” — edit, then Enter sends it in ${targetLang()}`, 'ok');
      return;
    }
    try { await qaPending; } catch (_) {}
    qaPending = null; clearTimeout(qaCloseTimer); toggleQA(false);
    if (norm(draft.value) !== norm(text)) { draft.value = text; autosize(); }
    await translateDraft(true);
  }

  // ── Settings modal ─────────────────────────────────────────────────────────
  function openSettings(tab) {
    $('#m-settings').classList.remove('hidden');
    for (const t of $$('#m-settings .tab')) t.classList.toggle('on', t.dataset.stab === (tab || 'general'));
    for (const p of $$('#m-settings .stab')) p.classList.toggle('hidden', p.dataset.stab !== (tab || 'general'));
    const s = S.settings;
    $('#st-my').value = s.myLanguage; $('#st-target').value = s.targetLanguage; $('#st-auto').checked = !!s.autoIncoming; $('#st-initial').value = s.initialIncoming;
    $('#st-orig').checked = !!s.showOriginalOutgoing; $('#st-enter').checked = s.enterTranslates !== false; $('#st-notif').checked = s.notifications !== false; $('#st-style').value = s.style || '';
    $('#st-provider').innerHTML = '<option value="">Account default</option>' + S.meta.providers.map(p => `<option value="${p.id}">${esc(p.display)}</option>`).join('');
    $('#st-provider').value = s.provider || ''; $('#st-model').value = s.model || '';
    $('#st-provider-info').textContent = S.meta.provider ? `In use now: ${S.meta.provider.display} · ${S.meta.provider.model}` : 'No provider key found — add one in Bibix → Settings → AI providers.';
    if (tab === 'qa') { (S.qa ? Promise.resolve() : loadQA()).then(renderQAM); }
    renderAccountsSettings();
  }
  $('#btn-settings').addEventListener('click', () => openSettings('general'));
  for (const t of $$('#m-settings .tab')) t.addEventListener('click', () => openSettings(t.dataset.stab));
  $('#st-save').addEventListener('click', async () => {
    try {
      S.settings = await put('/chats/settings', {
        myLanguage: $('#st-my').value, targetLanguage: $('#st-target').value, autoIncoming: $('#st-auto').checked, initialIncoming: Number($('#st-initial').value) || 0,
        showOriginalOutgoing: $('#st-orig').checked, enterTranslates: $('#st-enter').checked, notifications: $('#st-notif').checked, style: $('#st-style').value.trim(),
        provider: $('#st-provider').value || null, model: $('#st-model').value.trim() || null,
      });
      S.meta = await api('/chats/meta');
      if (S.settings.notifications) enablePush(true);
      closeModal('m-settings'); syncBar(); if (S.jid) renderMessages(false); toast('Saved');
    } catch (e) { toast(e.message, 5000); }
  });
  // quick answers manager
  let qamSel = null;
  function renderQAM() {
    const groups = S.qa || [];
    if (!groups.find(g => g.id === qamSel)) qamSel = groups[0]?.id || null;
    $('#qam-groups').innerHTML = groups.map(g => `<div class="qam-g ${g.id === qamSel ? 'on' : ''}" data-g="${esc(g.id)}"><span>${esc(g.name)}</span><span class="act" data-del-g="${esc(g.id)}" title="Delete group">✕</span></div>`).join('') || '<p class="muted">No groups yet.</p>';
    const g = groups.find(x => x.id === qamSel);
    $('#qam-title').textContent = g ? g.name : 'Answers';
    $('#qam-items').innerHTML = g ? (g.items.map(it => `<div class="qam-i" data-i="${esc(it.id)}"><div class="row"><input data-f="title" placeholder="Title" value="${esc(it.title)}"><span class="act" data-del-i="${esc(it.id)}">✕</span></div><textarea data-f="text" placeholder="Answer text (in your language)">${esc(it.text)}</textarea></div>`).join('') || '<p class="muted">Empty group — add an answer.</p>') : '';
  }
  $('#qam-groups').addEventListener('click', e => {
    const del = e.target.closest('[data-del-g]'); if (del) { if (confirm('Delete this group and its answers?')) { S.qa = S.qa.filter(g => g.id !== del.dataset.delG); renderQAM(); } return; }
    const g = e.target.closest('[data-g]'); if (g) { qamSel = g.dataset.g; renderQAM(); }
  });
  $('#qam-items').addEventListener('input', e => { const row = e.target.closest('[data-i]'); const g = S.qa.find(x => x.id === qamSel); const it = g?.items.find(i => i.id === row?.dataset.i); if (it && e.target.dataset.f) it[e.target.dataset.f] = e.target.value; });
  $('#qam-items').addEventListener('click', e => { const d = e.target.closest('[data-del-i]'); if (d) { const g = S.qa.find(x => x.id === qamSel); g.items = g.items.filter(i => i.id !== d.dataset.delI); renderQAM(); } });
  $('#qam-add-group').addEventListener('click', () => { const name = prompt('Group name:', ''); if (!name) return; S.qa = S.qa || []; const g = { id: 'g' + Date.now(), name, items: [] }; S.qa.push(g); qamSel = g.id; renderQAM(); });
  $('#qam-add-item').addEventListener('click', () => { const g = (S.qa || []).find(x => x.id === qamSel); if (!g) return toast('Create a group first'); g.items.push({ id: 'a' + Date.now(), title: '', text: '' }); renderQAM(); $$('#qam-items input').pop()?.focus(); });
  $('#qam-save').addEventListener('click', async () => { try { S.qa = await put('/chats/quick-answers', { groups: S.qa || [] }); toast('Quick answers saved'); renderQAM(); } catch (e) { toast(e.message, 5000); } });
  $('#qam-export').addEventListener('click', () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(S.qa || [], null, 2)], { type: 'application/json' })); a.download = 'bibix-quick-answers.json'; a.click(); });
  $('#qam-import').addEventListener('click', () => $('#qam-file').click());
  $('#qam-file').addEventListener('change', async e => { const f = e.target.files[0]; if (!f) return; try { const d = JSON.parse(await f.text()); if (!Array.isArray(d)) throw new Error('Expected an array of groups'); S.qa = d; renderQAM(); toast('Imported — click Save to keep it'); } catch (err) { toast('Import failed: ' + err.message, 5000); } e.target.value = ''; });
  function renderAccountsSettings() {
    $('#st-accounts').innerHTML = S.accounts.map(a => { const st = a.live?.status || a.status; return `<div class="acct"><span class="dot ${esc(st)}"></span><div class="info"><b>${esc(accountLabel(a))}</b><small>${esc(a.platform)} · ${esc(st)}${a.phone ? ' · +' + esc(a.phone) : ''}${a.status_reason ? ' · ' + esc(a.status_reason) : ''}</small></div>
      ${st !== 'open' ? `<button class="sm" data-relink="${a.id}">Link</button>` : ''}<button class="sm" data-unlink="${a.id}">Unlink</button></div>`; }).join('') || '<p class="muted">No accounts.</p>';
  }
  $('#st-accounts').addEventListener('click', async e => {
    const u = e.target.closest('[data-unlink]'); const r = e.target.closest('[data-relink]');
    if (r) { S.account = S.accounts.find(a => a.id === r.dataset.relink); closeModal('m-settings'); openLinkModal(); return; }
    if (!u) return;
    if (!confirm('Unlink this WhatsApp? The device is logged out on your phone and its synced chats are deleted from Bibix.')) return;
    try { await api(`/chats/accounts/${u.dataset.unlink}/logout`, { body: {} }); S.accounts = await api('/chats/accounts'); if (S.account?.id === u.dataset.unlink) { S.account = S.accounts[0] || null; closeThread(); await loadChats(); } renderAccounts(); renderAccountsSettings(); toast('Unlinked'); }
    catch (err) { toast(err.message, 5000); }
  });

  // ── Live updates (SSE) ─────────────────────────────────────────────────────
  function connectSSE() {
    if (S.sse) S.sse.close();
    const es = new EventSource('/api/events?token=' + encodeURIComponent(S.token));
    S.sse = es;
    const on = (name, fn) => es.addEventListener(name, e => { let d = {}; try { d = JSON.parse(e.data); } catch (_) {} fn(d); });
    on('chat:status', async d => {
      const a = S.accounts.find(x => x.id === d.account_id);
      if (a) { a.status = d.status; a.status_reason = d.reason; if (d.phone) a.phone = d.phone; if (d.name) a.display_name = d.name; a.live = { status: d.status, reason: d.reason }; }
      if (linking && linking.id === d.account_id) applyLinkStatus(d);
      renderAccounts(); if (!$('#m-settings').classList.contains('hidden')) renderAccountsSettings();
      if (d.status === 'open' && a && S.account?.id === a.id) loadChats();
    });
    on('chat:history', d => { if (d.account_id === S.account?.id) { if (d.messages) loadChats(); if (d.isLatest) toast('Chat history synced'); if (S.jid && d.messages) refreshThreadQuiet(); } });
    on('chat:chats', d => {
      if (d.account_id !== S.account?.id) return;
      for (const c of d.chats) { if (!c) continue; if ((c.archived ? 1 : 0) === S.tab) S.chats.set(c.jid, c); else S.chats.delete(c.jid); }
      renderChatList(); updateBadge();
      if (d.detected && d.chats[0]?.jid === S.jid) { syncBar(); status(`This chat: sending in ${d.detected} (auto-detected)`, 'ok'); }
      else if (d.chats.some(c => c?.jid === S.jid)) syncBar();
    });
    on('chat:message', d => {
      if (d.account_id !== S.account?.id) return;
      if (d.chat) { if ((d.chat.archived ? 1 : 0) === S.tab) S.chats.set(d.chat.jid, d.chat); renderChatList(); updateBadge(); }
      if (d.message.chat_jid === S.jid) {
        upsertLocal(d.message, true);
        if (d.live && !d.message.from_me && document.visibilityState === 'visible') markRead();
      } else if (d.live && d.inserted && !d.message.from_me) toast(`${d.chat?.name || d.message.chat_jid}: ${(d.message.text || '').slice(0, 80)}`);
    });
    on('chat:message-update', d => { if (d.account_id === S.account?.id && d.message.chat_jid === S.jid) upsertLocal(d.message, false); });
    on('chat:translated', d => { if (d.account_id === S.account?.id && d.message.chat_jid === S.jid) { S.trState.delete(d.message.id); upsertLocal(d.message, false); } });
    on('chat:presence', d => {
      if (d.account_id !== S.account?.id || d.jid !== S.jid) return;
      const p = Object.values(d.presences || {})[0]; const t = $('#typing');
      if (p?.lastKnownPresence === 'composing' || p?.lastKnownPresence === 'recording') { t.textContent = p.lastKnownPresence === 'composing' ? 'typing…' : 'recording…'; t.classList.remove('hidden'); clearTimeout(S.typingTimer); S.typingTimer = setTimeout(() => t.classList.add('hidden'), 8000); }
      else t.classList.add('hidden');
    });
    es.onerror = () => { /* EventSource reconnects by itself */ };
  }
  async function refreshThreadQuiet() {
    try { const d = await api(`/chats/accounts/${S.account.id}/chats/${encodeURIComponent(S.jid)}/messages?limit=60`); if (d.messages.length > S.messages.length || !S.messages.length) { S.messages = d.messages; S.oldestTs = d.messages[0]?.timestamp || null; renderMessages(false); } } catch (_) {}
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { if (S.sse?.readyState === 2) connectSSE(); if (S.jid) { refreshThreadQuiet(); markRead(); } loadChats(); } });

  // ── PWA: service worker + push ─────────────────────────────────────────────
  async function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    try {
      const reg = await navigator.serviceWorker.register('/chats/sw.js', { scope: '/chats/' });
      navigator.serviceWorker.addEventListener('message', e => {
        if (e.data?.type === 'open' && e.data.url) { const u = new URL(e.data.url, location.origin); const c = u.searchParams.get('chat'); const a = u.searchParams.get('account'); if (a && a !== S.account?.id) { S.account = S.accounts.find(x => x.id === a) || S.account; renderAccounts(); loadChats().then(() => c && openChat(c)); } else if (c) openChat(c); }
      });
      if (S.settings?.notifications !== false && Notification.permission === 'granted') enablePush(false, reg);
    } catch (e) { console.warn('[chats] sw', e.message); }
  }
  async function enablePush(ask, reg) {
    try {
      if (!('PushManager' in window) || !S.meta.vapid) return;
      if (Notification.permission !== 'granted') { if (!ask) return; if (await Notification.requestPermission() !== 'granted') return; }
      reg = reg || await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64(S.meta.vapid) });
      await api('/push/subscribe', { body: { subscription: sub.toJSON() } });
      S.pushReady = true;
    } catch (e) { console.warn('[chats] push', e.message); }
  }
  function urlB64(s) { const p = '='.repeat((4 - s.length % 4) % 4); const b = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, c => c.charCodeAt(0)); }
  window.addEventListener('resize', () => { if (S.jid) autosize(); });

  boot().catch(e => { console.error(e); toast(e.message, 6000); });
})();
