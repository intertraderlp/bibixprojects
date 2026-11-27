// Popup UI logic — wires the buttons to the content script + shows status.
//
// Flow:
//   1. On open, restore saved token + env (staging by default for now).
//   2. Click Like/Reply → send message to the active tab's content script.
//   3. Content script sends back progress + done events which we render in
//      the #status div.

const el = (id) => document.getElementById(id);
const $status = el('status');
const $env    = el('env');

function log(msg) {
  const t = new Date().toLocaleTimeString();
  $status.textContent = `[${t}] ${msg}\n` + $status.textContent;
}

// ── Config: token + env ─────────────────────────────────────────────────────
async function loadConfig() {
  const { bibixToken, bibixEnv } = await chrome.storage.local.get(['bibixToken', 'bibixEnv']);
  el('token').value = bibixToken || '';
  const env = bibixEnv || 'staging';
  $env.textContent = `Env: ${env}  ·  Token: ${bibixToken ? '✓ set' : 'missing'}`;
}
loadConfig();

el('saveToken').addEventListener('click', async () => {
  const token = el('token').value.trim();
  await chrome.storage.local.set({ bibixToken: token, bibixEnv: 'staging' });
  await loadConfig();
  log('Token saved.');
});

// ── Send action to active tab ───────────────────────────────────────────────
async function sendToActiveTab(msg) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) { log('No active tab.'); return; }
  if (!/tiktok\.com/.test(tab.url || '')) {
    log('⚠ Open tiktok.com first.');
    return;
  }
  try {
    await chrome.tabs.sendMessage(tab.id, msg);
    log(`→ Sent ${msg.action} (count=${msg.count})`);
  } catch (e) {
    log(`Error: ${e.message} — reload the TikTok tab so the content script loads.`);
  }
}

el('btnLike').addEventListener('click', () => {
  const count = Math.max(1, Math.min(100, parseInt(el('count').value, 10) || 1));
  sendToActiveTab({ action: 'TIKTOK_LIKE', count });
});

el('btnReply').addEventListener('click', () => {
  const count = Math.max(1, Math.min(100, parseInt(el('count').value, 10) || 1));
  const useAI = el('useAI').checked;
  const replies = el('replies').value.split('\n').map(s => s.trim()).filter(Boolean);
  // When useAI is off, we require at least one line (random pick from list).
  // When useAI is on, replies act as an emergency fallback if the AI call
  // fails — allowed to be empty; the content script will skip a video if
  // AI errors and there's no fallback.
  if (!useAI && replies.length === 0) {
    log('⚠ Enter at least one reply line or enable AI.');
    return;
  }
  sendToActiveTab({ action: 'TIKTOK_REPLY', count, replies, useAI });
});

el('btnStop').addEventListener('click', () => {
  sendToActiveTab({ action: 'TIKTOK_STOP' });
});

// ── Progress listener — content script → popup ─────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'TIKTOK_PROGRESS') log(msg.text);
  if (msg?.type === 'TIKTOK_DONE')     log(`✓ Done: ${msg.summary || ''}`);
});
