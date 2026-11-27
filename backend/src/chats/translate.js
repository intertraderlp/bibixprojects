// ─────────────────────────────────────────────────────────────────────────────
// Chats — translation service. Same prompt format as the Chrome extension
// (extension-chat-ai/background.js: buildSystemPrompt + "LANG:" detect line),
// run server-side with the user's keys from `user_ai_providers` (routes/ai.js).
// Keys never reach the browser.
// ─────────────────────────────────────────────────────────────────────────────
const db = require('../db/database');
const { generateText, getProviderConfig, listProviders } = require('../services/aiProviders');

// Chat-oriented default models (the catalog defaults in aiProviders.js are tuned for other modules).
const CHAT_DEFAULT_MODEL = {
  groq: 'openai/gpt-oss-120b',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-haiku-5-5',
  gemini: 'gemini-2.5-flash',
  mistral: 'mistral-small-latest',
  deepseek: 'deepseek-chat',
  grok: 'grok-3-mini',
};
const ENV_KEY = { groq: 'GROQ_API_KEY', openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', gemini: 'GEMINI_API_KEY', grok: 'GROK_API_KEY', mistral: 'MISTRAL_API_KEY', deepseek: 'DEEPSEEK_API_KEY' };

const LANGUAGES = [
  'English', 'Spanish', 'Portuguese', 'French', 'German', 'Italian', 'Dutch', 'Russian', 'Ukrainian', 'Polish',
  'Romanian', 'Greek', 'Turkish', 'Hebrew', 'Arabic', 'Persian', 'Hindi', 'Urdu', 'Bengali', 'Chinese (Simplified)',
  'Chinese (Traditional)', 'Japanese', 'Korean', 'Vietnamese', 'Thai', 'Indonesian', 'Malay', 'Filipino', 'Swedish',
  'Norwegian', 'Danish', 'Finnish', 'Czech', 'Hungarian', 'Catalan', 'Swahili',
];

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
  if (t.length > 1 && /^["“”'«]/.test(t) && /["“”'»]$/.test(t) && !/^["“”'«]/.test(original.trim())) t = t.slice(1, -1).trim();
  return t;
}

// Which provider/key/model to use for this user: chat settings override → user's default provider → env key.
function resolveProvider(userId, settings) {
  const rows = db.prepare('SELECT provider, api_key, model, base_url, is_default FROM user_ai_providers WHERE user_id = ? ORDER BY is_default DESC, created_at DESC').all(userId);
  let row = null;
  if (settings?.provider) row = rows.find(r => r.provider === settings.provider) || null;
  if (!row) row = rows.find(r => r.is_default) || rows[0] || null;
  let provider = row?.provider || settings?.provider || null, apiKey = row?.api_key || null, baseUrl = row?.base_url || null;
  if (!apiKey) {
    // env fallbacks (dev/admin convenience), same order as the extension's defaults
    for (const p of [provider, 'groq', 'openai', 'anthropic', 'gemini', 'grok', 'mistral', 'deepseek'].filter(Boolean)) {
      if (process.env[ENV_KEY[p]]) { provider = p; apiKey = process.env[ENV_KEY[p]]; break; }
    }
  }
  if (!provider || !apiKey) return null;
  const cfg = getProviderConfig(provider); if (!cfg) return null;
  const model = (settings?.provider === provider && settings?.model) || row?.model || CHAT_DEFAULT_MODEL[provider] || cfg.default_model;
  return { provider, apiKey, model, baseUrl: baseUrl || cfg.base_url, display: cfg.display };
}

// Small LRU so re-renders and repeated phrases cost no tokens.
const cache = new Map(); const CACHE_MAX = 1000;
function cacheGet(k) { const v = cache.get(k); if (v !== undefined) { cache.delete(k); cache.set(k, v); } return v; }
function cacheSet(k, v) { cache.set(k, v); if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value); }

// translate({ userId, settings, text, from, to, detect }) → detect ? { text, lang } : { text }
async function translate({ userId, settings, text, from = 'auto', to, detect = false }) {
  if (!text || !text.trim()) throw Object.assign(new Error('text required'), { status: 400 });
  if (!to) throw Object.assign(new Error('target language required'), { status: 400 });
  const p = resolveProvider(userId, settings);
  if (!p) throw Object.assign(new Error('No AI provider key configured — add one in Bibix → Settings → AI providers (Groq is free)'), { status: 412 });
  const style = settings?.style || '';
  const key = [p.provider, p.model, from, to, style, detect ? 'd' : '', text].join('\u0001');
  const hit = cacheGet(key); if (hit) return hit;

  const system = buildSystemPrompt({ from, to, style, detect });
  const raw = await generateText(p.provider, p.apiKey, { prompt: text, system, model: p.model, base_url: p.baseUrl, temperature: 0.2, max_tokens: Math.min(4000, Math.max(300, text.length * 3)) });
  let lang = null, body = raw || '';
  if (detect) {
    const m = body.match(/^\s*LANG:\s*([^\n]+)\n?([\s\S]*)$/i);
    if (m) { lang = m[1].trim().replace(/[.*_`"']+$/g, '').trim(); body = m[2]; }
  }
  const out = cleanOutput(body, text);
  if (!out) throw new Error('Empty translation from model');
  const result = { text: out, lang: detect ? lang : null, provider: p.provider, model: p.model };
  cacheSet(key, result);
  return result;
}

// ── Speech → text (call captions). Groq Whisper (free) or OpenAI, whichever has a key. ──
const STT = {
  groq:   { url: 'https://api.groq.com/openai/v1/audio/transcriptions', model: 'whisper-large-v3-turbo' },
  openai: { url: 'https://api.openai.com/v1/audio/transcriptions',      model: 'gpt-4o-mini-transcribe' },
};
function resolveStt(userId, settings) {
  const rows = db.prepare('SELECT provider, api_key FROM user_ai_providers WHERE user_id = ? AND provider IN (?, ?)').all(userId, 'groq', 'openai');
  const order = [settings?.sttProvider, 'groq', 'openai'].filter(Boolean);
  for (const p of order) {
    const key = rows.find(r => r.provider === p)?.api_key || process.env[ENV_KEY[p]];
    if (key && STT[p]) return { provider: p, apiKey: key, ...STT[p] };
  }
  return null;
}
// transcribe({ userId, settings, audio (base64), mime, language?, prompt? }) → { text, provider }
async function transcribe({ userId, settings, audio, mime = 'audio/wav', language, prompt }) {
  if (!audio) throw Object.assign(new Error('audio required'), { status: 400 });
  const p = resolveStt(userId, settings);
  if (!p) throw Object.assign(new Error('Call captions need a Groq (free) or OpenAI key — add one in Bibix → Settings → AI providers'), { status: 412 });
  const bytes = Buffer.from(audio, 'base64');
  if (bytes.length > 24 * 1024 * 1024) throw Object.assign(new Error('audio chunk too large'), { status: 413 });
  const ext = /wav/.test(mime) ? 'wav' : /webm/.test(mime) ? 'webm' : /mp4|m4a|aac/.test(mime) ? 'mp4' : /ogg|opus/.test(mime) ? 'ogg' : 'wav';
  const fd = new FormData();
  fd.append('file', new Blob([bytes], { type: mime }), 'chunk.' + ext);
  fd.append('model', p.model);
  fd.append('response_format', 'json');
  if (language) fd.append('language', language);
  if (prompt) fd.append('prompt', prompt);
  const r = await fetch(p.url, { method: 'POST', headers: { Authorization: 'Bearer ' + p.apiKey }, body: fd });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message || `${p.provider} ${r.status}`);
  return { text: String(j?.text || '').trim(), provider: p.provider };
}
function sttInfo(userId, settings) { const p = resolveStt(userId, settings); return p ? { provider: p.provider, model: p.model } : null; }

function providerInfo(userId, settings) {
  const p = resolveProvider(userId, settings);
  return p ? { provider: p.provider, model: p.model, display: p.display } : null;
}

module.exports = { translate, transcribe, sttInfo, buildSystemPrompt, resolveProvider, providerInfo, LANGUAGES, CHAT_DEFAULT_MODEL, listProviders };
