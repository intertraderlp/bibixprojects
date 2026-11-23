// ── Server-Sent Events broadcast manager ─────────────────────────────────────
// Keeps a map of userId → Set of active SSE response objects.
// Call emit(userId, event, data) from anywhere to push to all browser tabs
// belonging to that user.

const clients = new Map(); // userId → Set<res>

function addClient(userId, res) {
  if (!clients.has(userId)) clients.set(userId, new Set());
  clients.get(userId).add(res);
}

function removeClient(userId, res) {
  const set = clients.get(userId);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) clients.delete(userId);
}

function emit(userId, event, data = {}) {
  const set = clients.get(userId);
  if (!set || set.size === 0) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) {
    try { res.write(payload); }
    catch { /* client disconnected — will be cleaned up on close */ }
  }
}

function hasClients(userId) {
  const set = clients.get(userId);
  return !!(set && set.size > 0);
}

module.exports = { addClient, removeClient, emit, hasClients };
