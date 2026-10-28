const { Database: WasmDatabase } = require('node-sqlite3-wasm');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../../data/monday.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const BACKUP_DIR = path.join(path.dirname(DB_PATH), 'backups');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

// ── Validate SQLite file (must start with "SQLite format 3") ─────────────────
function isValidSQLite(filePath) {
  try {
    if (!fs.existsSync(filePath)) return false;
    const stat = fs.statSync(filePath);
    if (stat.size < 4096) return false;
    const buf = Buffer.alloc(16);
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buf, 0, 16, 0);
    fs.closeSync(fd);
    return buf.toString('utf8', 0, 15) === 'SQLite format 3';
  } catch { return false; }
}

// ── Auto-restore if DB is corrupted ──────────────────────────────────────────
if (fs.existsSync(DB_PATH) && !isValidSQLite(DB_PATH)) {
  console.error('[DB] CORRUPTION DETECTED — attempting auto-restore from backup...');
  const candidates = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('monday.db.'))
    .sort().reverse();
  let restored = false;
  for (const f of candidates) {
    const bp = path.join(BACKUP_DIR, f);
    if (isValidSQLite(bp)) {
      fs.copyFileSync(bp, DB_PATH);
      console.error(`[DB] Restored from backup: ${f}`);
      restored = true;
      break;
    }
  }
  if (!restored) {
    console.error('[DB] No valid backup found — starting with fresh database.');
    fs.unlinkSync(DB_PATH);
  }
}

// ── Startup backup — only if DB is valid ─────────────────────────────────────
try {
  if (isValidSQLite(DB_PATH)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const dest = path.join(BACKUP_DIR, `monday.db.startup.${stamp}`);
    fs.copyFileSync(DB_PATH, dest);
    // Keep only the 10 most recent startup backups (startup.* files only)
    const startupFiles = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('monday.db.startup.'))
      .sort().reverse();
    startupFiles.slice(10).forEach(f => { try { fs.unlinkSync(path.join(BACKUP_DIR, f)); } catch {} });
    console.log(`[DB] Startup backup saved: ${path.basename(dest)}`);
  }
} catch (e) { console.warn('[DB] Startup backup warning:', e.message); }

// node-sqlite3-wasm creates a lock directory; clean it up on startup
// so crashed/killed processes don't leave a stale lock
const LOCK_PATH = DB_PATH + '.lock';
try { fs.rmSync(LOCK_PATH, { recursive: true, force: true }); } catch {}

const rawDb = new WasmDatabase(DB_PATH);
rawDb.exec('PRAGMA foreign_keys = ON');
// Wait up to 5s for a lock instead of failing immediately. node-sqlite3-wasm is
// synchronous and single-connection; without this, a read/write collision throws
// "database is locked" — surfacing as failed saves and spurious sign-outs.
rawDb.exec('PRAGMA busy_timeout = 5000');
const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
rawDb.exec(schema);

// Migrations — add update_id to attachments
try { rawDb.exec("ALTER TABLE attachments ADD COLUMN update_id TEXT"); } catch {}

// Clean up orphaned item_values from deleted columns
rawDb.exec('DELETE FROM item_values WHERE column_id NOT IN (SELECT id FROM board_columns)');

// Migrations — safe to run repeatedly
const migrations = [
  "ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'",
  "ALTER TABLE workspace_members ADD COLUMN access TEXT NOT NULL DEFAULT 'edit'",
  "ALTER TABLE items ADD COLUMN parent_item_id TEXT",
  "ALTER TABLE board_columns ADD COLUMN width INTEGER NOT NULL DEFAULT 140",
  "ALTER TABLE users ADD COLUMN permissions TEXT NOT NULL DEFAULT '{}'",
  // super_admin role: no schema change needed — role column already TEXT
  // This migration is a no-op placeholder to document the new valid value
];
for (const m of migrations) {
  try { rawDb.exec(m); } catch { /* column already exists */ }
}

// ── Performance indexes ───────────────────────────────────────────────────────
// Core tables shipped with NO indexes, so every board load did full table scans —
// and because node-sqlite3-wasm is synchronous, each scan froze the whole process.
// Critical once a board has hundreds of items. Idempotent; built once on startup.
const indexes = [
  'CREATE INDEX IF NOT EXISTS idx_boards_workspace ON boards(workspace_id)',
  'CREATE INDEX IF NOT EXISTS idx_columns_board ON board_columns(board_id)',
  'CREATE INDEX IF NOT EXISTS idx_groups_board ON groups(board_id)',
  'CREATE INDEX IF NOT EXISTS idx_items_board ON items(board_id)',
  'CREATE INDEX IF NOT EXISTS idx_items_group ON items(group_id)',
  'CREATE INDEX IF NOT EXISTS idx_item_values_column ON item_values(column_id)',
  'CREATE INDEX IF NOT EXISTS idx_updates_item ON updates(item_id)',
  'CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at)',
  'CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_automations_board ON automations(board_id)',
];
for (const ix of indexes) {
  try { rawDb.exec(ix); } catch (e) { console.warn('[DB] index skipped:', e.message); }
}

// Compatibility shim: node-sqlite3-wasm requires array params,
// but our routes use better-sqlite3's spread-arg style.
function wrapStmt(stmt) {
  const toArray = (args) => {
    if (args.length === 0) return [];
    if (args.length === 1 && Array.isArray(args[0])) return args[0];
    return args;
  };
  return {
    run: (...args) => stmt.run(toArray(args)),
    get: (...args) => stmt.get(toArray(args)),
    all: (...args) => stmt.all(toArray(args)),
  };
}

const db = {
  prepare: (sql) => wrapStmt(rawDb.prepare(sql)),
  exec: (sql) => rawDb.exec(sql),
  pragma: (s) => rawDb.exec(`PRAGMA ${s}`),
};

module.exports = db;
