// ── GET /api/events — SSE stream for real-time board updates ─────────────────
// EventSource (browser) can't send custom headers, so we accept the JWT as
// a ?token= query param for this one endpoint only.
const express   = require('express');
const jwt       = require('jsonwebtoken');
const { addClient, removeClient } = require('../sse');
const { JWT_SECRET } = require('../middleware/auth'); // same fallback secret as the rest of the API

const router = express.Router();

router.get('/', (req, res) => {
  // Auth via query param (EventSource limitation)
  const token = req.query.token;
  if (!token) return res.status(401).end();
  let userId;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    userId = payload.id || payload.userId;
  } catch {
    return res.status(401).end();
  }

  // SSE headers
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
  res.flushHeaders();

  // Send an initial "connected" event so the client knows it's live
  res.write(`event: connected\ndata: {}\n\n`);

  addClient(userId, res);

  // Keep-alive ping every 25 s (prevents proxy timeouts)
  const ping = setInterval(() => {
    try { res.write(`:ping\n\n`); }
    catch { clearInterval(ping); }
  }, 25000);

  req.on('close', () => {
    clearInterval(ping);
    removeClient(userId, res);
  });
});

module.exports = router;
