const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { authenticate } = require('../middleware/auth');
const { accessFor, sharedAccessMap, listShares, shareTargets } = require('../utils/sharing');

const router = express.Router();

const UPLOADS_DIR = path.join(__dirname, '../../data/uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`),
});
const upload = multer({ storage, limits: { fileSize: 25 * 1024 * 1024 } });

// ── Tables ────────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS agreements (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    client_id TEXT,
    my_company_id TEXT,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    notes TEXT,
    created_by TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS agreement_shares (
    id TEXT PRIMARY KEY,
    agreement_id TEXT NOT NULL,
    subject_type TEXT NOT NULL,
    subject_id TEXT NOT NULL,
    access TEXT NOT NULL DEFAULT 'view',
    created_by TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(agreement_id, subject_type, subject_id)
  );
`);

function isSuperAdmin(userId) {
  return db.prepare('SELECT role FROM users WHERE id = ?').get(userId)?.role === 'super_admin';
}

// { agreement, access:'owner'|'edit'|'view'|null }
function agreementAccess(id, userId) {
  const agreement = db.prepare('SELECT * FROM agreements WHERE id = ?').get(id);
  if (!agreement) return { agreement: null, access: null };
  if (agreement.created_by === userId || isSuperAdmin(userId)) return { agreement, access: 'owner' };
  return { agreement, access: accessFor('agreement_shares', 'agreement_id', id, userId) };
}

const SELECT_WITH_NAMES = `
  SELECT a.*, cl.name AS client_name, c.name AS company_name, u.name AS owner_name
  FROM agreements a
  LEFT JOIN invoice_clients      cl ON cl.id = a.client_id
  LEFT JOIN invoice_my_companies c  ON c.id = a.my_company_id
  LEFT JOIN users                u  ON u.id = a.created_by
`;

// ── List (owned + shared), optional client_id / my_company_id filters ─────────
router.get('/', authenticate, (req, res) => {
  const owned = db.prepare(`${SELECT_WITH_NAMES} WHERE a.created_by = ?`).all(req.user.id).map(r => ({ ...r, access: 'owner' }));
  const map = sharedAccessMap('agreement_shares', 'agreement_id', req.user.id);
  let shared = [];
  if (map.size) {
    const ids = [...map.keys()];
    const ph = ids.map(() => '?').join(',');
    shared = db.prepare(`${SELECT_WITH_NAMES} WHERE a.id IN (${ph}) AND a.created_by != ?`).all(...ids, req.user.id)
      .map(r => ({ ...r, access: map.get(r.id), shared: true }));
  }
  let rows = [...owned, ...shared];
  if (req.query.client_id)     rows = rows.filter(r => r.client_id === req.query.client_id);
  if (req.query.my_company_id) rows = rows.filter(r => r.my_company_id === req.query.my_company_id);
  rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  res.json(rows);
});

router.get('/share-targets', authenticate, (req, res) => {
  res.json(shareTargets(req.user.id));
});

// ── Upload a new agreement ────────────────────────────────────────────────────
router.post('/', authenticate, upload.single('file'), (req, res) => {
  const { title, client_id, my_company_id, notes } = req.body;
  if (!req.file) return res.status(400).json({ error: 'A file is required' });
  if (!title) { fs.unlink(path.join(UPLOADS_DIR, req.file.filename), () => {}); return res.status(400).json({ error: 'Title is required' }); }
  if (!client_id && !my_company_id) { fs.unlink(path.join(UPLOADS_DIR, req.file.filename), () => {}); return res.status(400).json({ error: 'Link the agreement to a client or a company' }); }

  const id = uuidv4();
  db.prepare(`INSERT INTO agreements (id, title, client_id, my_company_id, filename, original_name, mime_type, size, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, title, client_id || null, my_company_id || null, req.file.filename, req.file.originalname, req.file.mimetype, req.file.size, notes || null, req.user.id);
  res.status(201).json(db.prepare(`${SELECT_WITH_NAMES} WHERE a.id = ?`).get(id));
});

router.get('/:id', authenticate, (req, res) => {
  const { access } = agreementAccess(req.params.id, req.user.id);
  if (!access) return res.status(404).json({ error: 'Not found' });
  res.json({ ...db.prepare(`${SELECT_WITH_NAMES} WHERE a.id = ?`).get(req.params.id), access });
});

// ── Download / view the file ──────────────────────────────────────────────────
router.get('/:id/file', authenticate, (req, res) => {
  const { agreement, access } = agreementAccess(req.params.id, req.user.id);
  if (!access) return res.status(404).json({ error: 'Not found' });
  const abs = path.join(UPLOADS_DIR, agreement.filename);
  if (!fs.existsSync(abs)) return res.status(404).json({ error: 'File missing on server' });
  const disposition = req.query.inline ? 'inline' : 'attachment';
  res.setHeader('Content-Type', agreement.mime_type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(agreement.original_name)}"`);
  fs.createReadStream(abs).pipe(res);
});

// ── Edit metadata (owner / super_admin / shared-edit) ─────────────────────────
router.put('/:id', authenticate, (req, res) => {
  const { agreement, access } = agreementAccess(req.params.id, req.user.id);
  if (!access) return res.status(404).json({ error: 'Not found' });
  if (access === 'view') return res.status(403).json({ error: 'You have view-only access' });
  const { title, notes, client_id, my_company_id } = req.body;
  db.prepare(`UPDATE agreements SET
      title = COALESCE(?, title),
      notes = ?,
      client_id = ?,
      my_company_id = ?
    WHERE id = ?`)
    .run(
      title || null,
      notes !== undefined ? (notes || null) : agreement.notes,
      client_id !== undefined ? (client_id || null) : agreement.client_id,
      my_company_id !== undefined ? (my_company_id || null) : agreement.my_company_id,
      req.params.id,
    );
  res.json(db.prepare(`${SELECT_WITH_NAMES} WHERE a.id = ?`).get(req.params.id));
});

router.delete('/:id', authenticate, (req, res) => {
  const { agreement, access } = agreementAccess(req.params.id, req.user.id);
  if (!agreement) return res.status(404).json({ error: 'Not found' });
  if (access !== 'owner') return res.status(403).json({ error: 'Only the owner can delete this agreement' });
  db.prepare('DELETE FROM agreement_shares WHERE agreement_id = ?').run(req.params.id);
  db.prepare('DELETE FROM agreements WHERE id = ?').run(req.params.id);
  fs.unlink(path.join(UPLOADS_DIR, agreement.filename), () => {});
  res.json({ success: true });
});

// ── Sharing (owner / super_admin only) ────────────────────────────────────────
function requireOwner(req, res) {
  const { agreement, access } = agreementAccess(req.params.id, req.user.id);
  if (!agreement) { res.status(404).json({ error: 'Not found' }); return null; }
  if (access !== 'owner') { res.status(403).json({ error: 'Only the owner can manage sharing' }); return null; }
  return agreement;
}

router.get('/:id/shares', authenticate, (req, res) => {
  if (!requireOwner(req, res)) return;
  res.json(listShares('agreement_shares', 'agreement_id', req.params.id));
});

router.post('/:id/shares', authenticate, (req, res) => {
  if (!requireOwner(req, res)) return;
  const { subject_type, subject_id, access } = req.body;
  if (!['user', 'group'].includes(subject_type) || !subject_id) return res.status(400).json({ error: 'subject_type and subject_id required' });
  const acc = access === 'edit' ? 'edit' : 'view';
  const ok = subject_type === 'user'
    ? db.prepare('SELECT 1 FROM users WHERE id = ?').get(subject_id)
    : db.prepare('SELECT 1 FROM user_groups WHERE id = ?').get(subject_id);
  if (!ok) return res.status(400).json({ error: 'Unknown user or group' });
  const existing = db.prepare('SELECT id FROM agreement_shares WHERE agreement_id = ? AND subject_type = ? AND subject_id = ?')
    .get(req.params.id, subject_type, subject_id);
  if (existing) db.prepare('UPDATE agreement_shares SET access = ? WHERE id = ?').run(acc, existing.id);
  else db.prepare('INSERT INTO agreement_shares (id, agreement_id, subject_type, subject_id, access, created_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run(uuidv4(), req.params.id, subject_type, subject_id, acc, req.user.id);
  res.json(listShares('agreement_shares', 'agreement_id', req.params.id));
});

router.put('/:id/shares/:shareId', authenticate, (req, res) => {
  if (!requireOwner(req, res)) return;
  const acc = req.body.access === 'edit' ? 'edit' : 'view';
  db.prepare('UPDATE agreement_shares SET access = ? WHERE id = ? AND agreement_id = ?').run(acc, req.params.shareId, req.params.id);
  res.json(listShares('agreement_shares', 'agreement_id', req.params.id));
});

router.delete('/:id/shares/:shareId', authenticate, (req, res) => {
  if (!requireOwner(req, res)) return;
  db.prepare('DELETE FROM agreement_shares WHERE id = ? AND agreement_id = ?').run(req.params.shareId, req.params.id);
  res.json(listShares('agreement_shares', 'agreement_id', req.params.id));
});

module.exports = router;
