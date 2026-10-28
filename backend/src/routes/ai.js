// ─────────────────────────────────────────────────────────────────────────────
// AI provider routes
//
// Per-user API keys for OpenAI / Groq / Claude / Gemini / Grok / Perplexity /
// Z.AI / Mistral / DeepSeek (etc.). The frontend lets users add/remove keys
// and pick a default. Server-side `generateReply` is used by the Instagram
// action queue when a batch item has `reply_source='ai'`.
//
// Endpoints:
//   GET    /ai/catalog              — public provider list (display + defaults)
//   GET    /ai/providers            — user's configured providers (masked keys)
//   POST   /ai/providers            — add/update a provider key
//   DELETE /ai/providers/:provider  — remove a provider
//   POST   /ai/providers/:provider/default  — set as user's default
//   POST   /ai/test                 — verify a key works (sends a "ping" prompt)
//   POST   /ai/reply                — generate a single reply (used by content
//                                     script via extension, and by previews)
//   GET    /ai/has-key              — boolean: does the user have any key?
// ─────────────────────────────────────────────────────────────────────────────

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { authenticateFlexible } = require('../middleware/auth');
const {
  listProviders,
  getProviderConfig,
  generateText,
  PROVIDERS,
} = require('../services/aiProviders');

const router = express.Router();

// ── Schema ──────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS user_ai_providers (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    api_key TEXT NOT NULL,
    model TEXT,
    base_url TEXT,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, provider)
  );
  CREATE INDEX IF NOT EXISTS idx_user_ai_providers_user
    ON user_ai_providers(user_id);
`);

// Mask a stored key for the GET response so the raw secret never leaves the
// server. Show the first 4 and last 4 chars only.
function maskKey(k) {
  if (!k) return '';
  if (k.length <= 12) return '••••••••';
  return `${k.slice(0, 4)}••••••••${k.slice(-4)}`;
}

// ── Catalog of available providers (public) ─────────────────────────────────
router.get('/catalog', authenticateFlexible, (req, res) => {
  res.json(listProviders());
});

// ── User's configured providers ─────────────────────────────────────────────
router.get('/providers', authenticateFlexible, (req, res) => {
  const uid = req.user.id;
  const rows = db.prepare(`
    SELECT id, provider, model, base_url, is_default, created_at,
           length(api_key) AS key_len,
           api_key
    FROM user_ai_providers
    WHERE user_id = ?
    ORDER BY is_default DESC, created_at DESC
  `).all(uid);
  // Mask the key before sending.
  res.json(rows.map(r => ({
    id: r.id,
    provider: r.provider,
    model: r.model,
    base_url: r.base_url,
    is_default: !!r.is_default,
    created_at: r.created_at,
    api_key_masked: maskKey(r.api_key),
  })));
});

// Tiny helper: did this user configure at least one provider? Used by the
// frontend to gate the "AI" reply option in the batch form.
router.get('/has-key', authenticateFlexible, (req, res) => {
  const row = db.prepare(`
    SELECT 1 AS n FROM user_ai_providers WHERE user_id = ? LIMIT 1
  `).get(req.user.id);
  res.json({ has_key: !!row });
});

// ── Add / update a provider key ─────────────────────────────────────────────
router.post('/providers', authenticateFlexible, (req, res) => {
  const uid = req.user.id;
  const { provider, api_key, model, base_url, set_default } = req.body || {};
  if (!provider || !getProviderConfig(provider)) {
    return res.status(400).json({ error: 'Unknown or missing provider.' });
  }
  if (!api_key || typeof api_key !== 'string' || api_key.length < 8) {
    return res.status(400).json({ error: 'api_key required (min 8 chars).' });
  }

  const existing = db.prepare(
    'SELECT id FROM user_ai_providers WHERE user_id = ? AND provider = ?'
  ).get(uid, provider);

  if (existing) {
    db.prepare(`
      UPDATE user_ai_providers
      SET api_key = ?, model = ?, base_url = ?
      WHERE id = ?
    `).run(api_key, model || null, base_url || null, existing.id);
  } else {
    db.prepare(`
      INSERT INTO user_ai_providers (id, user_id, provider, api_key, model, base_url)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(uuidv4(), uid, provider, api_key, model || null, base_url || null);
  }

  // If this is the user's first provider, auto-mark it default. Otherwise
  // only switch the default when the caller explicitly asked.
  const haveDefault = db.prepare(
    'SELECT 1 AS n FROM user_ai_providers WHERE user_id = ? AND is_default = 1 LIMIT 1'
  ).get(uid);
  if (!haveDefault || set_default) {
    db.prepare('UPDATE user_ai_providers SET is_default = 0 WHERE user_id = ?').run(uid);
    db.prepare(
      'UPDATE user_ai_providers SET is_default = 1 WHERE user_id = ? AND provider = ?'
    ).run(uid, provider);
  }

  res.json({ ok: true });
});

// ── Set default provider ────────────────────────────────────────────────────
router.post('/providers/:provider/default', authenticateFlexible, (req, res) => {
  const uid = req.user.id;
  const row = db.prepare(
    'SELECT id FROM user_ai_providers WHERE user_id = ? AND provider = ?'
  ).get(uid, req.params.provider);
  if (!row) return res.status(404).json({ error: 'Provider not configured.' });
  db.prepare('UPDATE user_ai_providers SET is_default = 0 WHERE user_id = ?').run(uid);
  db.prepare('UPDATE user_ai_providers SET is_default = 1 WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

// ── Delete a provider key ───────────────────────────────────────────────────
router.delete('/providers/:provider', authenticateFlexible, (req, res) => {
  const uid = req.user.id;
  const wasDefault = db.prepare(
    'SELECT is_default FROM user_ai_providers WHERE user_id = ? AND provider = ?'
  ).get(uid, req.params.provider)?.is_default;
  const r = db.prepare(
    'DELETE FROM user_ai_providers WHERE user_id = ? AND provider = ?'
  ).run(uid, req.params.provider);
  if (r.changes === 0) return res.status(404).json({ error: 'Provider not configured.' });
  // If we just removed the default, promote the most-recently-added remaining
  // provider to default so the user isn't left with no fallback.
  if (wasDefault) {
    const next = db.prepare(`
      SELECT id FROM user_ai_providers
      WHERE user_id = ? ORDER BY created_at DESC LIMIT 1
    `).get(uid);
    if (next) db.prepare('UPDATE user_ai_providers SET is_default = 1 WHERE id = ?').run(next.id);
  }
  res.json({ ok: true });
});

// ── Verify a key works (one tiny round-trip) ────────────────────────────────
router.post('/test', authenticateFlexible, async (req, res) => {
  const { provider, api_key, model, base_url } = req.body || {};
  if (!provider || !getProviderConfig(provider)) {
    return res.status(400).json({ error: 'Unknown provider.' });
  }
  if (!api_key) return res.status(400).json({ error: 'api_key required.' });
  try {
    const text = await generateText(provider, api_key, {
      prompt: 'Respond with the single word OK and nothing else.',
      max_tokens: 8,
      model,
      base_url,
    });
    res.json({ ok: true, sample: text.slice(0, 60) });
  } catch (e) {
    res.status(502).json({ ok: false, error: e?.message || 'unknown error' });
  }
});

// ── Generate a single reply for an IG comment ───────────────────────────────
// Used by both:
//   • the Instagram content script (when handling a batch item with
//     reply_source='ai') — replaces the old direct-Groq path
//   • the frontend, for "Preview AI reply" buttons
//
// Body: { comment_text, post_owner?, my_profile?, post_url?, tone?,
//         provider?, model? }   (provider/model override the user's default)
router.post('/reply', authenticateFlexible, async (req, res) => {
  const uid = req.user.id;
  const { comment_text, comment_author, post_owner, my_profile, post_url, tone, provider: overrideProvider, model: overrideModel } = req.body || {};
  const comment = (typeof comment_text === 'string' ? comment_text : '').trim();

  // Pick the provider: explicit override > user default > nothing.
  let row;
  if (overrideProvider) {
    row = db.prepare(`
      SELECT * FROM user_ai_providers WHERE user_id = ? AND provider = ?
    `).get(uid, overrideProvider);
  } else {
    row = db.prepare(`
      SELECT * FROM user_ai_providers WHERE user_id = ? AND is_default = 1
    `).get(uid);
  }
  if (!row) {
    return res.status(400).json({
      error: overrideProvider
        ? `No key configured for ${overrideProvider}. Add one in Settings → AI providers.`
        : 'No default AI provider configured. Add one in Settings → AI providers.',
    });
  }

  // Build the prompt. Kept short and tightly constrained so providers stay
  // cheap and replies look like a real IG comment, not a model essay. The key
  // goal: the reply must engage with WHAT THE COMMENT ACTUALLY SAYS, in the
  // comment's own language — not a generic "Nice! 🔥".
  const ownPost = my_profile && post_owner && my_profile === post_owner;
  const lines = [];
  lines.push(ownPost
    ? 'You are the creator replying to a comment on your own Instagram post.'
    : 'You are a warm, genuine Instagram user replying to someone else\'s comment on a post you are engaging with.');
  if (my_profile) lines.push(`You are @${my_profile}.`);
  if (comment_author) lines.push(`The comment was written by @${comment_author}.`);
  if (tone) lines.push(`Tone: ${tone}.`);
  if (comment) {
    lines.push('Read this comment and reply directly to what it says. React to its specific content, and write your reply in the SAME LANGUAGE as the comment:');
    lines.push(`"""${comment.slice(0, 400)}"""`);
  } else {
    lines.push('Write a warm, genuine-sounding reply that fits a positive Instagram comment.');
  }
  lines.push('Rules: exactly one short reply, max ~120 characters, sound like a real person, be specific and relevant (never a generic "Nice!"), no quotes, no preamble, no hashtags, no @mentions, at most one emoji.');
  const prompt = lines.join('\n');

  try {
    const text = await generateText(row.provider, row.api_key, {
      prompt,
      model: overrideModel || row.model,
      base_url: row.base_url,
      max_tokens: 80,
    });
    // Trim defensively: some providers add leading newlines or quotes.
    const cleaned = text.replace(/^["'\s]+|["'\s]+$/g, '').slice(0, 220);
    res.json({ reply: cleaned, provider: row.provider });
  } catch (e) {
    res.status(502).json({ error: e?.message || 'AI provider call failed' });
  }
});

// ── Instagram DM reply ───────────────────────────────────────────────────────
// Reads the recent conversation and writes the next reply as a real person,
// using the user's default AI provider (same system as comment replies — NOT
// the old extension-local Groq key). Goal: hold a normal, flowing DM chat.
const TONE_GUIDE = {
  friendly:     'warm, friendly and upbeat',
  flirty:       'playful and flirty, a little teasing, but tasteful',
  professional: 'polite, professional and concise',
  casual:       'super casual and chill, like texting a friend',
};
router.post('/dm-reply', authenticateFlexible, async (req, res) => {
  const uid = req.user.id;
  const { conversation, last_message, my_profile, their_username } = req.body || {};
  const convo = (typeof conversation === 'string' ? conversation : '').trim();
  const last = (typeof last_message === 'string' ? last_message : '').trim();
  if (!convo && !last) return res.status(400).json({ error: 'conversation or last_message required' });

  // Per-account bot config + media library (set in Monday → Instagram → DM Bot).
  const profile = (my_profile || '').toString().trim().replace(/^@/, '').toLowerCase() || '__default__';
  let cfg = null, media = [];
  try {
    cfg = db.prepare('SELECT * FROM instagram_dm_bot_configs WHERE user_id = ? AND my_profile = ?').get(uid, profile)
      || (profile !== '__default__' ? db.prepare("SELECT * FROM instagram_dm_bot_configs WHERE user_id = ? AND my_profile = '__default__'").get(uid) : null);
    media = db.prepare("SELECT id, kind, caption, when_to_send FROM instagram_dm_bot_media WHERE user_id = ? AND my_profile IN (?, '__default__')").all(uid, profile);
  } catch (_) { /* tables may not exist on very old DBs */ }

  const toneKey = (cfg && cfg.tone) || req.body.tone || 'friendly';
  const toneDesc = TONE_GUIDE[toneKey] || `${toneKey}`;
  const canSendMedia = media.length > 0 && (!cfg || cfg.media_mode !== 'off');

  const lines = [];
  lines.push(`You are @${my_profile || 'me'}, a real person chatting in Instagram DMs${their_username ? ` with @${their_username}` : ''}.`);
  lines.push(`Continue the conversation naturally, the way a ${toneDesc} human texts — never like a bot or an assistant.`);
  if (cfg && cfg.instructions) { lines.push('Follow these instructions about how to chat and what to aim for:'); lines.push(String(cfg.instructions).slice(0, 2000)); }
  if (cfg && cfg.goal_link) { lines.push(`When it feels natural (not too early, not pushy), guide them toward this link: ${cfg.goal_link}${cfg.goal_note ? ` — ${String(cfg.goal_note).slice(0, 300)}` : ''}`); }
  if (canSendMedia) {
    lines.push('You can also send ONE of these photos/videos if the moment fits (e.g. they ask for a pic, or your instructions say to). To send one, put a tag [[SEND_MEDIA:<id>]] at the very end of your reply, after the text. Only send when it genuinely fits; otherwise send none. Available media:');
    for (const m of media) lines.push(`- id=${m.id} (${m.kind}${m.caption ? `, "${String(m.caption).slice(0,60)}"` : ''})${m.when_to_send ? ` — send when: ${String(m.when_to_send).slice(0,120)}` : ''}`);
  }
  if (convo) {
    lines.push('Conversation so far (oldest first, most recent last; "Me" = you, "Them" = the other person):');
    lines.push(convo.slice(0, 1800));
  } else {
    lines.push(`Their last message: "${last.slice(0, 400)}"`);
  }
  lines.push('Write ONLY your next reply. Rules: reply to what they actually said; 1–2 short sentences; same language as them; stay in character; do NOT greet again if the chat is already going; vary your wording (don\'t repeat earlier replies); no quotes, no preamble, no hashtags; at most one emoji.' + (canSendMedia ? ' If and only if sending media fits, append [[SEND_MEDIA:<id>]] at the end.' : ''));
  const prompt = lines.join('\n');

  try {
    const text = await generateReplyForUser(uid, prompt, { max_tokens: 160 });
    let reply = (text || '').trim();
    // Pull out an optional [[SEND_MEDIA:id]] tag the model may have appended.
    let mediaId = null;
    const tag = /\[\[\s*SEND_MEDIA\s*:\s*([A-Za-z0-9_-]+)\s*\]\]/i.exec(reply);
    if (tag && canSendMedia && media.some(m => m.id === tag[1])) mediaId = tag[1];
    reply = reply.replace(/\[\[\s*SEND_MEDIA\s*:[^\]]*\]\]/ig, '').replace(/^["'\s]+|["'\s]+$/g, '').slice(0, 500);
    if (!reply && !mediaId) return res.status(502).json({ error: 'Empty reply from provider' });
    res.json({ reply, media_id: mediaId, media_url: mediaId ? `/api/instagram/dm-bot/media/${mediaId}/file` : null });
  } catch (e) {
    const msg = e?.message || 'AI provider call failed';
    res.status(/provider/i.test(msg) ? 400 : 502).json({ error: msg });
  }
});

// Tiny helper exported for use by other routes (e.g., the action queue
// dispatcher). Resolves the user's default-provider config + generates text
// without an HTTP round-trip.
async function generateReplyForUser(userId, prompt, opts = {}) {
  const row = db.prepare(`
    SELECT * FROM user_ai_providers WHERE user_id = ? AND is_default = 1
  `).get(userId);
  if (!row) throw new Error('No AI provider configured for this user.');
  return await generateText(row.provider, row.api_key, {
    prompt,
    model: opts.model || row.model,
    base_url: row.base_url,
    max_tokens: opts.max_tokens || 80,
  });
}

router.generateReplyForUser = generateReplyForUser;

module.exports = router;
