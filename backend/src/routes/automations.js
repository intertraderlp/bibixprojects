const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { authenticate } = require('../middleware/auth');
const { sendPushToUser } = require('../services/pushNotifications');

const router = express.Router();

function canAccessBoard(boardId, userId) {
  return db.prepare(`
    SELECT b.id FROM boards b
    JOIN workspace_members wm ON b.workspace_id = wm.workspace_id
    WHERE b.id = ? AND wm.user_id = ?
  `).get(boardId, userId);
}

router.get('/board/:boardId', authenticate, (req, res) => {
  if (!canAccessBoard(req.params.boardId, req.user.id)) return res.status(403).json({ error: 'Access denied' });
  const automations = db.prepare('SELECT * FROM automations WHERE board_id = ? ORDER BY created_at ASC')
    .all(req.params.boardId);
  res.json(automations.map(a => ({
    ...a,
    trigger_config: JSON.parse(a.trigger_config),
    action_config: JSON.parse(a.action_config),
  })));
});

router.post('/', authenticate, (req, res) => {
  const { board_id, name, trigger_type, trigger_config, action_type, action_config } = req.body;
  if (!board_id || !trigger_type || !action_type) return res.status(400).json({ error: 'Missing required fields' });
  if (!canAccessBoard(board_id, req.user.id)) return res.status(403).json({ error: 'Access denied' });

  const id = uuidv4();
  db.prepare('INSERT INTO automations (id, board_id, name, trigger_type, trigger_config, action_type, action_config, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, board_id, name || 'New Automation', trigger_type,
      JSON.stringify(trigger_config || {}), action_type,
      JSON.stringify(action_config || {}), req.user.id);

  const automation = db.prepare('SELECT * FROM automations WHERE id = ?').get(id);
  res.json({ ...automation, trigger_config: JSON.parse(automation.trigger_config), action_config: JSON.parse(automation.action_config) });
});

router.put('/:id', authenticate, (req, res) => {
  const automation = db.prepare('SELECT * FROM automations WHERE id = ?').get(req.params.id);
  if (!automation) return res.status(404).json({ error: 'Automation not found' });
  if (!canAccessBoard(automation.board_id, req.user.id)) return res.status(403).json({ error: 'Access denied' });

  const { name, enabled, trigger_type, action_type, trigger_config, action_config } = req.body;
  db.prepare(`UPDATE automations SET
      name = COALESCE(?, name), enabled = COALESCE(?, enabled),
      trigger_type = COALESCE(?, trigger_type), action_type = COALESCE(?, action_type),
      trigger_config = COALESCE(?, trigger_config), action_config = COALESCE(?, action_config)
    WHERE id = ?`)
    .run(name || null, enabled !== undefined ? (enabled ? 1 : 0) : null,
      trigger_type || null, action_type || null,
      trigger_config ? JSON.stringify(trigger_config) : null,
      action_config ? JSON.stringify(action_config) : null,
      req.params.id);

  const updated = db.prepare('SELECT * FROM automations WHERE id = ?').get(req.params.id);
  res.json({ ...updated, trigger_config: JSON.parse(updated.trigger_config), action_config: JSON.parse(updated.action_config) });
});

router.delete('/:id', authenticate, (req, res) => {
  const automation = db.prepare('SELECT * FROM automations WHERE id = ?').get(req.params.id);
  if (!automation) return res.status(404).json({ error: 'Automation not found' });
  if (!canAccessBoard(automation.board_id, req.user.id)) return res.status(403).json({ error: 'Access denied' });
  db.prepare('DELETE FROM automations WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

function runAutomations(boardId, triggerType, context, dbInstance) {
  const dbRef = dbInstance || db;
  const automations = dbRef.prepare('SELECT * FROM automations WHERE board_id = ? AND enabled = 1 AND trigger_type = ?')
    .all(boardId, triggerType);

  for (const auto of automations) {
    try {
      const triggerConfig = JSON.parse(auto.trigger_config);
      const actionConfig = JSON.parse(auto.action_config);

      if (!matchesTrigger(triggerType, triggerConfig, context)) continue;

      executeAction(auto.action_type, actionConfig, context, dbRef, auto);
    } catch (e) { /* skip broken automations */ }
  }
}

function matchesTrigger(type, config, ctx) {
  if (type === 'value_changed') {
    if (config.column_id && ctx.column?.id !== config.column_id) return false;
    if (config.to_value && ctx.newValue !== config.to_value) return false;
    return true;
  }
  if (type === 'item_created') return true;
  return false;
}

function executeAction(type, config, ctx, dbRef, auto) {
  if (type === 'generate_messages') {
    // Fire-and-forget: the LLM call takes seconds, so never block the triggering
    // request. The status save returns immediately; messages fill in shortly after.
    generateMessagesForItem(config, ctx, dbRef, auto)
      .catch(e => console.error('[automation generate_messages]', e.message));
    return;
  }
  if (type === 'notify') {
    const targetUsers = config.user_ids || [];
    for (const userId of targetUsers) {
      const notifTitle = config.title || `Automation triggered on "${ctx.item?.name}"`;
      const notifBody = config.body || '';
      dbRef.prepare('INSERT INTO notifications (id, user_id, type, title, body, link) VALUES (?, ?, ?, ?, ?, ?)')
        .run(uuidv4(), userId, 'automation', notifTitle, notifBody,
          `/board/${ctx.item?.board_id}/item/${ctx.item?.id}`);
      sendPushToUser(userId, notifTitle, notifBody);
    }
  } else if (type === 'set_value') {
    if (ctx.item && config.column_id) {
      dbRef.prepare(`
        INSERT INTO item_values (id, item_id, column_id, value) VALUES (?, ?, ?, ?)
        ON CONFLICT(item_id, column_id) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
      `).run(uuidv4(), ctx.item.id, config.column_id, config.value || null);
    }
  }
}

// ── AI message generation action ──────────────────────────────────────────────
const { generateText } = require('../services/aiProviders');

// Read a lead's column values as a {lowercased column name → value} map.
function leadFields(dbRef, item) {
  const cols = dbRef.prepare('SELECT id, name FROM board_columns WHERE board_id = ?').all(item.board_id);
  const vals = dbRef.prepare('SELECT column_id, value FROM item_values WHERE item_id = ?').all(item.id);
  const valByCol = {};
  for (const v of vals) valByCol[v.column_id] = v.value;
  const byName = {};
  for (const c of cols) byName[c.name.trim().toLowerCase()] = valByCol[c.id] || '';
  return (name) => byName[String(name).trim().toLowerCase()] || '';
}

// Find a column by name on the board, creating it (as text) if it doesn't exist.
function ensureColumn(dbRef, boardId, name) {
  const existing = dbRef.prepare('SELECT id FROM board_columns WHERE board_id = ? AND LOWER(name) = LOWER(?)')
    .get(boardId, name);
  if (existing) return existing.id;
  const id = uuidv4();
  const pos = dbRef.prepare('SELECT COALESCE(MAX(position),0)+1 AS p FROM board_columns WHERE board_id = ?').get(boardId).p;
  dbRef.prepare('INSERT INTO board_columns (id, board_id, name, type, settings, position) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, boardId, name, 'text', '{}', pos);
  return id;
}

function writeValue(dbRef, itemId, columnId, value) {
  dbRef.prepare(`INSERT INTO item_values (id, item_id, column_id, value) VALUES (?, ?, ?, ?)
    ON CONFLICT(item_id, column_id) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`)
    .run(uuidv4(), itemId, columnId, value);
}

const LI_EXAMPLE = `Hi Sheila, I asked 𝗖𝗵𝗮𝘁𝗚𝗣𝗧:
"𝗪𝗵𝗮𝘁 𝗮𝗿𝗲 𝘁𝗵𝗲 𝗯𝗲𝘀𝘁 𝗿𝗼𝗼𝗳𝗶𝗻𝗴 𝗰𝗼𝗺𝗽𝗮𝗻𝗶𝗲𝘀 𝗶𝗻 𝗠𝗶𝗮𝗺𝗶 𝗳𝗼𝗿 𝗮 𝗿𝗲𝘀𝗶𝗱𝗲𝗻𝘁𝗶𝗮𝗹 𝘁𝗶𝗹𝗲 𝗿𝗼𝗼𝗳 𝗿𝗲𝗽𝗹𝗮𝗰𝗲𝗺𝗲𝗻𝘁 𝘄𝗶𝘁𝗵 𝗮 𝗹𝗼𝗻𝗴 𝘄𝗮𝗿𝗿𝗮𝗻𝘁𝘆?"
It recommended 𝗼𝘁𝗵𝗲𝗿 contractors, but 𝘛&𝘚 𝘙𝘰𝘰𝘧𝘪𝘯𝘨 didn't appear in that response.
We can help improve your visibility in 𝗖𝗵𝗮𝘁𝗚𝗣𝗧, 𝗣𝗲𝗿𝗽𝗹𝗲𝘅𝗶𝘁𝘆, 𝗚𝗲𝗺𝗶𝗻𝗶 and other AI platforms to attract more potential clients and strengthen your company's reputation.
Would you like me to send you more information?`;

function buildLinkedInPrompt(d) {
  const loc = [d.address, d.country].filter(Boolean).join(', ') || 'their area';
  return `You are a B2B outreach copywriter for an agency that improves companies' visibility in AI assistants (ChatGPT, Perplexity, Gemini) — "AI SEO / Generative Engine Optimization".

Write ONE short LinkedIn first-message to this person, matching the STYLE, TONE and LENGTH of the EXAMPLE, but with fresh wording (never copy it verbatim).

LEAD (use ONLY this real data — never invent company facts):
- First name: ${d.first || '(unknown)'}
- Company: ${d.company || '(their company)'}
- Industry / services: ${d.vertical || 'their industry'}
- Location: ${loc}

EXAMPLE to imitate (note the styled unicode characters used for emphasis):
${LI_EXAMPLE}

RULES:
- Open with the person's first name.
- Invent a realistic, specific ChatGPT-style question that a potential CUSTOMER of this company (based on their industry + location) would actually type, and render that whole question in 𝗯𝗼𝗹𝗱 unicode exactly like the example.
- Render the company name in 𝘪𝘵𝘢𝘭𝘪𝘤 unicode.
- Concise and human. No hashtags, no links, no markdown, no emojis.
- Output ONLY the finished message, ready to paste straight into LinkedIn. No preamble, no surrounding quotes.`;
}

function buildEmailPrompt(d) {
  const loc = [d.address, d.country].filter(Boolean).join(', ') || 'their area';
  return `Write a short cold intro EMAIL (with a subject line) to ${d.first || 'the contact'} at ${d.company || 'their company'}, offering to improve their visibility in AI assistants (ChatGPT, Perplexity, Gemini) so customers who search with AI actually find them.

LEAD (use ONLY this real data — never invent facts):
- First name: ${d.first || '(unknown)'}
- Company: ${d.company || '(their company)'}
- Industry / services: ${d.vertical || 'their industry'}
- Location: ${loc}

STRUCTURE:
Subject: <specific, compelling, under 60 characters>

<2–4 short paragraphs>: open with a concrete scenario — someone asking an AI assistant for the best ${d.vertical || 'provider'} in ${loc} and ${d.company || 'this company'} not appearing in the answer; explain you help businesses get recommended by ChatGPT / Perplexity / Gemini; finish with one clear, low-friction CTA.

RULES:
- Warm, concise, professional. No markdown, no placeholders like [Name]. Ready to send as-is.
- Output ONLY the email (the "Subject:" line followed by the body).`;
}

// ── Unicode styling ───────────────────────────────────────────────────────────
// LinkedIn / plain text have no rich formatting, so emphasis is rendered with
// styled unicode characters. The model emits **bold** / *italic* markers and we
// convert them here, so the styling is guaranteed regardless of the model.
function toBold(s) {
  return s.replace(/[A-Za-z0-9]/g, c => {
    const n = c.charCodeAt(0);
    if (n >= 65 && n <= 90) return String.fromCodePoint(0x1D5D4 + n - 65);
    if (n >= 97 && n <= 122) return String.fromCodePoint(0x1D5EE + n - 97);
    return String.fromCodePoint(0x1D7EC + n - 48);
  });
}
function toItalic(s) {
  return s.replace(/[A-Za-z]/g, c => {
    const n = c.charCodeAt(0);
    if (n >= 65 && n <= 90) return String.fromCodePoint(0x1D608 + n - 65);
    return String.fromCodePoint(0x1D622 + n - 97);
  });
}
function applyStyle(text) {
  return String(text || '')
    .replace(/\*\*([^*]+?)\*\*/g, (_, m) => toBold(m))
    .replace(/\*([^*]+?)\*/g, (_, m) => toItalic(m));
}

// These supersede the earlier builders (last function declaration wins): they use
// **/* markers (converted above) and follow the user's template faithfully.
function buildLinkedInPrompt(d) {
  const loc = [d.address, d.country].filter(Boolean).join(', ') || 'their area';
  return `You write ONE short LinkedIn first-message for an agency that helps companies get recommended by AI assistants (ChatGPT, Perplexity, Gemini) — "Generative Engine Optimization".

Follow this EXACT template and flow (keep the structure; change only the specifics):

Hi {FirstName}, I asked **ChatGPT**:
**"What are the best {industry} companies in {location} for {a specific service} with {a differentiator}?"**
It recommended other companies, but *{Company}* didn't appear in that response.
We can help improve your visibility in **ChatGPT**, **Perplexity**, **Gemini** and other AI platforms to attract more potential clients and strengthen your company's reputation.
Would you like me to send you more information?

LEAD DATA (use ONLY this — never invent company facts):
- First name: ${d.first || '(unknown)'}
- Company: ${d.company || 'their company'}
- Industry / services: ${d.vertical || 'their industry'}
- Location: ${loc}

FORMATTING (critical):
- Wrap the ENTIRE fake ChatGPT question in **double asterisks**.
- Wrap each of the words ChatGPT, Perplexity, Gemini in **double asterisks** wherever they appear.
- Wrap the company name in *single asterisks*.
- Use NO other markdown. No emojis, hashtags, or links.

RULES:
- Invent ONLY the realistic customer search question (specific to this company's industry + location). Everything else uses the real data above.
- Do NOT add any signature, sign-off, name, or placeholder (no "Best,", no "[Your Name]"). End with exactly: Would you like me to send you more information?  — and write nothing after it.
- Output ONLY the finished message.`;
}

function buildEmailPrompt(d) {
  const loc = [d.address, d.country].filter(Boolean).join(', ') || 'their area';
  return `Write a short cold intro EMAIL (with a subject line) from an agency that helps companies get recommended by AI assistants. Same idea as the LinkedIn template, in email form.

Follow this flow:

Subject: {specific, under 60 chars, about being found in AI / ChatGPT search}

Hi {FirstName},

I asked **ChatGPT**: **"What are the best {industry} companies in {location} for {a specific service}?"** — and *{Company}* didn't appear. It recommended competitors instead.

More and more customers search with AI assistants (ChatGPT, Perplexity, Gemini) instead of Google. We help businesses like *{Company}* get recommended inside those AI answers, so you win those leads and strengthen your reputation.

Would you like me to send you more information?

LEAD DATA (use ONLY this — never invent company facts):
- First name: ${d.first || '(unknown)'}
- Company: ${d.company || 'their company'}
- Industry / services: ${d.vertical || 'their industry'}
- Location: ${loc}

FORMATTING: bold with **double asterisks** (the ChatGPT question and the words ChatGPT/Perplexity/Gemini), italic company name with *single asterisks*. No other markdown.

RULES:
- Invent ONLY the realistic customer search question. Everything else uses the real data.
- Do NOT add any signature, sign-off, sender name, company, or placeholder (no "Best,", no "[Your Name]", no "[Company]"). End with exactly: Would you like me to send you more information?  — and write nothing after it.
- Output ONLY the email: the "Subject:" line, then the body.`;
}

async function generateMessagesForItem(config, ctx, dbRef, auto) {
  const item = ctx.item;
  if (!item) return;
  const f = leadFields(dbRef, item);
  const d = {
    first:    f('Contact First Name') || String(item.name || '').split(' ')[0],
    company:  f('Company name') || '',
    vertical: f('Vertical') || '',
    country:  f('Country') || '',
    address:  f('Address') || '',
  };

  // Use the automation creator's configured key for the chosen provider.
  const provider = config.provider || 'openai';
  const creatorId = (auto && auto.created_by) || ctx.userId;
  const keyRow = dbRef.prepare('SELECT api_key, model FROM user_ai_providers WHERE user_id = ? AND provider = ?')
    .get(creatorId, provider);
  if (!keyRow || !keyRow.api_key) {
    console.warn(`[generate_messages] no "${provider}" API key configured for user ${creatorId}`);
    return;
  }
  const model = config.model || keyRow.model || undefined;

  // 1500 output tokens: some models (e.g. gpt-oss) spend tokens on reasoning, and
  // a too-low limit returned an empty LinkedIn message.
  const [linkedin, email] = await Promise.all([
    generateText(provider, keyRow.api_key, { prompt: buildLinkedInPrompt(d), model, max_tokens: 1500 })
      .catch(e => { console.error('[generate_messages linkedin]', e.message); return ''; }),
    generateText(provider, keyRow.api_key, { prompt: buildEmailPrompt(d), model, max_tokens: 1500 })
      .catch(e => { console.error('[generate_messages email]', e.message); return ''; }),
  ]);

  const liCol = ensureColumn(dbRef, item.board_id, config.linkedin_column || 'Linkedin 1st Message');
  const emCol = ensureColumn(dbRef, item.board_id, config.email_column || 'Intro email');
  const styledLi = applyStyle(linkedin).trim();
  const styledEm = applyStyle(email).trim();
  if (styledLi) writeValue(dbRef, item.id, liCol, styledLi);
  if (styledEm) writeValue(dbRef, item.id, emCol, styledEm);
}

module.exports = router;
module.exports.runAutomations = runAutomations;
