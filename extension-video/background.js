// VideoVue — background service worker.
// The only job: fetch play tokens on behalf of /watch pages. The fetch runs
// here so that its Origin header is chrome-extension://<id>, which is what the
// server checks before issuing a token. Nothing else can obtain one.

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'videovue:play-token') return false;
  // Only serve requests coming from our content script on a page whose origin matches.
  const pageOrigin = sender && sender.origin;
  const url = sender && sender.url ? new URL(sender.url) : null;
  if (!url || !pageOrigin || url.origin !== pageOrigin || !/^\/watch\/[A-Za-z0-9_-]+$/.test(url.pathname)) {
    sendResponse({ ok: false, error: 'Not a VideoVue watch page' });
    return false;
  }
  const share = url.pathname.split('/').pop();
  fetch(`${pageOrigin}/api/videos/watch/${share}/play-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh: !!msg.refresh }),
  }).then(async (res) => {
    let data = null; try { data = await res.json(); } catch (_) {}
    if (!res.ok) { sendResponse({ ok: false, error: (data && data.error) || ('HTTP ' + res.status), code: data && data.code }); return; }
    sendResponse({ ok: true, data });
  }).catch((e) => sendResponse({ ok: false, error: e.message }));
  return true;
});
