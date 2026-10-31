// LinkedIn Outreach — Phase 1 (the rails).
// Campaigns hold a connect-note template + a message/sequence; targets flow
// queued → invited → accepted → messaged → replied. The browser extension
// (Phase 2/3) will drive the queue; for now the UI runs it in assist mode.
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { authenticate, authenticateFlexible } = require('../middleware/auth');
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

// Migrations: rotating message variants (SQLite has no ADD COLUMN IF NOT EXISTS).
for (const sql of [
  `ALTER TABLE outreach_campaigns ADD COLUMN note_variants TEXT`,  // JSON array of connect-note variants
  `ALTER TABLE outreach_steps ADD COLUMN variants TEXT`,           // JSON array of message variants
]) { try { db.exec(sql); } catch (_) { /* already exists */ } }

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

// Normalize a list of template variants: drop blanks, always return ≥1 entry.
function cleanVariants(arr, fallback) {
  const list = (Array.isArray(arr) ? arr : []).map(s => String(s || '').trim()).filter(Boolean);
  if (list.length) return list;
  const f = String(fallback || '').trim();
  return f ? [f] : [];
}
function parseVariants(json, fallback) {
  let list = [];
  try { list = JSON.parse(json || '[]'); } catch (_) { list = []; }
  if (!Array.isArray(list)) list = [];
  list = list.map(s => String(s || '')).filter(s => s.trim());
  if (!list.length && fallback) list = [fallback];
  return list;
}
// Pick a variant to rotate through (round-robin by index; random when no index).
function pickVariant(list, idx) {
  if (!list || !list.length) return '';
  if (typeof idx === 'number' && idx >= 0) return list[idx % list.length];
  return list[Math.floor(Math.random() * list.length)];
}

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
  const noteVariants = cleanVariants(b.note_variants, b.connect_note);
  db.prepare(`INSERT INTO outreach_campaigns
    (id, user_id, name, status, connect_note, note_variants, follow_too, message_mode, daily_limit, min_delay_sec, max_delay_sec, ai_provider, ai_instruction)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, req.user.id, b.name.trim(), b.status || 'draft', noteVariants[0] || '', JSON.stringify(noteVariants),
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
    if (!s) return;
    const variants = cleanVariants(s.variants, s.body);
    if (!variants.length) return;
    db.prepare('INSERT INTO outreach_steps (id, campaign_id, step_index, delay_days, body, variants) VALUES (?,?,?,?,?,?)')
      .run(uuidv4(), campaignId, i, Number(s.delay_days) || 0, variants[0], JSON.stringify(variants));
  });
}

router.get('/campaigns/:id', authenticate, (req, res) => {
  const c = ownCampaign(req.params.id, req.user.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const steps = db.prepare('SELECT * FROM outreach_steps WHERE campaign_id = ? ORDER BY step_index').all(c.id)
    .map(s => ({ ...s, variants: parseVariants(s.variants, s.body) }));
  const targets = db.prepare('SELECT * FROM outreach_targets WHERE campaign_id = ? ORDER BY created_at').all(c.id);
  const note_variants = parseVariants(c.note_variants, c.connect_note);
  res.json({ ok: true, data: { ...campaignWithCounts(c), note_variants, steps, targets } });
});

router.put('/campaigns/:id', authenticate, (req, res) => {
  const c = ownCampaign(req.params.id, req.user.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  const noteVariants = b.note_variants !== undefined
    ? cleanVariants(b.note_variants, b.connect_note)
    : parseVariants(c.note_variants, c.connect_note);
  const fields = {
    name: b.name !== undefined ? b.name.trim() : c.name,
    status: b.status !== undefined ? b.status : c.status,
    connect_note: noteVariants[0] || '',
    note_variants: JSON.stringify(noteVariants),
    follow_too: b.follow_too !== undefined ? (b.follow_too ? 1 : 0) : c.follow_too,
    message_mode: b.message_mode !== undefined ? (b.message_mode === 'sequence' ? 'sequence' : 'single') : c.message_mode,
    daily_limit: b.daily_limit !== undefined ? Number(b.daily_limit) || 20 : c.daily_limit,
    min_delay_sec: b.min_delay_sec !== undefined ? Number(b.min_delay_sec) || 45 : c.min_delay_sec,
    max_delay_sec: b.max_delay_sec !== undefined ? Number(b.max_delay_sec) || 120 : c.max_delay_sec,
    ai_provider: b.ai_provider !== undefined ? b.ai_provider : c.ai_provider,
    ai_instruction: b.ai_instruction !== undefined ? b.ai_instruction : c.ai_instruction,
  };
  db.prepare(`UPDATE outreach_campaigns SET name=?, status=?, connect_note=?, note_variants=?, follow_too=?, message_mode=?,
      daily_limit=?, min_delay_sec=?, max_delay_sec=?, ai_provider=?, ai_instruction=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=?`).run(
    fields.name, fields.status, fields.connect_note, fields.note_variants, fields.follow_too, fields.message_mode,
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
  } else if (b.from === 'manual' || b.from === 'rows') {
    // Explicit rows — used by manual single-add, paste, and board multi-select.
    source = ['candidate', 'board', 'manual'].includes(b.source) ? b.source : 'manual';
    rows = (b.rows || []).map(r => ({
      name: r.name || null, headline: r.headline || null, company: r.company || null,
      linkedin_url: r.linkedin_url || r.url || null, source_ref: r.source_ref || null,
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
    let variants = [];
    if (b.kind === 'note') variants = parseVariants(c.note_variants, c.connect_note);
    else {
      const idx = Number(b.step_index) || 0;
      const step = db.prepare('SELECT body, variants FROM outreach_steps WHERE campaign_id = ? AND step_index = ?').get(c.id, idx);
      variants = step ? parseVariants(step.variants, step.body) : [];
    }
    if (!variants.length) return res.json({ ok: true, text: '' });
    // Rotate through variants so previews show the anti-detection rotation too.
    const vi = b.variant_index !== undefined ? Number(b.variant_index) : undefined;
    const tpl = pickVariant(variants, vi);
    const text = await resolveText(tpl, t, c, req.user.id);
    res.json({ ok: true, text, variant_count: variants.length });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── Extension API (authenticateFlexible = JWT or the browser-extension token) ──
// The LinkedIn extension polls these to run the queue and report results.

function invitesToday(campaignId) {
  const r = db.prepare(`SELECT COUNT(*) n FROM outreach_targets
    WHERE campaign_id = ? AND invited_at IS NOT NULL AND date(invited_at) = date('now')`).get(campaignId);
  return r ? r.n : 0;
}
function invitedTotal(campaignId) {
  const r = db.prepare(`SELECT COUNT(*) n FROM outreach_targets WHERE campaign_id = ? AND status != 'queued'`).get(campaignId);
  return r ? r.n : 0;
}

// Cheap overview for the extension/popup (no AI resolution).
router.get('/extension/summary', authenticateFlexible, (req, res) => {
  const camps = db.prepare("SELECT * FROM outreach_campaigns WHERE user_id = ? AND status = 'active'").all(req.user.id);
  let ready = 0;
  const campaigns = camps.map(c => {
    const queued = db.prepare("SELECT COUNT(*) n FROM outreach_targets WHERE campaign_id = ? AND status = 'queued' AND linkedin_url IS NOT NULL AND linkedin_url != ''").get(c.id).n;
    const remainingToday = Math.max(0, c.daily_limit - invitesToday(c.id));
    const canSend = Math.min(queued, remainingToday);
    ready += canSend;
    return { id: c.id, name: c.name, queued, remaining_today: remainingToday, can_send: canSend };
  });
  res.json({ ok: true, data: { ready, campaigns } });
});

// The invite queue: queued targets across active campaigns, within each
// campaign's remaining daily limit, each with a rotated+resolved connect note.
router.get('/extension/next', authenticateFlexible, async (req, res) => {
  const cap = Math.max(1, Math.min(50, Number(req.query.limit) || 15));
  const camps = db.prepare("SELECT * FROM outreach_campaigns WHERE user_id = ? AND status = 'active' ORDER BY created_at").all(req.user.id);
  const out = [];
  for (const c of camps) {
    if (out.length >= cap) break;
    const remaining = Math.max(0, c.daily_limit - invitesToday(c.id));
    if (remaining <= 0) continue;
    const take = Math.min(remaining, cap - out.length);
    const queued = db.prepare(`SELECT * FROM outreach_targets
      WHERE campaign_id = ? AND status = 'queued' AND linkedin_url IS NOT NULL AND linkedin_url != ''
      ORDER BY created_at LIMIT ?`).all(c.id, take);
    if (!queued.length) continue;
    const noteVariants = parseVariants(c.note_variants, c.connect_note);
    const base = invitedTotal(c.id); // rotate variants deterministically
    for (let i = 0; i < queued.length; i++) {
      const t = queued[i];
      let note = '';
      try {
        const tpl = pickVariant(noteVariants, base + i);
        note = tpl ? await resolveText(tpl, t, c, req.user.id) : '';
      } catch (_) { note = fillTokens(pickVariant(noteVariants, base + i), t); }
      out.push({
        target_id: t.id, campaign_id: c.id, name: t.name, linkedin_url: t.linkedin_url,
        note, follow_too: !!c.follow_too,
        min_delay_sec: c.min_delay_sec, max_delay_sec: c.max_delay_sec,
      });
      if (out.length >= cap) break;
    }
  }
  res.json({ ok: true, data: out });
});

// Report the result of an invite (or follow) the extension performed.
router.post('/extension/report', authenticateFlexible, (req, res) => {
  const b = req.body || {};
  const t = db.prepare('SELECT * FROM outreach_targets WHERE id = ?').get(b.target_id);
  if (!t || t.user_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
  if (b.ok) {
    db.prepare(`UPDATE outreach_targets SET status = 'invited', invited_at = CURRENT_TIMESTAMP, last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(t.id);
  } else {
    // Soft failure (already connected / pending / UI change): mark skipped so it
    // doesn't block the queue, keep the reason for review.
    db.prepare(`UPDATE outreach_targets SET status = 'skipped', last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(String(b.error || b.status || 'failed').slice(0, 300), t.id);
  }
  res.json({ ok: true });
});

module.exports = router;
