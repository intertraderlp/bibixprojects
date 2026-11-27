// VideoVue — content script for /watch/<share> pages.
// Bridges the page (window.postMessage) and the background worker, which is the
// only place a play token can be fetched from. The page never sees the
// extension's internals; it just receives { token, playlist, expiresIn }.

(() => {
  const isVideoVuePage = () => !!document.querySelector('meta[name="bibix-video"]');

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.type !== 'videovue:request') return;
    if (!isVideoVuePage()) return;
    chrome.runtime.sendMessage({ type: 'videovue:play-token', refresh: !!e.data.refresh }, (r) => {
      if (chrome.runtime.lastError || !r) {
        window.postMessage({ type: 'videovue:error', error: (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'Extension did not respond' }, location.origin);
        return;
      }
      if (r.ok) window.postMessage({ type: 'videovue:token', token: r.data.token, playlist: r.data.playlist, expiresIn: r.data.expiresIn }, location.origin);
      else window.postMessage({ type: 'videovue:error', error: r.error, code: r.code }, location.origin);
    });
  });

  const announce = () => { if (isVideoVuePage()) window.postMessage({ type: 'videovue:ready', version: chrome.runtime.getManifest().version }, location.origin); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', announce); else announce();
})();
