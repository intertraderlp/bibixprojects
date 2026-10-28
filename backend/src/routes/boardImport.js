const express = require('express');
const multer  = require('multer');
const XLSX    = require('xlsx');
const { v4: uuidv4 } = require('uuid');
const db      = require('../db/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router({ mergeParams: true });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function canAccessBoard(boardId, userId) {
  if (db.prepare('SELECT 1 FROM board_members WHERE board_id = ? AND user_id = ?').get(boardId, userId)) return true;
  return db.prepare(
    'SELECT b.id FROM boards b JOIN workspace_members wm ON b.workspace_id = wm.workspace_id WHERE b.id = ? AND wm.user_id = ?'
  ).get(boardId, userId);
}

// ── Date helpers ──────────────────────────────────────────────────────────────

/**
 * Accept: Excel serial number, YYYY-MM-DD, DD/MM/YYYY, MM/DD/YYYY, or any
 * string parseable by the JS Date constructor. Returns 'YYYY-MM-DD' or null.
 */
function parseFlexibleDate(raw) {
  if (raw === null || raw === undefined || raw === '') return null;

  // Excel serial number (dates show up as numbers like 45123)
  if (typeof raw === 'number') {
    if (raw > 25569 && raw < 73050) { // ~1970 – ~2099
      // Excel epoch is Dec 30 1899; subtract 25569 days to get Unix epoch days
      const ms = (raw - 25569) * 86400 * 1000;
      const d  = new Date(ms);
      const y  = d.getUTCFullYear();
      const m  = String(d.getUTCMonth() + 1).padStart(2, '0');
      const dy = String(d.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${dy}`;
    }
    return null;
  }

  const str = String(raw).trim();
  if (!str) return null;

  // YYYY-MM-DD
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(str)) {
    const [y, m, d] = str.split('-');
    const dt = new Date(`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}T12:00:00Z`);
    if (!isNaN(dt.getTime())) return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }

  // DD/MM/YYYY or D/M/YYYY
  const dmy = str.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    const dateStr = `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
    const dt = new Date(dateStr + 'T12:00:00Z');
    if (!isNaN(dt.getTime())) return dateStr;
  }

  // Fallback: JS Date parser
  const dt = new Date(str);
  if (!isNaN(dt.getTime())) {
    const y  = dt.getFullYear();
    const m  = String(dt.getMonth() + 1).padStart(2, '0');
    const d  = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  return null;
}

// ── Column value validation ───────────────────────────────────────────────────

/**
 * Returns { valid: boolean, normalized: string|null, reason: string|null }
 * - valid=true, normalized=null  → empty / skip silently
 * - valid=true, normalized=str   → store this value
 * - valid=false                  → report error, skip value
 */
function validateColumnValue(col, rawVal) {
  if (rawVal === null || rawVal === undefined || rawVal === '') {
    return { valid: true, normalized: null };
  }

  const str = String(rawVal).trim();
  if (!str) return { valid: true, normalized: null };

  let settings = {};
  try {
    settings = typeof col.settings === 'string'
      ? JSON.parse(col.settings)
      : (col.settings || {});
  } catch { /* leave empty */ }

  switch (col.type) {
    case 'date': {
      const normalized = parseFlexibleDate(rawVal);
      if (!normalized) {
        return {
          valid: false, normalized: null,
          reason: `"${str}" is not a valid date. Use DD/MM/YYYY (e.g. 15/06/2024) or YYYY-MM-DD`,
        };
      }
      return { valid: true, normalized };
    }

    case 'number': {
      const cleaned = str.replace(/[,\s]/g, '');
      if (isNaN(Number(cleaned))) {
        return { valid: false, normalized: null, reason: `"${str}" is not a valid number` };
      }
      return { valid: true, normalized: String(Number(cleaned)) };
    }

    case 'checkbox': {
      const lower = str.toLowerCase();
      if (['true', '1', 'yes', 'y', '✓', 'x', 'on'].includes(lower)) {
        return { valid: true, normalized: 'true' };
      }
      if (['false', '0', 'no', 'n', 'off'].includes(lower)) {
        return { valid: true, normalized: 'false' };
      }
      return {
        valid: false, normalized: null,
        reason: `"${str}" is not valid for a checkbox. Use: true, false, yes, no, 1, 0`,
      };
    }

    case 'status':
    case 'priority': {
      const options = settings.options || [];
      if (!options.length) return { valid: true, normalized: str }; // no options set → accept any
      const match = options.find(o => o.label.toLowerCase() === str.toLowerCase());
      if (!match) {
        const validList = options.map(o => `"${o.label}"`).join(', ');
        return {
          valid: false, normalized: null,
          reason: `"${str}" is not a valid option. Accepted values: ${validList}`,
        };
      }
      return { valid: true, normalized: match.label }; // normalise case
    }

    case 'timeline': {
      const parts = str.split('/');
      if (parts.length !== 2) {
        return {
          valid: false, normalized: null,
          reason: `"${str}" is not a valid timeline. Format: YYYY-MM-DD/YYYY-MM-DD`,
        };
      }
      const start = parseFlexibleDate(parts[0].trim());
      const end   = parseFlexibleDate(parts[1].trim());
      if (!start || !end) {
        return {
          valid: false, normalized: null,
          reason: `"${str}" contains an invalid date. Format: YYYY-MM-DD/YYYY-MM-DD`,
        };
      }
      if (start > end) {
        return {
          valid: false, normalized: null,
          reason: `Start date (${start}) is after end date (${end})`,
        };
      }
      return { valid: true, normalized: `${start}/${end}` };
    }

    case 'link': {
      // Accept http/https, app deep-links (tg://, mailto:, etc.), and relative paths
      if (!/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//i.test(str) && !str.startsWith('/') && !str.startsWith('mailto:')) {
        return {
          valid: false, normalized: null,
          reason: `"${str}" doesn't look like a URL. Links should start with https://, http://, or a URI scheme like tg://`,
        };
      }
      return { valid: true, normalized: str };
    }

    // text, tags, person, attachments → always valid
    default:
      return { valid: true, normalized: str };
  }
}

// ── POST /api/boards/:boardId/import ─────────────────────────────────────────

const GROUP_COLORS = ['#0073ea','#00c875','#e2445c','#ffcb00','#ff642e','#9d50dd','#333333','#579bfc'];

router.post('/', authenticate, upload.single('file'), (req, res) => {
  const { boardId } = req.params;
  if (!canAccessBoard(boardId, req.user.id)) return res.status(403).json({ error: 'Forbidden' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  // ── Parse file ────────────────────────────────────────────────────────────
  let rows;
  try {
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet    = workbook.Sheets[workbook.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  } catch {
    return res.status(400).json({ error: 'Could not parse file. Make sure it is a valid .xlsx or .csv file.' });
  }

  if (!rows.length) return res.json({ imported: 0, skipped: 0, groups: 0, errors: [] });

  // ── Check required columns exist ──────────────────────────────────────────
  const firstRow = rows[0];
  const hasTasks = 'Task Name' in firstRow;
  if (!hasTasks) {
    return res.status(400).json({
      error: 'The file is missing the required "Task Name" column. Please download the template and try again.',
    });
  }

  // ── Board metadata ────────────────────────────────────────────────────────
  const columns      = db.prepare('SELECT * FROM board_columns WHERE board_id = ? ORDER BY position').all(boardId);
  const existingGroups = db.prepare('SELECT id, name FROM groups WHERE board_id = ?').all(boardId);

  const groupMap = {};
  for (const g of existingGroups) groupMap[g.name.toLowerCase()] = g.id;
  let maxGroupPos = db.prepare('SELECT COALESCE(MAX(position), 0) as m FROM groups WHERE board_id = ?').get(boardId).m;
  let colorIdx    = existingGroups.length % GROUP_COLORS.length;

  // ── Prepared statements ───────────────────────────────────────────────────
  const insertGroup = db.prepare(
    'INSERT INTO groups (id, board_id, name, color, position) VALUES (?, ?, ?, ?, ?)'
  );
  const insertItem = db.prepare(
    'INSERT INTO items (id, group_id, board_id, name, position, created_by, parent_item_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const upsertValue = db.prepare(
    'INSERT OR REPLACE INTO item_values (id, item_id, column_id, value) VALUES (?, ?, ?, ?)'
  );

  // ── Process rows ──────────────────────────────────────────────────────────
  const issues      = []; // { row, taskName, field, value, reason, severity }
  let importedItems = 0;
  let importedGroups = 0;
  let skippedRows   = 0;
  const itemNameToId = {}; // name (lowercased) → id, for parent linking

  // NOTE: the node-sqlite3-wasm wrapper has no .transaction(); use manual
  // BEGIN/COMMIT/ROLLBACK via exec() (see the try/catch below).
  const tx = () => {
    rows.forEach((row, idx) => {
      const rowNum   = idx + 2; // row 1 = header
      const groupName = String(row['Group'] || '').trim() || 'Imported';
      const taskName  = String(row['Task Name'] || '').trim();
      const parentRaw = String(row['Parent Task (leave blank for top-level task)'] || row['Parent Task'] || '').trim();

      // ── Validate task name ──────────────────────────────────────────────
      if (!taskName) {
        skippedRows++;
        issues.push({
          row: rowNum,
          taskName: '(empty)',
          field: 'Task Name',
          value: '',
          reason: 'Task Name is required — this row was skipped.',
          severity: 'error',
        });
        return;
      }

      // ── Ensure group exists ─────────────────────────────────────────────
      const groupKey = groupName.toLowerCase();
      if (!groupMap[groupKey]) {
        const gId = uuidv4();
        maxGroupPos++;
        insertGroup.run(gId, boardId, groupName, GROUP_COLORS[colorIdx % GROUP_COLORS.length], maxGroupPos);
        groupMap[groupKey] = gId;
        colorIdx++;
        importedGroups++;
      }
      const groupId = groupMap[groupKey];

      // ── Resolve parent ──────────────────────────────────────────────────
      let parentId = null;
      if (parentRaw) {
        parentId = itemNameToId[parentRaw.toLowerCase()] ?? null;
        if (!parentId) {
          issues.push({
            row: rowNum,
            taskName,
            field: 'Parent Task',
            value: parentRaw,
            reason: `Parent task "${parentRaw}" was not found. Task will be created as top-level.`,
            severity: 'warning',
          });
        }
      }

      // ── Insert item ─────────────────────────────────────────────────────
      const maxPos = db.prepare('SELECT COALESCE(MAX(position),0) as m FROM items WHERE group_id=?').get(groupId).m;
      const itemId = uuidv4();
      insertItem.run(itemId, groupId, boardId, taskName, maxPos + 1, req.user.id, parentId);
      itemNameToId[taskName.toLowerCase()] = itemId;
      importedItems++;

      // ── Validate & insert column values ─────────────────────────────────
      for (const col of columns) {
        const rawVal = row[col.name];
        if (rawVal === undefined || rawVal === '' || rawVal === null) continue;

        const { valid, normalized, reason } = validateColumnValue(col, rawVal);

        if (!valid) {
          issues.push({
            row: rowNum,
            taskName,
            field: col.name,
            value: String(rawVal),
            reason,
            severity: 'warning',
          });
        } else if (normalized !== null) {
          upsertValue.run(uuidv4(), itemId, col.id, normalized);
        }
      }
    });
  };

  try {
    db.exec('BEGIN');
    tx();
    db.exec('COMMIT');
    res.json({
      imported: importedItems,
      skipped:  skippedRows,
      groups:   importedGroups,
      errors:   issues,
    });
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
