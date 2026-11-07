const express = require('express');
const { v4: uuidv4 } = require('uuid');
// pdfkit removed — PDF export is handled client-side via browser print
const db = require('../db/database');
const { authenticate } = require('../middleware/auth');
const { accessFor, sharedAccessMap, listShares, shareTargets } = require('../utils/sharing');

const router = express.Router();

// ── Create tables ─────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS invoice_my_companies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    address TEXT,
    city TEXT,
    country TEXT,
    phone TEXT,
    email TEXT,
    vat_number TEXT,
    bank_name TEXT,
    bank_account TEXT,
    bank_swift TEXT,
    logo_url TEXT,
    created_by TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS invoice_clients (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    address TEXT,
    city TEXT,
    country TEXT,
    phone TEXT,
    email TEXT,
    vat_number TEXT,
    contact_person TEXT,
    created_by TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,
    invoice_number TEXT NOT NULL,
    my_company_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    issue_date TEXT NOT NULL,
    due_date TEXT,
    status TEXT DEFAULT 'draft',
    currency TEXT DEFAULT 'USD',
    notes TEXT,
    tax_rate REAL DEFAULT 0,
    discount REAL DEFAULT 0,
    subtotal REAL DEFAULT 0,
    tax_amount REAL DEFAULT 0,
    total REAL DEFAULT 0,
    template_id INTEGER DEFAULT 1,
    created_by TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS invoice_items (
    id TEXT PRIMARY KEY,
    invoice_id TEXT NOT NULL,
    description TEXT NOT NULL,
    quantity REAL DEFAULT 1,
    unit_price REAL DEFAULT 0,
    amount REAL DEFAULT 0,
    position INTEGER DEFAULT 0,
    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS invoice_shares (
    id TEXT PRIMARY KEY,
    invoice_id TEXT NOT NULL,
    subject_type TEXT NOT NULL,   -- 'user' | 'group'
    subject_id TEXT NOT NULL,
    access TEXT NOT NULL DEFAULT 'view',  -- 'view' | 'edit'
    created_by TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(invoice_id, subject_type, subject_id)
  );
`);

// ── Migration: add template_id column if it doesn't exist ────────────────────
try {
  db.exec(`ALTER TABLE invoices ADD COLUMN template_id INTEGER DEFAULT 1`);
} catch (_) { /* column already exists */ }

// ── Helper: recalc totals from items ─────────────────────────────────────────
function calcTotals(items, taxRate, discount) {
  const subtotal = items.reduce((s, it) => s + (it.quantity * it.unit_price), 0);
  const discountedSubtotal = subtotal - (discount || 0);
  const tax_amount = discountedSubtotal * ((taxRate || 0) / 100);
  const total = discountedSubtotal + tax_amount;
  return { subtotal, tax_amount, total };
}

// ── Helper: is this user a super_admin? (can edit any record) ─────────────────
function isSuperAdmin(userId) {
  return db.prepare('SELECT role FROM users WHERE id = ?').get(userId)?.role === 'super_admin';
}

// ── Helper: a user's effective access to an invoice ───────────────────────────
// Returns { invoice, access } where access is 'owner' | 'edit' | 'view' | null.
function invoiceAccess(invoiceId, userId) {
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
  if (!invoice) return { invoice: null, access: null };
  if (invoice.created_by === userId || isSuperAdmin(userId)) return { invoice, access: 'owner' };
  return { invoice, access: accessFor('invoice_shares', 'invoice_id', invoiceId, userId) };
}

// ════════════════════════════════════════════════════════════════════════════
// MY COMPANIES
// ════════════════════════════════════════════════════════════════════════════

router.get('/my-companies', authenticate, (req, res) => {
  // super_admin sees all companies, others see only their own
  const role = db.prepare('SELECT role FROM users WHERE id = ?').get(req.user.id)?.role;
  const rows = role === 'super_admin'
    ? db.prepare('SELECT * FROM invoice_my_companies ORDER BY name').all()
    : db.prepare('SELECT * FROM invoice_my_companies WHERE created_by = ? ORDER BY name').all(req.user.id);
  res.json(rows);
});

router.post('/my-companies', authenticate, (req, res) => {
  const { name, address, city, country, phone, email, vat_number, bank_name, bank_account, bank_swift, logo_url } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const id = uuidv4();
  db.prepare(`INSERT INTO invoice_my_companies
    (id, name, address, city, country, phone, email, vat_number, bank_name, bank_account, bank_swift, logo_url, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, name, address || null, city || null, country || null, phone || null,
         email || null, vat_number || null, bank_name || null, bank_account || null,
         bank_swift || null, logo_url || null, req.user.id);
  const row = db.prepare('SELECT * FROM invoice_my_companies WHERE id = ?').get(id);
  res.status(201).json(row);
});

router.put('/my-companies/:id', authenticate, (req, res) => {
  // super_admin can edit any company; everyone else only their own
  const company = isSuperAdmin(req.user.id)
    ? db.prepare('SELECT * FROM invoice_my_companies WHERE id = ?').get(req.params.id)
    : db.prepare('SELECT * FROM invoice_my_companies WHERE id = ? AND created_by = ?').get(req.params.id, req.user.id);
  if (!company) return res.status(404).json({ error: 'Not found' });
  const { name, address, city, country, phone, email, vat_number, bank_name, bank_account, bank_swift, logo_url } = req.body;
  db.prepare(`UPDATE invoice_my_companies SET
    name = COALESCE(?, name), address = ?, city = ?, country = ?, phone = ?,
    email = ?, vat_number = ?, bank_name = ?, bank_account = ?, bank_swift = ?, logo_url = ?
    WHERE id = ?`)
    .run(name || null, address ?? company.address, city ?? company.city,
         country ?? company.country, phone ?? company.phone, email ?? company.email,
         vat_number ?? company.vat_number, bank_name ?? company.bank_name,
         bank_account ?? company.bank_account, bank_swift ?? company.bank_swift,
         logo_url ?? company.logo_url, req.params.id);
  res.json(db.prepare('SELECT * FROM invoice_my_companies WHERE id = ?').get(req.params.id));
});

router.delete('/my-companies/:id', authenticate, (req, res) => {
  const company = isSuperAdmin(req.user.id)
    ? db.prepare('SELECT id FROM invoice_my_companies WHERE id = ?').get(req.params.id)
    : db.prepare('SELECT id FROM invoice_my_companies WHERE id = ? AND created_by = ?').get(req.params.id, req.user.id);
  if (!company) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM invoice_my_companies WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════════════════
// CLIENTS
// ════════════════════════════════════════════════════════════════════════════

router.get('/clients', authenticate, (req, res) => {
  // super_admin sees all clients, others see only their own
  const role = db.prepare('SELECT role FROM users WHERE id = ?').get(req.user.id)?.role;
  const rows = role === 'super_admin'
    ? db.prepare('SELECT * FROM invoice_clients ORDER BY name').all()
    : db.prepare('SELECT * FROM invoice_clients WHERE created_by = ? ORDER BY name').all(req.user.id);
  res.json(rows);
});

router.post('/clients', authenticate, (req, res) => {
  const { name, address, city, country, phone, email, vat_number, contact_person } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const id = uuidv4();
  db.prepare(`INSERT INTO invoice_clients
    (id, name, address, city, country, phone, email, vat_number, contact_person, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, name, address || null, city || null, country || null, phone || null,
         email || null, vat_number || null, contact_person || null, req.user.id);
  res.status(201).json(db.prepare('SELECT * FROM invoice_clients WHERE id = ?').get(id));
});

router.put('/clients/:id', authenticate, (req, res) => {
  // super_admin can edit any client; everyone else only their own
  const client = isSuperAdmin(req.user.id)
    ? db.prepare('SELECT * FROM invoice_clients WHERE id = ?').get(req.params.id)
    : db.prepare('SELECT * FROM invoice_clients WHERE id = ? AND created_by = ?').get(req.params.id, req.user.id);
  if (!client) return res.status(404).json({ error: 'Not found' });
  const { name, address, city, country, phone, email, vat_number, contact_person } = req.body;
  db.prepare(`UPDATE invoice_clients SET
    name = COALESCE(?, name), address = ?, city = ?, country = ?, phone = ?,
    email = ?, vat_number = ?, contact_person = ?
    WHERE id = ?`)
    .run(name || null, address ?? client.address, city ?? client.city,
         country ?? client.country, phone ?? client.phone, email ?? client.email,
         vat_number ?? client.vat_number, contact_person ?? client.contact_person, req.params.id);
  res.json(db.prepare('SELECT * FROM invoice_clients WHERE id = ?').get(req.params.id));
});

router.delete('/clients/:id', authenticate, (req, res) => {
  const client = isSuperAdmin(req.user.id)
    ? db.prepare('SELECT id FROM invoice_clients WHERE id = ?').get(req.params.id)
    : db.prepare('SELECT id FROM invoice_clients WHERE id = ? AND created_by = ?').get(req.params.id, req.user.id);
  if (!client) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM invoice_clients WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════════════════
// INVOICES
// ════════════════════════════════════════════════════════════════════════════

router.get('/', authenticate, (req, res) => {
  const owned = db.prepare(`
    SELECT i.*, c.name AS company_name, cl.name AS client_name, 'owner' AS access
    FROM invoices i
    LEFT JOIN invoice_my_companies c  ON c.id = i.my_company_id
    LEFT JOIN invoice_clients      cl ON cl.id = i.client_id
    WHERE i.created_by = ?
  `).all(req.user.id);

  // Invoices shared with this user (directly or via a group), excluding own.
  const map = sharedAccessMap('invoice_shares', 'invoice_id', req.user.id);
  let shared = [];
  if (map.size) {
    const ids = [...map.keys()];
    const ph = ids.map(() => '?').join(',');
    shared = db.prepare(`
      SELECT i.*, c.name AS company_name, cl.name AS client_name,
             u.name AS owner_name
      FROM invoices i
      LEFT JOIN invoice_my_companies c  ON c.id = i.my_company_id
      LEFT JOIN invoice_clients      cl ON cl.id = i.client_id
      LEFT JOIN users u ON u.id = i.created_by
      WHERE i.id IN (${ph}) AND i.created_by != ?
    `).all(...ids, req.user.id).map(r => ({ ...r, access: map.get(r.id), shared: true }));
  }

  let rows = [...owned, ...shared];
  if (req.query.client_id)     rows = rows.filter(r => r.client_id === req.query.client_id);
  if (req.query.my_company_id) rows = rows.filter(r => r.my_company_id === req.query.my_company_id);
  rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  res.json(rows);
});

// Users + groups this user can share with (for the share picker).
router.get('/share-targets', authenticate, (req, res) => {
  res.json(shareTargets(req.user.id));
});

router.get('/:id', authenticate, (req, res) => {
  const { invoice: exists, access } = invoiceAccess(req.params.id, req.user.id);
  if (!exists || !access) return res.status(404).json({ error: 'Not found' });
  const invoice = db.prepare(`
    SELECT i.*,
           c.name  AS company_name,
           cl.name AS client_name
    FROM invoices i
    LEFT JOIN invoice_my_companies c  ON c.id = i.my_company_id
    LEFT JOIN invoice_clients      cl ON cl.id = i.client_id
    WHERE i.id = ?
  `).get(req.params.id);
  const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY position').all(req.params.id);
  res.json({ ...invoice, items, access });
});

router.post('/', authenticate, (req, res) => {
  const {
    invoice_number, my_company_id, client_id, issue_date, due_date,
    status, currency, notes, tax_rate, discount, items = [], template_id
  } = req.body;

  if (!invoice_number || !my_company_id || !client_id || !issue_date) {
    return res.status(400).json({ error: 'invoice_number, my_company_id, client_id, issue_date are required' });
  }

  const { subtotal, tax_amount, total } = calcTotals(items, tax_rate, discount);
  const id = uuidv4();

  db.prepare(`INSERT INTO invoices
    (id, invoice_number, my_company_id, client_id, issue_date, due_date, status, currency, notes,
     tax_rate, discount, subtotal, tax_amount, total, template_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, invoice_number, my_company_id, client_id, issue_date, due_date || null,
         status || 'draft', currency || 'USD', notes || null,
         tax_rate || 0, discount || 0, subtotal, tax_amount, total,
         template_id || 1, req.user.id);

  const insertItem = db.prepare(`INSERT INTO invoice_items
    (id, invoice_id, description, quantity, unit_price, amount, position)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  items.forEach((it, idx) => {
    const amt = (it.quantity || 1) * (it.unit_price || 0);
    insertItem.run(uuidv4(), id, it.description, it.quantity || 1, it.unit_price || 0, amt, idx);
  });

  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
  const savedItems = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY position').all(id);
  res.status(201).json({ ...invoice, items: savedItems });
});

// Duplicate (copy) an existing invoice — creates a new draft with the same
// company/client/items and a unique invoice number, then returns it for editing.
router.post('/:id/duplicate', authenticate, (req, res) => {
  const src = isSuperAdmin(req.user.id)
    ? db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id)
    : db.prepare('SELECT * FROM invoices WHERE id = ? AND created_by = ?').get(req.params.id, req.user.id);
  if (!src) return res.status(404).json({ error: 'Not found' });

  const srcItems = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY position').all(req.params.id);

  // Build a unique invoice number: "<orig>-COPY", then -COPY2, -COPY3, … if taken
  const base = `${src.invoice_number}-COPY`;
  let invoiceNumber = base;
  let n = 1;
  while (db.prepare('SELECT 1 FROM invoices WHERE invoice_number = ? AND created_by = ?').get(invoiceNumber, req.user.id)) {
    n += 1;
    invoiceNumber = `${base}${n}`;
  }

  const id = uuidv4();
  const today = new Date().toISOString().slice(0, 10);
  db.prepare(`INSERT INTO invoices
    (id, invoice_number, my_company_id, client_id, issue_date, due_date, status, currency, notes,
     tax_rate, discount, subtotal, tax_amount, total, template_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, invoiceNumber, src.my_company_id, src.client_id, today, src.due_date || null,
         'draft', src.currency, src.notes || null,
         src.tax_rate, src.discount, src.subtotal, src.tax_amount, src.total,
         src.template_id || 1, req.user.id);

  const insertItem = db.prepare(`INSERT INTO invoice_items
    (id, invoice_id, description, quantity, unit_price, amount, position)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  srcItems.forEach((it, idx) => {
    insertItem.run(uuidv4(), id, it.description, it.quantity, it.unit_price, it.amount, idx);
  });

  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
  const savedItems = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY position').all(id);
  res.status(201).json({ ...invoice, items: savedItems });
});

router.put('/:id', authenticate, (req, res) => {
  const { invoice: existing, access } = invoiceAccess(req.params.id, req.user.id);
  if (!existing || !access) return res.status(404).json({ error: 'Not found' });
  if (access === 'view') return res.status(403).json({ error: 'You have view-only access to this invoice' });

  const {
    invoice_number, my_company_id, client_id, issue_date, due_date,
    status, currency, notes, tax_rate, discount, items, template_id
  } = req.body;

  const newItems = items !== undefined ? items : db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY position').all(req.params.id);
  const usedTaxRate = tax_rate !== undefined ? tax_rate : existing.tax_rate;
  const usedDiscount = discount !== undefined ? discount : existing.discount;
  const usedTemplateId = template_id !== undefined ? template_id : (existing.template_id || 1);
  const { subtotal, tax_amount, total } = calcTotals(newItems, usedTaxRate, usedDiscount);

  db.prepare(`UPDATE invoices SET
    invoice_number = COALESCE(?, invoice_number),
    my_company_id  = COALESCE(?, my_company_id),
    client_id      = COALESCE(?, client_id),
    issue_date     = COALESCE(?, issue_date),
    due_date       = ?,
    status         = COALESCE(?, status),
    currency       = COALESCE(?, currency),
    notes          = ?,
    tax_rate       = ?,
    discount       = ?,
    subtotal       = ?,
    tax_amount     = ?,
    total          = ?,
    template_id    = ?,
    updated_at     = CURRENT_TIMESTAMP
    WHERE id = ?`)
    .run(
      invoice_number || null, my_company_id || null, client_id || null, issue_date || null,
      due_date !== undefined ? (due_date || null) : existing.due_date,
      status || null, currency || null,
      notes !== undefined ? (notes || null) : existing.notes,
      usedTaxRate, usedDiscount, subtotal, tax_amount, total,
      usedTemplateId, req.params.id
    );

  if (items !== undefined) {
    db.prepare('DELETE FROM invoice_items WHERE invoice_id = ?').run(req.params.id);
    const insertItem = db.prepare(`INSERT INTO invoice_items
      (id, invoice_id, description, quantity, unit_price, amount, position)
      VALUES (?, ?, ?, ?, ?, ?, ?)`);
    items.forEach((it, idx) => {
      const amt = (it.quantity || 1) * (it.unit_price || 0);
      insertItem.run(uuidv4(), req.params.id, it.description, it.quantity || 1, it.unit_price || 0, amt, idx);
    });
  }

  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  const savedItems = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY position').all(req.params.id);
  res.json({ ...invoice, items: savedItems });
});

router.delete('/:id', authenticate, (req, res) => {
  const { invoice, access } = invoiceAccess(req.params.id, req.user.id);
  if (!invoice) return res.status(404).json({ error: 'Not found' });
  if (access !== 'owner') return res.status(403).json({ error: 'Only the owner can delete this invoice' });
  db.prepare('DELETE FROM invoice_items WHERE invoice_id = ?').run(req.params.id);
  db.prepare('DELETE FROM invoice_shares WHERE invoice_id = ?').run(req.params.id);
  db.prepare('DELETE FROM invoices WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════════════════
// PDF GENERATION
// ════════════════════════════════════════════════════════════════════════════

router.get('/:id/pdf', authenticate, (req, res) => {
  // PDF export is handled client-side via browser print/preview
  res.status(200).json({ message: 'Use the frontend preview to print or save as PDF' });
});

// ════════════════════════════════════════════════════════════════════════════
// SHARING  (owner / super_admin only)
// ════════════════════════════════════════════════════════════════════════════

function requireInvoiceOwner(req, res) {
  const { invoice, access } = invoiceAccess(req.params.id, req.user.id);
  if (!invoice) { res.status(404).json({ error: 'Not found' }); return null; }
  if (access !== 'owner') { res.status(403).json({ error: 'Only the owner can manage sharing' }); return null; }
  return invoice;
}

router.get('/:id/shares', authenticate, (req, res) => {
  if (!requireInvoiceOwner(req, res)) return;
  res.json(listShares('invoice_shares', 'invoice_id', req.params.id));
});

router.post('/:id/shares', authenticate, (req, res) => {
  if (!requireInvoiceOwner(req, res)) return;
  const { subject_type, subject_id, access } = req.body;
  if (!['user', 'group'].includes(subject_type) || !subject_id) return res.status(400).json({ error: 'subject_type and subject_id required' });
  const acc = access === 'edit' ? 'edit' : 'view';
  // Validate the subject exists.
  const ok = subject_type === 'user'
    ? db.prepare('SELECT 1 FROM users WHERE id = ?').get(subject_id)
    : db.prepare('SELECT 1 FROM user_groups WHERE id = ?').get(subject_id);
  if (!ok) return res.status(400).json({ error: 'Unknown user or group' });

  const existing = db.prepare('SELECT id FROM invoice_shares WHERE invoice_id = ? AND subject_type = ? AND subject_id = ?')
    .get(req.params.id, subject_type, subject_id);
  if (existing) {
    db.prepare('UPDATE invoice_shares SET access = ? WHERE id = ?').run(acc, existing.id);
  } else {
    db.prepare('INSERT INTO invoice_shares (id, invoice_id, subject_type, subject_id, access, created_by) VALUES (?, ?, ?, ?, ?, ?)')
      .run(uuidv4(), req.params.id, subject_type, subject_id, acc, req.user.id);
  }
  res.json(listShares('invoice_shares', 'invoice_id', req.params.id));
});

router.put('/:id/shares/:shareId', authenticate, (req, res) => {
  if (!requireInvoiceOwner(req, res)) return;
  const acc = req.body.access === 'edit' ? 'edit' : 'view';
  db.prepare('UPDATE invoice_shares SET access = ? WHERE id = ? AND invoice_id = ?').run(acc, req.params.shareId, req.params.id);
  res.json(listShares('invoice_shares', 'invoice_id', req.params.id));
});

router.delete('/:id/shares/:shareId', authenticate, (req, res) => {
  if (!requireInvoiceOwner(req, res)) return;
  db.prepare('DELETE FROM invoice_shares WHERE id = ? AND invoice_id = ?').run(req.params.shareId, req.params.id);
  res.json(listShares('invoice_shares', 'invoice_id', req.params.id));
});


module.exports = router;
