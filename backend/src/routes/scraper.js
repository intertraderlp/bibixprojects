// Scraper ingest endpoint — used by the Bibix browser scraper extension.
// Accepts a batch of scraped rows and upserts them as board items, auto-creating
// any missing columns and deduping by the listing link.
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { authenticateFlexible } = require('../middleware/auth');

const router = express.Router();

function canAccessBoard(boardId, userId) {
  if (db.prepare('SELECT 1 FROM board_members WHERE board_id = ? AND user_id = ?').get(boardId, userId)) return true;
  return db.prepare(
    'SELECT b.id FROM boards b JOIN workspace_members wm ON b.workspace_id = wm.workspace_id WHERE b.id = ? AND wm.user_id = ?'
  ).get(boardId, userId);
}

// Columns this scraper writes, in display order. `key` matches the row payload,
// `name` is the column title created when the board has no matching column, and
// `type` is the Bibix column type used on creation. `aliases` lets the ingest map
// onto a board's EXISTING columns (any name/locale) instead of creating duplicates
// — e.g. a "Bed Rooms" / "Size m2" / "Short Description" / "Phone Number" board
// is filled in place. Matching is case-insensitive on name or alias.
// The `link` column is the dedupe key.
const SCRAPER_COLUMNS = [
  { key: 'link',         name: 'Link',        type: 'link',     aliases: ['url', 'enlace', 'listing', 'anuncio'] },
  { key: 'price',        name: 'Price',       type: 'number',   aliases: ['precio', 'importe'] },
  { key: 'price_per_m2', name: '€/m²',        type: 'number',   aliases: ['price per m2', 'price/m2', '€/m2', 'eur/m2', 'precio/m2', 'precio por m2'] },
  { key: 'rooms',        name: 'Rooms',       type: 'number',   aliases: ['bed rooms', 'bedrooms', 'beds', 'habitaciones', 'dormitorios', 'hab', 'rooms'] },
  { key: 'size',         name: 'Size m²',     type: 'number',   aliases: ['size m2', 'size', 'metros', 'm2', 'm²', 'superficie', 'surface'] },
  { key: 'address',      name: 'Address',     type: 'text',     aliases: ['direccion', 'dirección', 'calle', 'street'] },
  // zone = the search district (e.g. "Moncloa", from the URL/H1); the user labels it "Area".
  { key: 'zone',         name: 'Area',        type: 'text',     aliases: ['zona', 'distrito', 'district', 'main area', 'search area', 'zone'] },
  // area = the per-listing barrio (e.g. "Valdezarza"); the user labels it "Inside Area".
  { key: 'area',         name: 'Inside Area', type: 'text',     aliases: ['barrio', 'neighbourhood', 'neighborhood', 'sub area', 'sub-area', 'subarea'] },
  { key: 'city',         name: 'City',        type: 'text',     aliases: ['ciudad', 'municipio', 'town', 'province', 'provincia'] },
  { key: 'phone',        name: 'Phone',       type: 'phone',    aliases: ['phone number', 'telephone', 'telefono', 'teléfono', 'tel', 'móvil', 'movil'] },
  { key: 'description',  name: 'Description', type: 'textarea', aliases: ['short description', 'descripcion', 'descripción', 'desc', 'notes', 'notas'] },
  { key: 'source',       name: 'Source',      type: 'text',     aliases: ['fuente', 'origin'] },
  { key: 'scraped_at',   name: 'Scraped',     type: 'date',     aliases: ['scraped at', 'fecha', 'date added', 'imported'] },
];

// Normalise a numeric-ish scraped string ("263.000 €", "3.757", "70 m²") → "263000".
function toNumber(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number') return String(raw);
  // Strip everything except digits, comma, dot, minus.
  let s = String(raw).replace(/[^\d.,-]/g, '');
  if (!s) return null;
  // Spanish formatting: '.' thousands, ',' decimals. Drop thousands dots, comma→dot.
  if (s.includes(',') && s.includes('.')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (s.includes(',')) {
    s = s.replace(',', '.');
  } else {
    // Only dots: treat as thousands separators (idealista prices have no decimals).
    s = s.replace(/\./g, '');
  }
  const n = Number(s);
  return isNaN(n) ? null : String(n);
}

function cleanStr(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).replace(/\s+/g, ' ').trim();
  return s || null;
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Ensure every scraper field has a destination column on the board.
// First tries to MAP onto an existing column by name or alias (case-insensitive),
// so curated boards ("Bed Rooms", "Size m2", "Short Description", "Phone Number"…)
// are filled in place; only truly missing fields get a new column created.
// Returns { map: { key: column_id }, created: [names] }.
function ensureColumns(boardId) {
  const existing = db.prepare('SELECT id, name FROM board_columns WHERE board_id = ?').all(boardId);
  const byName = new Map(existing.map(c => [c.name.trim().toLowerCase(), c]));
  const maxPosRow = db.prepare('SELECT MAX(position) as mp FROM board_columns WHERE board_id = ?').get(boardId);
  let pos = (maxPosRow?.mp ?? -1) + 1;

  const map = {};
  const created = [];
  const claimed = new Set(); // a column maps to at most one scraper field
  for (const spec of SCRAPER_COLUMNS) {
    const candidates = [spec.name, ...(spec.aliases || [])].map(s => s.toLowerCase());
    let found = null;
    for (const c of candidates) {
      const col = byName.get(c);
      if (col && !claimed.has(col.id)) { found = col; break; }
    }
    if (found) { map[spec.key] = found.id; claimed.add(found.id); continue; }

    const id = uuidv4();
    db.prepare('INSERT INTO board_columns (id, board_id, name, type, settings, position) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, boardId, spec.name, spec.type, '{}', pos++);
    byName.set(spec.name.toLowerCase(), { id, name: spec.name });
    claimed.add(id);
    map[spec.key] = id;
    created.push(spec.name);
  }
  return { map, created };
}

// Ensure a destination group exists; return its id. Reuses one named `groupName`.
function ensureGroup(boardId, groupName) {
  const found = db.prepare('SELECT id FROM groups WHERE board_id = ? AND name = ?').get(boardId, groupName);
  if (found) return found.id;
  const maxPos = db.prepare('SELECT MAX(position) as mp FROM groups WHERE board_id = ?').get(boardId);
  const id = uuidv4();
  db.prepare('INSERT INTO groups (id, board_id, name, color, position) VALUES (?, ?, ?, ?, ?)')
    .run(id, boardId, groupName, '#0073ea', (maxPos?.mp ?? -1) + 1);
  return id;
}

/**
 * POST /api/scraper/ingest
 * Body: {
 *   board_id: string,
 *   source?: string,              // e.g. 'idealista' — stored in the Source column
 *   group_name?: string,          // destination group (default 'Idealista')
 *   rows: [{ link, title, price, price_per_m2, rooms, size, address, area, phone, description }]
 * }
 * Dedupes by the Link column within the board: an existing item with the same link
 * is updated (non-empty fields only) instead of inserted again.
 */
router.post('/ingest', authenticateFlexible, (req, res) => {
  const { board_id, rows, source, group_name } = req.body || {};
  if (!board_id) return res.status(400).json({ error: 'board_id required' });
  if (!Array.isArray(rows)) return res.status(400).json({ error: 'rows[] required' });
  if (!canAccessBoard(board_id, req.user.id)) return res.status(403).json({ error: 'Access denied' });
  if (!rows.length) return res.json({ imported: 0, updated: 0, skipped: 0 });

  const { map: cols, created } = ensureColumns(board_id);
  const groupId = ensureGroup(board_id, cleanStr(group_name) || 'Idealista');
  const linkColId = cols.link;
  const src = cleanStr(source) || 'idealista';
  const scrapedAt = todayISO();

  // Build an index of existing link → item_id for this board (dedupe key).
  const existingLinks = new Map();
  for (const r of db.prepare(
    `SELECT iv.value AS link, iv.item_id FROM item_values iv
     JOIN items i ON i.id = iv.item_id
     WHERE i.board_id = ? AND iv.column_id = ? AND iv.value IS NOT NULL AND iv.value != ''`
  ).all(board_id, linkColId)) {
    existingLinks.set(r.link, r.item_id);
  }

  const upsertValue = db.prepare(`
    INSERT INTO item_values (id, item_id, column_id, value) VALUES (?, ?, ?, ?)
    ON CONFLICT(item_id, column_id) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `);

  // Convert a raw row into { column_id: normalizedValue } (skips empties).
  function buildValues(row) {
    const normalized = {
      link:         cleanStr(row.link),
      price:        toNumber(row.price),
      price_per_m2: toNumber(row.price_per_m2),
      rooms:        toNumber(row.rooms),
      size:         toNumber(row.size),
      address:      cleanStr(row.address),
      area:         cleanStr(row.area),
      zone:         cleanStr(row.zone),
      city:         cleanStr(row.city),
      phone:        cleanStr(row.phone),
      description:  cleanStr(row.description),
      source:       src,
      scraped_at:   scrapedAt,
    };
    const out = [];
    for (const [key, colId] of Object.entries(cols)) {
      const v = normalized[key];
      if (v === null || v === undefined || v === '') continue;
      out.push([colId, v]);
    }
    return out;
  }

  let imported = 0, updated = 0, skipped = 0;
  const insertItem = db.prepare('INSERT INTO items (id, group_id, board_id, name, position, created_by) VALUES (?, ?, ?, ?, ?, ?)');
  const touchItem = db.prepare('UPDATE items SET updated_at = CURRENT_TIMESTAMP WHERE id = ?');

  let maxPos = db.prepare('SELECT MAX(position) as mp FROM items WHERE group_id = ?').get(groupId)?.mp;
  maxPos = (maxPos != null ? Number(maxPos) : -1);

  // node-sqlite3-wasm has no .transaction(); use manual BEGIN/COMMIT/ROLLBACK.
  try {
    db.exec('BEGIN');
    for (const row of rows) {
      const link = cleanStr(row.link);
      if (!link) { skipped++; continue; }
      const name = cleanStr(row.title) || cleanStr(row.address) || link;
      const values = buildValues(row);

      const existingId = existingLinks.get(link);
      if (existingId) {
        // Update only non-empty scraped fields (don't wipe phone with a later blank scrape).
        for (const [colId, v] of values) upsertValue.run(uuidv4(), existingId, colId, v);
        touchItem.run(existingId);
        updated++;
      } else {
        const itemId = uuidv4();
        insertItem.run(itemId, groupId, board_id, name, ++maxPos, req.user.id);
        for (const [colId, v] of values) upsertValue.run(uuidv4(), itemId, colId, v);
        existingLinks.set(link, itemId);
        imported++;
      }
    }
    db.exec('COMMIT');
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    console.error('[POST /scraper/ingest] error:', e.message);
    return res.status(500).json({ error: 'Ingest failed: ' + e.message });
  }

  res.json({ imported, updated, skipped, board_id, group_id: groupId, created_columns: created });
});

module.exports = router;
