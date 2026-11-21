// Bibix Chat AI — content script for WhatsApp Web + Telegram Web (K and A clients).
// Adds a toolbar above the composer (translate & send / translate in place) and
// translates incoming messages inline. All model calls go through the background worker.
(() => {
  if (window.__bxChatAI) return; window.__bxChatAI = true;

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const bg = (msg) => chrome.runtime.sendMessage(msg).then(r => { if (!r?.ok) throw new Error(r?.error || 'No response'); return r.data; });
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // ── Platform adapters (selectors with fallbacks; adjust here when the apps change markup) ──
  const adapters = {
    whatsapp: {
      id: 'whatsapp',
      // WhatsApp changes its editor often (Lexical now). Take every editable box in the chat
      // pane, drop the search field, keep the visible one lowest in the DOM.
      composer: () => {
        const cands = $$('#main [contenteditable="true"], footer [contenteditable="true"], [contenteditable="true"][data-lexical-editor="true"], [contenteditable="true"][role="textbox"]')
          .filter(el => el.offsetParent !== null
            && !/search/i.test(el.getAttribute('aria-label') || '')
            && !/search/i.test(el.getAttribute('aria-placeholder') || '')
            && el.getAttribute('data-tab') !== '3');
        return cands[cands.length - 1] || null;
      },
      sendButton: () => $('button[aria-label="Send"]')
        || $('[data-icon="send"], [data-icon*="send"]')?.closest('button, [role="button"]') || null,
      barAnchor: () => {
        const c = adapters.whatsapp.composer();
        return c?.closest('footer') || $('footer') || (c && Array.from($('#main')?.children || []).find(n => n.contains(c))) || null;
      },
      // The open chat's name: the header inside the same pane as the message box; fallback to the
      // highlighted row in the chat list. (Any stray header elsewhere would make all chats share one key.)
      chatTitle: () => {
        // 1. The highlighted row in the chat list carries the exact chat name.
        const row = $$('[aria-selected="true"]').find(r => r.querySelector('span[title], span[dir="auto"]'));
        const fromRow = row?.querySelector('span[title]')?.getAttribute('title') || row?.querySelector('span[dir="auto"]')?.textContent?.trim();
        if (fromRow) return fromRow;
        // 2. A header that overlaps the composer horizontally (i.e. lives in the conversation pane,
        //    not in the chat-list column on the left).
        const c = adapters.whatsapp.composer(); const cr = c?.getBoundingClientRect();
        for (const h of $$('header')) {
          if (h.contains(c)) continue;
          if (cr && h.getBoundingClientRect().right <= cr.left) continue;
          const t = h.querySelector('span[title]')?.getAttribute('title') || h.querySelector('span[dir="auto"]')?.textContent || (h.innerText || '').split('\n')[0];
          if (t && t.trim()) return t.trim();
        }
        return '';
      },
      // WhatsApp keeps removing ids/classes (#main, message-in…). Strategy, in order:
      //  1. classic .message-in/.message-out bubbles
      //  2. rows with WhatsApp's stable ids (data-id="true_…" sent / "false_…" received)
      //  3. any element carrying message text ([data-pre-plain-text] / .selectable-text), bubbling
      //     up to its row; incoming vs outgoing then decided by which side of the pane it sits on.
      messages: () => {
        let a = $$('div.message-in, div.message-out'); if (a.length) return a;
        a = $$('[data-id^="true_"], [data-id^="false_"]'); if (a.length) return a;
        const seen = new Set(), rows = [];
        for (const t of $$('[data-pre-plain-text], span.selectable-text, .copyable-text')) {
          if (t.closest('.bx-bar, footer, [contenteditable]')) continue;
          const row = t.closest('[role="row"]') || t.closest('[data-id]') || t.parentElement?.parentElement?.parentElement || t;
          if (!seen.has(row)) { seen.add(row); rows.push(row); }
        }
        return rows;
      },
      isIncoming: (el) => {
        if (el.classList.contains('message-in') || el.querySelector(':scope .message-in')) return true;
        if (el.classList.contains('message-out') || el.querySelector(':scope .message-out')) return false;
        const id = el.getAttribute('data-id') || el.querySelector('[data-id]')?.getAttribute('data-id') || '';
        if (id.startsWith('false_')) return true; if (id.startsWith('true_')) return false;
        // Geometry: the bubble closer to the left edge of the chat pane is incoming.
        const bubble = adapters.whatsapp.textEl(el) || el; const r = bubble.getBoundingClientRect();
        const pane = (adapters.whatsapp.composer()?.closest('footer') || el.parentElement).getBoundingClientRect();
        return (r.left - pane.left) < (pane.right - r.right);
      },
      textEl: (el) => el.querySelector('.copyable-text span.selectable-text') || el.querySelector('span.selectable-text') || el.querySelector('[data-pre-plain-text]') || el.querySelector('.copyable-text') || (el.matches?.('[data-pre-plain-text], .selectable-text') ? el : null),
      strip: ['[data-icon]', '.read-more-button'],
      diag: () => `main:${!!$('#main')} rows:${$$('[role="row"]').length} pre:${$$('[data-pre-plain-text]').length} sel:${$$('span.selectable-text').length} copy:${$$('.copyable-text').length} ids:${$$('[data-id]').length}`,
    },
    telegramK: {
      id: 'telegramK',
      composer: () => $('.input-message-input[contenteditable="true"]'),
      sendButton: () => $('.btn-send') || $('.btn-send-container .btn-send'),
      barAnchor: () => $('.chat-input .chat-input-container') || $('.chat-input'),
      chatTitle: () => $('.chat-info .peer-title')?.textContent || $('.chat-info .user-title')?.textContent || '',
      messages: () => $$('.bubbles .bubble.is-in, .bubbles .bubble.is-out'),
      isIncoming: (el) => el.classList.contains('is-in'),
      textEl: (el) => el.querySelector('.message.spoilers-container') || el.querySelector('.message'),
      strip: ['.time', '.time-inner', '.reply', '.web', '.document-container', '.audio', '.bubble-name', '.name'],
    },
    telegramA: {
      id: 'telegramA',
      composer: () => $('#editable-message-text'),
      sendButton: () => $('.MessageInput .Button.send') || $('button.send') || $('[aria-label="Send Message"]'),
      barAnchor: () => $('.MessageInput') || $('.middle-column-footer'),
      chatTitle: () => $('.MiddleHeader .title')?.textContent || $('.MiddleHeader h3')?.textContent || '',
      messages: () => $$('.MessageList .Message'),
      isIncoming: (el) => !el.classList.contains('own'),
      textEl: (el) => el.querySelector('.text-content'),
      strip: ['.MessageMeta', '.message-title', '.EmbeddedMessage', '.WebPage', '.Audio', '.File'],
    },
  };
  function detect() {
    const h = location.hostname, p = location.pathname;
    if (h === 'web.whatsapp.com') return adapters.whatsapp;
    if (h === 'web.telegram.org') return p.startsWith('/a') ? adapters.telegramA : adapters.telegramK;
    return null;
  }
  const A = detect();
  if (!A) return;

  // ── State ──────────────────────────────────────────────────────────────────
  let S = null;                       // settings
  let bar = null, els = {};
  let lastDraft = null;               // for undo after "translate in place"
  const sentOriginals = [];           // [{ translated, original, at }] to label my outgoing bubbles
  const trCache = new Map();          // text|to → translation (page-local, cheap)
  let chatKey = '';

  function chatPref() { return (S.perChat && S.perChat[chatKey]) || {}; }
  function targetLang() { return chatPref().targetLanguage || S.targetLanguage; }
  function autoIncoming() { const p = chatPref(); return p.autoIncoming ?? S.autoIncoming; }
  async function savePerChat(patch) {
    if (!chatKey || chatKey.endsWith('|')) {               // chat not identified → don't pollute storage
      S = await bg({ type: 'SET_SETTINGS', patch: { targetLanguage: patch.targetLanguage || S.targetLanguage, autoIncoming: patch.autoIncoming ?? S.autoIncoming } });
      status('Could not identify this chat — saved as the default instead', 'err');
      return;
    }
    const perChat = { ...(S.perChat || {}) };
    perChat[chatKey] = { ...(perChat[chatKey] || {}), ...patch, updatedAt: Date.now() };
    S = await bg({ type: 'SET_SETTINGS', patch: { perChat } });
  }
  // Languages used across chats, most recent first — surfaced at the top of the "Send in" list.
  function recentLanguages() {
    const seen = new Set();
    return Object.values(S.perChat || {}).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .map(p => p.targetLanguage).filter(l => l && !seen.has(l) && seen.add(l)).slice(0, 8);
  }
  // Called with the detected source language of an incoming message. If the user never chose a
  // language for this chat, adopt the detected one so replies go out in the contact's language.
  async function noteDetectedLanguage(lang) {
    if (!lang || !chatKey) return;
    lang = lang.replace(/\s*\(.*?\)\s*$/, '').trim();
    if (!lang || /^(unknown|none|mixed|n\/a)$/i.test(lang)) return;
    if (lang.toLowerCase() === S.myLanguage.toLowerCase()) return;
    const p = chatPref();
    if (p.targetLanguage && !p.detected) return;            // user chose explicitly — respect it
    if (p.targetLanguage === lang) return;
    await savePerChat({ targetLanguage: lang, detected: true });
    syncBar();
    status(`This chat: sending in ${lang} (auto-detected)`, 'ok');
  }

  // ── Toolbar ────────────────────────────────────────────────────────────────
  function buildBar() {
    bar = document.createElement('div');
    bar.className = 'bx-bar';
    bar.innerHTML = `
      <span class="bx-logo" title="Bibix Chat AI — click for settings">A</span>
      <span class="bx-toggle" title="Enable / disable for all chats"></span>
      <label>Send in <select class="bx-target" title="Language my messages are sent in (per chat)"></select></label>
      <button class="bx-send bx-primary" title="Translate the draft and send (Ctrl/⌘+Shift+Enter)">Translate &amp; send</button>
      <button class="bx-inplace" title="Translate the draft in the box so you can review it (Ctrl/⌘+Shift+T)">Translate</button>
      <button class="bx-undo" title="Restore what you typed (Ctrl/⌘+Shift+U)" style="display:none">Undo</button>
      <button class="bx-qa-btn" title="Quick answers (Ctrl/⌘+Shift+Q) — click: insert to edit · double-click: translate &amp; send">⚡ Quick</button>
      <label title="Translate incoming messages into my language"><input type="checkbox" class="bx-auto" /> Incoming → <span class="bx-mylang"></span></label>
      <button class="bx-now" title="Translate the visible incoming messages now">Translate visible</button>
      <span class="bx-status"></span>`;
    els = {
      toggle: $('.bx-toggle', bar), target: $('.bx-target', bar), send: $('.bx-send', bar), inplace: $('.bx-inplace', bar),
      undo: $('.bx-undo', bar), auto: $('.bx-auto', bar), mylang: $('.bx-mylang', bar), now: $('.bx-now', bar), status: $('.bx-status', bar),
    };
    bg({ type: 'GET_META' }).then(({ languages }) => { allLanguages = languages; fillLangList(); }).catch(() => {});

    $('.bx-logo', bar).addEventListener('click', () => chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' }).catch(() => {}));
    els.toggle.addEventListener('click', async () => { S = await bg({ type: 'SET_SETTINGS', patch: { enabled: !S.enabled } }); syncBar(); });
    els.target.addEventListener('change', async () => {
      let v = els.target.value;
      if (v === '__other') { v = (window.prompt('Language to send this chat\'s messages in (e.g. Hebrew, Arabic, Japanese):', '') || '').trim(); }
      if (v) await savePerChat({ targetLanguage: v, detected: false });
      syncBar();
    });
    els.auto.addEventListener('change', async () => { await savePerChat({ autoIncoming: els.auto.checked }); if (els.auto.checked) scanIncoming(S.initialIncoming); });
    els.send.addEventListener('click', () => translateDraft(true));
    els.inplace.addEventListener('click', () => translateDraft(false));
    els.undo.addEventListener('click', undoDraft);
    els.now.addEventListener('click', () => scanIncoming(30, true));
    $('.bx-qa-btn', bar).addEventListener('click', () => toggleQA());
    // Keep key events inside the bar from reaching the app's hotkeys.
    bar.addEventListener('keydown', e => e.stopPropagation());
    return bar;
  }
  let allLanguages = [];
  function fillLangList() {
    const sel = els.target; if (!sel) return;
    const current = targetLang();
    const recent = recentLanguages();
    const rest = allLanguages.filter(l => !recent.includes(l));
    const opt = (l) => `<option value="${l.replace(/"/g, '&quot;')}">${l}</option>`;
    sel.innerHTML = [
      (current && !recent.includes(current) && !rest.includes(current)) ? opt(current) : '',
      recent.length ? `<optgroup label="Recent">${recent.map(opt).join('')}</optgroup>` : '',
      `<optgroup label="All languages">${rest.map(opt).join('')}</optgroup>`,
      `<option value="__other">Other…</option>`,
    ].join('');
    sel.value = current;
  }
  function syncBar() {
    if (!bar) return;
    bar.classList.toggle('bx-off', !S.enabled);
    els.toggle.classList.toggle('on', S.enabled);
    const p = chatPref();
    const chatName = chatKey.split('|').slice(1).join('|') || '(chat not identified)';
    els.target.title = `Chat: ${chatName}\n` + (p.targetLanguage
      ? (p.detected ? `Auto-detected from this chat's messages — pick another to override` : `Chosen by you for this chat`)
      : `Default language (pick one here for this chat, or it is auto-detected from incoming messages)`);
    els.target.classList.toggle('bx-detected', !!p.detected);
    fillLangList();
    els.auto.checked = !!autoIncoming();
    els.mylang.textContent = S.myLanguage;
    for (const b of [els.send, els.inplace, els.now]) b.disabled = !S.enabled;
  }
  function status(msg, kind) {
    if (!els.status) return;
    els.status.textContent = msg || '';
    els.status.className = 'bx-status' + (kind ? ' bx-' + kind : '');
    els.status.title = msg || '';
    if (kind === 'ok') setTimeout(() => { if (els.status.textContent === msg) status(''); }, 3000);
  }
  function mountBar() {
    const anchor = A.barAnchor();
    if (!bar) buildBar();
    if (anchor && !anchor.contains(bar)) { bar.classList.remove('bx-floating'); anchor.prepend(bar); }
    else if (!anchor && !document.body.contains(bar)) { bar.classList.add('bx-floating'); document.body.appendChild(bar); }
    syncBar();
    console.info('[Bibix Chat AI] mounted', { platform: A.id, chat: chatKey, anchor: !!anchor, composer: !!A.composer(), sendButton: !!A.sendButton(), messages: A.messages().length });
  }

  // ── Composer helpers ───────────────────────────────────────────────────────
  function readDraft() {
    const c = A.composer(); if (!c) throw new Error('Message box not found — the app changed its layout');
    return (c.innerText || c.textContent || '').replace(/ /g, ' ').replace(/\n$/, '');
  }
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  function selectAllIn(c) {
    const sel = window.getSelection(); const range = document.createRange();
    range.selectNodeContents(c); sel.removeAllRanges(); sel.addRange(range);
  }
  // Replace the draft and make sure the editor really took it (WhatsApp/Telegram use
  // React/Lexical editors whose internal state ignores plain DOM writes). Tries, in order:
  // execCommand insertText → synthetic paste → raw DOM. Throws if none stuck, so we never
  // send the untranslated draft by mistake.
  async function writeDraft(text) {
    const c = A.composer(); if (!c) throw new Error('Message box not found');
    const attempts = [
      ['insertText', () => { selectAllIn(c); document.execCommand('insertText', false, text); }],
      ['paste', () => { selectAllIn(c); const dt = new DataTransfer(); dt.setData('text/plain', text);
        c.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }],
      ['delete+insert', () => { selectAllIn(c); document.execCommand('delete', false, null); document.execCommand('insertText', false, text); }],
      ['dom', () => { c.textContent = text; c.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text })); }],
    ];
    c.focus();
    for (const [name, run] of attempts) {
      try { run(); } catch (_) {}
      await sleep(40);
      const got = norm(readDraft());
      console.info('[Bibix Chat AI] writeDraft via', name, got === norm(text) ? 'OK' : 'mismatch: ' + got.slice(0, 60));
      if (got === norm(text)) return;
    }
    throw new Error('Could not replace the draft — the editor rejected the text');
  }
  async function clickSend() {
    await sleep(80);
    sendingNow = true;
    try {
      const btn = A.sendButton();
      if (btn) { btn.click(); }
      else {
        const c = A.composer();
        c?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      }
      await sleep(150);
    } finally { sendingNow = false; }
  }

  async function translateDraft(andSend) {
    if (!S.enabled) return;
    const to = targetLang();
    els.send.disabled = els.inplace.disabled = true;
    try {
      const text = readDraft().trim();
      if (!text) { status('Type a message first', 'err'); return; }
      status(`Translating → ${to}…`, 'busy');
      const out = await translateText(text, S.myLanguage, to);
      console.info('[Bibix Chat AI] translated', { from: text, to: out });
      lastDraft = text;
      await writeDraft(out);
      els.undo.style.display = '';
      if (andSend) {
        sentOriginals.push({ translated: out, original: text, at: Date.now() });
        if (sentOriginals.length > 30) sentOriginals.shift();
        await clickSend();
        lastDraft = null; els.undo.style.display = 'none';
        status('Sent: ' + out, 'ok');
      } else status('Translated — review and press Enter', 'ok');
    } catch (e) { status(e.message, 'err'); }
    finally { els.send.disabled = els.inplace.disabled = !S.enabled; }
  }
  async function undoDraft() { if (lastDraft == null) return; await writeDraft(lastDraft).catch(e => status(e.message, 'err')); lastDraft = null; els.undo.style.display = 'none'; status('Restored', 'ok'); }

  async function translateText(text, from, to) {
    const k = from + '|' + to + '|' + text;
    if (trCache.has(k)) return trCache.get(k);
    const out = await bg({ type: 'TRANSLATE', text, from, to });
    trCache.set(k, out);
    return out;
  }
  // Incoming variant: also returns the detected source language → { text, lang }.
  async function translateDetect(text, to) {
    const k = 'detect|' + to + '|' + text;
    if (trCache.has(k)) return trCache.get(k);
    const out = await bg({ type: 'TRANSLATE', text, from: 'auto', to, detect: true });
    trCache.set(k, out);
    return out;
  }

  // ── Incoming messages ──────────────────────────────────────────────────────
  function extractText(el) {
    const t = A.textEl(el); if (!t) return '';
    const clone = t.cloneNode(true);
    for (const sel of A.strip) clone.querySelectorAll(sel).forEach(n => n.remove());
    clone.querySelectorAll('.bx-tr, .bx-tbtn').forEach(n => n.remove());
    clone.querySelectorAll('img[alt]').forEach(img => img.replaceWith(img.getAttribute('alt'))); // emoji images
    return (clone.innerText || clone.textContent || '').replace(/ /g, ' ').trim();
  }
  function noteFor(el, cls) {
    const t = A.textEl(el); if (!t) return null;
    let n = t.parentElement?.querySelector(':scope > .bx-tr.' + cls) || Array.from(t.parentElement?.children || []).find(c => c.classList?.contains('bx-tr') && c.classList.contains(cls));
    if (!n) { n = document.createElement('div'); n.className = 'bx-tr ' + cls; n.dataset.bxCls = cls; t.insertAdjacentElement('afterend', n); }
    return n;
  }
  function setNote(n, tag, body, state) {
    n.className = 'bx-tr ' + (n.dataset.bxCls || '') + (state ? ' bx-' + state : '');
    n.textContent = '';
    const tagEl = document.createElement('span'); tagEl.className = 'bx-tag'; tagEl.textContent = tag; n.appendChild(tagEl);
    n.appendChild(document.createTextNode(body));
    const x = document.createElement('span'); x.className = 'bx-act'; x.textContent = '✕'; x.title = 'Hide'; x.onclick = () => n.remove(); n.appendChild(x);
  }
  const inflight = new Set();
  // Returns what happened: 'notext' | 'seen' | 'busy' | 'noslot' | 'same' | 'done' | 'fail'
  async function translateIncoming(el, force) {
    const text = extractText(el);
    if (!text || text.length < 2) return 'notext';
    if (el.dataset.bxText === text && !force) return 'seen';   // already handled this content
    if (inflight.has(el)) return 'busy';
    inflight.add(el);
    el.dataset.bxText = text;
    const n = noteFor(el, 'bx-in'); if (!n) { inflight.delete(el); return 'noslot'; }
    setNote(n, S.myLanguage, 'translating…', 'pending');
    try {
      const { text: out, lang } = await translateDetect(text, S.myLanguage);
      if (lang && A.isIncoming(el)) noteDetectedLanguage(lang);
      if (norm(out) === norm(text)) { n.remove(); el.dataset.bxSame = '1'; return 'same'; }   // already in my language
      setNote(n, lang ? `${lang} → ${S.myLanguage}` : S.myLanguage, out, '');
      return 'done';
    } catch (e) { setNote(n, S.myLanguage, e.message, 'fail'); delete el.dataset.bxText; return 'fail'; }
    finally { inflight.delete(el); }
  }

  // ── Quick answers panel ────────────────────────────────────────────────────
  let qaGroups = null, qaPanel = null, qaSel = null, qaQuery = '', qaPending = null, qaCloseTimer = null, qaLastClick = { id: null, at: 0 };
  // Close the panel when clicking elsewhere (registered once).
  document.addEventListener('mousedown', (e) => { if (qaPanel && !qaPanel.contains(e.target) && !e.target.closest?.('.bx-qa-btn')) toggleQA(false); }, true);
  async function loadQA() { try { qaGroups = await bg({ type: 'GET_QA' }); } catch (_) { qaGroups = []; } }
  function toggleQA(force) {
    const open = force ?? !(qaPanel && document.body.contains(qaPanel));
    if (!open) { qaPanel?.remove(); qaPanel = null; return; }
    (qaGroups ? Promise.resolve() : loadQA()).then(() => { renderQA(); positionQA(); $('.bx-qa-search', qaPanel)?.focus(); });
  }
  function positionQA() {
    if (!qaPanel || !bar) return;
    const r = bar.getBoundingClientRect();
    qaPanel.style.left = Math.max(8, r.left + 8) + 'px';
    qaPanel.style.bottom = Math.max(8, window.innerHeight - r.top + 6) + 'px';
    qaPanel.style.width = Math.min(640, r.width - 16) + 'px';
  }
  function renderQA() {
    if (!qaPanel) {
      qaPanel = document.createElement('div'); qaPanel.className = 'bx-qa';
      qaPanel.innerHTML = `
        <div class="bx-qa-head"><input class="bx-qa-search" placeholder="Search quick answers… (Enter inserts the first match, Shift+Enter sends it)" /><span class="bx-act bx-qa-close" title="Close (Esc)">✕</span></div>
        <div class="bx-qa-body"><div class="bx-qa-groups"></div><div class="bx-qa-list"></div></div>
        <div class="bx-qa-foot"><span><b>Click</b>: put in the box to edit (Enter then translates &amp; sends) · <b>Double-click</b>: translate &amp; send now</span><a class="bx-qa-manage">Manage ↗</a></div>`;
      document.body.appendChild(qaPanel);
      qaPanel.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Escape') { toggleQA(false); A.composer()?.focus(); }
        if (e.key === 'Enter' && e.target.classList.contains('bx-qa-search')) { const first = qaVisibleItems()[0]; if (first) useQuickAnswer(first, e.shiftKey); }
      });
      $('.bx-qa-search', qaPanel).addEventListener('input', (e) => { qaQuery = e.target.value.toLowerCase().trim(); renderQA(); });
      $('.bx-qa-close', qaPanel).addEventListener('click', () => toggleQA(false));
      $('.bx-qa-manage', qaPanel).addEventListener('click', () => chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS', section: 'quick-answers' }).catch(() => {}));
      $('.bx-qa-groups', qaPanel).addEventListener('click', (e) => { const g = e.target.closest('[data-g]'); if (g) { qaSel = g.dataset.g; renderQA(); } });
      // Click handling: we count clicks ourselves (WhatsApp swallows some dblclick events).
      // 1st click → insert; 2nd click on the same answer within 600 ms, or the ➤ button → translate & send.
      $('.bx-qa-list', qaPanel).addEventListener('click', (e) => {
        const row = e.target.closest('[data-i]'); if (!row) return;
        const item = findQA(row.dataset.i); if (!item) return;
        const now = Date.now();
        const second = e.target.closest('.bx-qa-send') || (qaLastClick.id === item.id && now - qaLastClick.at < 600);
        qaLastClick = second ? { id: null, at: 0 } : { id: item.id, at: now };
        if (second) { clearTimeout(qaCloseTimer); useQuickAnswer(item, true); }
        else qaPending = useQuickAnswer(item, false);
      });
      $('.bx-qa-list', qaPanel).addEventListener('dblclick', (e) => { e.preventDefault(); e.stopPropagation(); });
    }
    const groups = qaGroups || [];
    if (!groups.find(g => g.id === qaSel)) qaSel = groups[0]?.id || null;
    $('.bx-qa-groups', qaPanel).innerHTML = groups.map(g => `<div class="bx-qa-g ${g.id === qaSel ? 'on' : ''}" data-g="${g.id}">${escHtml(g.name)} <small>${g.items.length}</small></div>`).join('')
      || '<div class="bx-qa-empty">No quick answers yet.<br>Click “Manage” to create groups and answers.</div>';
    const items = qaVisibleItems();
    $('.bx-qa-list', qaPanel).innerHTML = items.map(it => `<div class="bx-qa-i" data-i="${it.id}"><div class="bx-qa-t">${escHtml(it.title || it.text.slice(0, 40))}${qaQuery ? ` <small>${escHtml(it._g)}</small>` : ''}</div><div class="bx-qa-x">${escHtml(it.text)}</div><span class="bx-qa-send" title="Translate & send now">➤</span></div>`).join('')
      || `<div class="bx-qa-empty">${qaQuery ? 'No match.' : 'This group is empty.'}</div>`;
  }
  function qaVisibleItems() {
    const groups = qaGroups || [];
    if (qaQuery) return groups.flatMap(g => g.items.map(it => ({ ...it, _g: g.name }))).filter(it => (it.title + ' ' + it.text).toLowerCase().includes(qaQuery));
    return (groups.find(g => g.id === qaSel)?.items || []).map(it => ({ ...it, _g: '' }));
  }
  function findQA(id) { for (const g of qaGroups || []) { const it = g.items.find(i => i.id === id); if (it) return it; } return null; }
  function escHtml(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  async function useQuickAnswer(item, sendNow) {
    const text = (item.text || '').trim(); if (!text) return;
    console.info('[Bibix Chat AI] quick answer', { sendNow, title: item.title, enabled: S.enabled, my: S.myLanguage, to: targetLang() });
    try {
      if (!sendNow) {
        // Keep the panel briefly so a double-click can still land on the row; then close it.
        clearTimeout(qaCloseTimer); qaCloseTimer = setTimeout(() => toggleQA(false), 500);
        await writeDraft(text);
        A.composer()?.focus();
        status(`Inserted “${item.title || text.slice(0, 30)}” — edit, then Enter sends it in ${targetLang()}`, 'ok');
        return;
      }
      // Double-click: the first click already inserted the text (or is doing so) — wait for it,
      // then translate what is in the box to the chat language and send it, same path as Enter.
      try { await qaPending; } catch (_) {}
      qaPending = null;
      clearTimeout(qaCloseTimer); toggleQA(false);
      if (!S.enabled) { status('Turn the toolbar on to translate', 'err'); return; }
      if (norm(readDraft()) !== norm(text)) await writeDraft(text);
      await translateDraft(true);
    } catch (e) { status(e.message, 'err'); }
  }

  // ── Right-click → Translate (any bubble, or just the selected text) ─────────
  let contextTarget = null;
  document.addEventListener('contextmenu', (e) => { contextTarget = e.target; }, true);
  function bubbleFor(node) {
    if (!node) return null;
    const msgs = A.messages();
    return msgs.find(m => m === node || m.contains(node)) || null;
  }
  function showPopover(anchor, title, body, state) {
    document.querySelectorAll('.bx-pop').forEach(p => p.remove());
    const pop = document.createElement('div'); pop.className = 'bx-pop' + (state ? ' bx-' + state : '');
    const h = document.createElement('div'); h.className = 'bx-pop-title'; h.textContent = title;
    const x = document.createElement('span'); x.className = 'bx-act'; x.textContent = '✕'; x.onclick = () => pop.remove(); h.appendChild(x);
    const b = document.createElement('div'); b.className = 'bx-pop-body'; b.textContent = body;
    pop.append(h, b); document.body.appendChild(pop);
    const r = (anchor?.getBoundingClientRect?.()) || { left: 40, bottom: 80, top: 80 };
    const w = Math.min(420, window.innerWidth - 32);
    pop.style.width = w + 'px';
    pop.style.left = Math.max(16, Math.min(r.left, window.innerWidth - w - 16)) + 'px';
    const below = r.bottom + 8, ph = pop.offsetHeight;
    pop.style.top = (below + ph < window.innerHeight - 8 ? below : Math.max(8, r.top - ph - 8)) + 'px';
    return pop;
  }
  async function contextTranslate(selectionText) {
    if (!S.enabled) { status('Toolbar is off', 'err'); return; }
    const sel = (selectionText || '').trim();
    if (sel) {
      const pop = showPopover(contextTarget, `Translating → ${S.myLanguage}…`, sel, 'pending');
      try {
        const { text, lang } = await translateDetect(sel, S.myLanguage);
        pop.remove(); showPopover(contextTarget, `${lang || 'Translation'} → ${S.myLanguage}`, text, '');
      } catch (e) { pop.remove(); showPopover(contextTarget, 'Translation failed', e.message, 'fail'); }
      return;
    }
    const el = bubbleFor(contextTarget);
    if (!el) { status('Right-click on a message bubble to translate it', 'err'); return; }
    const r = await translateIncoming(el, true);
    if (r === 'same') status(`That message is already in ${S.myLanguage}`, 'ok');
    else if (r === 'notext') status('No text in that message (media?)', 'err');
  }
  // Small "translate" icon shown on hover at the end of every bubble's text (the apps swallow
  // the native right-click menu, so this is the reliable on-demand path).
  function addTranslateButton(el) {
    if (el.dataset.bxBtn) return;
    const t = A.textEl(el); if (!t || !t.parentElement) return;
    el.dataset.bxBtn = '1';
    const b = document.createElement('span');
    b.className = 'bx-tbtn'; b.textContent = '🌐'; b.title = `Translate this message → ${S.myLanguage}`;
    b.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); });
    b.addEventListener('click', async (e) => {
      e.preventDefault(); e.stopPropagation();
      const existing = t.parentElement.querySelector(':scope > .bx-tr.bx-in');
      if (existing && !existing.classList.contains('bx-fail')) { existing.remove(); delete el.dataset.bxText; return; }   // toggle off
      b.classList.add('bx-busy');
      const r = await translateIncoming(el, true);
      b.classList.remove('bx-busy');
      if (r === 'same') status(`That message is already in ${S.myLanguage}`, 'ok');
      else if (r === 'notext') status('No text in that message', 'err');
    });
    t.insertAdjacentElement('afterend', b);
  }
  function labelOutgoing(el) {
    if (!S.showOriginalOutgoing || el.dataset.bxOut) return;
    const text = extractText(el); if (!text) return;
    const hit = sentOriginals.find(s => s.translated.trim() === text.trim() && Date.now() - s.at < 5 * 60 * 1000);
    if (!hit) return;
    el.dataset.bxOut = '1';
    const n = noteFor(el, 'bx-orig'); if (!n) return;
    setNote(n, 'you wrote', hit.original, '');
  }
  async function scanIncoming(limit, force) {
    if (!S.enabled) return;
    const msgs = A.messages();
    if (force || autoIncoming()) {
      const incoming = msgs.filter(A.isIncoming);
      const slice = limit ? incoming.slice(-limit) : incoming;
      if (force) {
        if (!incoming.length) { status(`No incoming messages found (${msgs.length} bubbles; ${A.diag ? A.diag() : ''})`, 'err'); return; }
        status(`Translating ${slice.length} incoming…`, 'busy');
        const results = await Promise.all(slice.map(el => translateIncoming(el, true)));
        const c = (k) => results.filter(r => r === k).length;
        const parts = [];
        if (c('done')) parts.push(`${c('done')} translated`);
        if (c('same')) parts.push(`${c('same')} already in ${S.myLanguage}`);
        if (c('fail')) parts.push(`${c('fail')} failed`);
        if (c('notext') + c('noslot')) parts.push(`${c('notext') + c('noslot')} without text`);
        status(parts.join(', ') || 'Nothing to do', c('fail') ? 'err' : 'ok');
        console.info('[Bibix Chat AI] translate visible', { bubbles: msgs.length, incoming: incoming.length, results });
      } else {
        for (const el of slice) translateIncoming(el, force);
      }
    }
    for (const el of msgs) { if (!A.isIncoming(el)) labelOutgoing(el); addTranslateButton(el); }
  }

  // ── Observe the app ────────────────────────────────────────────────────────
  let scanTimer = null;
  function onMutation() {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      const title = A.chatTitle().trim();
      const key = A.id + '|' + title;
      if (key !== chatKey) {
        chatKey = key; mountBar(); scanIncoming(S.initialIncoming);
        status(title ? `Chat: ${title} · send in ${targetLang()}${chatPref().targetLanguage ? '' : ' (default)'}` : 'Chat not identified — language saved as default', title ? 'ok' : 'err');
        return;
      }
      if (!bar || !document.body.contains(bar)) mountBar();
      scanIncoming(autoIncoming() ? 8 : 0);   // only the newest few on routine mutations
    }, 350);
  }

  let sendingNow = false;   // set while clickSend() fires so our own Enter passes through
  document.addEventListener('keydown', (e) => {
    const c = A.composer(); if (!c || !c.contains(document.activeElement)) return;
    // Plain Enter = translate & send (when enabled and the option is on). Shift+Enter still = newline.
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && !e.isComposing) {
      if (!S?.enabled || S.enterTranslates === false || sendingNow) return;
      if (!norm(readDraft())) return;                       // let the app handle empty Enter
      e.preventDefault(); e.stopImmediatePropagation(); translateDraft(true); return;
    }
    if (!(e.ctrlKey || e.metaKey) || !e.shiftKey) return;
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); translateDraft(true); }
    else if (e.key.toLowerCase() === 't') { e.preventDefault(); e.stopPropagation(); translateDraft(false); }
    else if (e.key.toLowerCase() === 'u') { e.preventDefault(); e.stopPropagation(); undoDraft(); }
    else if (e.key.toLowerCase() === 'q') { e.preventDefault(); e.stopPropagation(); toggleQA(); }
  }, true);
  // WhatsApp's own send arrow: when the toolbar is on, route it through translate & send too,
  // so a message can't leave untranslated whichever way it is sent.
  document.addEventListener('click', (e) => {
    if (!S?.enabled || S.enterTranslates === false || sendingNow) return;
    const btn = A.sendButton(); if (!btn || !(btn === e.target || btn.contains(e.target))) return;
    let draft = ''; try { draft = norm(readDraft()); } catch (_) { return; }
    if (!draft) return;
    e.preventDefault(); e.stopImmediatePropagation();
    translateDraft(true);
  }, true);
  window.addEventListener('resize', positionQA);

  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    if (msg?.type === 'SETTINGS_CHANGED') { S = { ...S, ...msg.settings }; syncBar(); if (S.enabled && autoIncoming()) scanIncoming(S.initialIncoming); }
    if (msg?.type === 'GET_CHAT') reply({ chatKey, title: A.chatTitle().trim(), platform: A.id });
    if (msg?.type === 'TRANSLATE_VISIBLE') { scanIncoming(30, true); reply({ ok: true }); }
    if (msg?.type === 'CONTEXT_TRANSLATE') { contextTranslate(msg.selectionText); reply({ ok: true }); }
    if (msg?.type === 'QA_CHANGED') { qaGroups = msg.groups; if (qaPanel && document.body.contains(qaPanel)) renderQA(); }
  });

  async function init() {
    S = await bg({ type: 'GET_SETTINGS' });
    new MutationObserver(onMutation).observe(document.body, { childList: true, subtree: true, characterData: true });
    onMutation();
  }
  init().catch(e => console.warn('[Bibix Chat AI]', e));
})();
