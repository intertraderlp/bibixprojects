// LinkedIn Outreach — Phase 1 (the rails).
// Campaigns hold a connect-note template + a message/sequence; targets flow
// queued → invited → accepted → messaged → replied. The browser extension
// (Phase 2/3) will drive the queue; for now the UI runs it in assist mode.
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { authenticate } = require('../middleware/auth');
const { generateText } = require('../services/aiProviders');

const router = express.Router();

// ── Tables ──────────────────────────────────────────────────────────────────
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS outreach_campaigns (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT DEFAULT 'draft',            -- draft | active | paused
      connect_note TEXT,                      -- connection-request note template
      follow_too INTEGER DEFAULT 0,
      message_mode TEXT DEFAULT 'single',     -- single | sequence
      daily_limit INTEGER DEFAULT 20,
      min_delay_sec INTEGER DEFAULT 45,
      max_delay_sec INTEGER DEFAULT 120,
      ai_provider TEXT,
      ai_instruction TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS outreach_steps (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL,
      step_index INTEGER NOT NULL,            -- order among post-accept messages
      delay_days INTEGER DEFAULT 0,           -- wait after accept / previous step
      body TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS outreach_targets (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      name TEXT,
      headline TEXT,
      company TEXT,
      linkedin_url TEXT,
      source TEXT,                            -- candidate | board | manual
      source_ref TEXT,
      status TEXT DEFAULT 'queued',           -- queued|invited|accepted|messaged|replied|skipped|failed
      next_step INTEGER DEFAULT 0,
      invited_at DATETIME,
      accepted_at DATETIME,
      messaged_at DATETIME,
      last_error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_oc_user ON outreach_campaigns(user_id);
    CREATE INDEX IF NOT EXISTS idx_ot_campaign ON outreach_targets(campaign_id, status);
    CREATE INDEX IF NOT EXISTS idx_os_campaign ON outreach_steps(campaign_id, step_index);
  `);
} catch (e) { console.error('Outreach table init error (non-fatal):', e.message); }

// ── Helpers ───────────────────────────────────────────────────────────────────
function ownCampaign(id, userId) {
  const c = db.prepare('SELECT * FROM outreach_campaigns WHERE id = ?').get(id);
  if (!c || c.user_id !== userId) return null;
  return c;
}

function canAccessBoard(boardId, userId) {
  const board = db.prepare('SELECT b.* FROM boards b WHERE b.id = ?').get(boardId);
  if (!board) return false;
  const member = db.prepare('SELECT 1 FROM workspace_members WHERE workspace_id = ? AND user_id = ?')
    .get(board.workspace_id, userId);
  return !!member;
}

function firstName(name) { return (name || '').trim().split(/\s+/)[0] || ''; }

// Replace {{Name}} / {{FirstName}} / {{Company}} / {{Headline}} tokens.
function fillTokens(tpl, t) {
  if (!tpl) return '';
  const map = {
    name: t.name || '', fullname: t.name || '', firstname: firstName(t.name),
    company: t.company || '', headline: t.headline || '',
  };
  return String(tpl).replace(/\{\{\s*([\w ]+?)\s*\}\}/g, (m, key) => {
    const k = String(key).toLowerCase().replace(/\s+/g, '');
    return map[k] !== undefined ? map[k] : m;
  });
}

function resolveAiKey(userId, wantProvider) {
  let provider = wantProvider;
  if (!provider) {
    const def = db.prepare('SELECT provider FROM user_ai_providers WHERE user_id = ? AND is_default = 1').get(userId)
      || db.prepare('SELECT provider FROM user_ai_providers WHERE user_id = ? LIMIT 1').get(userId);
    provider = def && def.provider;
  }
  if (!provider) return null;
  const row = db.prepare('SELECT api_key, model, base_url FROM user_ai_providers WHERE user_id = ? AND provider = ?').get(userId, provider);
  if (!row || !row.api_key) return null;
  return { ...row, provider };
}

// Resolve a template for a target: tokens first, then run any [[AI: ...]] blocks.
async function resolveText(tpl, target, campaign, userId) {
  let text = fillTokens(tpl, target);
  const aiBlocks = [...text.matchAll(/\[\[\s*AI:\s*([\s\S]*?)\]\]/gi)];
  if (aiBlocks.length === 0) return text;
  const key = resolveAiKey(userId, campaign.ai_provider);
  if (!key) throw new Error('No AI provider configured — add one in Settings, or remove the [[AI: …]] block.');
  const ctx = `Prospect: ${target.name || 'Unknown'}${target.headline ? ` — ${target.headline}` : ''}${target.company ? ` at ${target.company}` : ''}.`;
  const guide = campaign.ai_instruction ? `\nStyle guidance: ${campaign.ai_instruction}` : '';
  for (const b of aiBlocks) {
    const instruction = b[1].trim();
    const prompt = `${ctx}${guide}\n\nWrite ONLY the requested text, no preamble, no quotes.\nRequest: ${instruction}`;
    const out = await generateText(key.provider, key.api_key, { prompt, model: key.model, base_url: key.base_url, max_tokens: 220 });
    text = text.replace(b[0], (out || '').trim());
  }
  return text.trim();
}

function campaignWithCounts(c) {
  const rows = db.prepare('SELECT status, COUNT(*) n FROM outreach_targets WHERE campaign_id = ? GROUP BY status').all(c.id);
  const counts = {};
  let total = 0;
  for (const r of rows) { counts[r.status] = r.n; total += r.n; }
  return { ...c, counts, total };
}

// ── Campaign CRUD ───────────────────────────────────────────────────────────
router.get('/campaigns', authenticate, (req, res) => {
  const list = db.prepare('SELECT * FROM outreach_campaigns WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
  res.json({ ok: true, data: list.map(campaignWithCounts) });
});

router.post('/campaigns', authenticate, (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.name.trim()) return res.status(400).json({ error: 'name required' });
  const id = uuidv4();
  db.prepare(`INSERT INTO outreach_campaigns
    (id, user_id, name, status, connect_note, follow_too, message_mode, daily_limit, min_delay_sec, max_delay_sec, ai_provider, ai_instruction)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, req.user.id, b.name.trim(), b.status || 'draft', b.connect_note || '',
    b.follow_too ? 1 : 0, b.message_mode === 'sequence' ? 'sequence' : 'single',
    Number(b.daily_limit) || 20, Number(b.min_delay_sec) || 45, Number(b.max_delay_sec) || 120,
    b.ai_provider || null, b.ai_instruction || null
  );
  saveSteps(id, b.steps);
  res.json({ ok: true, data: campaignWithCounts(ownCampaign(id, req.user.id)) });
});

function saveSteps(campaignId, steps) {
  db.prepare('DELETE FROM outreach_steps WHERE campaign_id = ?').run(campaignId);
  const arr = Array.isArray(steps) ? steps : [];
  arr.forEach((s, i) => {
    if (!s || !String(s.body || '').trim()) return;
    db.prepare('INSERT INTO outreach_steps (id, campaign_id, step_index, delay_days, body) VALUES (?,?,?,?,?)')
      .run(uuidv4(), campaignId, i, Number(s.delay_days) || 0, String(s.body).trim());
  });
}

router.get('/campaigns/:id', authenticate, (req, res) => {
  const c = ownCampaign(req.params.id, req.user.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const steps = db.prepare('SELECT * FROM outreach_steps WHERE campaign_id = ? ORDER BY step_index').all(c.id);
  const targets = db.prepare('SELECT * FROM outreach_targets WHERE campaign_id = ? ORDER BY created_at').all(c.id);
  res.json({ ok: true, data: { ...campaignWithCounts(c), steps, targets } });
});

router.put('/campaigns/:id', authenticate, (req, res) => {
  const c = ownCampaign(req.params.id, req.user.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  const fields = {
    name: b.name !== undefined ? b.name.trim() : c.name,
    status: b.status !== undefined ? b.status : c.status,
    connect_note: b.connect_note !== undefined ? b.connect_note : c.connect_note,
    follow_too: b.follow_too !== undefined ? (b.follow_too ? 1 : 0) : c.follow_too,
    message_mode: b.message_mode !== undefined ? (b.message_mode === 'sequence' ? 'sequence' : 'single') : c.message_mode,
    daily_limit: b.daily_limit !== undefined ? Number(b.daily_limit) || 20 : c.daily_limit,
    min_delay_sec: b.min_delay_sec !== undefined ? Number(b.min_delay_sec) || 45 : c.min_delay_sec,
    max_delay_sec: b.max_delay_sec !== undefined ? Number(b.max_delay_sec) || 120 : c.max_delay_sec,
    ai_provider: b.ai_provider !== undefined ? b.ai_provider : c.ai_provider,
    ai_instruction: b.ai_instruction !== undefined ? b.ai_instruction : c.ai_instruction,
  };
  db.prepare(`UPDATE outreach_campaigns SET name=?, status=?, connect_note=?, follow_too=?, message_mode=?,
      daily_limit=?, min_delay_sec=?, max_delay_sec=?, ai_provider=?, ai_instruction=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=?`).run(
    fields.name, fields.status, fields.connect_note, fields.follow_too, fields.message_mode,
    fields.daily_limit, fields.min_delay_sec, fields.max_delay_sec, fields.ai_provider, fields.ai_instruction, c.id
  );
  if (b.steps !== undefined) saveSteps(c.id, b.steps);
  res.json({ ok: true, data: campaignWithCounts(ownCampaign(c.id, req.user.id)) });
});

router.delete('/campaigns/:id', authenticate, (req, res) => {
  const c = ownCampaign(req.params.id, req.user.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM outreach_targets WHERE campaign_id = ?').run(c.id);
  db.prepare('DELETE FROM outreach_steps WHERE campaign_id = ?').run(c.id);
  db.prepare('DELETE FROM outreach_campaigns WHERE id = ?').run(c.id);
  res.json({ ok: true });
});

// ── Targets ─────────────────────────────────────────────────────────────────
function normUrl(u) {
  const s = String(u || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s.split('?')[0].replace(/\/$/, '');
  if (/linkedin\.com/i.test(s)) return 'https://' + s.replace(/^\/+/, '').split('?')[0].replace(/\/$/, '');
  return s;
}

function addTargets(campaignId, userId, rows, source) {
  const existing = new Set(
    db.prepare('SELECT linkedin_url FROM outreach_targets WHERE campaign_id = ?').all(campaignId)
      .map(r => (r.linkedin_url || '').toLowerCase())
  );
  let added = 0, skipped = 0;
  const ins = db.prepare(`INSERT INTO outreach_targets (id, campaign_id, user_id, name, headline, company, linkedin_url, source, source_ref)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  for (const r of rows) {
    const url = normUrl(r.linkedin_url);
    const key = url.toLowerCase();
    if (url && existing.has(key)) { skipped++; continue; }
    if (url) existing.add(key);
    ins.run(uuidv4(), campaignId, userId, r.name || null, r.headline || null, r.company || null, url || null, source, r.source_ref || null);
    added++;
  }
  return { added, skipped };
}

router.post('/campaigns/:id/targets', authenticate, (req, res) => {
  const c = ownCampaign(req.params.id, req.user.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  let rows = [];
  let source = 'manual';

  if (b.from === 'candidates') {
    source = 'candidate';
    const ids = (b.ids || []).map(Number).filter(Boolean);
    if (ids.length) {
      const ph = ids.map(() => '?').join(',');
      const cands = db.prepare(`SELECT id, full_name, first_name, last_name, headline, company, linkedin_url
        FROM linkedin_contacts WHERE user_id = ? AND id IN (${ph})`).all(req.user.id, ...ids);
      rows = cands.map(x => ({
        name: x.full_name || [x.first_name, x.last_name].filter(Boolean).join(' ') || null,
        headline: x.headline, company: x.company, linkedin_url: x.linkedin_url, source_ref: String(x.id),
      }));
    }
  } else if (b.from === 'board') {
    source = 'board';
    if (!b.board_id || !canAccessBoard(b.board_id, req.user.id)) return res.status(403).json({ error: 'Board access denied' });
    const items = db.prepare('SELECT id, name FROM items WHERE board_id = ? AND parent_item_id IS NULL').all(b.board_id);
    const valOf = db.prepare('SELECT value FROM item_values WHERE item_id = ? AND column_id = ?');
    rows = items.map(it => {
      const url = b.url_column ? (valOf.get(it.id, b.url_column) || {}).value : null;
      const nm = b.name_column ? (valOf.get(it.id, b.name_column) || {}).value : null;
      const company = b.company_column ? (valOf.get(it.id, b.company_column) || {}).value : null;
      return { name: nm || it.name, company: company || null, linkedin_url: url || null, source_ref: it.id };
    }).filter(r => r.linkedin_url);
  } else if (b.from === 'manual') {
    source = 'manual';
    rows = (b.rows || []).map(r => ({
      name: r.name || null, headline: r.headline || null, company: r.company || null,
      linkedin_url: r.linkedin_url || r.url || null,
    })).filter(r => r.name || r.linkedin_url);
  } else {
    return res.status(400).json({ error: 'Unknown source' });
  }

  if (!rows.length) return res.json({ ok: true, added: 0, skipped: 0 });
  const r = addTargets(c.id, req.user.id, rows, source);
  res.json({ ok: true, ...r });
});

router.put('/targets/:id', authenticate, (req, res) => {
  const t = db.prepare('SELECT * FROM outreach_targets WHERE id = ?').get(req.params.id);
  if (!t || t.user_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  const status = b.status || t.status;
  // Timestamp the transition when status advances.
  const stamp = {
    invited_at: status === 'invited' && !t.invited_at ? "CURRENT_TIMESTAMP" : null,
    accepted_at: status === 'accepted' && !t.accepted_at ? "CURRENT_TIMESTAMP" : null,
    messaged_at: status === 'messaged' && !t.messaged_at ? "CURRENT_TIMESTAMP" : null,
  };
  db.prepare(`UPDATE outreach_targets SET
      name = COALESCE(?, name), headline = COALESCE(?, headline), company = COALESCE(?, company),
      linkedin_url = COALESCE(?, linkedin_url), status = ?, next_step = COALESCE(?, next_step),
      last_error = ?,
      invited_at  = ${stamp.invited_at  ? 'CURRENT_TIMESTAMP' : 'invited_at'},
      accepted_at = ${stamp.accepted_at ? 'CURRENT_TIMESTAMP' : 'accepted_at'},
      messaged_at = ${stamp.messaged_at ? 'CURRENT_TIMESTAMP' : 'messaged_at'},
      updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`).run(
    b.name ?? null, b.headline ?? null, b.company ?? null, b.linkedin_url ? normUrl(b.linkedin_url) : null,
    status, b.next_step ?? null, b.last_error ?? null, t.id
  );
  res.json({ ok: true, data: db.prepare('SELECT * FROM outreach_targets WHERE id = ?').get(t.id) });
});

router.delete('/targets/:id', authenticate, (req, res) => {
  const t = db.prepare('SELECT * FROM outreach_targets WHERE id = ?').get(req.params.id);
  if (!t || t.user_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM outreach_targets WHERE id = ?').run(t.id);
  res.json({ ok: true });
});

// Preview the resolved connect note or a message step for one target.
router.post('/targets/:id/preview', authenticate, async (req, res) => {
  const t = db.prepare('SELECT * FROM outreach_targets WHERE id = ?').get(req.params.id);
  if (!t || t.user_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
  const c = ownCampaign(t.campaign_id, req.user.id);
  const b = req.body || {};
  try {
    let tpl;
    if (b.kind === 'note') tpl = c.connect_note;
    else {
      const idx = Number(b.step_index) || 0;
      const step = db.prepare('SELECT body FROM outreach_steps WHERE campaign_id = ? AND step_index = ?').get(c.id, idx);
      tpl = step && step.body;
    }
    if (!tpl) return res.json({ ok: true, text: '' });
    const text = await resolveText(tpl, t, c, req.user.id);
    res.json({ ok: true, text });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
