// Bibix Videos — protected videos that only play when the Bibix Video Player
// browser extension is installed. Viewers do not sign in: each video has a
// secret share link (/watch/<share_token>) and the link only works with the
// extension.
//
// How the protection works:
//   1. An admin uploads a video (any format) from the Videos page in Bibix.
//      ffmpeg transcodes it to HLS and encrypts every segment with a per-video
//      AES-128 key. The raw upload is deleted; the key lives next to the
//      segments but is never served statically.
//   2. The /watch/<share> page asks the extension (via a content script) for a
//      *play token*. The extension's background worker requests it from this
//      server; that request is only honoured when it comes from a
//      chrome-extension:// origin (optionally pinned to VIDEO_EXTENSION_IDS).
//      The token is a short-lived JWT bound to the video.
//   3. The playlist, the segments and the decryption key are served only to
//      requests carrying a valid play token. Without the extension there is no
//      token, so the share link shows "install the extension" and any direct
//      URL yields 401. A token for one video does not open another.
//
// Files: data/videos/<id>/{hls/index.m3u8, hls/seg_*.ts, key.bin, thumb.jpg}
//
// This deters sharing; it is not DRM (a user with the extension can still
// screen-record). See extension-video/README.md.

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { authenticate, requireAdmin, JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

const VIDEOS_DIR = path.join(__dirname, '../../data/videos');
const INCOMING_DIR = path.join(VIDEOS_DIR, '_incoming');
fs.mkdirSync(INCOMING_DIR, { recursive: true });

const PLAY_TOKEN_TTL_SEC = parseInt(process.env.VIDEO_PLAY_TOKEN_TTL || '900', 10); // 15 min, refreshed by the player
const MAX_UPLOAD_BYTES = parseInt(process.env.VIDEO_MAX_UPLOAD_MB || '2048', 10) * 1024 * 1024;
// Comma-separated extension IDs allowed to obtain play tokens. Empty = any chrome-extension:// origin.
const ALLOWED_EXTENSION_IDS = (process.env.VIDEO_EXTENSION_IDS || '').split(',').map(s => s.trim()).filter(Boolean);

db.exec(`CREATE TABLE IF NOT EXISTS videos (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  original_name TEXT,
  size INTEGER,
  duration REAL,
  status TEXT NOT NULL DEFAULT 'processing',
  error TEXT,
  uploaded_by TEXT,
  share_token TEXT UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);
// SQLite cannot ALTER-add a UNIQUE column, so add it plain and index it.
try { db.exec('ALTER TABLE videos ADD COLUMN share_token TEXT'); } catch {}
try { db.exec('ALTER TABLE videos ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1'); } catch {}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_videos_share_token ON videos(share_token)');
// Play log. (An earlier local draft used a table "video_plays" tied to signed-in users; viewers are anonymous now.)
db.exec(`CREATE TABLE IF NOT EXISTS video_plays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id TEXT NOT NULL,
  extension_id TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);
// Older rows without a share link get one.
for (const row of db.prepare('SELECT id FROM videos WHERE share_token IS NULL').all()) {
  db.prepare('UPDATE videos SET share_token = ? WHERE id = ?').run(newShareToken(), row.id);
}

function newShareToken() { return crypto.randomBytes(18).toString('base64url'); }
// Links are built from the host the admin is using (behind LiteSpeed the host header is preserved).
function shareUrl(req, v) {
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https').toString().split(',')[0];
  return `${proto}://${req.get('host')}/watch/${v.share_token}`;
}

// ── ffmpeg resolution ──────────────────────────────────────────────────────────
function resolveFfmpeg() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  for (const bin of ['ffmpeg', '/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg']) {
    try { execFileSync(bin, ['-version'], { stdio: 'ignore' }); return bin; } catch {}
  }
  try { return require('ffmpeg-static'); } catch {}
  return null;
}
const FFMPEG = resolveFfmpeg();
if (!FFMPEG) console.warn('[videos] ffmpeg not found — uploads will fail. Set FFMPEG_PATH or `npm i ffmpeg-static`.');

// ── Upload ─────────────────────────────────────────────────────────────────────
const upload = multer({
  storage: multer.diskStorage({
    destination: INCOMING_DIR,
    filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname || '').toLowerCase()}`),
  }),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (req, file, cb) => cb(null, /^video\//.test(file.mimetype) || /\.(mp4|mov|mkv|webm|avi|m4v|mpg|mpeg)$/i.test(file.originalname || '')),
});

// Crash-recovery: anything left "processing" from a previous run is marked failed.
try { db.prepare("UPDATE videos SET status='error', error='Server restarted during processing' WHERE status='processing'").run(); } catch {}

function videoDir(id) { return path.join(VIDEOS_DIR, id); }

function probeDuration(src) {
  // Parse "Duration: HH:MM:SS.xx" from ffmpeg's stderr (no ffprobe dependency).
  try { execFileSync(FFMPEG, ['-i', src], { stdio: ['ignore', 'ignore', 'pipe'] }); } catch (e) {
    const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(String(e.stderr || ''));
    if (m) return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
  }
  return null;
}

function transcode(id, srcPath) {
  const dir = videoDir(id);
  const hlsDir = path.join(dir, 'hls');
  fs.mkdirSync(hlsDir, { recursive: true });

  // Per-video AES-128 key. The key URI written into the playlist is relative
  // ("key"), so hls.js resolves it against the playlist URL and sends it through
  // the same token-gated route.
  const key = crypto.randomBytes(16);
  const iv = crypto.randomBytes(16).toString('hex');
  const keyPath = path.join(dir, 'key.bin');
  fs.writeFileSync(keyPath, key);
  const keyInfoPath = path.join(dir, 'key.info');
  fs.writeFileSync(keyInfoPath, `key\n${keyPath}\n${iv}\n`);

  const duration = probeDuration(srcPath);
  if (duration) db.prepare('UPDATE videos SET duration = ? WHERE id = ?').run(duration, id);

  const args = [
    '-y', '-i', srcPath,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-profile:v', 'main', '-level', '4.0',
    '-vf', "scale='min(1280,iw)':-2", '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
    '-movflags', '+faststart',
    '-f', 'hls', '-hls_time', '6', '-hls_playlist_type', 'vod', '-hls_list_size', '0',
    '-hls_key_info_file', keyInfoPath,
    '-hls_segment_filename', path.join(hlsDir, 'seg_%04d.ts'),
    path.join(hlsDir, 'index.m3u8'),
  ];
  const proc = spawn(FFMPEG, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  proc.stderr.on('data', d => { stderr += d; if (stderr.length > 20000) stderr = stderr.slice(-10000); });
  proc.on('error', (e) => finish(e.message));
  proc.on('close', (code) => {
    if (code !== 0) return finish(`ffmpeg exited ${code}: ${stderr.split('\n').filter(Boolean).slice(-3).join(' | ')}`);
    // Thumbnail at ~1s (best effort)
    try { execFileSync(FFMPEG, ['-y', '-ss', '1', '-i', srcPath, '-frames:v', '1', '-vf', "scale='min(480,iw)':-2", path.join(dir, 'thumb.jpg')], { stdio: 'ignore' }); } catch {}
    finish(null);
  });
  function finish(err) {
    try { fs.unlinkSync(keyInfoPath); } catch {}
    try { fs.unlinkSync(srcPath); } catch {}
    if (err) {
      db.prepare("UPDATE videos SET status='error', error=? WHERE id=?").run(String(err).slice(0, 500), id);
      console.error('[videos] transcode failed', id, err);
    } else {
      db.prepare("UPDATE videos SET status='ready', error=NULL WHERE id=?").run(id);
      console.log('[videos] ready', id);
    }
  }
}

// ── Play tokens ────────────────────────────────────────────────────────────────
function extensionIdFromOrigin(origin) {
  const m = /^chrome-extension:\/\/([a-z]{32})$/.exec(origin || '');
  return m ? m[1] : null;
}
function requireExtensionOrigin(req, res, next) {
  const extId = extensionIdFromOrigin(req.headers.origin);
  if (!extId) {
    // Local dev without an extension: allow when explicitly enabled.
    if (process.env.NODE_ENV !== 'production' && process.env.VIDEO_ALLOW_NO_EXTENSION === '1') { req.extensionId = 'dev'; return next(); }
    return res.status(403).json({ error: 'Videos can only be played from the Bibix Video Player extension', code: 'EXTENSION_REQUIRED' });
  }
  if (ALLOWED_EXTENSION_IDS.length && !ALLOWED_EXTENSION_IDS.includes(extId)) {
    return res.status(403).json({ error: 'This extension is not allowed to play videos', code: 'EXTENSION_NOT_ALLOWED' });
  }
  req.extensionId = extId;
  next();
}
function signPlayToken(videoId, extensionId) {
  return jwt.sign({ typ: 'play', vid: videoId, ext: extensionId }, JWT_SECRET, { expiresIn: PLAY_TOKEN_TTL_SEC });
}
function requirePlayToken(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.replace(/^Bearer\s+/i, '').trim() || String(req.query.t || '');
  if (!token) return res.status(401).json({ error: 'Play token required' });
  try {
    const p = jwt.verify(token, JWT_SECRET);
    if (p.typ !== 'play' || p.vid !== req.params.id) return res.status(403).json({ error: 'Token is not valid for this video' });
    req.play = p;
    next();
  } catch {
    res.status(401).json({ error: 'Play token expired or invalid', code: 'PLAY_TOKEN_INVALID' });
  }
}

function adminRow(req, v) {
  const views = db.prepare('SELECT COUNT(*) AS n FROM video_plays WHERE video_id = ?').get(v.id).n;
  return { id: v.id, title: v.title, description: v.description, duration: v.duration, size: v.size, status: v.status, error: v.error, created_at: v.created_at, original_name: v.original_name, enabled: !!v.enabled, share_url: shareUrl(req, v), views };
}

// ── Routes: public, used by the /watch page (no login) ─────────────────────────
function findByShare(share) {
  if (!/^[A-Za-z0-9_-]{10,64}$/.test(share || '')) return null;
  return db.prepare('SELECT * FROM videos WHERE share_token = ?').get(share) || null;
}

router.get('/watch/:share', (req, res) => {
  const v = findByShare(req.params.share);
  if (!v || !v.enabled) return res.status(404).json({ error: 'This video link is not valid' });
  res.json({ title: v.title, description: v.description, duration: v.duration, status: v.status });
});

router.get('/watch/:share/thumb.jpg', (req, res) => {
  const v = findByShare(req.params.share);
  if (!v || !v.enabled) return res.status(404).end();
  const p = path.join(videoDir(v.id), 'thumb.jpg');
  if (!fs.existsSync(p)) return res.status(404).end();
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.sendFile(p);
});

// POST /api/videos/watch/:share/play-token — only the extension's background worker can call this.
router.post('/watch/:share/play-token', requireExtensionOrigin, (req, res) => {
  const v = findByShare(req.params.share);
  if (!v || !v.enabled) return res.status(404).json({ error: 'This video link is not valid' });
  if (v.status !== 'ready') return res.status(409).json({ error: v.status === 'processing' ? 'Video is still processing' : 'Video failed to process' });
  if (!req.body || !req.body.refresh) {
    db.prepare('INSERT INTO video_plays (video_id, extension_id, ip, user_agent) VALUES (?, ?, ?, ?)')
      .run(v.id, req.extensionId, (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim(), (req.headers['user-agent'] || '').slice(0, 200));
  }
  res.json({ token: signPlayToken(v.id, req.extensionId), expiresIn: PLAY_TOKEN_TTL_SEC, playlist: `/api/videos/${v.id}/hls/index.m3u8` });
});

// ── Routes: admin library (Videos page in Bibix) ───────────────────────────────
router.get('/', authenticate, requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM videos ORDER BY created_at DESC').all();
  res.json({ videos: rows.map(v => adminRow(req, v)), ffmpeg: !!FFMPEG });
});

// POST /api/videos — admin upload (multipart field "file", optional title/description)
router.post('/', authenticate, requireAdmin, (req, res) => {
  if (!FFMPEG) return res.status(500).json({ error: 'ffmpeg is not installed on the server' });
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? `File too large (max ${Math.round(MAX_UPLOAD_BYTES / 1048576)} MB)` : err.message });
    if (!req.file) return res.status(400).json({ error: 'No video file uploaded (field "file")' });
    const id = uuidv4();
    const title = (req.body.title || '').trim() || path.basename(req.file.originalname, path.extname(req.file.originalname));
    db.prepare('INSERT INTO videos (id, title, description, original_name, size, status, uploaded_by, share_token) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, title, (req.body.description || '').trim() || null, req.file.originalname, req.file.size, 'processing', req.user.id, newShareToken());
    fs.mkdirSync(videoDir(id), { recursive: true });
    setImmediate(() => { try { transcode(id, req.file.path); } catch (e) { db.prepare("UPDATE videos SET status='error', error=? WHERE id=?").run(e.message, id); } });
    res.json(adminRow(req, db.prepare('SELECT * FROM videos WHERE id = ?').get(id)));
  });
});

router.get('/:id', authenticate, requireAdmin, (req, res) => {
  const v = db.prepare('SELECT * FROM videos WHERE id = ?').get(req.params.id);
  if (!v) return res.status(404).json({ error: 'Not found' });
  res.json(adminRow(req, v));
});

// Regenerate the share link (old link stops working immediately).
router.post('/:id/share/rotate', authenticate, requireAdmin, (req, res) => {
  const v = db.prepare('SELECT * FROM videos WHERE id = ?').get(req.params.id);
  if (!v) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE videos SET share_token = ? WHERE id = ?').run(newShareToken(), v.id);
  res.json(adminRow(req, db.prepare('SELECT * FROM videos WHERE id = ?').get(v.id)));
});

router.put('/:id', authenticate, requireAdmin, (req, res) => {
  const v = db.prepare('SELECT * FROM videos WHERE id = ?').get(req.params.id);
  if (!v) return res.status(404).json({ error: 'Not found' });
  const title = (req.body.title ?? v.title).toString().trim() || v.title;
  const description = req.body.description === undefined ? v.description : (String(req.body.description).trim() || null);
  const enabled = req.body.enabled === undefined ? v.enabled : (req.body.enabled ? 1 : 0);
  db.prepare('UPDATE videos SET title = ?, description = ?, enabled = ? WHERE id = ?').run(title, description, enabled, v.id);
  res.json(adminRow(req, db.prepare('SELECT * FROM videos WHERE id = ?').get(v.id)));
});

router.delete('/:id', authenticate, requireAdmin, (req, res) => {
  const v = db.prepare('SELECT * FROM videos WHERE id = ?').get(req.params.id);
  if (!v) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM video_plays WHERE video_id = ?').run(v.id);
  db.prepare('DELETE FROM videos WHERE id = ?').run(v.id);
  try { fs.rmSync(videoDir(v.id), { recursive: true, force: true }); } catch {}
  res.json({ success: true });
});

// Thumbnail for the admin list
router.get('/:id/thumb.jpg', authenticate, requireAdmin, (req, res) => {
  const p = path.join(videoDir(req.params.id), 'thumb.jpg');
  if (!fs.existsSync(p)) return res.status(404).end();
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.sendFile(p);
});

// ── Routes: playback (play token required) ─────────────────────────────────────
const noStore = (res) => { res.setHeader('Cache-Control', 'no-store'); };

router.get('/:id/hls/index.m3u8', requirePlayToken, (req, res) => {
  const p = path.join(videoDir(req.params.id), 'hls', 'index.m3u8');
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'Not ready' });
  noStore(res);
  res.type('application/vnd.apple.mpegurl');
  res.sendFile(p);
});

router.get('/:id/hls/key', requirePlayToken, (req, res) => {
  const p = path.join(videoDir(req.params.id), 'key.bin');
  if (!fs.existsSync(p)) return res.status(404).end();
  noStore(res);
  res.type('application/octet-stream');
  res.sendFile(p);
});

router.get('/:id/hls/:seg', requirePlayToken, (req, res) => {
  if (!/^seg_\d{4}\.ts$/.test(req.params.seg)) return res.status(404).end();
  const p = path.join(videoDir(req.params.id), 'hls', req.params.seg);
  if (!fs.existsSync(p)) return res.status(404).end();
  noStore(res);
  res.type('video/mp2t');
  res.sendFile(p);
});

// Admin: who watched what
router.get('/:id/views', authenticate, requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT created_at, extension_id, ip, user_agent FROM video_plays WHERE video_id = ? ORDER BY created_at DESC LIMIT 200').all(req.params.id);
  res.json({ views: rows });
});

module.exports = router;
