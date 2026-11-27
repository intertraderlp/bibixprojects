// ─────────────────────────────────────────────────────────────────────────────
// Chats — AI conversation bots.
//
// A bot is a persona + style + targeting rules + behaviour, stored per user (chat_bots). When a live
// incoming message arrives, the engine picks the bot for that chat (per-chat override → highest-priority
// bot whose rules match: account, platform, country of the phone number, language, chat type, keywords,
// hours…), waits a short debounce so several quick messages get one answer, composes a prompt from the
// persona and the recent transcript, asks the user's AI provider, and sends the reply through the
// account (typing indicator + human-like delay). It steps aside when a person answers from our side,
// when the contact asks for a human, and when a per-chat cap is reached.
//
// Nothing here runs in the worker process: the engine lives in the app (it needs the DB and the keys).
// ─────────────────────────────────────────────────────────────────────────────
const { generateText } = require('../services/aiProviders');
const tr = require('./translate');
const { countryOfPhone } = require('./phoneCountry');

const DEFAULTS = {
  name: 'New bot', emoji: '🤖', enabled: true, priority: 0,
  persona: { name: '', role: '', company: '', background: '', traits: '', goals: '', rules: '', opening: '' },
  style: { formality: 'casual', warmth: 'warm', humour: 'light', emoji: 'rare', length: 'short', bubbles: 2, notes: '', customPrompt: '', replacePrompt: false },
  language: { mode: 'auto', fixed: 'English', fallback: 'English' },
  match: { accounts: [], platforms: [], countries: [], excludeCountries: [], languages: [], chatType: 'private', contacts: 'any', keywords: [], firstContactOnly: false, hours: null },
  behaviour: { debounceSec: 4, delayMinSec: 2, delayMaxSec: 8, typing: true, maxPerDay: 40, maxTotal: 0, maxAgeMin: 15, handoffMinutes: 30, handoffKeywords: ['human', 'agent', 'person', 'persona', 'agente', 'humano', 'operador'], handoffMessage: '', handoffPauseHours: 24, notifyHandoff: true, historyLimit: 20, replyToMedia: true },
  model: { provider: null, model: null, temperature: 0.8, maxTokens: 400 },
  knowledge: '',
};
const LANG_HINTS = [
  [/[֐-׿]/, 'Hebrew'], [/[؀-ۿ]/, 'Arabic'], [/[Ѐ-ӿ]/, 'Russian'], [/[぀-ヿ]/, 'Japanese'], [/[가-힯]/, 'Korean'],
  [/[一-鿿]/, 'Chinese (Simplified)'], [/[฀-๿]/, 'Thai'], [/[ऀ-ॿ]/, 'Hindi'], [/[Ͱ-Ͽ]/, 'Greek'],
  [/\b(hola|gracias|buenos|buenas|quiero|tienes|cómo|como estás|por favor|vale|mañana)\b/i, 'Spanish'], [/\b(olá|obrigad[oa]|você|bom dia|boa tarde|tudo bem)\b/i, 'Portuguese'],
  [/\b(bonjour|merci|salut|je suis|s'il vous|vous|ça va)\b/i, 'French'], [/\b(hallo|danke|bitte|ich bin|guten|wie geht)\b/i, 'German'], [/\b(ciao|grazie|buongiorno|sono|vorrei|come stai)\b/i, 'Italian'],
  [/\b(hello|hi|thanks|please|how are you|i am|i'm|can you)\b/i, 'English'],
];
const LANG_CODES = { en: 'English', es: 'Spanish', pt: 'Portuguese', fr: 'French', de: 'German', it: 'Italian', nl: 'Dutch', ru: 'Russian', uk: 'Ukrainian', pl: 'Polish', ro: 'Romanian', el: 'Greek', tr: 'Turkish', he: 'Hebrew', iw: 'Hebrew', ar: 'Arabic', fa: 'Persian', hi: 'Hindi', ur: 'Urdu', bn: 'Bengali', zh: 'Chinese (Simplified)', ja: 'Japanese', ko: 'Korean', vi: 'Vietnamese', th: 'Thai', id: 'Indonesian', ms: 'Malay', tl: 'Filipino', sv: 'Swedish', no: 'Norwegian', da: 'Danish', fi: 'Finnish', cs: 'Czech', hu: 'Hungarian', ca: 'Catalan', sw: 'Swahili' };
function langName(l) { if (!l) return null; const k = String(l).trim().toLowerCase().replace(/[-_].*$/, ''); return LANG_CODES[k] || String(l).trim().replace(/^\w/, c => c.toUpperCase()); }
function guessLanguage(text) { for (const [re, l] of LANG_HINTS) if (re.test(text || '')) return l; return null; }

function deepMerge(base, over) {
  if (Array.isArray(base)) return Array.isArray(over) ? over : base;
  if (base && typeof base === 'object') { const o = { ...base }; for (const k of Object.keys(over || {})) o[k] = k in base ? deepMerge(base[k], over[k]) : over[k]; return o; }
  return over === undefined ? base : over;
}
function normalizeBot(b) {
  const bot = deepMerge(DEFAULTS, b || {});
  bot.priority = Number(bot.priority) || 0;
  bot.match.keywords = (Array.isArray(bot.match.keywords) ? bot.match.keywords : String(bot.match.keywords || '').split(',')).map(s => String(s).trim()).filter(Boolean);
  bot.behaviour.handoffKeywords = (Array.isArray(bot.behaviour.handoffKeywords) ? bot.behaviour.handoffKeywords : String(bot.behaviour.handoffKeywords || '').split(',')).map(s => String(s).trim().toLowerCase()).filter(Boolean);
  for (const k of ['accounts', 'platforms', 'countries', 'excludeCountries', 'languages']) bot.match[k] = Array.isArray(bot.match[k]) ? bot.match[k] : [];
  if (bot.match.hours && !(bot.match.hours.from && bot.match.hours.to)) bot.match.hours = null;
  return bot;
}

const FORMALITY = { 'very-casual': 'very casual and relaxed, like texting a friend', casual: 'casual and friendly', neutral: 'neutral, everyday', formal: 'polite and professional', 'very-formal': 'very formal and courteous' };
const WARMTH = { cold: 'reserved and matter-of-fact', neutral: 'even-tempered', warm: 'warm and personable', 'very-warm': 'very warm, caring and enthusiastic' };
const HUMOUR = { none: 'no jokes', light: 'a light touch of humour when it fits', playful: 'playful and witty' };
const EMOJI = { none: 'never use emojis', rare: 'an emoji only occasionally', some: 'a few emojis where natural', lots: 'plenty of emojis' };
const LENGTH = { 'one-liner': 'one short sentence', short: '1–2 short sentences', medium: '2–4 sentences', long: 'as long as the topic needs, in short paragraphs' };

function localTime(tz) {
  try { return new Intl.DateTimeFormat('en-GB', { timeZone: tz || 'UTC', weekday: 'long', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()); } catch (_) { return ''; }
}
function hourParts(tz) {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz || 'UTC', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date()).map(x => [x.type, x.value]));
    const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
    return { minutes: (Number(p.hour) % 24) * 60 + Number(p.minute), day: day === 0 ? 7 : day };
  } catch (_) { return { minutes: 0, day: 1 }; }
}
function inHours(h) {
  if (!h) return true;
  const { minutes, day } = hourParts(h.tz);
  if (Array.isArray(h.days) && h.days.length && !h.days.map(Number).includes(day)) return false;
  const toMin = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(s || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  const a = toMin(h.from), b = toMin(h.to); if (a == null || b == null) return true;
  return a <= b ? (minutes >= a && minutes < b) : (minutes >= a || minutes < b);   // overnight ranges wrap
}

// Context about a chat the rules and the prompt both use.
function chatContext(account, chat, text) {
  const country = chat?.phone ? countryOfPhone(chat.phone) : null;
  return {
    platform: account?.platform || 'whatsapp',
    accountId: account?.id, accountLabel: account?.label || account?.display_name || account?.phone || '',
    contactName: chat?.name && !/^\+?\d+$/.test(chat.name) ? chat.name : '',
    phone: chat?.phone || null, country, countryCode: country?.code || null,
    language: chat?.send_language || guessLanguage(text) || null,
    isGroup: !!chat?.is_group,
    saved: !!(chat?.name && !/^\+?\d+$/.test(chat.name)),
  };
}

function createBotEngine({ store, client, sse, sendPushToUser, logger = console }) {
  const pending = new Map();   // `${accountId}|${jid}` → { timer, texts: [], rowIds: [] }

  // ── Matching ────────────────────────────────────────────────────────────
  function matches(bot, ctx, text, { firstContact } = {}) {
    const m = bot.match;
    if (m.accounts.length && !m.accounts.includes(ctx.accountId)) return 'account';
    if (m.platforms.length && !m.platforms.includes(ctx.platform)) return 'platform';
    if (m.chatType === 'private' && ctx.isGroup) return 'group';
    if (m.chatType === 'group' && !ctx.isGroup) return 'not a group';
    if (m.countries.length) { if (!ctx.countryCode || !m.countries.includes(ctx.countryCode)) return 'country'; }
    if (m.excludeCountries.length && ctx.countryCode && m.excludeCountries.includes(ctx.countryCode)) return 'country excluded';
    if (m.languages.length) { if (!ctx.language || !m.languages.some(l => l.toLowerCase() === String(ctx.language).toLowerCase())) return 'language'; }
    if (m.contacts === 'saved' && !ctx.saved) return 'unsaved contact';
    if (m.contacts === 'unsaved' && ctx.saved) return 'saved contact';
    if (m.keywords.length) { const t = (text || '').toLowerCase(); if (!m.keywords.some(k => t.includes(k.toLowerCase()))) return 'keywords'; }
    if (m.firstContactOnly && !firstContact) return 'not first contact';
    if (!inHours(m.hours)) return 'outside hours';
    return null;
  }
  function specificity(bot) { const m = bot.match; return ['accounts', 'platforms', 'countries', 'languages', 'keywords'].filter(k => m[k].length).length + (m.hours ? 1 : 0) + (m.contacts !== 'any' ? 1 : 0) + (m.firstContactOnly ? 1 : 0); }

  // Which bot would answer in this chat right now? Returns { bot, reason, paused }.
  function pick(userId, account, chat, text, opts = {}) {
    const settings = opts.settings || store.getSettings(userId);
    if (settings.botsEnabled === false) return { bot: null, reason: 'bots switched off' };
    const bots = (opts.bots || store.listBots(userId)).map(normalizeBot);
    const ctx = chatContext(account, chat, text);
    const paused = chat?.bot_paused_until && chat.bot_paused_until > Date.now();
    if (chat?.bot_mode === 'off') return { bot: null, reason: 'off for this chat', ctx };
    if (chat?.bot_mode) {
      const b = bots.find(x => x.id === chat.bot_mode);
      if (!b) return { bot: null, reason: 'assigned bot no longer exists', ctx };
      if (!b.enabled) return { bot: null, reason: `${b.name} is disabled`, ctx };
      return { bot: b, reason: 'assigned to this chat', paused, ctx };
    }
    const ranked = bots.filter(b => b.enabled).sort((a, b) => (b.priority - a.priority) || (specificity(b) - specificity(a)));
    const why = [];
    for (const b of ranked) {
      const r = matches(b, ctx, text, opts);
      if (!r) return { bot: b, reason: 'rules match', paused, ctx };
      why.push(`${b.name}: ${r}`);
    }
    return { bot: null, reason: why.length ? 'no rules match (' + why.join('; ') + ')' : 'no bots', ctx };
  }

  // ── Prompting ───────────────────────────────────────────────────────────
  function systemPrompt(bot, ctx, lang) {
    const p = bot.persona, s = bot.style;
    if (s.replacePrompt && s.customPrompt) return s.customPrompt + '\n\n' + languageRule(bot, lang) + '\n' + formatRule(bot);
    const who = [p.name && `Your name is ${p.name}.`, p.role && `You are ${p.role}${p.company ? ' at ' + p.company : ''}.`, p.background && `Background: ${p.background}`, p.traits && `Personality: ${p.traits}`].filter(Boolean).join(' ');
    const lines = [
      `You are chatting on ${ctx.platform === 'telegram' ? 'Telegram' : 'WhatsApp'} as a real person, replying to messages from ${ctx.contactName || 'a contact'}${ctx.country ? ' in ' + ctx.country.name : ''}. Never say you are an AI, a bot or an assistant; stay in character.`,
      who,
      `Tone: ${FORMALITY[s.formality] || s.formality}; ${WARMTH[s.warmth] || s.warmth}; ${HUMOUR[s.humour] || s.humour}; ${EMOJI[s.emoji] || s.emoji}. Length: ${LENGTH[s.length] || s.length}. Write like people text: natural, no headings, no bullet lists, no markdown.`,
      s.notes && `Style notes: ${s.notes}`,
      p.goals && `What you want to achieve in this conversation: ${p.goals}`,
      p.rules && `Rules you must follow: ${p.rules}`,
      p.opening && `If this is the start of the conversation, open along these lines: ${p.opening}`,
      bot.knowledge && `Facts you know (use them when relevant, never invent others):\n${bot.knowledge}`,
      ctx.localTime && `Local time for you now: ${ctx.localTime}.`,
      s.customPrompt && !s.replacePrompt && `Additional instructions: ${s.customPrompt}`,
      languageRule(bot, lang),
      formatRule(bot),
    ].filter(Boolean);
    return lines.join('\n\n');
  }
  function languageRule(bot, lang) {
    if (bot.language.mode === 'fixed') return `Always reply in ${bot.language.fixed || 'English'}, whatever language the contact writes in.`;
    return `Reply in the language the contact writes in${lang ? ` (currently ${lang})` : ''}; if you cannot tell, use ${bot.language.fallback || 'English'}. Mirror their register and local expressions.`;
  }
  function formatRule(bot) {
    const n = Math.max(1, Math.min(4, Number(bot.style.bubbles) || 1));
    return `Output format: the first line must be "LANG: <language you reply in>", then the reply. ${n > 1 ? `You may split the reply into up to ${n} chat bubbles by putting a line with only "---" between them.` : 'Send a single message.'} Plain text only. If you should not answer at all (for example the message needs no reply), output exactly "NOREPLY".`;
  }
  function transcript(messages, ctx) {
    const lbl = (m) => m.from_me ? 'You' : (ctx.isGroup && m.sender_name ? m.sender_name : (ctx.contactName || 'Contact'));
    const body = (m) => m.text || ({ image: '[photo]', video: '[video]', audio: '[voice message]', sticker: '[sticker]', document: '[file]', contact: '[contact card]', location: '[location]', call: '[call]' }[m.kind] || '[message]');
    return messages.map(m => `${lbl(m)}: ${body(m)}`).join('\n');
  }
  function parseReply(raw) {
    let t = String(raw || '').trim(), lang = null;
    const m = /^\s*LANG:\s*([^\n]+)\n?([\s\S]*)$/i.exec(t); if (m) { lang = langName(m[1].trim().replace(/[.*_`"']+$/g, '')); t = m[2].trim(); }
    if (/^NOREPLY\b/i.test(t) || !t) return { lang, bubbles: [] };
    const bubbles = t.split(/\n\s*---+\s*\n/).map(x => x.trim().replace(/^["“]|["”]$/g, '')).filter(Boolean).slice(0, 4);
    return { lang, bubbles };
  }
  async function generate(userId, bot, ctx, history, lang) {
    const settings = store.getSettings(userId);
    const p = tr.resolveProvider(userId, { provider: bot.model.provider || settings.provider, model: bot.model.provider ? bot.model.model : (settings.provider ? settings.model : null) });
    if (!p) throw Object.assign(new Error('No AI provider key configured — add one in Bibix → Settings → AI providers'), { status: 412 });
    const system = systemPrompt(bot, ctx, lang);
    const prompt = `Conversation so far (most recent last):\n${transcript(history, ctx)}\n\nWrite your next reply now.`;
    const t0 = Date.now();
    const raw = await generateText(p.provider, p.apiKey, { prompt, system, model: bot.model.model && bot.model.provider === p.provider ? bot.model.model : p.model, base_url: p.baseUrl, temperature: Number(bot.model.temperature ?? 0.8), max_tokens: Number(bot.model.maxTokens) || 400 });
    return { ...parseReply(raw), raw, system, provider: p.provider, model: p.model, latencyMs: Date.now() - t0 };
  }

  // ── Live path ───────────────────────────────────────────────────────────
  // Called for every live incoming message that was just stored. Cheap when no bot applies.
  function onIncoming({ userId, account, chat, row, settings }) {
    try {
      if (!row || row.from_me) return;
      const bots = store.listBots(userId); if (!bots.length) return;
      const text = row.text || '';
      const picked = pick(userId, account, chat, text, { settings, bots, firstContact: store.countIncoming(account.id, chat.jid) <= 1 });
      if (!picked.bot) return;
      const bot = picked.bot;
      if (!text && !bot.behaviour.replyToMedia) return;
      if (row.timestamp && Date.now() - row.timestamp > (Number(bot.behaviour.maxAgeMin) || 15) * 60000) return;   // backlog after a reconnect: stay quiet
      const key = `${account.id}|${chat.jid}`;
      const cur = pending.get(key) || { texts: [], rowIds: [] };
      clearTimeout(cur.timer);
      cur.texts.push(text); cur.rowIds.push(row.id); cur.bot = bot; cur.userId = userId; cur.account = account; cur.jid = chat.jid;
      cur.timer = setTimeout(() => { pending.delete(key); respond(cur).catch(e => logger.warn('[bots] reply failed:', e.message)); }, Math.max(0, Number(bot.behaviour.debounceSec) || 0) * 1000);
      pending.set(key, cur);
    } catch (e) { logger.warn('[bots] onIncoming:', e.message); }
  }

  async function respond({ bot, userId, account, jid, texts }) {
    const chat = store.getChat(account.id, jid); if (!chat) return;
    const inText = texts.filter(Boolean).join('\n');
    const base = { userId, botId: bot.id, accountId: account.id, chatJid: jid, inText };
    const emit = (type, extra) => sse.emit(userId, 'chat:bot', { account_id: account.id, chat_jid: jid, bot: { id: bot.id, name: bot.name, emoji: bot.emoji }, type, ...extra });
    // 1. someone from our side is handling this chat
    if (chat.bot_paused_until && chat.bot_paused_until > Date.now()) return;
    const human = store.lastHumanOutgoingAt(account.id, jid);
    if (human && Date.now() - human < (Number(bot.behaviour.handoffMinutes) || 0) * 60000) return;
    // 2. the contact asked for a person
    const low = inText.toLowerCase();
    if (bot.behaviour.handoffKeywords.some(k => new RegExp(`(^|[^\\p{L}])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\p{L}]|$)`, 'iu').test(low))) {
      const until = Date.now() + (Number(bot.behaviour.handoffPauseHours) || 24) * 3600000;
      store.updateChatPrefs(account.id, jid, { bot_paused_until: until });
      store.logBot({ ...base, event: 'handoff', outText: bot.behaviour.handoffMessage || '' });
      if (bot.behaviour.handoffMessage) { try { await sendBubble(bot, userId, account, jid, bot.behaviour.handoffMessage, { noDelay: true }); } catch (e) { logger.warn('[bots] handoff message failed:', e.message); } }
      emit('handoff', { chat: store.getChat(account.id, jid) });
      if (bot.behaviour.notifyHandoff) { try { sendPushToUser(userId, `${chat.name} asked for a person`, `${bot.emoji || '🤖'} ${bot.name} stepped aside — reply yourself`, { url: '/chats/?account=' + account.id + '&chat=' + encodeURIComponent(jid), type: 'chat' }); } catch (_) {} }
      return;
    }
    // 3. caps
    const day = Date.now() - 86400000;
    if (bot.behaviour.maxPerDay && store.botRepliesInChat(bot.id, account.id, jid, day) >= Number(bot.behaviour.maxPerDay)) { store.logBot({ ...base, event: 'skip', error: 'daily cap reached' }); return; }
    if (bot.behaviour.maxTotal && store.botRepliesInChat(bot.id, account.id, jid, 0) >= Number(bot.behaviour.maxTotal)) { store.logBot({ ...base, event: 'skip', error: 'conversation cap reached' }); return; }
    // 4. compose + generate
    const ctx = chatContext(account, chat, inText); ctx.localTime = localTime(bot.match.hours?.tz || bot.timezone);
    const history = store.listMessages(account.id, jid, { limit: Math.max(4, Number(bot.behaviour.historyLimit) || 20) });
    let out;
    try { out = await generate(userId, bot, ctx, history, chat.send_language); }
    catch (e) { store.logBot({ ...base, error: e.message }); emit('error', { error: e.message }); return; }
    // 5. language adoption (auto mode, only when the user has not fixed one for this chat)
    if (out.lang && bot.language.mode !== 'fixed' && !/^(unknown|none|mixed|n\/a)$/i.test(out.lang) && (!chat.send_language || chat.send_language_detected)) {
      const l = out.lang.replace(/\s*\(.*?\)\s*$/, '').trim();
      if (l && l.toLowerCase() !== String(chat.send_language || '').toLowerCase()) store.updateChatPrefs(account.id, jid, { send_language: l, send_language_detected: true });
    }
    if (!out.bubbles.length) { store.logBot({ ...base, event: 'skip', error: null, outText: 'NOREPLY', lang: out.lang, provider: out.provider, model: out.model, latencyMs: out.latencyMs }); return; }
    // 6. send, one bubble at a time
    for (const text of out.bubbles) {
      // a person may have jumped in while we were thinking
      const h2 = store.lastHumanOutgoingAt(account.id, jid); if (h2 && h2 > (human || 0)) return;
      let row;
      try { row = await sendBubble(bot, userId, account, jid, text); }
      catch (e) { store.logBot({ ...base, outText: text, lang: out.lang, provider: out.provider, model: out.model, latencyMs: out.latencyMs, error: 'send failed: ' + e.message }); emit('error', { error: e.message }); return; }
      store.logBot({ ...base, messageId: row?.id || null, outText: text, lang: out.lang, provider: out.provider, model: out.model, latencyMs: out.latencyMs });
    }
    store.updateChatPrefs(account.id, jid, { bot_last_id: bot.id });
    emit('reply', { chat: store.getChat(account.id, jid), text: out.bubbles.join(' ') });
  }

  async function sendBubble(bot, userId, account, jid, text, { noDelay } = {}) {
    const b = bot.behaviour;
    if (!noDelay) {
      const ms = Math.min((Number(b.delayMaxSec) || 8) * 1000, (Number(b.delayMinSec) || 2) * 1000 + text.length * 35);
      if (b.typing !== false) { try { await client.presence(account.id, { jid, type: 'composing' }); } catch (_) {} }
      await new Promise(r => setTimeout(r, ms));
      if (b.typing !== false) { try { await client.presence(account.id, { jid, type: 'paused' }); } catch (_) {} }
    }
    const sent = await client.send(account.id, { jid, text });
    const { row } = store.upsertMessage(account.id, { ...sent, chatJid: sent.chatJid || jid, fromMe: true, text: sent.text || text, status: Math.max(1, sent.status || 1), botId: bot.id });
    sse.emit(userId, 'chat:message', { account_id: account.id, message: row, chat: store.getChat(account.id, jid), live: false, inserted: true });
    return row;
  }

  // ── Test console: same prompt, nothing sent ──────────────────────────────
  async function simulate(userId, botInput, { messages = [], context = {} } = {}) {
    const bot = normalizeBot(botInput);
    const country = context.countryCode ? { code: context.countryCode, name: context.countryName || context.countryCode } : null;
    const ctx = { platform: context.platform || 'whatsapp', contactName: context.contactName || 'Alex', country, countryCode: country?.code || null, language: context.language || null, isGroup: false, saved: true, localTime: localTime(bot.match.hours?.tz) };
    const history = messages.map((m, i) => ({ from_me: m.role === 'bot' || m.role === 'me', text: m.text, kind: 'text', timestamp: i }));
    const out = await generate(userId, bot, ctx, history, context.language || null);
    return { bubbles: out.bubbles, lang: out.lang, raw: out.raw, system: out.system, provider: out.provider, model: out.model, latencyMs: out.latencyMs };
  }

  // What the chat list shows: the bot that would answer each chat (no AI call).
  function annotate(userId, account, chats) {
    const bots = store.listBots(userId); if (!bots.length) return chats;
    const settings = store.getSettings(userId);
    for (const c of chats) {
      const r = pick(userId, account, c, c.last_message_from_me ? '' : (c.last_message_text || ''), { settings, bots });
      c.bot = r.bot ? { id: r.bot.id, name: r.bot.name, emoji: r.bot.emoji, paused: !!r.paused, assigned: !!c.bot_mode } : null;
      c.bot_reason = r.reason;
    }
    return chats;
  }

  return { onIncoming, pick, simulate, annotate, normalizeBot, DEFAULTS, chatContext, systemPrompt };
}

module.exports = { createBotEngine, normalizeBot, DEFAULTS, guessLanguage };
