const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { authenticate } = require('../middleware/auth');
const { runAutomations } = require('./automations');

const router = express.Router();

function canAccessBoard(boardId, userId) {
  if (db.prepare("SELECT 1 FROM board_members WHERE board_id = ? AND user_id = ?").get(boardId, userId)) return true;
  return db.prepare(`
    SELECT b.id FROM boards b
    JOIN workspace_members wm ON b.workspace_id = wm.workspace_id
    WHERE b.id = ? AND wm.user_id = ?
  `).get(boardId, userId);
}

router.post('/', authenticate, (req, res) => {
  const { group_id, name, parent_item_id } = req.body;
  if (!group_id || !name) return res.status(400).json({ error: 'group_id and name required' });

  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(group_id);
  if (!group) return res.status(404).json({ error: 'Group not found' });
  if (!canAccessBoard(group.board_id, req.user.id)) return res.status(403).json({ error: 'Access denied' });

  const parentId = parent_item_id || null;
  let pos = 0;
  try {
    const maxPos = db.prepare('SELECT MAX(position) as mp FROM items WHERE group_id = ? AND parent_item_id IS ?').get(group_id, parentId);
    pos = (maxPos?.mp != null ? Number(maxPos.mp) : -1) + 1;
  } catch (e) {
    console.error('[POST /items] maxPos error:', e.message);
  }

  const id = uuidv4();
  db.prepare('INSERT INTO items (id, group_id, board_id, name, position, created_by, parent_item_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, group_id, group.board_id, name, pos, req.user.id, parentId);

  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
  res.json(item);
});

router.put('/:id', authenticate, (req, res) => {
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  if (!canAccessBoard(item.board_id, req.user.id)) return res.status(403).json({ error: 'Access denied' });

  const { name, group_id } = req.body;
  db.prepare('UPDATE items SET name = COALESCE(?, name), group_id = COALESCE(?, group_id), updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(name || null, group_id || null, req.params.id);

  // Promote / demote: only when the client explicitly sends parent_item_id.
  // null  -> promote a subtask to a top-level task
  // <id>  -> demote a task into a subtask of that parent
  if (Object.prototype.hasOwnProperty.call(req.body, 'parent_item_id')) {
    const newParent = req.body.parent_item_id || null;
    if (newParent === req.params.id) {
      return res.status(400).json({ error: 'An item cannot be its own parent' });
    }
    if (newParent) {
      const parent = db.prepare('SELECT * FROM items WHERE id = ?').get(newParent);
      if (!parent) return res.status(404).json({ error: 'Parent item not found' });
      if (parent.board_id !== item.board_id) return res.status(400).json({ error: 'Parent must be on the same board' });
      // Keep a single level of nesting: no subtasks-of-subtasks, and a task that
      // already has its own subtasks cannot itself become a subtask.
      if (parent.parent_item_id) return res.status(400).json({ error: 'Cannot nest under a subtask' });
      const childCount = db.prepare('SELECT COUNT(*) AS c FROM items WHERE parent_item_id = ?').get(req.params.id).c;
      if (childCount > 0) return res.status(400).json({ error: 'This task has subtasks — promote or move them first' });
      // Subtasks live in their parent's group; append to the end of its subtasks.
      const mp = db.prepare('SELECT MAX(position) AS mp FROM items WHERE group_id = ? AND parent_item_id IS ?').get(parent.group_id, newParent);
      const pos = (mp?.mp ?? -1) + 1;
      db.prepare('UPDATE items SET parent_item_id = ?, group_id = ?, position = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(newParent, parent.group_id, pos, req.params.id);
    } else {
      // Promote to a top-level task; append to the end of its group's top-level items.
      const mp = db.prepare('SELECT MAX(position) AS mp FROM items WHERE group_id = ? AND parent_item_id IS NULL').get(item.group_id);
      const pos = (mp?.mp ?? -1) + 1;
      db.prepare('UPDATE items SET parent_item_id = NULL, position = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(pos, req.params.id);
    }
  }

  const updated = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  res.json(updated);
});

router.delete('/:id', authenticate, (req, res) => {
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  if (!canAccessBoard(item.board_id, req.user.id)) return res.status(403).json({ error: 'Access denied' });
  db.prepare('DELETE FROM items WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

router.put('/:id/values', authenticate, (req, res) => {
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  if (!canAccessBoard(item.board_id, req.user.id)) return res.status(403).json({ error: 'Access denied' });

  const { column_id, value } = req.body;
  if (!column_id) return res.status(400).json({ error: 'column_id required' });

  const col = db.prepare('SELECT * FROM board_columns WHERE id = ?').get(column_id);
  if (!col) return res.status(404).json({ error: 'Column not found' });

  const oldValue = db.prepare('SELECT value FROM item_values WHERE item_id = ? AND column_id = ?')
    .get(req.params.id, column_id);

  const valueId = uuidv4();
  db.prepare(`
    INSERT INTO item_values (id, item_id, column_id, value) VALUES (?, ?, ?, ?)
    ON CONFLICT(item_id, column_id) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).run(valueId, req.params.id, column_id, value !== undefined ? String(value) : null);

  db.prepare('UPDATE items SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.params.id);

  try {
    runAutomations(item.board_id, 'value_changed', {
      item,
      column: col,
      oldValue: oldValue?.value,
      newValue: value,
      userId: req.user.id,
    }, db);
  } catch (e) { /* non-fatal */ }

  const updated = db.prepare('SELECT * FROM item_values WHERE item_id = ? AND column_id = ?')
    .get(req.params.id, column_id);
  res.json(updated);
});

router.get('/:id', authenticate, (req, res) => {
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  if (!canAccessBoard(item.board_id, req.user.id)) return res.status(403).json({ error: 'Access denied' });

  const values = db.prepare('SELECT * FROM item_values WHERE item_id = ?').all(req.params.id);
  const updates = db.prepare(`
    SELECT u.*, usr.name as author_name, usr.avatar_color as author_color
    FROM updates u JOIN users usr ON u.user_id = usr.id
    WHERE u.item_id = ? ORDER BY u.created_at ASC
  `).all(req.params.id).map(u => ({
    ...u,
    attachments: db.prepare('SELECT * FROM attachments WHERE update_id = ? ORDER BY created_at ASC').all(u.id),
  }));

  const board = db.prepare('SELECT name FROM boards WHERE id = ?').get(item.board_id);
  const group = db.prepare('SELECT name FROM groups WHERE id = ?').get(item.group_id);

  res.json({ ...item, values, updates, board_name: board?.name, group_name: group?.name });
});

router.put('/:id/move', authenticate, (req, res) => {
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  if (!canAccessBoard(item.board_id, req.user.id)) return res.status(403).json({ error: 'Access denied' });

  const { group_id, position } = req.body;
  db.prepare('UPDATE items SET group_id = COALESCE(?, group_id), position = COALESCE(?, position), updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(group_id || null, position !== undefined ? position : null, req.params.id);

  res.json(db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id));
});

module.exports = router;
