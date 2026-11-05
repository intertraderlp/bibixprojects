// ─────────────────────────────────────────────────────────────────────────────
// fetch-hook.js  —  runs in the PAGE's MAIN world (see manifest content_scripts
// with "world": "MAIN"). Wraps window.fetch / XMLHttpRequest from inside the
// page and forwards matching responses to the content script via
// window.postMessage.
//
// v2: DIAGNOSTIC MODE
//   • Logs EVERY notification-related URL the page hits so we can see exactly
//     what IG is fetching when you open the Activity panel.
//   • Broader URL pattern — captures more candidates, prints what was kept
//     vs ignored.
//   • Dumps the top-level shape of each forwarded response so the content
//     script's parser can be tuned to IG's real JSON structure.
//
// All errors are swallowed so we never break instagram.com.
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  if (window.__bibixFetchHookInstalled) return;
  window.__bibixFetchHookInstalled = true;
  // Counter exposed for quick verification (`window.__bibixHookFetches`).
  window.__bibixHookFetches = 0;
  window.__bibixHookForwards = 0;

  console.log('[BibixHook] installed at', new Date().toISOString());

  // URLs we want to inspect. Wider than v1 — anything that smells like
  // notifications / activity / inbox / news / graphql. We log every match,
  // forward the ones that look like notif data (story arrays etc.).
  const URL_RE = /\/news\/|\/notification|\/inbox|\/activity|\/aymf|graphql|story/i;

  function shapeSummary(json) {
    // Cheap top-level fingerprint: keys + first-array-length per array key.
    try {
      if (!json || typeof json !== 'object') return String(json).slice(0, 80);
      const keys = Object.keys(json);
      const summary = {};
      for (const k of keys.slice(0, 25)) {
        const v = json[k];
        if (Array.isArray(v)) summary[k] = `Array[${v.length}]`;
        else if (v && typeof v === 'object') summary[k] = `{${Object.keys(v).slice(0, 5).join(',')}}`;
        else summary[k] = typeof v;
      }
      return summary;
    } catch (_) { return 'unknown'; }
  }

  function forward(url, text) {
    if (!url) return;
    let json;
    try { json = JSON.parse(text); } catch (_) {
      console.log('[BibixHook] ⤴ not-JSON', url.slice(0, 120));
      return;
    }
    const shape = shapeSummary(json);
    const looksLikeNotif =
      json && (
        json.new_stories || json.old_stories || json.counts ||
        (Array.isArray(json.stories)) ||
        (json.data && typeof json.data === 'object') ||
        json.aymf || json.subscription
      );

    console.log(`[BibixHook] ⤵ ${looksLikeNotif ? 'FORWARD' : 'IGNORE'}`, url.slice(0, 140), shape);

    if (!looksLikeNotif) return;
    window.__bibixHookForwards++;
    try {
      window.postMessage({ __bibixNotif: true, url: String(url), json }, '*');
    } catch (e) {
      console.log('[BibixHook] postMessage failed:', e && e.message);
    }
  }

  // ── Wrap window.fetch ──────────────────────────────────────────────────────
  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (...args) {
      const p = origFetch.apply(this, args);
      let url = '';
      try { url = (typeof args[0] === 'string') ? args[0] : (args[0] && args[0].url) || ''; } catch (_) {}
      if (url && URL_RE.test(url)) {
        window.__bibixHookFetches++;
        p.then((res) => {
          try {
            res.clone().text().then((t) => forward(url, t)).catch(() => {});
          } catch (_) {}
        }).catch(() => {});
      }
      return p;
    };
  }

  // ── Wrap XMLHttpRequest ────────────────────────────────────────────────────
  try {
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      try { this.__bibixUrl = url; } catch (_) {}
      return origOpen.call(this, method, url, ...rest);
    };
    XMLHttpRequest.prototype.send = function (...sendArgs) {
      try {
        this.addEventListener('load', function () {
          try {
            if (this.__bibixUrl && URL_RE.test(this.__bibixUrl)) {
              window.__bibixHookFetches++;
              forward(this.__bibixUrl, this.responseText);
            }
          } catch (_) {}
        });
      } catch (_) {}
      return origSend.apply(this, sendArgs);
    };
  } catch (_) { /* XHR wrap failed — fetch hook still active */ }
})();
