// Bibix Chat AI — background service worker.
// Owns API keys + provider calls. Content scripts / popup never see keys;
// they send { type: 'TRANSLATE' } and get text back.
importScripts('providers.js');

// ── Settings ───────────────────────────────────────────────────────────────────
async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...BX_DEFAULT_SETTINGS, ...(settings || {}) };
}
async function setSettings(patch) {
  const cur = await getSettings();
  const next = { ...cur, ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}

// ── Prompt ─────────────────────────────────────────────────────────────────────
function buildSystemPrompt({ from, to, style, detect }) {
  return [
    `You are a professional translator embedded in a chat app.`,
    `Translate the user's message ${from && from !== 'auto' ? `from ${from} ` : ''}into ${to}.`,
    `Rules:`,
    detect
      ? `- The very first line of your output must be exactly "LANG: <name of the source language in English>" (e.g. "LANG: Hebrew"), then a newline, then ONLY the translated text. Nothing else.`
      : `- Output ONLY the translated text. No quotes, no preamble, no notes, no alternatives.`,
    `- Keep the tone, register, slang, emojis, punctuation and line breaks of the original.`,
    `- Keep names, URLs, numbers, @mentions, hashtags and code unchanged.`,
    `- If the message is already in ${to}, return it exactly as is.`,
    `- Never answer or react to the message; only translate it.`,
    style ? `Style instructions from the user: ${style}` : '',
  ].filter(Boolean).join('\n');
}

function cleanOutput(text, original) {
  let t = (text || '').trim();
  // Strip wrapping quotes some models add.
  if (t.length > 1 && /^["“”'«]/.test(t) && /["“”'»]$/.test(t) && !/^["“”'«]/.test(original.trim())) t = t.slice(1, -1).trim();
  return t;
}

// ── Provider calls (raw fetch; MV3 workers can't bundle SDKs) ──────────────────
async function callOpenAICompatible(cfg, system, text) {
  const headers = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers['Authorization'] = 'Bearer ' + cfg.apiKey;
  if (cfg.id === 'openrouter') { headers['HTTP-Referer'] = 'https://bibix.app'; headers['X-Title'] = 'Bibix Chat AI'; }
  const res = await fetch(cfg.baseUrl + '/chat/completions', {
    method: 'POST', headers,
    body: JSON.stringify({
      model: cfg.model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: text }],
      temperature: 0.2,
      // Reasoning models (GPT-OSS on Groq) think before answering; translation needs little of it.
      ...(cfg.id === 'groq' && /gpt-oss/.test(cfg.model) ? { reasoning_effort: 'low' } : {}),
    }),
  });
  const data = await readJson(res);
  return data.choices?.[0]?.message?.content ?? '';
}

async function callAnthropic(cfg, system, text) {
  const res = await fetch(cfg.baseUrl + '/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': cfg.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: 4096,
      system,
      output_config: { effort: 'low' },
      messages: [{ role: 'user', content: text }],
    }),
  });
  const data = await readJson(res);
  if (data.stop_reason === 'refusal') throw new Error('Model refused to translate this message');
  return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
}

async function callGemini(cfg, system, text) {
  const url = `${cfg.baseUrl}/models/${encodeURIComponent(cfg.model)}:generateContent?key=${encodeURIComponent(cfg.apiKey)}`;
  const res = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text }] }],
      generationConfig: { temperature: 0.2 },
    }),
  });
  const data = await readJson(res);
  return data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') ?? '';
}

async function readJson(res) {
  let data = null;
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) {
    const msg = data?.error?.message || data?.error || data?.message || `HTTP ${res.status}`;
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  return data || {};
}

async function listModels(cfg) {
  if (cfg.kind === 'gemini') {
    const data = await readJson(await fetch(`${cfg.baseUrl}/models?key=${encodeURIComponent(cfg.apiKey)}&pageSize=200`));
    return (data.models || []).map(m => m.name.replace(/^models\//, ''))
      .filter(n => /gemini/.test(n) && !/embedding|imagen|veo|tts|audio/.test(n)).sort();
  }
  if (cfg.kind === 'anthropic') {
    const data = await readJson(await fetch(cfg.baseUrl + '/models?limit=100', {
      headers: { 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    }));
    return (data.data || []).map(m => m.id).sort();
  }
  const headers = cfg.apiKey ? { Authorization: 'Bearer ' + cfg.apiKey } : {};
  const data = await readJson(await fetch(cfg.baseUrl + '/models', { headers }));
  return (data.data || data.models || []).map(m => m.id || m.name).filter(Boolean).sort();
}

// ── Translation with a small in-memory cache ───────────────────────────────────
const cache = new Map();
const CACHE_MAX = 600;
function cacheGet(k) { const v = cache.get(k); if (v !== undefined) { cache.delete(k); cache.set(k, v); } return v; }
function cacheSet(k, v) { cache.set(k, v); if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value); }

async function ensureHostPermission(baseUrl) {
  if (!baseUrl) return;
  let origin;
  try { origin = new URL(baseUrl).origin + '/*'; } catch (_) { return; }
  const has = await chrome.permissions.contains({ origins: [origin] }).catch(() => true);
  if (!has) throw new Error(`Grant access to ${origin} in the extension options first.`);
}

// With `detect: true` the result is { text, lang } (lang = detected source language, may be null);
// otherwise it is the translated string.
async function translate({ text, from, to, providerId, detect }) {
  const settings = await getSettings();
  const id = providerId || settings.provider;
  const cfg = bxProviderConfig(settings, id);
  if (!cfg.model) throw new Error(`No model set for ${BX_PROVIDERS[id]?.name || id}`);
  if (!cfg.apiKey && !cfg.noKey) throw new Error(`No API key for ${BX_PROVIDERS[id]?.name || id} — open the extension options`);
  if (BX_PROVIDERS[id]?.editableUrl) await ensureHostPermission(cfg.baseUrl);

  const key = [id, cfg.model, from || 'auto', to, settings.style, detect ? 'd' : '', text].join('\u0001');
  const hit = cacheGet(key);
  if (hit) return hit;

  const system = buildSystemPrompt({ from, to, style: settings.style, detect });
  let raw;
  if (cfg.kind === 'anthropic') raw = await callAnthropic(cfg, system, text);
  else if (cfg.kind === 'gemini') raw = await callGemini(cfg, system, text);
  else raw = await callOpenAICompatible(cfg, system, text);

  let lang = null, body = raw || '';
  if (detect) {
    const m = body.match(/^\s*LANG:\s*([^\n]+)\n?([\s\S]*)$/i);
    if (m) { lang = m[1].trim().replace(/[.*_`"']+$/g, '').trim(); body = m[2]; }
  }
  const out = cleanOutput(body, text);
  if (!out) throw new Error('Empty translation from model');
  const result = detect ? { text: out, lang } : out;
  cacheSet(key, result);
  return result;
}

// ── Message router ─────────────────────────────────────────────────────────────
const handlers = {
  GET_SETTINGS: () => getSettings(),
  SET_SETTINGS: ({ patch }) => setSettings(patch),
  GET_META: () => ({ providers: BX_PROVIDERS, languages: BX_LANGUAGES }),
  OPEN_OPTIONS: () => chrome.runtime.openOptionsPage(),
  TRANSLATE: (msg) => translate(msg),
  TEST_PROVIDER: async ({ providerId }) => {
    const out = await translate({ text: 'Hello! How are you today?', from: 'English', to: 'Spanish', providerId });
    return { sample: out };
  },
  LIST_MODELS: async ({ providerId }) => {
    const settings = await getSettings();
    const cfg = bxProviderConfig(settings, providerId);
    return { models: await listModels(cfg) };
  },
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const h = handlers[msg?.type];
  if (!h) { sendResponse({ ok: false, error: 'Unknown message ' + msg?.type }); return false; }
  Promise.resolve().then(() => h(msg))
    .then(data => sendResponse({ ok: true, data }))
    .catch(err => sendResponse({ ok: false, error: err?.message || String(err) }));
  return true; // async
});

// Broadcast settings changes to open chat tabs so the toolbar updates live.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings) return;
  chrome.tabs.query({ url: ['https://web.whatsapp.com/*', 'https://web.telegram.org/*'] }, tabs => {
    for (const t of tabs) chrome.tabs.sendMessage(t.id, { type: 'SETTINGS_CHANGED', settings: changes.settings.newValue }).catch(() => {});
  });
});

// ── Right-click menu on chat pages ─────────────────────────────────────────────
const CHAT_URLS = ['https://web.whatsapp.com/*', 'https://web.telegram.org/*'];
function installMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'bx-translate-message', title: 'Translate this message', contexts: ['page', 'link', 'image'], documentUrlPatterns: CHAT_URLS });
    chrome.contextMenus.create({ id: 'bx-translate-selection', title: 'Translate selected text', contexts: ['selection'], documentUrlPatterns: CHAT_URLS });
  });
}
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id || !String(info.menuItemId).startsWith('bx-')) return;
  chrome.tabs.sendMessage(tab.id, { type: 'CONTEXT_TRANSLATE', selectionText: info.menuItemId === 'bx-translate-selection' ? (info.selectionText || '') : '' }).catch(() => {});
});

chrome.runtime.onInstalled.addListener(({ reason }) => {
  installMenus();
  if (reason === 'install') chrome.runtime.openOptionsPage();
});
chrome.runtime.onStartup.addListener(installMenus);
