// Content script for TikTok.
//
// Runs on every tiktok.com page. Listens for TIKTOK_LIKE / TIKTOK_REPLY /
// TIKTOK_STOP messages from the popup, then executes them by manipulating
// the DOM (clicking the like button, opening comments and typing).
//
// Design notes:
//   • TikTok's DOM uses data-e2e attributes for stable-ish anchors, e.g.
//     data-e2e="like-icon", data-e2e="comment-icon", data-e2e="comment-text".
//     TikTok changes these occasionally, so we also fall back to
//     aria-label / role searches.
//   • The feed at https://www.tiktok.com/foryou renders one video at a time;
//     to like/reply "N videos" we press ArrowDown between actions to advance.
//   • Every action POSTs to /api/tiktok/actions so the backend records it.
//     Failures are logged but don't stop the run.

console.log('✅ Bibix TikTok content.js loaded');

let STOP = false;

// ── Helpers ─────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand  = (max) => Math.floor(Math.random() * max);
const pick  = (arr) => arr[rand(arr.length)];

function progress(text) {
  console.log(`[BibixTikTok] ${text}`);
  chrome.runtime.sendMessage({ type: 'TIKTOK_PROGRESS', text }).catch(() => {});
}
function done(summary) {
  chrome.runtime.sendMessage({ type: 'TIKTOK_DONE', summary }).catch(() => {});
}

// ── Selectors — kept in one place so we can update them when TikTok
//    changes its DOM. Each returns the current element or null.
// ────────────────────────────────────────────────────────────────────────────
function findLikeButton() {
  // TikTok has moved the like icon around in different feed variants —
  // try a chain of anchors, most-specific first.
  const anchors = [
    '[data-e2e="like-icon"]',              // classic feed
    '[data-e2e="browse-like-icon"]',        // browse pages
    '[data-e2e="video-like-icon"]',         // video pages
    '[data-e2e*="like"]',                    // any data-e2e mentioning "like"
    'button[aria-label*="Like" i]',
    '[role="button"][aria-label*="Like" i]',
    'svg[aria-label*="Like" i]',
  ];
  for (const sel of anchors) {
    const el = document.querySelector(sel);
    if (!el) continue;
    // Walk up to a clickable ancestor. Some like icons are SVGs inside
    // a wrapper button; some are the button itself.
    const btn = el.closest('button, [role="button"], a');
    if (btn) return btn;
    if (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') return el;
  }
  return null;
}

// Dispatch a realistic pointer + mouse + click sequence so React handlers
// bound with onPointerDown / onClick actually fire. Plain el.click() often
// does nothing on TikTok because their React synthetic-event system
// doesn't accept it.
function humanClick(el) {
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 };
  try {
    el.dispatchEvent(new PointerEvent('pointerover', { ...opts, pointerType: 'mouse' }));
    el.dispatchEvent(new PointerEvent('pointerenter', { ...opts, pointerType: 'mouse' }));
    el.dispatchEvent(new PointerEvent('pointerdown',  { ...opts, pointerType: 'mouse' }));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup',   { ...opts, pointerType: 'mouse' }));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
    // Fallback for really stubborn handlers.
    if (typeof el.click === 'function') el.click();
    return true;
  } catch (_) {
    try { el.click(); return true; } catch (_) { return false; }
  }
}

// Read the current "liked" state of a like button. Uses multiple heuristics
// because TikTok changes markup often:
//   • aria-pressed="true"
//   • class contains "liked" / "active"
//   • the inner SVG has a fill color close to TikTok's red (#fe2c55 family)
function isLikeButtonActive(btn) {
  if (!btn) return false;
  if (btn.getAttribute('aria-pressed') === 'true') return true;
  const cls = (btn.className || '').toString().toLowerCase();
  if (/(^|\s)liked(\s|$)|active/.test(cls)) return true;
  const svg = btn.querySelector('svg');
  if (svg) {
    const fill = (svg.getAttribute('fill') || svg.style.fill || '').toLowerCase();
    if (/^#?(fe2c55|ff0050|ff004[0-9a-f]|e91e63)/.test(fill.replace('#', ''))) return true;
    const path = svg.querySelector('path[fill]');
    if (path) {
      const pf = (path.getAttribute('fill') || '').toLowerCase().replace('#', '');
      if (/^(fe2c55|ff0050|ff004[0-9a-f]|e91e63)/.test(pf)) return true;
    }
  }
  return false;
}

function findCommentButton() {
  let el = document.querySelector('[data-e2e="comment-icon"]');
  if (el) return el.closest('button, [role="button"], a') || el.parentElement;
  el = document.querySelector('button[aria-label*="Comment" i], [role="button"][aria-label*="Comment" i]');
  return el || null;
}

function findCommentInput() {
  // TikTok uses a contenteditable div for the comment input.
  return document.querySelector('[data-e2e="comment-text"], [contenteditable="true"][placeholder*="comment" i]')
      || document.querySelector('div[contenteditable="true"]');
}

function findPostButton() {
  // "Post" or "Reply" button next to the comment input.
  const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
  return buttons.find(b => {
    const t = (b.innerText || b.textContent || '').trim().toLowerCase();
    return t === 'post' || t === 'reply' || t === 'send';
  }) || null;
}

function getCurrentVideoUrl() {
  // On the /foryou feed, the URL updates to /@user/video/<id> as you scroll.
  // On /explore or search results it may not — best effort.
  return window.location.href;
}

function getCurrentVideoAuthor() {
  // The @username link on the video sidebar.
  const link = document.querySelector('a[href^="/@"]');
  if (!link) return null;
  const m = link.href.match(/\/@([\w.]+)/);
  return m ? m[1] : null;
}

// Best-effort scrape of the video caption/description for AI context.
// TikTok stores it in [data-e2e="browse-video-desc"] on the feed and in
// [data-e2e="video-desc"] on the video page — try both, then generic
// text near the title.
function getCurrentVideoCaption() {
  const sels = [
    '[data-e2e="browse-video-desc"]',
    '[data-e2e="video-desc"]',
    'div[data-e2e*="desc"]',
    'h1[data-e2e*="desc"]',
  ];
  for (const s of sels) {
    const el = document.querySelector(s);
    const t = el?.innerText?.trim();
    if (t) return t.slice(0, 500); // cap length
  }
  return '';
}

// Ask background.js to call the Bibix backend's /ai/reply endpoint. The
// backend hides which AI provider is active (OpenAI / Groq / Claude / etc.)
// and holds the API key — the extension just asks for a reply given
// context. Returns null on failure so the caller can fall back to the
// static reply pool.
function requestAIReply(caption, author) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({
      action: 'GET_AI_REPLY',
      comment: caption || `TikTok video by @${author || 'creator'}`,
      post_owner: author || null,
    }, (res) => {
      if (res?.reply) resolve(String(res.reply).trim());
      else resolve(null);
    });
  });
}

// ── Advance to next video ──────────────────────────────────────────────────
// Only the /foryou feed (or similar swipe-feed pages) supports "next video."
// On a single video page (/@user/video/ID) there's no next. We try three
// approaches in order and stop at the one that changes the URL:
//   1. Click the on-screen "next" button (if TikTok renders one)
//   2. Dispatch ArrowDown to the feed container
//   3. Simulate a scroll-down on the video wrapper (some layouts use scroll)
async function advanceToNextVideo() {
  const before = getCurrentVideoUrl();

  // Attempt 1: on-screen down arrow / next button.
  const arrowBtn = document.querySelector(
    '[data-e2e="arrow-right"], button[aria-label*="next" i], button[aria-label*="Next" i]'
  );
  if (arrowBtn) {
    humanClick(arrowBtn);
    await sleep(1500 + rand(400));
    if (getCurrentVideoUrl() !== before) return;
  }

  // Attempt 2: keyboard event, dispatched with target on the video player
  // (TikTok binds keydown on window/document — bubbling from body works).
  ['keydown', 'keyup'].forEach(evt => {
    document.body.dispatchEvent(new KeyboardEvent(evt, {
      key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40,
      bubbles: true, cancelable: true, view: window,
    }));
  });
  await sleep(1500 + rand(500));
  if (getCurrentVideoUrl() !== before) return;

  // Attempt 3: wheel event on the video container — some TikTok layouts
  // use a virtualized scroller instead of key handlers.
  const container = document.querySelector('[data-e2e="recommend-list-item-container"], [data-e2e="feed-video"]')
                  || document.querySelector('video')?.closest('div');
  if (container) {
    container.dispatchEvent(new WheelEvent('wheel', {
      deltaY: 1000, bubbles: true, cancelable: true,
    }));
    await sleep(1500 + rand(500));
  }
}

// ── Save action to backend ─────────────────────────────────────────────────
async function saveAction(payload) {
  chrome.runtime.sendMessage({ action: 'BIBIX_TIKTOK_SAVE', payload }).catch(() => {});
}

// Fire a key press on the video player. TikTok's feed listens for L/C/
// ArrowDown at the document level. Firing on document.body works because
// TikTok's handlers use bubbling from the video wrapper.
function pressKey(key, keyCode) {
  const opts = { key, code: `Key${key.toUpperCase()}`, keyCode, which: keyCode, bubbles: true, cancelable: true, view: window };
  ['keydown', 'keypress', 'keyup'].forEach(evt => {
    document.dispatchEvent(new KeyboardEvent(evt, opts));
    document.body.dispatchEvent(new KeyboardEvent(evt, opts));
  });
}

// ── Like N videos ──────────────────────────────────────────────────────────
async function handleLike(count) {
  STOP = false;
  progress(`Liking up to ${count} videos…`);

  let liked = 0;
  let skipped = 0;
  let alreadyLiked = 0;
  const seenVideoIds = new Set(); // dedup — don't act twice on the same video

  for (let i = 0; i < count; i++) {
    if (STOP) { progress('Stopped.'); break; }

    // Wait for the like button to be present.
    let btn = findLikeButton();
    let waited = 0;
    while (!btn && waited < 5000) {
      await sleep(500);
      waited += 500;
      btn = findLikeButton();
    }
    if (!btn) {
      progress(`⚠ No like button visible (video ${i + 1}) — advancing.`);
      skipped++;
      await advanceToNextVideo();
      continue;
    }

    // Dedup by current URL — if ArrowDown didn't advance we'd re-toggle.
    const urlNow = getCurrentVideoUrl();
    if (seenVideoIds.has(urlNow)) {
      progress(`↷ Still on same video — trying to advance.`);
      await advanceToNextVideo();
      continue;
    }
    seenVideoIds.add(urlNow);

    // Skip if already liked (visual check).
    if (isLikeButtonActive(btn)) {
      progress(`↷ Video ${i + 1} already liked (@${getCurrentVideoAuthor() || '?'}) — skipping.`);
      alreadyLiked++;
      await advanceToNextVideo();
      continue;
    }

    // First try: press "L" — TikTok's built-in shortcut for like. Untrusted
    // key events sometimes get through where untrusted clicks don't.
    btn.scrollIntoView({ block: 'center' });
    await sleep(200);
    progress(`  · pressing L…`);
    pressKey('l', 76);

    // Verify the like stuck within ~1.5s.
    let confirmed = false;
    for (let j = 0; j < 6; j++) {
      await sleep(250);
      const btnNow = findLikeButton();
      if (btnNow && isLikeButtonActive(btnNow)) { confirmed = true; break; }
    }

    // Second try: full pointer/click sequence on the button element.
    if (!confirmed) {
      progress(`  · L didn't work, trying button click…`);
      humanClick(btn);
      for (let j = 0; j < 6; j++) {
        await sleep(250);
        const btnNow = findLikeButton();
        if (btnNow && isLikeButtonActive(btnNow)) { confirmed = true; break; }
      }
    }

    // Third try: double-tap the video (TikTok's mobile like gesture) —
    // implemented as two rapid touchend events on the video element.
    if (!confirmed) {
      const vid = document.querySelector('video');
      if (vid) {
        progress(`  · trying double-tap on video…`);
        const rect = vid.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const touchOpts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy };
        for (let k = 0; k < 2; k++) {
          vid.dispatchEvent(new MouseEvent('mousedown', touchOpts));
          vid.dispatchEvent(new MouseEvent('mouseup', touchOpts));
          vid.dispatchEvent(new MouseEvent('click', touchOpts));
          await sleep(120);
        }
        for (let j = 0; j < 6; j++) {
          await sleep(250);
          const btnNow = findLikeButton();
          if (btnNow && isLikeButtonActive(btnNow)) { confirmed = true; break; }
        }
      }
    }

    if (confirmed) {
      liked++;
      progress(`❤️ Liked ${liked}/${count} — @${getCurrentVideoAuthor() || '?'}`);
      saveAction({
        type: 'like',
        video_url: urlNow,
        target_username: getCurrentVideoAuthor(),
      });
    } else {
      skipped++;
      progress(`⚠ Click didn't register on video ${i + 1} — @${getCurrentVideoAuthor() || '?'}`);
    }

    await advanceToNextVideo();
  }

  done(`liked=${liked} skipped=${skipped} already=${alreadyLiked}`);
}

// ── Reply to N videos ──────────────────────────────────────────────────────
// `useAI = true` asks the Bibix backend to generate a per-video reply using
// the video's caption + author as context. Static `replies` is used as a
// fallback when the AI call fails (or is not requested).
async function handleReply(count, replies, useAI) {
  STOP = false;
  progress(`Replying up to ${count} videos (AI=${useAI ? 'on' : 'off'}, ${replies.length} fallback lines)…`);

  let replied = 0;
  let skipped = 0;
  for (let i = 0; i < count; i++) {
    if (STOP) { progress('Stopped.'); break; }

    // Open the comments panel.
    let cb = findCommentButton();
    let waited = 0;
    while (!cb && waited < 4000) {
      await sleep(400);
      waited += 400;
      cb = findCommentButton();
    }
    if (!cb) {
      progress(`⚠ No comment button on video ${i + 1} — skipping.`);
      skipped++;
      await advanceToNextVideo();
      continue;
    }
    cb.click();
    await sleep(1200 + rand(400));

    const input = findCommentInput();
    if (!input) {
      progress(`⚠ Comment input not visible — skipping.`);
      skipped++;
      await advanceToNextVideo();
      continue;
    }

    // Resolve the reply text: AI first (if requested), fallback to random
    // pick from the static list. If AI is on AND fails AND there's no
    // fallback, skip the video (backend AI misconfigured is the caller's
    // problem to fix — don't fake it).
    const caption = getCurrentVideoCaption();
    const author  = getCurrentVideoAuthor();
    let text = null;
    if (useAI) {
      progress(`🤖 Generating AI reply ${i + 1}/${count}…`);
      text = await requestAIReply(caption, author);
      if (!text) {
        if (replies.length > 0) {
          text = pick(replies);
          progress(`⚠ AI failed — using fallback "${text}"`);
        } else {
          progress(`⚠ AI failed and no fallback — skipping video ${i + 1}.`);
          skipped++;
          await advanceToNextVideo();
          continue;
        }
      }
    } else {
      text = pick(replies);
    }

    input.focus();
    // For contenteditable divs, setting innerText + dispatching input works
    // in most React-based apps.
    input.innerText = text;
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
    await sleep(500 + rand(300));

    const post = findPostButton();
    if (!post) {
      progress(`⚠ Post button not found for video ${i + 1}.`);
      skipped++;
      await advanceToNextVideo();
      continue;
    }
    post.click();
    replied++;
    progress(`💬 Replied ${replied}/${count} — "${text}"`);
    saveAction({
      type: 'reply',
      video_url: getCurrentVideoUrl(),
      target_username: author,
      reply_text: text,
    });

    await sleep(800 + rand(400));
    await advanceToNextVideo();
  }

  done(`replied=${replied} skipped=${skipped}`);
}

// ── Message handler from popup ─────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  sendResponse({ ok: true });
  if (msg.action === 'TIKTOK_STOP')  { STOP = true; return; }
  if (msg.action === 'TIKTOK_LIKE')  { handleLike(parseInt(msg.count, 10) || 1); }
  if (msg.action === 'TIKTOK_REPLY') { handleReply(parseInt(msg.count, 10) || 1, msg.replies || [], !!msg.useAI); }
});
