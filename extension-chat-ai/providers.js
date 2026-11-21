// Bibix Chat AI — provider registry + settings schema.
// Loaded by background.js (importScripts) and by the options/popup pages (<script>).
// Everything that talks to a model lives here so adding a provider is one entry.

const BX_PROVIDERS = {
  groq: {
    name: 'Groq', kind: 'openai', free: true,
    baseUrl: 'https://api.groq.com/openai/v1', defaultModel: 'openai/gpt-oss-120b',
    keyUrl: 'https://console.groq.com/keys', note: 'Free tier, very fast. Good default. (Llama models are enterprise-only on Groq now; use openai/gpt-oss-120b or -20b.)',
  },
  gemini: {
    name: 'Google Gemini', kind: 'gemini', free: true,
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta', defaultModel: 'gemini-2.5-flash',
    keyUrl: 'https://aistudio.google.com/apikey', note: 'Free tier available (AI Studio key).',
  },
  openai: {
    name: 'OpenAI', kind: 'openai', free: false,
    baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini',
    keyUrl: 'https://platform.openai.com/api-keys', note: 'Paid.',
  },
  anthropic: {
    name: 'Anthropic (Claude)', kind: 'anthropic', free: false,
    baseUrl: 'https://api.anthropic.com/v1', defaultModel: 'claude-opus-5-5',
    keyUrl: 'https://platform.claude.com/', note: 'Paid. Best quality for nuance/tone.',
  },
  xai: {
    name: 'xAI (Grok)', kind: 'openai', free: false,
    baseUrl: 'https://api.x.ai/v1', defaultModel: 'grok-3-mini',
    keyUrl: 'https://console.x.ai/', note: 'Paid (some promo credits).',
  },
  kimi: {
    name: 'Moonshot (Kimi)', kind: 'openai', free: false,
    baseUrl: 'https://api.moonshot.ai/v1', defaultModel: 'kimi-k2-turbo-preview',
    keyUrl: 'https://platform.moonshot.ai/', note: 'Paid, cheap. Strong in Chinese.',
  },
  deepseek: {
    name: 'DeepSeek', kind: 'openai', free: false,
    baseUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat',
    keyUrl: 'https://platform.deepseek.com/api_keys', note: 'Paid, very cheap.',
  },
  mistral: {
    name: 'Mistral', kind: 'openai', free: true,
    baseUrl: 'https://api.mistral.ai/v1', defaultModel: 'mistral-small-latest',
    keyUrl: 'https://console.mistral.ai/api-keys', note: 'Free experiment tier.',
  },
  openrouter: {
    name: 'OpenRouter', kind: 'openai', free: true,
    baseUrl: 'https://openrouter.ai/api/v1', defaultModel: 'meta-llama/llama-3.3-70b-instruct:free',
    keyUrl: 'https://openrouter.ai/keys', note: 'One key, hundreds of models; ":free" models cost nothing.',
  },
  ollama: {
    name: 'Ollama (local)', kind: 'openai', free: true, noKey: true,
    baseUrl: 'http://localhost:11434/v1', defaultModel: 'llama3.1',
    keyUrl: 'https://ollama.com/download', note: 'Runs on your machine. Run: OLLAMA_ORIGINS="chrome-extension://*" ollama serve',
  },
  custom: {
    name: 'Custom (OpenAI-compatible)', kind: 'openai', free: false, editableUrl: true,
    baseUrl: '', defaultModel: '',
    keyUrl: '', note: 'Any /v1/chat/completions endpoint (LM Studio, vLLM, Together, Fireworks…).',
  },
};

const BX_LANGUAGES = [
  'English', 'Spanish', 'Portuguese', 'French', 'German', 'Italian', 'Dutch', 'Russian', 'Ukrainian', 'Polish',
  'Romanian', 'Greek', 'Turkish', 'Hebrew', 'Arabic', 'Persian', 'Hindi', 'Urdu', 'Bengali', 'Chinese (Simplified)',
  'Chinese (Traditional)', 'Japanese', 'Korean', 'Vietnamese', 'Thai', 'Indonesian', 'Malay', 'Filipino', 'Swedish',
  'Norwegian', 'Danish', 'Finnish', 'Czech', 'Hungarian', 'Catalan', 'Swahili',
];

const BX_DEFAULT_SETTINGS = {
  enabled: true,
  provider: 'groq',
  providers: {},               // { [id]: { apiKey, model, baseUrl } }
  myLanguage: 'English',       // language I read and write in
  targetLanguage: 'Spanish',   // default language my messages are sent in
  autoIncoming: true,          // translate incoming messages inline
  initialIncoming: 15,         // how many existing incoming messages to translate when a chat opens
  showOriginalOutgoing: true,  // under my sent (translated) bubbles, show what I originally typed
  enterTranslates: true,       // plain Enter in the chat = translate & send (Shift+Enter = newline)
  style: '',                   // extra instructions, e.g. "informal tone, use tú"
  perChat: {},                 // { [platform|chatTitle]: { targetLanguage, autoIncoming } }
};

// Model IDs providers have retired → what to use instead (applied transparently to saved settings).
const BX_RETIRED_MODELS = {
  groq: { 'llama-3.3-70b-versatile': 'openai/gpt-oss-120b', 'llama-3.1-8b-instant': 'openai/gpt-oss-20b', 'llama3-70b-8192': 'openai/gpt-oss-120b', 'llama3-8b-8192': 'openai/gpt-oss-20b', 'mixtral-8x7b-32768': 'openai/gpt-oss-120b' },
};

function bxProviderConfig(settings, id) {
  const def = BX_PROVIDERS[id] || BX_PROVIDERS.custom;
  const saved = (settings.providers && settings.providers[id]) || {};
  let model = (saved.model || def.defaultModel || '').trim();
  model = (BX_RETIRED_MODELS[id] || {})[model] || model;
  return {
    id, kind: def.kind, noKey: !!def.noKey,
    apiKey: (saved.apiKey || '').trim(),
    model,
    baseUrl: (saved.baseUrl || def.baseUrl || '').trim().replace(/\/+$/, ''),
  };
}

if (typeof module !== 'undefined') module.exports = { BX_PROVIDERS, BX_LANGUAGES, BX_DEFAULT_SETTINGS, bxProviderConfig };
