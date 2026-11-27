const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// ── Table ─────────────────────────────────────────────────────────────────────
// Per-user reminders attached to a task (item). Each user sets their own.
db.exec(`CREATE TABLE IF NOT EXISTS task_reminders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  board_id TEXT,
  remind_at TEXT NOT NULL,
  note TEXT,
  done INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);
try { db.exec('CREATE INDEX IF NOT EXISTS idx_task_reminders_user ON task_reminders(user_id)'); } catch (_) {}

function canAccessBoard(boardId, userId) {
  if (!boardId) return false;
  if (db.prepare('SELECT 1 FROM board_members WHERE board_id = ? AND user_id = ?').get(boardId, userId)) return true;
  return !!db.prepare(`
    SELECT b.id FROM boards b
    JOIN workspace_members wm ON b.workspace_id = wm.workspace_id
    WHERE b.id = ? AND wm.user_id = ?
  `).get(boardId, userId);
}

// Enrich reminders with the task name + board name (for the popup & links).
function enrich(rows) {
  return rows.map(r => {
    const item = db.prepare('SELECT name, board_id FROM items WHERE id = ?').get(r.item_id);
    const board = item ? db.prepare('SELECT name FROM boards WHERE id = ?').get(item.board_id) : null;
    return {
      ...r,
      done: !!r.done,
      item_name: item ? item.name : '(deleted task)',
      board_id: item ? item.board_id : r.board_id,
      board_name: board ? board.name : null,
      item_deleted: !item,
    };
  });
}

// ── List my reminders ─────────────────────────────────────────────────────────
// Default: not-done reminders, soonest first. ?all=1 includes done ones.
router.get('/', authenticate, (req, res) => {
  const includeDone = req.query.all === '1';
  const rows = db.prepare(
    `SELECT * FROM task_reminders WHERE user_id = ? ${includeDone ? '' : 'AND done = 0'} ORDER BY remind_at ASC`
  ).all(req.user.id);
  res.json(enrich(rows));
});

// ── My reminders for one task ─────────────────────────────────────────────────
router.get('/item/:itemId', authenticate, (req, res) => {
  const rows = db.prepare('SELECT * FROM task_reminders WHERE user_id = ? AND item_id = ? ORDER BY remind_at ASC')
    .all(req.user.id, req.params.itemId);
  res.json(rows.map(r => ({ ...r, done: !!r.done })));
});

// ── Create ────────────────────────────────────────────────────────────────────
router.post('/', authenticate, (req, res) => {
  const { item_id, remind_at, note } = req.body;
  if (!item_id || !remind_at) return res.status(400).json({ error: 'item_id and remind_at are required' });
  const item = db.prepare('SELECT id, board_id FROM items WHERE id = ?').get(item_id);
  if (!item) return res.status(404).json({ error: 'Task not found' });
  if (!canAccessBoard(item.board_id, req.user.id)) return res.status(403).json({ error: 'Access denied' });

  const id = uuidv4();
  db.prepare('INSERT INTO task_reminders (id, user_id, item_id, board_id, remind_at, note) VALUES (?,?,?,?,?,?)')
    .run(id, req.user.id, item_id, item.board_id, remind_at, note || null);
  const row = db.prepare('SELECT * FROM task_reminders WHERE id = ?').get(id);
  res.json({ ...row, done: !!row.done });
});

// ── Update (time / note / done) ───────────────────────────────────────────────
router.put('/:id', authenticate, (req, res) => {
  const existing = db.prepare('SELECT * FROM task_reminders WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Reminder not found' });
  const { remind_at, note, done } = req.body;
  db.prepare('UPDATE task_reminders SET remind_at = COALESCE(?, remind_at), note = ?, done = ? WHERE id = ?')
    .run(remind_at ?? null, note !== undefined ? note : existing.note, done === undefined ? existing.done : (done ? 1 : 0), existing.id);
  const row = db.prepare('SELECT * FROM task_reminders WHERE id = ?').get(existing.id);
  res.json({ ...row, done: !!row.done });
});

// ── Delete ────────────────────────────────────────────────────────────────────
router.delete('/:id', authenticate, (req, res) => {
  db.prepare('DELETE FROM task_reminders WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ success: true });
});

module.exports = router;
