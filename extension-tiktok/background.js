// Background service worker.
//
// Responsibilities:
//   1. Hold the API token + env (staging vs prod) in chrome.storage.local
//      so the content script never has to see it directly.
//   2. Receive BIBIX_TIKTOK_SAVE messages from the content script and POST
//      them to /api/tiktok/actions on the Bibix backend.
//
// Errors are logged to the SW console but don't crash the extension —
// this MVP treats logging as best-effort. If POSTs fail, the like/reply
// still happened on TikTok, we just lose the record.

const BIBIX_PROD    = 'https://bibix.ailabstech.com';
const BIBIX_STAGING = 'https://staging.bibix.ailabstech.com';

async function getConfig() {
  const { bibixToken, bibixEnv } = await chrome.storage.local.get(['bibixToken', 'bibixEnv']);
  return {
    token: bibixToken || '',
    baseUrl: bibixEnv === 'prod' ? BIBIX_PROD : BIBIX_STAGING,
  };
}

async function bibixPost(path, body) {
  const { token, baseUrl } = await getConfig();
  if (!token) {
    console.warn('[BibixTikTok] No token — action not saved. Set token in popup.');
    return null;
  }
  try {
    const res = await fetch(`${baseUrl}/api${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.warn(`[BibixTikTok] POST ${path} → ${res.status}`);
      return null;
    }
    return await res.json().catch(() => null);
  } catch (e) {
    console.warn(`[BibixTikTok] POST ${path} failed:`, e.message);
    return null;
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.action === 'BIBIX_TIKTOK_SAVE') {
    (async () => {
      await bibixPost('/tiktok/actions', msg.payload);
      sendResponse({ ok: true });
    })();
    return true; // async response
  }

  // Proxy AI reply requests to the Bibix backend, which owns provider +
  // API keys. Same endpoint the Instagram extension uses — reusing keeps
  // one provider config across both. Content script never sees keys.
  if (msg?.action === 'GET_AI_REPLY') {
    (async () => {
      try {
        const res = await bibixPost('/ai/reply', {
          comment_text: msg.comment || 'Nice video!',
          post_owner:   msg.post_owner || null,
        });
        if (res && res.reply) sendResponse({ reply: res.reply });
        else sendResponse({ error: (res && res.error) || 'AI provider returned empty reply' });
      } catch (e) {
        sendResponse({ error: (e && e.message) || 'AI request failed' });
      }
    })();
    return true; // async response
  }
});

console.log('✅ Bibix TikTok background.js loaded');
