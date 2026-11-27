const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { authenticate } = require('../middleware/auth');
const { generateText } = require('../services/aiProviders');

const router = express.Router();

function canAccessBoard(boardId, userId) {
  const board = db.prepare('SELECT b.* FROM boards b WHERE b.id = ?').get(boardId);
  if (!board) return false;
  const member = db.prepare('SELECT 1 FROM workspace_members WHERE workspace_id = ? AND user_id = ?')
    .get(board.workspace_id, userId);
  return !!member;
}

// ── Token / AI resolution ─────────────────────────────────────────────────────

// Returns a getter: column name (case-insensitive) → the item's cell value.
function itemFields(item) {
  const cols = db.prepare('SELECT id, name FROM board_columns WHERE board_id = ?').all(item.board_id);
  const vals = db.prepare('SELECT column_id, value FROM item_values WHERE item_id = ?').all(item.id);
  const byCol = {};
  for (const v of vals) byCol[v.column_id] = v.value;
  const byName = {};
  for (const c of cols) byName[c.name.trim().toLowerCase()] = byCol[c.id] || '';
  byName['item name'] = item.name || '';
  byName['name'] = byName['name'] || item.name || '';
  return name => byName[String(name).trim().toLowerCase()] ?? '';
}

function ensureColumn(boardId, name) {
  const existing = db.prepare('SELECT id FROM board_columns WHERE board_id = ? AND LOWER(name) = LOWER(?)').get(boardId, name);
  if (existing) return existing.id;
  const id = uuidv4();
  const pos = db.prepare('SELECT COALESCE(MAX(position),0)+1 AS p FROM board_columns WHERE board_id = ?').get(boardId).p;
  db.prepare('INSERT INTO board_columns (id, board_id, name, type, settings, position) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, boardId, name, 'text', '{}', pos);
  return id;
}

function writeValue(itemId, columnId, value) {
  db.prepare(`INSERT INTO item_values (id, item_id, column_id, value) VALUES (?, ?, ?, ?)
    ON CONFLICT(item_id, column_id) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`)
    .run(uuidv4(), itemId, columnId, value);
}

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

// Resolve the AI key to use: the actor's key for the provider, else the template
// author's key. Returns { api_key, model, base_url, provider } or null.
function resolveAiKey(actorId, authorId, wantProvider) {
  let provider = wantProvider;
  if (!provider) {
    const def = db.prepare('SELECT provider FROM user_ai_providers WHERE user_id = ? AND is_default = 1').get(actorId)
      || db.prepare('SELECT provider FROM user_ai_providers WHERE user_id = ? LIMIT 1').get(actorId)
      || (authorId && db.prepare('SELECT provider FROM user_ai_providers WHERE user_id = ? AND is_default = 1').get(authorId))
      || (authorId && db.prepare('SELECT provider FROM user_ai_providers WHERE user_id = ? LIMIT 1').get(authorId));
    provider = def && def.provider;
  }
  if (!provider) return null;
  let row = db.prepare('SELECT api_key, model, base_url FROM user_ai_providers WHERE user_id = ? AND provider = ?').get(actorId, provider);
  if ((!row || !row.api_key) && authorId) {
    row = db.prepare('SELECT api_key, model, base_url FROM user_ai_providers WHERE user_id = ? AND provider = ?').get(authorId, provider);
  }
  if (!row || !row.api_key) return null;
  return { ...row, provider };
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

router.get('/', authenticate, (req, res) => {
  const boardId = req.query.board_id;
  if (!boardId) return res.status(400).json({ error: 'board_id required' });
  if (!canAccessBoard(boardId, req.user.id)) return res.status(403).json({ error: 'Access denied' });
  const rows = db.prepare('SELECT * FROM message_templates WHERE board_id = ? ORDER BY position, created_at').all(boardId);
  res.json(rows);
});

router.post('/', authenticate, (req, res) => {
  const { board_id, name, target_column, body, ai_provider, apply_styling } = req.body;
  if (!board_id || !name) return res.status(400).json({ error: 'board_id and name required' });
  if (!canAccessBoard(board_id, req.user.id)) return res.status(403).json({ error: 'Access denied' });
  const id = uuidv4();
  const pos = db.prepare('SELECT COALESCE(MAX(position),0)+1 AS p FROM message_templates WHERE board_id = ?').get(board_id).p;
  db.prepare(`INSERT INTO message_templates (id, board_id, name, target_column, body, ai_provider, apply_styling, position, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, board_id, name, target_column || '', body || '', ai_provider || null, apply_styling ? 1 : 0, pos, req.user.id);
  res.json(db.prepare('SELECT * FROM message_templates WHERE id = ?').get(id));
});

router.put('/:id', authenticate, (req, res) => {
  const tpl = db.prepare('SELECT * FROM message_templates WHERE id = ?').get(req.params.id);
  if (!tpl) return res.status(404).json({ error: 'Template not found' });
  if (!canAccessBoard(tpl.board_id, req.user.id)) return res.status(403).json({ error: 'Access denied' });
  const { name, target_column, body, ai_provider, apply_styling } = req.body;
  db.prepare(`UPDATE message_templates SET
    name = COALESCE(?, name), target_column = COALESCE(?, target_column), body = COALESCE(?, body),
    ai_provider = ?, apply_styling = COALESCE(?, apply_styling) WHERE id = ?`)
    .run(
      name ?? null, target_column ?? null, body ?? null,
      ai_provider || null,
      apply_styling === undefined ? null : (apply_styling ? 1 : 0),
      req.params.id,
    );
  res.json(db.prepare('SELECT * FROM message_templates WHERE id = ?').get(req.params.id));
});

router.delete('/:id', authenticate, (req, res) => {
  const tpl = db.prepare('SELECT * FROM message_templates WHERE id = ?').get(req.params.id);
  if (!tpl) return res.status(404).json({ error: 'Template not found' });
  if (!canAccessBoard(tpl.board_id, req.user.id)) return res.status(403).json({ error: 'Access denied' });
  db.prepare('DELETE FROM message_templates WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Copy a template to another board (duplicate across boards).
router.post('/:id/duplicate', authenticate, (req, res) => {
  const tpl = db.prepare('SELECT * FROM message_templates WHERE id = ?').get(req.params.id);
  if (!tpl) return res.status(404).json({ error: 'Template not found' });
  const target = req.body.board_id || tpl.board_id;
  if (!canAccessBoard(tpl.board_id, req.user.id) || !canAccessBoard(target, req.user.id)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  const id = uuidv4();
  const pos = db.prepare('SELECT COALESCE(MAX(position),0)+1 AS p FROM message_templates WHERE board_id = ?').get(target).p;
  const sameBoard = target === tpl.board_id;
  db.prepare(`INSERT INTO message_templates (id, board_id, name, target_column, body, ai_provider, apply_styling, position, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, target, sameBoard ? `${tpl.name} (copy)` : tpl.name, tpl.target_column, tpl.body, tpl.ai_provider, tpl.apply_styling, pos, req.user.id);
  res.json(db.prepare('SELECT * FROM message_templates WHERE id = ?').get(id));
});

// ── Run a template against one item ─────────────────────────────────────────────
router.post('/:id/run', authenticate, async (req, res) => {
  const tpl = db.prepare('SELECT * FROM message_templates WHERE id = ?').get(req.params.id);
  if (!tpl) return res.status(404).json({ error: 'Template not found' });
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.body.item_id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  if (!canAccessBoard(item.board_id, req.user.id)) return res.status(403).json({ error: 'Access denied' });

  try {
    const f = itemFields(item);
    // 1) Resolve {{Column}} tokens everywhere (including inside [[AI: ...]]).
    let text = String(tpl.body || '').replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, name) => f(name));

    // 2) Resolve [[AI: instruction]] segments by calling the model.
    const aiSegments = [...text.matchAll(/\[\[\s*AI:\s*([\s\S]*?)\]\]/gi)];
    if (aiSegments.length) {
      const key = resolveAiKey(req.user.id, tpl.created_by, tpl.ai_provider);
      if (!key) return res.status(400).json({ error: 'No AI provider/key configured. Add one in an automation, or remove the [[AI: …]] part.' });
      const outputs = await Promise.all(aiSegments.map(m =>
        generateText(key.provider, key.api_key, {
          prompt: m[1].trim(),
          model: key.model || undefined,
          base_url: key.base_url || undefined,
          max_tokens: 1200,
        }).then(r => String(r || '').trim()).catch(() => '')
      ));
      let i = 0;
      text = text.replace(/\[\[\s*AI:\s*[\s\S]*?\]\]/gi, () => outputs[i++] || '');
    }

    // 3) Optional unicode bold/italic styling (**bold**, *italic*).
    if (tpl.apply_styling) text = applyStyle(text);
    text = text.trim();

    // 4) Write to the target column (created as text if missing).
    const colName = tpl.target_column && tpl.target_column.trim() ? tpl.target_column.trim() : tpl.name;
    const columnId = ensureColumn(item.board_id, colName);
    writeValue(item.id, columnId, text);
    db.prepare('UPDATE items SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(item.id);

    res.json({ column_id: columnId, column_name: colName, value: text });
  } catch (e) {
    console.error('[templates:run]', e);
    res.status(500).json({ error: e.message || 'Failed to run template' });
  }
});

module.exports = router;
