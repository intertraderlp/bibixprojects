// ─────────────────────────────────────────────────────────────────────────────
// AI provider abstraction
//
// One adapter per supported provider so the rest of the app can just call
// `generateText(provider, apiKey, opts)` without knowing which vendor it is.
// Most providers expose an OpenAI-compatible /chat/completions endpoint, so
// they all share a single adapter (`callOpenAICompat`). Anthropic Claude and
// Google Gemini have their own request shapes so each gets a dedicated call.
//
// To add a new OpenAI-compatible provider: just add a row to PROVIDERS with
// style:'openai' and the correct base_url + default_model. No code changes.
//
// Keys are stored per-user in `user_ai_providers` (see routes/ai.js); env
// var fallbacks (GROQ_API_KEY, OPENAI_API_KEY, etc.) are honoured for
// dev/admin convenience but the per-user key always wins.
// ─────────────────────────────────────────────────────────────────────────────

const fetchFn = (typeof fetch === 'function') ? fetch : require('node-fetch');

// Display order chosen for the settings UI — most popular / cheapest first.
const PROVIDERS = {
  groq: {
    display: 'Groq',
    base_url: 'https://api.groq.com/openai/v1',
    default_model: 'llama-3.3-70b-versatile',
    style: 'openai',
    docs_url: 'https://console.groq.com/keys',
    free_tier: true,
  },
  openai: {
    display: 'OpenAI',
    base_url: 'https://api.openai.com/v1',
    default_model: 'gpt-4o-mini',
    style: 'openai',
    docs_url: 'https://platform.openai.com/api-keys',
    free_tier: false,
  },
  anthropic: {
    display: 'Anthropic Claude',
    base_url: 'https://api.anthropic.com/v1',
    default_model: 'claude-3-5-haiku-latest',
    style: 'anthropic',
    docs_url: 'https://console.anthropic.com/settings/keys',
    free_tier: false,
  },
  gemini: {
    display: 'Google Gemini',
    base_url: 'https://generativelanguage.googleapis.com/v1beta',
    default_model: 'gemini-2.0-flash',
    style: 'gemini',
    docs_url: 'https://aistudio.google.com/app/apikey',
    free_tier: true,
  },
  grok: {
    display: 'xAI Grok',
    base_url: 'https://api.x.ai/v1',
    default_model: 'grok-2-1212',
    style: 'openai',
    docs_url: 'https://console.x.ai',
    free_tier: false,
  },
  perplexity: {
    display: 'Perplexity',
    base_url: 'https://api.perplexity.ai',
    default_model: 'llama-3.1-sonar-small-128k-online',
    style: 'openai',
    docs_url: 'https://www.perplexity.ai/settings/api',
    free_tier: false,
  },
  z_ai: {
    display: 'Z.AI (GLM)',
    base_url: 'https://api.z.ai/api/paas/v4',
    default_model: 'glm-4-flash',
    style: 'openai',
    docs_url: 'https://docs.z.ai/',
    free_tier: true,
  },
  mistral: {
    display: 'Mistral',
    base_url: 'https://api.mistral.ai/v1',
    default_model: 'mistral-small-latest',
    style: 'openai',
    docs_url: 'https://console.mistral.ai/',
    free_tier: false,
  },
  deepseek: {
    display: 'DeepSeek',
    base_url: 'https://api.deepseek.com/v1',
    default_model: 'deepseek-chat',
    style: 'openai',
    docs_url: 'https://platform.deepseek.com/api_keys',
    free_tier: false,
  },
};

// Public catalog returned to the frontend (no keys).
function listProviders() {
  return Object.entries(PROVIDERS).map(([id, p]) => ({
    id,
    display: p.display,
    default_model: p.default_model,
    docs_url: p.docs_url,
    free_tier: !!p.free_tier,
  }));
}

function getProviderConfig(id) {
  return PROVIDERS[id] || null;
}

// ── OpenAI-compatible chat completions ──────────────────────────────────────
// Used for: openai, groq, grok, perplexity, z_ai, mistral, deepseek.
async function callOpenAICompat(baseUrl, apiKey, model, prompt, maxTokens) {
  const r = await fetchFn(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens || 250,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`HTTP ${r.status} ${body.slice(0, 300)}`);
  }
  const data = await r.json();
  return String(data?.choices?.[0]?.message?.content || '').trim();
}

// ── Anthropic Claude /v1/messages ───────────────────────────────────────────
async function callAnthropic(baseUrl, apiKey, model, prompt, maxTokens) {
  const r = await fetchFn(`${baseUrl}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens || 250,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`HTTP ${r.status} ${body.slice(0, 300)}`);
  }
  const data = await r.json();
  // Claude returns content as an array of blocks; concat text blocks.
  const text = (data?.content || [])
    .filter((b) => b?.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  return text;
}

// ── Google Gemini /v1beta/models/MODEL:generateContent ──────────────────────
async function callGemini(baseUrl, apiKey, model, prompt, maxTokens) {
  // Gemini uses an API key query param, not a Bearer header.
  const url = `${baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const r = await fetchFn(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: maxTokens || 250 },
    }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`HTTP ${r.status} ${body.slice(0, 300)}`);
  }
  const data = await r.json();
  const text = (data?.candidates?.[0]?.content?.parts || [])
    .map((p) => p?.text || '')
    .join('')
    .trim();
  return text;
}

// Main entry point. Dispatches to the right adapter based on provider style.
// Returns the generated text, or throws.
async function generateText(provider, apiKey, opts) {
  const cfg = PROVIDERS[provider];
  if (!cfg) throw new Error(`Unknown provider: ${provider}`);
  if (!apiKey) throw new Error(`No API key configured for ${cfg.display}`);
  const model = opts?.model || cfg.default_model;
  const baseUrl = opts?.base_url || cfg.base_url;
  const maxTokens = opts?.max_tokens || 250;
  const prompt = opts?.prompt || '';
  if (!prompt) throw new Error('prompt required');

  if (cfg.style === 'openai') {
    return await callOpenAICompat(baseUrl, apiKey, model, prompt, maxTokens);
  }
  if (cfg.style === 'anthropic') {
    return await callAnthropic(baseUrl, apiKey, model, prompt, maxTokens);
  }
  if (cfg.style === 'gemini') {
    return await callGemini(baseUrl, apiKey, model, prompt, maxTokens);
  }
  throw new Error(`Unsupported style: ${cfg.style}`);
}

module.exports = {
  PROVIDERS,
  listProviders,
  getProviderConfig,
  generateText,
};
