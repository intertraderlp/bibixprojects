const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../db/database');
const { authenticate, requireAdmin, requirePermission } = require('../middleware/auth');
const { zipDir } = require('../utils/zipdir');

const router = express.Router();

// Repo root is two levels up from backend/src/routes.
const REPO_ROOT = path.resolve(__dirname, '../../..');

// The browser extensions we offer for download. `dir` is the folder in the repo
// (relative to the repo root). An entry with no folder on disk shows as
// "not available yet" rather than disappearing.
const EXTENSIONS = [
  { key: 'linkedin',  name: 'LinkedIn Assistant',  dir: 'extension',            blurb: 'Outreach auto-connect, engagement and messaging on LinkedIn.' },
  { key: 'instagram', name: 'Instagram Assistant', dir: 'extensions/instagram', blurb: 'Engagement, DMs and insights automation for Instagram.' },
  { key: 'tiktok',    name: 'TikTok Assistant',    dir: 'extension-tiktok',     blurb: 'TikTok engagement automation.' },
  { key: 'idealista', name: 'Idealista Scraper',   dir: 'extension-idealista',  blurb: 'Scrape idealista listings straight into a Bibix board.' },
];

function extDir(cfg) { return path.join(REPO_ROOT, cfg.dir); }

function describe(cfg) {
  const dir = extDir(cfg);
  let available = false, version = null, description = null;
  try {
    const mf = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    available = true;
    version = mf.version || null;
    description = mf.description || null;
  } catch { /* folder/manifest missing → not available */ }
  return { key: cfg.key, name: cfg.name, blurb: cfg.blurb, available, version, description };
}

// ── Install guide (admin-editable, so a video/notes can be added later) ──────
function getGuide() {
  try {
    const row = db.prepare("SELECT value FROM app_settings WHERE key = 'extensions_guide'").get();
    if (row && row.value) return JSON.parse(row.value);
  } catch { /* ignore */ }
  return { videoUrl: '', intro: '' };
}
function setGuide(guide) {
  const value = JSON.stringify({ videoUrl: guide.videoUrl || '', intro: guide.intro || '' });
  db.prepare("INSERT INTO app_settings (key, value) VALUES ('extensions_guide', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(value);
}

// List extensions + current install guide.
router.get('/', authenticate, requirePermission('extensions'), (req, res) => {
  res.json({ extensions: EXTENSIONS.map(describe), guide: getGuide() });
});

// Admin: update the shared install guide (video URL + intro notes).
router.put('/guide', authenticate, requireAdmin, (req, res) => {
  const { videoUrl, intro } = req.body || {};
  setGuide({ videoUrl, intro });
  res.json({ ok: true, guide: getGuide() });
});

// Download one extension as a .zip (built on the fly from the live repo folder).
router.get('/:key/download', authenticate, requirePermission('extensions'), (req, res) => {
  const cfg = EXTENSIONS.find(e => e.key === req.params.key);
  if (!cfg) return res.status(404).json({ error: 'Unknown extension' });
  const dir = extDir(cfg);
  let version = '';
  try { version = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')).version || ''; }
  catch { return res.status(404).json({ error: 'This extension is not available yet' }); }

  try {
    const folder = `bibix-${cfg.key}-extension`;
    const buf = zipDir(dir, folder);
    const fname = `${folder}${version ? '-v' + version : ''}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    res.setHeader('Content-Length', buf.length);
    res.send(buf);
  } catch (e) {
    console.error('[extensions] zip failed:', e.message);
    res.status(500).json({ error: 'Could not package the extension' });
  }
});

module.exports = router;
