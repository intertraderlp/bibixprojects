// Bump on every content.js change. Logged on load and echoed on every message
// response so we can ALWAYS confirm which build is actually running in a given
// browser tab (folder/version confusion has repeatedly bitten us). Check it in
// the IG tab's DevTools console: "content.js vX.Y.Z loaded".
const BIBIX_EXT_VERSION = "1.53.0";
console.log(`✅ Instagram Extension content.js v${BIBIX_EXT_VERSION} loaded`);

let STOP = false;

const DEFAULT_REPLIES = [
  "🔥🔥🔥", "Love this 😍", "Facts 💯", "Well said 👏",
  "Interesting 👀", "So true 🙌", "Amazing! ✨", "Keep it up 💪",
];

/* ===== MESSAGE HANDLER ===== */
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  sendResponse({ ok: true, version: BIBIX_EXT_VERSION });
  if (msg.action === "STOP_ALL")        { STOP = true; return; }
  if (msg.action === "RANDOM_LIKE")     { STOP = false; handleLikes(parseInt(msg.count, 10) || 1, msg.asAccount || null, msg.queueItemId || null); }
  if (msg.action === "RANDOM_COMMENT")  { STOP = false; handleComments(parseInt(msg.count, 10) || 1, msg.replies || [], msg.useAI || false, msg.asAccount || null, msg.queueItemId || null); }
  if (msg.action === "RANDOM_FOLLOW")   { STOP = false; handleFollow(parseInt(msg.count, 10) || 1); }
  if (msg.action === "UNFOLLOW_PEOPLE")    { STOP = false; handleUnfollow(parseInt(msg.count, 10) || 1); }
  if (msg.action === "SCAN_NOTIFICATIONS") { STOP = false; handleScanNotifications(!!msg.autoOpen); }
  if (msg.action === "REPLY_DMS")          { STOP = false; handleReplyDMs(parseInt(msg.count, 10) || 10); }
  if (msg.action === "SNAPSHOT_FOLLOWERS") { STOP = false; handleSnapshotFollowers(!!msg.autoOpen); }
  if (msg.action === "TRIGGER_SCHEDULE_POLL") { pollScheduledPosts(true); }
  if (msg.action === "SCAN_ACCOUNTS")        { STOP = false; handleScanAccounts(); }
  if (msg.action === "SWITCH_ACCOUNT")       { STOP = false; handleManualSwitch(msg.username, !!msg.waitCooldown); }
  if (msg.action === "SCRAPE_PROFILE")       { STOP = false; handleScrapeProfile(msg.target_username, msg.post_count, msg.job_id); }
  if (msg.action === "ENRICH_PROFILE")       { STOP = false; handleEnrichProfile(msg.username); }
});

/* ===== LOAD MORE COMMENTS =====
   Aggressively click every variant of "load more / view N more comments"
   that IG renders, plus scroll to keep nudging the lazy loader. IG renders
   ~6-12 comments per click, so a post with 500 comments may need 50-80
   click cycles before everything is in the DOM.

   TARGET-AWARE: if `target` is passed, we keep clicking + scrolling until
   the DOM has at least target*1.3 visible comments (30% buffer for dedup /
   own-comments / already-liked). This is essential for the batch use case
   where the tab opens fresh and IG only server-renders ~7 initial comments
   — without target awareness we'd give up too early on big like targets. */
// Find the actual scrollable comments container inside the IG post modal.
//
// CRITICAL: in IG's post modal layout, comments live in their own internal
// scrollable element, NOT the window. window.scrollBy / scrollTo do nothing
// for the comments — they just scroll the page background. That's why the
// loader was finding the initial ~10 comments + maybe one "Load more" click
// worth and then giving up: IG's IntersectionObserver-based lazy loader
// only fires when you scroll the comments container itself.
//
// Heuristic: find every element with overflow=scroll/auto AND a comment
// heart inside it AND a usable scroll-height > clientHeight. Return the
// most-specific one (the deepest in the DOM, since IG nests dialog→sidebar
// →comments-region→comments-list).
function findCommentsScrollable() {
  const hearts = document.querySelectorAll('svg[aria-label="Like"], svg[aria-label="Unlike"]');
  if (hearts.length === 0) return null;
  // Walk up from a heart, find the closest scrollable ancestor.
  const isScrollable = (el) => {
    if (!el || el === document || el === document.body) return false;
    const cs = getComputedStyle(el);
    const overflowY = cs.overflowY;
    if (overflowY !== 'scroll' && overflowY !== 'auto') return false;
    return el.scrollHeight > el.clientHeight + 4;
  };
  const candidates = new Set();
  for (const heart of hearts) {
    let el = heart.parentElement;
    while (el && el !== document.body) {
      if (isScrollable(el)) { candidates.add(el); break; }
      el = el.parentElement;
    }
  }
  if (candidates.size === 0) return null;
  // Prefer the candidate with the most hearts inside it (the true comments panel).
  let best = null, bestScore = -1;
  for (const c of candidates) {
    const inside = c.querySelectorAll('svg[aria-label="Like"], svg[aria-label="Unlike"]').length;
    if (inside > bestScore) { bestScore = inside; best = c; }
  }
  return best;
}

// Scroll the comments container to the bottom. Falls back to window-scroll
// if no container can be identified (defensive — should never happen on a
// real IG post page, but keeps the loader from no-op'ing).
function scrollCommentsToBottom() {
  const c = findCommentsScrollable();
  if (c) {
    c.scrollTop = c.scrollHeight;
    return true;
  }
  window.scrollTo({ top: document.body.scrollHeight, behavior: 'auto' });
  return false;
}

// Scroll the comments container by Npx. Same fallback logic.
function scrollCommentsBy(deltaY) {
  const c = findCommentsScrollable();
  if (c) {
    c.scrollTop = Math.min(c.scrollHeight, c.scrollTop + deltaY);
    return true;
  }
  window.scrollBy({ top: deltaY, behavior: 'smooth' });
  return false;
}

// Compact snapshot of the comments DOM — logged when the loader can't load
// more, so we can SEE from a real run why: whether a scroll container was
// found, how many load-more controls matched, and the most common button /
// icon labels present (which reveals what IG's real "load more" control is
// named when our matcher misses it). Purely diagnostic; no side effects.
function commentsDomSnapshot() {
  const c = findCommentsScrollable();
  const matched = Array.from(document.querySelectorAll('button, div[role="button"]')).filter(isLoadMoreControl).length;
  const freq = {};
  for (const el of document.querySelectorAll('button, div[role="button"], svg[aria-label]')) {
    const label = (el.getAttribute && el.getAttribute('aria-label')) || (el.innerText || '').trim();
    if (label && label.length <= 40) freq[label] = (freq[label] || 0) + 1;
  }
  const topLabels = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([t, n]) => `${t}×${n}`);
  return {
    comments: countLoadedComments(),
    container: c ? `${c.tagName}.${String(c.className || '').slice(0, 40)} sh=${c.scrollHeight} ch=${c.clientHeight}` : 'NONE',
    loadMoreMatched: matched,
    topLabels,
  };
}

// ─── v1.45: INCREMENTAL LOADER ───────────────────────────────────────────────
// Comments are loaded one batch at a time, and only when the like/reply loop
// has run out of candidates. The previous two-phase design pre-loaded 2× the
// target before the first like (20-50 "+" clicks on big targets): slow to
// start, and it grew the DOM — and the tab's memory — far beyond what the run
// actually used. Loading stops the moment the target is reached.
//
// One batch = up to `maxCycles` rounds of: click every visible "load more"
// control, scroll the comments container (wakes IG's IntersectionObserver
// lazy-loader), wait ~1.5s. Returns as soon as the comment count grows.
// progress() is emitted every cycle so the background 3-min silence
// watchdog never fires while loading.
function countLoadedComments() {
  let n = 0;
  document.querySelectorAll('svg[aria-label="Like"], svg[aria-label="Unlike"]').forEach(s => {
    const h = parseInt(s.getAttribute('height') || '0', 10);
    if (h >= 10 && h <= 24) n++;
  });
  return n;
}

// True for any of IG's expand controls: the round [+] "Load more comments",
// "View N more comments/replies" links, and the hidden-comments gates.
function isLoadMoreControl(b) {
  if (!b) return false;
  // (a) SVG icon controls — the round ⊕ "Load more comments" and its variants.
  if (b.querySelector && b.querySelector(
    'svg[aria-label="Load more comments"], svg[aria-label*="more comment" i], svg[aria-label*="load more" i], svg[aria-label*="View more" i], svg[aria-label*="see more" i], svg[aria-label*="show more" i], svg[aria-label*="hidden" i], svg[aria-label*="more repl" i]'
  )) return true;
  // The ⊕ button itself sometimes carries the aria-label (not a child svg).
  const aria = (b.getAttribute && (b.getAttribute('aria-label') || '')).toLowerCase();
  if (/load more|more comment|view more|see more|show more|more repl|hidden/.test(aria)) return true;
  // (b) Text-based variants across IG versions and locales.
  const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
  return (
    /^(load more|show more|see more|view all comments|view more comments|view previous comments|view hidden comments|view \d[\d,]*\s+(more\s+)?(comment|repl|hidden)|view \d[\d,]*\s+repl|show \d[\d,]*\s+repl|view replies|show replies)/i.test(txt)
    || /view\s+hidden\s+comments?/i.test(txt)
    || /hidden\s+by\s+instagram/i.test(txt)
    || /\d+\s+hidden\s+comments?/i.test(txt)
    || /^(more comments?|show more comments?)$/i.test(txt)
  );
}

// Persistently pull more comments into the DOM: click every load-more control
// and scroll the comments container until EITHER new comments appear (return
// immediately so the caller likes/replies to them) OR the post is genuinely
// out — no load-more control present AND no growth for a sustained stretch.
// Stays incremental: the caller stops the whole run once the target is reached,
// so we never load far past what the run needs. This has to be patient: on a
// post with hundreds of comments IG lazy-loads them slowly, a page at a time,
// and the visible "Load more" button often disappears while scroll-triggered
// loading is still delivering more — quitting early is exactly the v1.45 bug
// that capped a 200-like run at 42 on a 286-comment post.
function containerScrollHeight() {
  const c = findCommentsScrollable();
  if (c) return c.scrollHeight;
  const se = document.scrollingElement || document.documentElement;
  return se ? se.scrollHeight : 0;
}

// Load exactly ONE more page of comments, gently. The like/reply loop calls
// this only when it has run out of comments currently on screen: we click the
// round (+) "Load more comments" control once (or, if there's no button, do a
// single scroll to the bottom to trigger IG's lazy-loader), then wait for the
// next page to appear and hand straight back so liking resumes one-by-one.
// No multi-strategy scroll-fest — that "opens several scrolls then starts"
// behavior is exactly what we're removing here.
async function loadMoreComments(label) {
  const before = countLoadedComments();

  // Trigger the next page: prefer the explicit (+) / "view more" control; if
  // there's none, IG paginates on scroll — so scroll the comments container,
  // the window, and the last comment into view (all three, since IG's
  // lazy-loader may watch any of them). This is still ONE page per call.
  const trigger = () => {
    const btn = Array.from(document.querySelectorAll('button, div[role="button"]')).find(isLoadMoreControl);
    if (btn) {
      try { btn.scrollIntoView({ behavior: 'auto', block: 'center' }); btn.click(); } catch (_) {}
      return true;            // a real load-more control existed
    }
    const cont = findCommentsScrollable();
    if (cont) { cont.scrollTop = cont.scrollHeight; try { cont.dispatchEvent(new WheelEvent('wheel', { deltaY: 1500, bubbles: true })); } catch (_) {} }
    try { window.scrollTo(0, document.body.scrollHeight); } catch (_) {}
    const hearts = document.querySelectorAll('svg[aria-label="Like"], svg[aria-label="Unlike"]');
    const last = hearts[hearts.length - 1];
    if (last) { try { last.scrollIntoView({ block: 'end' }); } catch (_) {} }
    return false;
  };
  const hadButton = trigger();

  // Wait for that one page to arrive (up to ~12s). Return the instant new
  // comments show up so we go right back to liking them one by one.
  for (let i = 0; i < 24; i++) {
    if (STOP) break;
    await sleep(500);
    const now = countLoadedComments();
    if (now > before) {
      console.log(`[BibixCS] loadMoreComments: next page +${now - before} (→${now}), button=${hadButton}`);
      return { before, after: now, grew: true, buttonsSeenMax: hadButton ? 1 : 0 };
    }
    if (i % 4 === 0) progress(`📥 ${label} — loading next page… ${now} in view`);
    // Re-trigger a couple of times in case the first click/scroll didn't catch.
    if (i === 6 || i === 14) trigger();
  }

  const after = countLoadedComments();
  const snapshot = commentsDomSnapshot();
  console.log(`[BibixCS] loadMoreComments: no next page (${before}→${after}), button=${hadButton}`, JSON.stringify(snapshot));
  return { before, after, grew: after > before, buttonsSeenMax: hadButton ? 1 : 0, snapshot };
}
// One persistent loadMoreComments() call already waits ~40s before declaring a
// post exhausted, so a single dry call is enough; a second is cheap insurance
// against a transient IG stall.
const MAX_DRY_BATCHES = 2;

// ─── Legacy loader (kept for handleComments and other call-sites) ────────────
async function loadAllComments(maxClicks = 250, target = 0) {
  // Comment counter — counts EVERY heart icon (Like or Unlike state) sized
  // like a comment heart. This is the most robust signal because the heart
  // is rendered next to every comment regardless of whether it's a top-level
  // comment or a nested reply.
  // (Previous version used `ul ul a[href^="/"]` which only matched usernames
  // inside REPLY threads — missing the top-level comments entirely, so the
  // target-reached early-exit never fired on most posts.)
  const countComments = () => {
    let n = 0;
    document.querySelectorAll('svg[aria-label="Like"], svg[aria-label="Unlike"]').forEach(s => {
      const h = parseInt(s.getAttribute('height') || '0', 10);
      if (h >= 10 && h <= 24) n++;
    });
    return n;
  };

  // Detect whether we successfully located the comments container — if not,
  // log it loudly. (When IG changes its modal layout this is the FIRST thing
  // that breaks, and a clear log line makes it obvious.)
  const scrollable = findCommentsScrollable();
  if (scrollable) {
    console.log(`[BibixCS] loadAllComments: comments container found (scrollHeight=${scrollable.scrollHeight}, clientHeight=${scrollable.clientHeight})`);
  } else {
    console.warn(`[BibixCS] loadAllComments: NO scrollable comments container found — falling back to window-scroll (may not trigger IG lazy-loader)`);
  }

  let noButtonStreak = 0;
  // True for any of these expand-more controls IG renders:
  //   • [+] "Load more comments" pagination button (the round "+" icon)
  //   • "View N more comments" / "View previous comments" text links
  //   • "View N replies" inside a nested thread
  //   • "View hidden comments" — the eye-with-slash button at the bottom
  //     when IG has demoted some comments (spam-suspect, etc.). Posts with
  //     thousands of total comments often have most of them behind this
  //     gate, so missing it caps the like loop hard.
  //   • "Hidden by Instagram" — moderation gate IG shows for comments it
  //     flagged. Need to click to expand them before they're likeable.
  const isLoadMoreButton = (b) => {
    if (!b) return false;
    // (a) SVG icons on pill buttons.
    if (b.querySelector && b.querySelector(
      'svg[aria-label="Load more comments"], svg[aria-label*="more comments" i], svg[aria-label*="View more" i], svg[aria-label*="hidden" i]'
    )) return true;
    // (b) Text-based variants seen across IG variants and locales.
    const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
    return (
      /^(load more|view all comments|view more comments|view previous comments|view hidden comments|view \d[\d,]*\s+(more\s+)?(comment|repl|hidden)|view \d[\d,]*\s+repl)/i.test(txt)
      // Plain "View hidden comments" without a count, anywhere in the text.
      || /view\s+hidden\s+comments?/i.test(txt)
      // "Hidden by Instagram" moderation gate — click to expand flagged comments.
      || /hidden\s+by\s+instagram/i.test(txt)
      // Generic "hidden comments" / "X hidden comments" fallback.
      || /\d+\s+hidden\s+comments?/i.test(txt)
    );
  };

  // Track signature counts so we know if a click actually surfaced new
  // controls — IG sometimes leaves the same button in place after a click
  // (animation glitch) and we'd loop forever otherwise.
  let lastButtonSignature = '';
  let sameSignatureStreak = 0;

  // Target-aware: if caller asks for N likes, load at least N*1.3 comments
  // before returning. Floor at 50 so small targets still get a meaningful
  // expansion pass. If no target given, behave as before (just click everything).
  const minComments = target > 0 ? Math.ceil(target * 1.3) : 0;
  if (minComments > 0) {
    console.log(`[BibixCS] loadAllComments target=${target}, need ≥${minComments} comments in DOM`);
  }

  // Stagnation tracking — give up only when the comment count STOPS growing
  // for a long stretch, not just when a button is momentarily absent. This
  // catches "IG hid the button but more comments are still loading" cases.
  let lastCount = 0;
  let stagnantStreak = 0;

  // Exit state — captured so handleLikes can surface it in the partial
  // error message. Lets the user see WHERE the loader stopped without
  // needing the console open. Set at every return path below.
  const exitState = { finalCount: 0, iterations: 0, reason: 'unknown' };

  for (let i = 0; i < maxClicks; i++) {
    if (STOP) { exitState.reason = 'stop_requested'; exitState.iterations = i; exitState.finalCount = countComments(); return exitState; }

    // Force-scroll the COMMENTS CONTAINER (not the window) to bottom every
    // 3 iterations. IG's IntersectionObserver fires on the comments
    // container, not the page. Without this, the lazy-loader sits dormant
    // and we never see comments beyond the initial render.
    if (i > 0 && i % 3 === 0) {
      scrollCommentsToBottom();
      await sleep(600);
    }

    // Find every "load more" candidate, click them top-to-bottom (some
    // posts have separate buttons per nested thread).
    const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'))
      .filter(isLoadMoreButton);

    const currentCount = countComments();
    exitState.iterations = i;
    exitState.finalCount = currentCount;

    // Update stagnation tracking BEFORE we log so the log reflects the latest.
    if (currentCount > lastCount) {
      stagnantStreak = 0;
      lastCount = currentCount;
    } else {
      stagnantStreak++;
    }

    // Periodic diagnostic + watchdog heartbeat. The loader can run for
    // 1-3 minutes on big posts; without an emitted progress() the
    // background.js silence watchdog (3 min) would falsely kill the tab
    // before the loader even finishes. Sending progress every 5 iters
    // (~6-10s) keeps that watchdog reset.
    if (i % 5 === 0) {
      console.log(`[BibixCS] loadAllComments iter=${i} comments=${currentCount} buttons=${buttons.length} stagnant=${stagnantStreak} target=${minComments || 'open'}`);
      progress(`📥 Loading comments… ${currentCount}${minComments ? ` / ≥${minComments}` : ''}`);
    }

    // Early exit if we hit the target — no need to keep clicking once we
    // have enough comments to satisfy the like loop's appetite.
    if (minComments > 0 && currentCount >= minComments) {
      console.log(`[BibixCS] loadAllComments DONE: ${currentCount} ≥ ${minComments}`);
      exitState.reason = 'target_reached';
      return exitState;
    }

    if (!buttons.length) {
      noButtonStreak++;
      // Give up only when BOTH:
      //   • buttons absent for many polls (~70s) AND
      //   • comment count hasn't grown for a SUSTAINED stretch (~75s)
      //
      // Real-world IG behavior on big posts: after the visible "Load more"
      // button disappears, IG keeps lazy-loading comments via scroll-
      // triggered IntersectionObserver. The previous 25-poll stagnant
      // threshold (~28s) was too aggressive — we'd quit at 14 visible
      // comments when 200+ were still in the pipeline and would have
      // appeared if we'd kept scrolling. Bumped to 60 (~70s) to give
      // the lazy-loader real time to deliver.
      //
      // Trade-off: ~45s extra wait on small/exhausted posts (added to
      // the existing 70s no-button wait). Acceptable — small posts that
      // truly have no more comments still exit cleanly, just slower.
      if (noButtonStreak >= 60 && stagnantStreak >= 60) {
        console.log(`[BibixCS] loadAllComments GIVE UP at iter=${i} comments=${currentCount} (no button for ${noButtonStreak} polls AND stagnant ${stagnantStreak} polls)`);
        exitState.reason = `gave_up_no_buttons_${noButtonStreak}p_stagnant_${stagnantStreak}p`;
        break;
      }
      // Aggressive scroll inside the comments container. Alternate
      // between scrollTo bottom and partial scrollBy — both can trigger
      // IG's IntersectionObserver depending on which sentinel element
      // is being watched.
      if (noButtonStreak % 3 === 0) {
        scrollCommentsToBottom();
      } else {
        scrollCommentsBy(1500);
      }
      await sleep(1100);
      continue;
    }

    noButtonStreak = 0;

    // Detect "stuck on the same button" (rare, but recoverable by scrolling
    // and waiting a beat). The signature is the joined trimmed text of
    // every candidate — if it doesn't change after a click, IG hasn't
    // actually expanded anything yet.
    const sig = buttons.map(b => (b.innerText || '').trim().slice(0, 40)).join('|');
    if (sig === lastButtonSignature) {
      sameSignatureStreak++;
      if (sameSignatureStreak >= 3) {
        // Try harder: scroll the comments container to bottom and wait
        // for the lazy loader. (Was scrolling the window, which does
        // nothing inside an IG modal.)
        scrollCommentsToBottom();
        await sleep(1500);
        sameSignatureStreak = 0;
      }
    } else {
      sameSignatureStreak = 0;
      lastButtonSignature = sig;
    }

    for (const btn of buttons) {
      if (STOP) { exitState.reason = 'stop_requested'; exitState.finalCount = countComments(); return exitState; }
      try {
        btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
        btn.click();
      } catch (_) { /* element may have been removed mid-iteration */ }
      await sleep(700 + rand(400));
    }
  }

  // Reached the maxClicks ceiling without hitting target — also a give-up,
  // but a different reason than the no-button one (means buttons WERE being
  // found, we just hit the iteration cap).
  exitState.finalCount = countComments();
  if (exitState.reason === 'unknown') {
    exitState.reason = `max_clicks_${maxClicks}_reached`;
  }
  if (minComments > 0) {
    console.log(`[BibixCS] loadAllComments END: ${exitState.finalCount} comments in DOM, wanted ≥${minComments}, reason=${exitState.reason}`);
  }
  return exitState;
}

// Wait for this tab to actually be visible (foreground). Chrome heavily
// throttles background tabs — and IG's lazy comment loader specifically
// uses IntersectionObserver which won't fire without real visibility.
// If we don't wait, batches with concurrency > 1 burn time loading nothing.
//
// IMPORTANT: while waiting, send a keep-alive progress() every 30s. The
// background.js watchdog kills any tab that goes silent for 3 minutes,
// and a tab patiently waiting its turn in the visibility queue would
// otherwise fail with "Content script went silent for 200s". The
// heartbeat resets that watchdog so queued tabs survive until they're
// activated.
async function waitUntilVisible(reason = '') {
  if (document.visibilityState === 'visible') return;
  progress(`⏸ Tab in background — waiting for focus${reason ? ` (${reason})` : ''}…`);
  console.log(`[BibixCS] waitUntilVisible: tab in background (${document.visibilityState}), waiting…`);
  let heartbeatCount = 0;
  const heartbeat = setInterval(() => {
    heartbeatCount++;
    progress(`⏸ Still waiting for focus… (${heartbeatCount * 30}s)`);
  }, 30000);
  await new Promise((resolve) => {
    const handler = () => {
      if (document.visibilityState === 'visible') {
        document.removeEventListener('visibilitychange', handler);
        clearInterval(heartbeat);
        console.log(`[BibixCS] waitUntilVisible: tab visible after ${heartbeatCount * 30}s, resuming`);
        resolve();
      }
    };
    document.addEventListener('visibilitychange', handler);
  });
}

/* ===== LIKE COMMENTS ===== */
async function handleLikes(total, asAccount, queueItemId = null) {
  // v1.40: emit an IMMEDIATE heartbeat at function entry. Without this, a
  // fresh tab opening on a slow IG page could spend 60-90s loading the
  // post DOM before checkActiveAccount even runs, and the background
  // watchdog's 3-min silence timer would start ticking on a tab that's
  // genuinely making progress. One progress() right here keeps that timer
  // alive while the page loads.
  progress(`🚀 Tab started — target ${total} likes`);

  // Profile-switch enforcement: bail loudly if the active IG account in
  // this Chrome doesn't match the batch's as_account. Otherwise the likes
  // would silently fire under the wrong account.
  const check = checkActiveAccount(asAccount);
  if (!check.ok) {
    progress(`⛔ ${check.error}`);
    done(0, { failed: true, error: check.error });
    return;
  }

  // IG's lazy comment loader needs visibility. If our tab opened in the
  // background (which happens for items 2-N of a parallel-dispatched batch),
  // wait until the background activates us before loading.
  await waitUntilVisible('before comment load');

  // v1.45: no pre-load. Like what is already on screen; the loop below pulls
  // the next batch of comments only when it runs out of candidates.
  const loaderExit = { finalCount: countLoadedComments(), iterations: 0, reason: 'incremental' };
  let loading = false;   // a batch load is in flight — later ticks must not start another
  let dryBatches = 0;    // consecutive batches that surfaced no new comments
  let loadedPages = 0;   // how many times we successfully loaded a NEXT page

  progress("Getting post info…");
  const myUsername = getLoggedInUsername();
  const postMeta   = await getPostMeta();

  const campaignId = await startCampaign({
    type:      "like",
    myProfile: myUsername,
    requested: total,
    parentQueueId: queueItemId,
    ...postMeta,
  });

  let liked = 0;
  let consecutiveFails = 0;
  let totalAttempts    = 0;
  let totalSucceeded   = 0;
  const runStartMs     = Date.now();
  // Track by comment author (stable across IG's frequent re-renders) instead
  // of by DOM node reference — IG replaces button elements after clicks, so
  // a button-reference set will let the script re-pick the same comment and
  // *unlike* what was just liked.
  const usedAuthors    = new Set();
  // Authors whose click failed (IG didn't flip the heart — typical of rate
  // limiting). Tracked SEPARATELY so we can release them back to candidate
  // pool after a cool-off period. Without this, a 5-fail streak burns 5
  // unique candidates per successful like, exhausting the pool fast.
  const failedAuthors  = new Set();
  const followerValues = [];

  // Find the actual <button> wrapping a Like SVG, regardless of how deeply
  // nested it is (IG markup varies).
  const findLikeButton = (svg) => svg.closest('div[role="button"], button');

  // One-shot post-mortem at end of run: walks every heart icon in the DOM
  // and bucketizes why we did/didn't like it. Surfaces a human-readable
  // summary like "93 liked, 50 already-liked, 30 duplicate authors, 10 own"
  // so the user understands the gap between requested vs performed.
  const summarizeSkipReasons = () => {
    const seenAuthors = new Set();
    let total = 0, alreadyLiked = 0, ownComments = 0, duplicateAuthors = 0, noAuthor = 0;
    const hearts = document.querySelectorAll('svg[aria-label="Like"], svg[aria-label="Unlike"]');
    for (const svg of hearts) {
      const h = parseInt(svg.getAttribute('height') || '0', 10);
      if (h < 10 || h > 24) continue;
      total++;
      const btn = findLikeButton(svg);
      if (!btn) continue;
      const author = getCommentAuthor(btn);
      if (!author) { noAuthor++; continue; }
      if (svg.getAttribute('aria-label') === 'Unlike') {
        // Either we liked it this run, or someone else (a prior run) did.
        // usedAuthors tracks what WE liked this session.
        if (!usedAuthors.has(author)) alreadyLiked++;
        continue;
      }
      if (author === myUsername) { ownComments++; continue; }
      if (seenAuthors.has(author)) { duplicateAuthors++; continue; }
      seenAuthors.add(author);
    }
    return { total, alreadyLiked, ownComments, duplicateAuthors, noAuthor };
  };

  // After clicking, verify the heart actually flipped to "Unlike" within a
  // short window. If it didn't (IG silently rejected the like, button
  // re-rendered to Like state), don't count it.
  const confirmLikeStuck = async (btn) => {
    for (let i = 0; i < 8; i++) {
      const svg = btn.querySelector('svg[aria-label]');
      if (svg && svg.getAttribute('aria-label') === 'Unlike') return true;
      await sleep(250);
    }
    return false;
  };

  const timer = setInterval(async () => {
    if (STOP || liked >= total) {
      clearInterval(timer);
      const elapsedMin = Math.round((Date.now() - runStartMs) / 60000);
      await finishCampaign(campaignId, {
        completed:     liked,
        status:        STOP ? "stopped" : "done",
        notes:         `v${BIBIX_EXT_VERSION} perf=${liked}/${total} fails=${totalAttempts - totalSucceeded} min=${elapsedMin} reason=${STOP ? 'stopped_by_user' : 'target_reached'}`,
        followerStats: computeFollowerStats(followerValues),
      });
      done(liked);
      return;
    }

    // Accept any small heart SVG (height 10–24) to handle Instagram UI
    // variants. Pair each SVG with its enclosing button and the comment
    // author so we can dedupe by username, not button reference.
    const candidates = Array.from(document.querySelectorAll('svg[aria-label="Like"]'))
      .filter((svg) => {
        const h = parseInt(svg.getAttribute("height") || "0", 10);
        return h >= 10 && h <= 24;
      })
      .map((svg) => {
        const btn = findLikeButton(svg);
        if (!btn) return null;
        const author = getCommentAuthor(btn);
        return { btn, author };
      })
      .filter((entry) => entry && entry.author && !usedAuthors.has(entry.author));

    if (!candidates.length) {
      if (loading) return;   // a batch load is already running — wait for it
      // v1.45: out of candidates in what is loaded → fetch ONE more batch of
      // comments, then keep liking. The timer keeps ticking while we await;
      // `loading` makes those ticks no-ops.
      loading = true;
      let batch;
      try {
        batch = await loadMoreComments(`❤️ ${liked}/${total}`);
      } finally {
        loading = false;
      }
      loaderExit.finalCount = batch.after;
      if (batch.grew) { dryBatches = 0; loadedPages++; return; }   // new page loaded — like them on the next tick
      dryBatches++;
      if (dryBatches < MAX_DRY_BATCHES) return;
      loaderExit.reason = `exhausted_after_${dryBatches}_dry_batches`;
      {
        // We really did run out. Report partial if we did some, otherwise
        // no_targets. handleActionTabDone in background.js decides.
        clearInterval(timer);
        const skipBreakdown = summarizeSkipReasons();
        skipBreakdown.totalAttempts = totalAttempts;
        skipBreakdown.totalSucceeded = totalSucceeded;
        skipBreakdown.failedClicks = totalAttempts - totalSucceeded;
        skipBreakdown.loaderFinalCount = loaderExit.finalCount;
        skipBreakdown.loaderExitReason = loaderExit.reason;

        // Plain-English reason the run stopped short, shown in the popup so the
        // user can distinguish "IG has no more comments to load" from "IG
        // stopped accepting my likes" without opening DevTools.
        const snap = batch.snapshot || {};
        const fails = totalAttempts - totalSucceeded;
        const loaded = snap.comments != null ? snap.comments : loaderExit.finalCount;
        const btns = batch.buttonsSeenMax || 0;
        const elapsedMin = Math.round((Date.now() - runStartMs) / 60000);
        // One clean machine code (the dashboard maps it to a Result badge) +
        // a human sentence for the popup. The key distinction: if we never
        // managed to load even one extra page (loadedPages===0) on a post that
        // had more comments than we liked, that's a LOADER failure
        // (could_not_load_more), NOT "the post is small".
        let reasonCode, why;
        if (liked >= total) {
          reasonCode = 'target_reached';
          why = `✅ Done ${liked}/${total}.`;
        } else if (fails >= 5 && fails >= Math.max(5, liked * 0.4)) {
          reasonCode = 'rate_limited';
          why = `⚠️ Stopped at ${liked}/${total} — Instagram rejected ${fails} likes (rate-limit). Use a smaller batch or wait before retrying.`;
        } else if (loaded === 0) {
          reasonCode = 'no_comments_found';
          why = `⚠️ Stopped at ${liked}/${total} — no comments found on this post (comments off, or not a post page).`;
        } else if (loadedPages === 0) {
          reasonCode = 'could_not_load_more';
          why = `⚠️ Stopped at ${liked}/${total} — couldn't load more than the first ${loaded} comments. The loader can't find how to load the next page on this post's layout; Bibix is investigating.`;
        } else {
          reasonCode = 'not_enough_comments';
          why = `⚠️ Stopped at ${liked}/${total} — loaded ${loadedPages + 1} pages (${loaded} comments) and ran out; the post doesn't have enough to reach ${total}.`;
        }
        loaderExit.reason = reasonCode;
        skipBreakdown.diagnosis = why;
        skipBreakdown.snapshot = snap;

        // Persist a compact diagnosis to the campaign so we can see server-side
        // (and in the dashboard) WHY each run stopped short. `labels` carries
        // the most common button/icon names on the page, which reveals IG's
        // real "load more" control when our matcher misses it — so the loader
        // can be fixed from one query, no DevTools. Queryable via
        // instagram_campaigns.notes.
        const labels = (snap.topLabels || []).slice(0, 8).join('|').replace(/\s+/g, ' ').slice(0, 220);
        const notes = `v${BIBIX_EXT_VERSION} perf=${liked}/${total} loaded=${loaded} pages=${loadedPages} btns=${btns} fails=${fails} cont=${snap.container === 'NONE' ? 'none' : 'ok'} min=${elapsedMin} reason=${reasonCode} labels=${labels}`;
        await finishCampaign(campaignId, {
          completed:     liked,
          status:        "done",
          notes,
          followerStats: computeFollowerStats(followerValues),
        });
        progress(why);
        console.log(`[BibixCS] handleLikes summary ${notes}`, JSON.stringify(snap));
        done(liked, liked < total
          ? { exhausted: true, requested: total, skipBreakdown }
          : { skipBreakdown });
        return;
      }
    }

    const { btn, author: targetUsername } = pick(candidates);
    // Mark as used immediately so concurrent polls / re-renders don't
    // re-pick the same comment WHILE the click + confirm is in flight.
    // If the click ends up failing (IG rate-limited), we move the author
    // into failedAuthors and release after a cool-off so we don't lose
    // them as candidates forever.
    usedAuthors.add(targetUsername);
    totalAttempts++;

    // v1.49: NO per-like profile hover. IG's hover card can take up to 6s to
    // appear — or never, in a throttled/background tab — and that per-like cost
    // (purely to capture a follower number for the dashboard) was the real
    // reason big like runs never finished: at ~1–6s each, a run dies at 30–50
    // likes before the target. The backend already backfills full_name /
    // follower_count for a username from earlier scans, so we lose almost
    // nothing. Replies keep the hover — they're far fewer per run.
    const followers = null, fullName = null;

    btn.scrollIntoView({ behavior: "smooth", block: "center" });

    // v1.42 CRITICAL GUARD: re-read the heart's state RIGHT BEFORE clicking.
    // The candidate snapshot at the top of this poll was taken seconds ago.
    // Between then and now, the DOM may have changed because:
    //   • another Chrome tab open on the same post liked this comment
    //   • IG's server-side state sync flipped the local heart to Unlike
    //   • IG re-rendered the comments panel and the same author now lives
    //     under a button whose state has already toggled
    //   • the getProfileInfoByHover above (1-2s of hover wait) gave plenty
    //     of time for the DOM to shift
    //
    // Clicking a heart that's ALREADY in "Unlike" state would toggle it to
    // "Like" — which means UN-LIKING a comment we (or another tab) already
    // liked. That's the bug the user reported as "system is liking and
    // unliking the comments instead of leaving them liked".
    //
    // If the state isn't currently "Like" at click-time, skip without
    // clicking. Don't count it as a fail (which would trigger rate-limit
    // backoff) — just move on quietly.
    const svgNow = btn.querySelector('svg[aria-label]');
    const labelNow = svgNow ? svgNow.getAttribute('aria-label') : null;
    if (labelNow !== 'Like') {
      console.log(`[BibixCS] SKIP @${targetUsername} — heart no longer in Like state (now: ${labelNow || 'gone'}). DOM changed between selection and click; refusing to click and risk UN-liking.`);
      return; // Try again next tick with a fresh candidate
    }

    btn.click();

    // Confirm IG actually registered the like. If the heart didn't flip to
    // Unlike within 2s, treat it as a failed click — skip the saveAction
    // so we don't pollute instagram_actions with phantom likes.
    const stuck = await confirmLikeStuck(btn);
    if (!stuck) {
      consecutiveFails++;
      failedAuthors.add(targetUsername);
      console.log(`[BibixCS] like did NOT stick for @${targetUsername} (consecFails=${consecutiveFails}, attempts=${totalAttempts}, succeeded=${totalSucceeded})`);

      // Rate-limit detection: 5 fails in a row strongly suggests IG is
      // blocking comment likes for this account on this post. Pause 60s
      // for the limit window to roll off, then release failed authors
      // back to the candidate pool so we can retry them.
      if (consecutiveFails >= 5) {
        progress(`⏸ IG rate-limiting suspected (${consecutiveFails} consecutive fails). Pausing 60s…`);
        console.log(`[BibixCS] rate-limit backoff: pausing 60s after ${consecutiveFails} consecutive fails`);
        await sleep(60000);
        // Release the failed authors so they're candidates again.
        for (const a of failedAuthors) usedAuthors.delete(a);
        console.log(`[BibixCS] backoff complete — released ${failedAuthors.size} failed authors back to pool`);
        failedAuthors.clear();
        consecutiveFails = 0;
      }
      return;
    }

    // Success — reset the consecutive-fail counter.
    consecutiveFails = 0;
    totalSucceeded++;

    saveAction({
      action: "like",
      campaignId,
      myProfile: myUsername,
      targetUsername,
      fullName,
      followers,
      replyText: null,
      postUrl:   postMeta.postUrl,
      postOwner: postMeta.postOwner,
    });

    liked++;
    progress(`❤️ Liked ${liked}/${total}`);
  }, 1400 + rand(800));
}

/* ===== REPLY TO COMMENTS ===== */
async function handleComments(total, customReplies, useAI, asAccount, queueItemId = null) {
  // v1.40: immediate heartbeat — see handleLikes for rationale.
  progress(`🚀 Tab started — target ${total} replies`);

  // Profile-switch enforcement (same logic as handleLikes — see comment there).
  const check = checkActiveAccount(asAccount);
  if (!check.ok) {
    progress(`⛔ ${check.error}`);
    done(0, { failed: true, error: check.error });
    return;
  }

  // Visibility wait — same reason as handleLikes.
  await waitUntilVisible('before comment load');

  // v1.45: no pre-load — reply to what is on screen, load more only when the
  // loop runs out of candidates (same incremental scheme as handleLikes).
  progress("Getting post info…");
  const myUsername = getLoggedInUsername();
  const postMeta   = await getPostMeta();
  const replies    = customReplies.length ? customReplies : DEFAULT_REPLIES;

  const campaignId = await startCampaign({
    type:      "comment_reply",
    myProfile: myUsername,
    requested: total,
    parentQueueId: queueItemId,
    ...postMeta,
  });

  let replied = 0;
  // Track by comment author (stable across re-renders) plus a few empty
  // polls before giving up — IG sometimes lazy-loads comments. Mirrors the
  // robustness fix applied to handleLikes.
  const usedAuthors    = new Set();
  const followerValues = [];
  let dryBatches       = 0;

  while (!STOP && replied < total) {
    // Modern Instagram uses <div role="button"> for many interactive
    // elements, not <button>. Search both, plus generic clickable spans.
    const replyBtns = Array.from(
      document.querySelectorAll('button, [role="button"]')
    ).filter((b) => {
      const txt = (b.innerText || b.textContent || "").trim();
      if (txt !== "Reply") return false;
      const author = getCommentAuthor(b);
      if (!author) return false;
      if (usedAuthors.has(author)) return false;
      // Don't reply to your own comments
      if (myUsername && author === myUsername) return false;
      return true;
    });

    if (!replyBtns.length) {
      // Out of candidates in what is loaded → persistently load more, then retry.
      const batch = await loadMoreComments(`💬 ${replied}/${total}`);
      if (batch.grew) { dryBatches = 0; continue; }
      dryBatches++;
      if (dryBatches >= MAX_DRY_BATCHES) break;
      continue;
    }
    dryBatches = 0;

    const btn                     = pick(replyBtns);
    const targetUsername          = getCommentAuthor(btn);
    // Mark used immediately so dedup holds even if IG re-renders before
    // the action completes.
    if (targetUsername) usedAuthors.add(targetUsername);
    const usernameLink            = getUsernameLink(btn);
    const { followers, fullName } = await getProfileInfoByHover(usernameLink);

    const fNum = parseFollowerCount(followers);
    if (fNum !== null) followerValues.push(fNum);

    btn.scrollIntoView({ behavior: "smooth", block: "center" });
    btn.click();

    const typed = await waitFor(() => {
      const ta = document.querySelector('textarea[aria-label="Add a comment…"]');
      return ta && ta.value.startsWith("@") ? ta : null;
    }, 3000);

    if (!typed || STOP) break;

    let replyText;
    if (useAI) {
      progress(`🤖 Generating AI reply ${replied + 1}/${total}…`);
      const commentText = getCommentText(btn);
      // Pass full context so the backend's prompt can be tailored: whose
      // comment this is, which IG account we're acting as, who the post
      // belongs to, and the post URL.
      const aiReply = await getAIReply(commentText, {
        author:    targetUsername,
        postOwner: postMeta.postOwner,
        myProfile: myUsername,
        postUrl:   postMeta.postUrl,
      });
      replyText = typed.value.trim() + " " + (aiReply || pick(replies));
    } else {
      replyText = typed.value.trim() + " " + pick(replies);
    }

    const nativeInputSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, "value"
    ).set;
    nativeInputSetter.call(typed, replyText);
    typed.dispatchEvent(new Event("input", { bubbles: true }));
    await sleep(400);

    const postBtn = Array.from(document.querySelectorAll('[role="button"], button'))
      .find((b) => b.innerText.trim() === "Post");

    if (postBtn && !STOP) {
      postBtn.click();

      const cleanReply = replyText.replace(/^@\S+\s*/, "").trim();
      saveAction({
        action: "comment_reply",
        campaignId,
        myProfile: myUsername,
        targetUsername,
        fullName,
        followers,
        replyText: cleanReply,
        postUrl:   postMeta.postUrl,
        postOwner: postMeta.postOwner,
      });

      replied++;
      progress(`💬 Replied ${replied}/${total}`);
    }

    await sleep(3000 + rand(1000));
  }

  await finishCampaign(campaignId, {
    completed:     replied,
    status:        STOP ? "stopped" : "done",
    followerStats: computeFollowerStats(followerValues),
  });
  // Flag partial vs completed: if we replied less than requested, the
  // backend will mark the queue item 'partial' instead of 'completed' so
  // the UI doesn't lie about the result.
  done(replied, replied < total && replied > 0 ? { exhausted: true, requested: total } : {});
}

/* ===== FOLLOW PEOPLE ===== */
async function handleFollow(total) {
  progress("Looking for Follow buttons…");

  const myUsername = getLoggedInUsername();

  const campaignId = await startCampaign({
    type:        "follow",
    myProfile:   myUsername,
    requested:   total,
    contextUrl:  window.location.href,
  });

  let followed = 0;
  const used           = new Set();
  const followerValues = [];

  const timer = setInterval(async () => {
    if (STOP || followed >= total) {
      clearInterval(timer);
      await finishCampaign(campaignId, {
        completed:     followed,
        status:        STOP ? "stopped" : "done",
        followerStats: computeFollowerStats(followerValues),
      });
      done(followed);
      return;
    }

    const candidates = getFollowButtons(used);

    if (!candidates.length) {
      const scrollable = findModalScrollable();
      if (scrollable) { scrollable.scrollTop += 400; await sleep(1200); }
      else {
        clearInterval(timer);
        await finishCampaign(campaignId, {
          completed:     followed,
          status:        "done",
          followerStats: computeFollowerStats(followerValues),
        });
        done(followed);
      }
      return;
    }

    const btn                     = candidates[0];
    const targetUsername          = getUsernameFromRow(btn);
    const usernameLink            = getUsernameLink(btn);
    const { followers, fullName } = await getProfileInfoByHover(usernameLink);

    const fNum = parseFollowerCount(followers);
    if (fNum !== null) followerValues.push(fNum);

    used.add(btn);
    btn.scrollIntoView({ behavior: "smooth", block: "center" });
    btn.click();

    saveAction({
      action: "follow",
      campaignId,
      myProfile: myUsername,
      targetUsername,
      fullName,
      followers,
      replyText: null,
    });

    followed++;
    progress(`👤 Followed ${followed}/${total}`);
  }, 2000 + rand(800));
}

/* ===== UNFOLLOW PEOPLE ===== */
async function handleUnfollow(total) {
  progress("Looking for Following buttons…");

  const myUsername = getLoggedInUsername();

  const campaignId = await startCampaign({
    type:        "unfollow",
    myProfile:   myUsername,
    requested:   total,
    contextUrl:  window.location.href,
  });

  let unfollowed = 0;
  const used           = new Set();
  const followerValues = [];
  let emptyRetries     = 0;

  while (!STOP && unfollowed < total) {
    const followingBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => (b.innerText || "").trim() === "Following" && !used.has(b)
    );

    if (!followingBtn) {
      if (emptyRetries >= 12) break;          // more patience before giving up
      emptyRetries++;

      // Re-find scrollable every attempt (DOM may have changed)
      const scrollable = findModalScrollable();
      if (scrollable) {
        scrollable.scrollTop += 600;          // larger scroll step
      } else {
        window.scrollBy({ top: 600, behavior: "smooth" });
      }
      await sleep(2000);                      // wait longer for new rows to render
      continue;
    }

    emptyRetries = 0;
    const targetUsername          = getUsernameFromRow(followingBtn);
    const usernameLink            = getUsernameLink(followingBtn);
    const { followers, fullName } = await getProfileInfoByHover(usernameLink);

    const fNum = parseFollowerCount(followers);
    if (fNum !== null) followerValues.push(fNum);

    used.add(followingBtn);
    followingBtn.scrollIntoView({ behavior: "smooth", block: "center" });
    followingBtn.click();

    const confirmBtn = await waitFor(() =>
      Array.from(document.querySelectorAll("button, [role='button']")).find(
        (b) => (b.innerText || "").trim() === "Unfollow"
      ), 5000
    );

    if (!confirmBtn || STOP) break;

    confirmBtn.click();

    saveAction({
      action: "unfollow",
      campaignId,
      myProfile: myUsername,
      targetUsername,
      fullName,
      followers,
      replyText: null,
    });

    unfollowed++;
    progress(`👋 Unfollowed ${unfollowed}/${total}`);

    // After each unfollow the list shifts — scroll down to expose new entries
    await sleep(2000 + rand(800));
    const scrollable = findModalScrollable();
    if (scrollable) scrollable.scrollTop += 300;
    await sleep(800);
  }

  await finishCampaign(campaignId, {
    completed:     unfollowed,
    status:        STOP ? "stopped" : "done",
    followerStats: computeFollowerStats(followerValues),
  });
  done(unfollowed);
}

/* ===== SCAN NOTIFICATIONS ===== */
// ── Notification network interception ───────────────────────────────────────
// fetch-hook.js (MAIN world) posts intercepted notification JSON here. We
// buffer the most recent relevant payloads so handleScanNotifications can
// parse structured data (exact timestamps!) instead of scraping the DOM.
const _bibixNotifBuffer = [];
window.addEventListener('message', (ev) => {
  if (ev.source !== window) return;
  const d = ev.data;
  if (!d || d.__bibixNotif !== true || !d.json) return;
  _bibixNotifBuffer.push({ url: d.url, json: d.json, at: Date.now() });
  // Keep only the last 10 payloads.
  if (_bibixNotifBuffer.length > 10) _bibixNotifBuffer.shift();
});

// Walk an arbitrary JSON structure collecting "story"-shaped notification
// objects. IG's REST shape is { new_stories:[], old_stories:[] } where each
// story has { args: { text, timestamp, profile_name, ... } }. GraphQL shapes
// vary, so we recursively hunt for objects that have an `args.text` or a
// top-level text+timestamp pair. Defensive — never throws.
function collectNotifStories(root) {
  const out = [];
  const seen = new Set();
  const visit = (node, depth) => {
    if (!node || depth > 8 || typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const v of node) visit(v, depth + 1);
      return;
    }
    // A story-like object: has args with text, or text+timestamp directly.
    const args = node.args && typeof node.args === 'object' ? node.args : node;
    const text = typeof args.text === 'string' ? args.text
               : (typeof args.rich_text === 'string' ? args.rich_text : null);
    const ts = args.timestamp || args.created_at || node.timestamp;
    if (text && ts) {
      out.push({ args, text, timestamp: ts });
    }
    for (const k of Object.keys(node)) {
      if (k === 'args') continue;
      visit(node[k], depth + 1);
    }
  };
  try { visit(root, 0); } catch (_) {}
  return out;
}

// Strip IG's rich-text markup (it sometimes wraps the username in markers).
function cleanNotifText(t) {
  return String(t || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

// Map a story's text to our action taxonomy — same vocabulary as the DOM
// parser (parseNotificationItem), so downstream storage is identical.
function classifyNotifText(text) {
  const t = text.toLowerCase();
  if (/started following you/.test(t)) return 'new_follower';
  if (/liked your reel/.test(t)) return 'received_like_reel';
  if (/liked your (photo|post)/.test(t)) return 'received_like_post';
  if (/liked your comment/.test(t)) return 'received_like_comment';
  if (/replied to your comment/.test(t)) return 'received_reply';
  if (/mentioned you/.test(t)) return 'received_mention';
  if (/commented/.test(t)) return 'received_comment';
  if (/and \d+ others liked/.test(t)) return 'received_like_post';
  return null;
}

// Parse buffered network payloads into notification records matching the
// DOM parser's output shape. Returns [] if nothing usable was captured.
function parseNotificationsFromNetwork() {
  const records = [];
  for (const payload of _bibixNotifBuffer) {
    const stories = collectNotifStories(payload.json);
    for (const s of stories) {
      const text = cleanNotifText(s.text);
      const action = classifyNotifText(text);
      if (!action) continue;
      // Actor username: prefer structured field, else first word of text.
      let targetUsername = s.args.profile_name || s.args.username || null;
      if (!targetUsername) {
        const m = text.match(/^([a-zA-Z0-9._]+)\s/);
        targetUsername = m ? m[1] : null;
      }
      if (!targetUsername) continue;
      // Exact timestamp: IG uses seconds (sometimes float). Guard for ms.
      let tsNum = Number(s.timestamp);
      if (!Number.isFinite(tsNum)) continue;
      const ms = tsNum > 1e12 ? tsNum : tsNum * 1000; // s → ms unless already ms
      const notifDate = new Date(ms).toISOString();
      // Comment/reply text: best-effort — the part after the colon.
      let replyText = null;
      const cm = text.match(/(?:commented|replied[^:]*|comment):\s*(.+)$/i);
      if (cm) replyText = cm[1].trim();
      records.push({
        targetUsername: String(targetUsername).replace(/^@/, '').toLowerCase(),
        action,
        text: replyText,
        postUrl: null,        // media→shortcode mapping is non-trivial; left null
        postOwner: null,
        notifDate,
      });
    }
  }
  // Dedup within this batch by username+action+text.
  const seen = new Set();
  return records.filter(r => {
    const k = `${r.targetUsername}::${r.action}::${(r.text || '').slice(0, 40)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

async function handleScanNotifications(autoOpen = false) {
  // When invoked from an automation (autoOpen=true), the page just loaded
  // and the Notifications panel is not open. Click the sidebar's heart icon
  // ourselves so the user doesn't have to. IG renders this as an svg with
  // aria-label="Notifications" inside a clickable link/button.
  if (autoOpen) {
    progress("Opening notifications panel…");
    const clickNotifIcon = () => {
      // Multiple aria-label variants seen across IG versions/locales.
      const candidates = Array.from(document.querySelectorAll(
        'svg[aria-label="Notifications"], svg[aria-label="Notificaciones"], svg[aria-label*="otifica" i]'
      ));
      for (const svg of candidates) {
        const btn = svg.closest('a, [role="link"], button, div[role="button"]');
        if (btn) { btn.click(); return true; }
      }
      return false;
    };
    let clicked = false;
    // Retry for ~12s — page may still be hydrating.
    for (let i = 0; i < 20; i++) {
      if (clickNotifIcon()) { clicked = true; break; }
      await sleep(600);
    }
    if (!clicked) {
      progress("❌ Couldn't find Notifications icon in sidebar");
      await sleep(2000);
      done();
      return;
    }
    // Wait for the panel to slide in and start rendering items.
    await sleep(2500);
  }

  progress("Looking for notifications panel…");

  // Retry finding the container a few times in case it's still rendering
  let container = null;
  for (let i = 0; i < 5; i++) {
    container = findNotificationsContainer();
    if (container) break;
    await sleep(800);
  }

  if (!container) {
    progress("❌ Open the Notifications panel first, then click Scan.");
    await sleep(3000);
    done();
    return;
  }

  // ── Optimistic network-interception try ─────────────────────────────────
  // The MAIN-world fetch hook forwards intercepted IG notification API
  // responses into _bibixNotifBuffer. We do a quick check (no wait, no
  // extra scrolling): if anything's already in the buffer from the natural
  // page activity, use it; otherwise fall through to DOM scraping below
  // without paying the wait cost. (IG's current notif data isn't fetched
  // via window.fetch on the activity panel, so this path is dormant for
  // now — kept for the day IG changes their data flow.)
  const myUsernameEarly = getLoggedInUsername();
  const netRecords = parseNotificationsFromNetwork();
  console.log(`[BibixCS] notification network capture: ${_bibixNotifBuffer.length} payload(s), ${netRecords.length} record(s)`);
  if (_bibixNotifBuffer.length > 0) {
    // Log the first payload's top-level keys so we can refine the parser.
    try { console.log('[BibixCS] sample notif payload keys:', Object.keys(_bibixNotifBuffer[0].json || {})); } catch (_) {}
  }

  if (netRecords.length > 0) {
    progress(`📡 Network: ${netRecords.length} notifications. Saving…`);
    const existingLogN = await new Promise((resolve) =>
      chrome.runtime.sendMessage({ action: "GET_LOG" }, ({ log }) => resolve(log || []))
    );
    const seenN = new Set(existingLogN.map(notifFingerprint));
    let savedN = 0, skippedN = 0;
    for (const notif of netRecords) {
      if (STOP) break;
      const fp = notifFingerprint({
        targetUsername: notif.targetUsername,
        action: notif.action,
        postUrl: notif.postUrl || null,
        replyText: notif.text || null,
      });
      if (seenN.has(fp)) { skippedN++; continue; }
      seenN.add(fp);
      saveAction({
        action: notif.action,
        myProfile: myUsernameEarly,
        targetUsername: notif.targetUsername,
        fullName: null,
        followers: null,
        replyText: notif.text || null,
        postUrl: notif.postUrl || null,
        postOwner: notif.postOwner || null,
        date: notif.notifDate,
      });
      savedN++;
      progress(`🔔 (network) Saved ${savedN} · skipped ${skippedN}…`);
      await sleep(120);
    }
    progress(`✅ Done (network)! ${savedN} new, ${skippedN} duplicates. Exact timestamps ✓`);
    await sleep(2500);
    done();
    return;
  }

  // ── Fallback: DOM scraping (original path) ────────────────────────────────
  progress("Network capture empty — using DOM scan…");

  // Load existing log to build a deduplication fingerprint set
  // (we can't use dates because relative timestamps shift every scan)
  progress("Checking existing records…");
  const existingLog = await new Promise((resolve) =>
    chrome.runtime.sendMessage({ action: "GET_LOG" }, ({ log }) => resolve(log || []))
  );
  const seenFingerprints = new Set(existingLog.map(notifFingerprint));

  // Scroll down to load all notifications, then back to top
  progress("Loading notifications…");
  const scrollable = findScrollable(container);
  for (let i = 0; i < 8; i++) {
    if (STOP) break;
    scrollable.scrollTop += 700;
    await sleep(800);
  }
  scrollable.scrollTop = 0;
  await sleep(600);

  const items = getNotificationItems(container);
  progress(`Found ${items.length} notifications. Extracting info…`);

  const myUsername = getLoggedInUsername();
  let saved   = 0;
  let skipped = 0;

  for (const item of items) {
    if (STOP) break;

    const notif = parseNotificationItem(item);
    if (!notif.targetUsername || !notif.action) continue;

    // Build a fingerprint before hovering to skip early
    const fp = notifFingerprint({
      targetUsername: notif.targetUsername,
      action:         notif.action,
      postUrl:        notif.postUrl || null,
      replyText:      notif.text   || null,
    });

    if (seenFingerprints.has(fp)) {
      skipped++;
      progress(`⏭️ ${skipped} duplicates skipped, ${saved} new so far…`);
      continue;
    }

    // Mark as seen immediately so duplicates within the same scan are also caught
    seenFingerprints.add(fp);

    // Skip the per-notification hover. Hovering each username to read
    // follower count + full name was the bottleneck — ~800ms per item,
    // 12+ items = 10+ seconds for hovers alone. The dashboard works fine
    // without follower count in the notification feed itself; if we
    // really want it later, we can enrich asynchronously via the
    // accounts list / a one-off backfill.
    const followers = null;
    const fullName = null;

    saveAction({
      action:         notif.action,
      myProfile:      myUsername,
      targetUsername: notif.targetUsername,
      fullName,
      followers,
      replyText:  notif.text     || null,
      postUrl:    notif.postUrl  || null,
      postOwner:  notif.postOwner || null,
      date:       notif.notifDate,   // actual notification date, not scan date
    });

    saved++;
    progress(`🔔 Saved ${saved} new · skipped ${skipped} duplicates…`);
    // Tiny pacing only — we removed the hover, so we don't need the
    // human-ish 600-900ms gap. 80ms keeps the popup progress readable.
    await sleep(80);
  }

  progress(`✅ Done! ${saved} new notifications saved, ${skipped} duplicates skipped.`);
  await sleep(2500);
  done();
}

// Fingerprint for deduplication — deliberately excludes date because
// Instagram's relative timestamps ("7m", "1h") shift on every scan.
function notifFingerprint(r) {
  return [
    (r.targetUsername || "").toLowerCase(),
    r.action || "",
    r.postUrl || "",
    (r.replyText || "").slice(0, 60),
  ].join("::");
}

function findNotificationsContainer() {
  // Find any element whose direct text is exactly "Notifications"
  for (const el of document.querySelectorAll("*")) {
    const t = (el.childNodes.length === 1 && el.childNodes[0].nodeType === 3)
      ? (el.textContent || "").trim()
      : (el.innerText || "").trim();
    if (t === "Notifications") {
      // Walk up until we hit a sizeable panel
      let node = el.parentElement;
      for (let i = 0; i < 20; i++) {
        if (!node) break;
        const rect = node.getBoundingClientRect();
        if (rect.height > 400 && rect.width > 200) return node;
        node = node.parentElement;
      }
    }
  }
  return null;
}

function findScrollable(container) {
  // Check if the container itself scrolls
  if (container.scrollHeight > container.clientHeight) return container;
  for (const el of container.querySelectorAll("*")) {
    const s = window.getComputedStyle(el);
    if (
      (s.overflowY === "scroll" || s.overflowY === "auto") &&
      el.scrollHeight > el.clientHeight + 10
    ) return el;
  }
  return container;
}

function getNotificationItems(container) {
  const ACTION_KEYWORDS = ["liked", "following", "replied", "commented", "mentioned"];

  // Deduplicate by DOM element reference AND by username+action text
  const seenElements = new WeakSet();
  const seenKeys     = new Set();
  const results      = [];

  const profileLinks = Array.from(container.querySelectorAll("a[href]")).filter(
    (a) => /^\/[a-zA-Z0-9._]+\/?$/.test(a.getAttribute("href"))
  );

  for (const link of profileLinks) {
    let el = link.parentElement;
    for (let i = 0; i < 8; i++) {
      if (!el || el === container) break;
      const text = (el.innerText || "").replace(/\s+/g, " ").trim();
      const rect = el.getBoundingClientRect();

      if (
        rect.width > 150 &&
        rect.height > 20 &&
        rect.height < 250 &&
        ACTION_KEYWORDS.some((k) => text.toLowerCase().includes(k))
      ) {
        // Skip if we've already added this exact DOM element
        if (!seenElements.has(el)) {
          seenElements.add(el);

          // Also skip if same username + action text (catches rows at different ancestor levels)
          const username = link.getAttribute("href").replace(/\//g, "");
          const actionSnippet = text.slice(0, 80);
          const key = `${username}::${actionSnippet}`;

          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            results.push(el);
          }
        }
        break;
      }
      el = el.parentElement;
    }
  }

  return results;
}

function parseNotificationItem(item) {
  const text = (item.innerText || "").replace(/\s+/g, " ").trim();

  // Username: first profile link in the item
  const usernameLink = Array.from(item.querySelectorAll("a[href]")).find(
    (a) => /^\/[a-zA-Z0-9._]+\/?$/.test(a.getAttribute("href"))
  );
  const targetUsername = usernameLink?.getAttribute("href")
    ?.match(/^\/([a-zA-Z0-9._]+)\/?$/)?.[1] || null;

  // Post URL: link to /p/ or /reel/
  const postLink = Array.from(item.querySelectorAll("a[href]")).find(
    (a) => /\/p\/|\/reel\//.test(a.getAttribute("href") || "")
  );
  const postUrl = postLink
    ? "https://www.instagram.com" + postLink.getAttribute("href")
    : null;

  // Timestamp: last token matching e.g. "7m", "1h", "23h", "1d", "2w"
  const timeMatch = text.match(/\b(\d+\s*[smhdw])\s*$/i);
  const relativeTime = timeMatch?.[1]?.replace(/\s/g, "") || null;
  const notifDate = parseRelativeTime(relativeTime);

  let action = null;
  let notifText = null;
  let postOwner = null;

  if (/started following you/i.test(text)) {
    action = "new_follower";

  } else if (/liked your reel/i.test(text)) {
    action = "received_like_reel";

  } else if (/liked your post/i.test(text)) {
    action = "received_like_post";

  } else if (/liked your comment/i.test(text)) {
    action = "received_like_comment";
    const m = text.match(/liked your comment:\s*@\S+\s+(.+?)(?:\s+\d+\s*[smhdw])?$/i);
    notifText = m?.[1]?.trim() || null;

  } else if (/commented:/i.test(text)) {
    action = "received_comment";
    const m = text.match(/commented:\s*(.+?)(?:\s+\d+\s*[smhdw])?$/i);
    notifText = m?.[1]?.trim() || null;

  } else if (/commented on your post/i.test(text)) {
    action = "received_comment";
    const m = text.match(/commented on your post:\s*(.+?)(?:\s+\d+\s*[smhdw])?$/i);
    notifText = m?.[1]?.trim() || null;

  } else if (/replied to your comment/i.test(text)) {
    action = "received_reply";
    const ownerMatch = text.match(/on\s+([\w.]+)'s\s+post/i);
    postOwner = ownerMatch?.[1] || null;
    const m = text.match(/post:\s*@\S+\s+(.+?)(?:\s+\d+\s*[smhdw])?$/i);
    notifText = m?.[1]?.trim() || null;

  } else if (/mentioned you/i.test(text)) {
    action = "received_mention";
    const m = text.match(/mentioned you[^:]*:\s*(.+?)(?:\s+\d+\s*[smhdw])?$/i);
    notifText = m?.[1]?.trim() || null;

  } else if (/and \d+ others liked/i.test(text)) {
    action = "received_like_post";

  }

  return { targetUsername, usernameLink, action, text: notifText, postUrl, postOwner, notifDate };
}

// Convert Instagram's relative timestamp ("7m", "1h", "23h", "1d", "2w") to an ISO date string
function parseRelativeTime(timeStr) {
  const now = new Date();
  if (!timeStr) return now.toISOString();

  const match = timeStr.match(/^(\d+)([smhdw])$/i);
  if (!match) return now.toISOString();

  const value = parseInt(match[1]);
  const unit  = match[2].toLowerCase();

  const msMap = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
  };

  return new Date(now.getTime() - value * (msMap[unit] || 0)).toISOString();
}

/* ===== DATABASE ===== */
function saveAction({ action, myProfile, targetUsername, fullName, followers, replyText, postUrl, postOwner, date, campaignId }) {
  const record = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    date: date || new Date().toISOString(),   // use notification date if provided
    scanDate: new Date().toISOString(),        // always record when it was scanned
    myProfile: myProfile || "unknown",
    action,
    targetUsername: targetUsername || "unknown",
    fullName: fullName || null,
    followers: followers || null,
    replyText: replyText || null,
    postUrl: postUrl || null,
    postOwner: postOwner || null,
    campaignId: campaignId || null,
  };
  chrome.runtime.sendMessage({ action: "SAVE_ACTION", record });
}

/* ===== HELPERS ===== */

// Get username from a follow/unfollow row in the modal
function getUsernameFromRow(btn) {
  let el = btn.parentElement;
  for (let i = 0; i < 6; i++) {
    if (!el) break;
    const link = Array.from(el.querySelectorAll("a[href]")).find(
      (a) => /^\/[a-zA-Z0-9._]+\/?$/.test(a.getAttribute("href"))
    );
    if (link) {
      const match = link.getAttribute("href").match(/^\/([a-zA-Z0-9._]+)\/?$/);
      if (match) return match[1];
    }
    el = el.parentElement;
  }
  return null;
}

// Get username from a comment's like/reply button
function getCommentAuthor(btn) {
  const usernamePattern = /^\/([a-zA-Z0-9._]+)\/?$/;

  // Strategy 1: find nearest <li> or listitem (comment container) and get first username link
  const li = btn.closest('li') || btn.closest('[role="listitem"]');
  if (li) {
    const links = Array.from(li.querySelectorAll('a[href]')).filter(
      a => usernamePattern.test(a.getAttribute('href'))
    );
    if (links.length) {
      const m = links[0].getAttribute('href').match(usernamePattern);
      if (m) return m[1];
    }
  }

  // Strategy 2: walk up DOM up to 25 levels, stop at first level that has a username link
  let el = btn.parentElement;
  for (let i = 0; i < 25; i++) {
    if (!el) break;
    const links = Array.from(el.querySelectorAll('a[href]')).filter(
      a => usernamePattern.test(a.getAttribute('href'))
    );
    if (links.length) {
      const m = links[0].getAttribute('href').match(usernamePattern);
      if (m) return m[1];
    }
    el = el.parentElement;
  }

  // Strategy 3: check aria-label attributes near the button for "username's ..." pattern
  let ariaEl = btn;
  for (let i = 0; i < 10; i++) {
    if (!ariaEl) break;
    for (const node of ariaEl.querySelectorAll('[aria-label]')) {
      const lbl = node.getAttribute('aria-label') || '';
      const m = lbl.match(/^([a-zA-Z0-9._]+)'s/i);
      if (m && m[1].length > 1) return m[1];
    }
    ariaEl = ariaEl.parentElement;
  }

  return null;
}

// Get the username <a> link element near a button (for hover card)
function getUsernameLink(btn) {
  const usernamePattern = /^\/[a-zA-Z0-9._]+\/?$/;

  // Strategy 1: nearest <li> container
  const li = btn.closest('li') || btn.closest('[role="listitem"]');
  if (li) {
    const link = Array.from(li.querySelectorAll('a[href]')).find(
      a => usernamePattern.test(a.getAttribute('href'))
    );
    if (link) return link;
  }

  // Strategy 2: walk up DOM
  let el = btn.parentElement;
  for (let i = 0; i < 25; i++) {
    if (!el) break;
    const link = Array.from(el.querySelectorAll('a[href]')).find(
      a => usernamePattern.test(a.getAttribute('href'))
    );
    if (link) return link;
    el = el.parentElement;
  }

  return null;
}

// Hover over a username link, wait for Instagram's profile hover card,
// extract { followers, fullName } from NEWLY added DOM nodes only
async function getProfileInfoByHover(link) {
  if (!link) return { followers: null, fullName: null };

  return new Promise((resolve) => {
    let resolved = false;

    const finish = (value) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      observer.disconnect();
      link.dispatchEvent(new MouseEvent("mouseleave",    { bubbles: true }));
      link.dispatchEvent(new MouseEvent("mouseout",      { bubbles: true }));
      link.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
      link.dispatchEvent(new PointerEvent("pointerout",   { bubbles: true }));
      setTimeout(() => resolve(value), 150);
    };

    const timer = setTimeout(() => finish({ followers: null, fullName: null }), 6000);

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;

          const info = extractProfileInfo(node.innerText || node.textContent || "");
          if (info) { finish(info); return; }

          if (node.querySelectorAll) {
            for (const child of node.querySelectorAll("*")) {
              const info2 = extractProfileInfo(child.innerText || child.textContent || "");
              if (info2) { finish(info2); return; }
            }
          }
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    link.dispatchEvent(new MouseEvent("mouseover",   { bubbles: true, cancelable: true }));
    link.dispatchEvent(new MouseEvent("mouseenter",  { bubbles: true, cancelable: true }));
    link.dispatchEvent(new PointerEvent("pointerover",  { bubbles: true, cancelable: true }));
    link.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true, cancelable: true }));
  });
}

// Parse the hover card text to get followers + full name
// Card text looks like: "username\nFull Name\n0\nposts\n48\nfollowers\n118\nfollowing"
function extractProfileInfo(text) {
  if (!text || text.length > 700) return null;
  if (!text.includes("followers") || !text.includes("posts")) return null;

  // Follower count
  const followersMatch =
    text.match(/([\d,]+)\s*\nfollowers/i) ||
    text.match(/([\d,.]+[KkMm]?)\s*followers/i);
  const followers = followersMatch ? followersMatch[1].replace(/,/g, "") : null;

  // Full name: a line that has a space, no digits at start, not a stat keyword
  const skipWords = ["posts", "followers", "following", "no posts", "shares", "you'll", "threads"];
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 1);
  let fullName = null;
  for (const line of lines) {
    if (
      line.includes(" ") &&
      !/^\d/.test(line) &&
      line.length < 60 &&
      !skipWords.some((w) => line.toLowerCase().includes(w))
    ) {
      fullName = line;
      break;
    }
  }

  return { followers, fullName };
}

// Get the URL of the current post
function getPostUrl() {
  return window.location.href;
}

// Get the username of the post owner
function getPostOwner() {
  // IG removed the legacy <article> wrapper on logged-in single-post views,
  // so the historical "first link inside article" trick returns null. The
  // canonical og:url meta tag, however, is rendered server-side and reliably
  // includes the username in the path (e.g. /ggiuliafetescu/p/SHORTCODE/).
  // Strategy 1: og:url → /USERNAME/p|reel|tv/SHORTCODE/
  try {
    const og = document.querySelector('meta[property="og:url"]')?.getAttribute("content") || "";
    const m = og.match(/^https?:\/\/(?:www\.)?instagram\.com\/([a-zA-Z0-9._]+)\/(?:p|reel|tv)\//i);
    if (m && m[1] !== "p" && m[1] !== "reel" && m[1] !== "tv") return m[1];
  } catch (_) {}

  // Strategy 2: locate the Follow / Following button and walk up to find the
  // adjacent username link. This works on logged-in feed/single-post views
  // where the button sits next to the owner's @handle.
  try {
    const followBtn = Array.from(document.querySelectorAll('button, [role="button"]'))
      .find(b => /^\s*(Follow|Following|Requested)\s*$/i.test((b.textContent || "").trim()));
    if (followBtn) {
      let p = followBtn;
      for (let i = 0; i < 8 && p; i++) {
        const link = Array.from(p.querySelectorAll("a[href]")).find(
          a => /^\/[a-zA-Z0-9._]+\/?$/.test(a.getAttribute("href") || "")
        );
        if (link) {
          const m = link.getAttribute("href").match(/^\/([a-zA-Z0-9._]+)\/?$/);
          if (m) return m[1];
        }
        p = p.parentElement;
      }
    }
  } catch (_) {}

  // Strategy 3: scan visible text for "More posts from USERNAME" which IG
  // renders at the bottom of single-post views.
  try {
    const txt = document.body?.innerText || "";
    const m = txt.match(/(?:More posts from|Posts from)\s+([a-zA-Z0-9._]+)/i);
    if (m) return m[1];
  } catch (_) {}

  // Strategy 4 (legacy fallback): <article>-scoped header link.
  try {
    const article = document.querySelector("article");
    if (article) {
      const header = article.querySelector("header");
      if (header) {
        const link = Array.from(header.querySelectorAll("a[href]")).find(
          a => /^\/[a-zA-Z0-9._]+\/?$/.test(a.getAttribute("href"))
        );
        if (link) {
          const m = link.getAttribute("href").match(/^\/([a-zA-Z0-9._]+)\/?$/);
          if (m) return m[1];
        }
      }
    }
  } catch (_) {}

  // Strategy 5: heading link (some single-post views).
  for (const el of document.querySelectorAll("h1 a, h2 a")) {
    const match = el.getAttribute("href")?.match(/^\/([a-zA-Z0-9._]+)\/?$/);
    if (match) return match[1];
  }
  return null;
}

// Extract comment text for AI
// Extract just the comment BODY for a Reply/Like button — not the username,
// timestamp, like-count, or action-bar chrome around it. The old version
// joined every span in the row, so the model was fed
// "carlos 2w All the covers are wonderful Reply 4 likes" and replied vaguely.
// We drop UI keywords, relative timestamps, like counts and the author's own
// name, then take the LONGEST remaining leaf-text — the comment is almost
// always the longest real text in its row.
function getCommentText(replyBtn) {
  const author = (getCommentAuthor(replyBtn) || "").replace(/^@/, "").toLowerCase();
  const isJunk = (t) => {
    const s = t.trim();
    if (s.length < 2) return true;
    if (/^(reply|like|liked|translate|see translation|edited|author|follow|following|verified|pinned|hide replies)$/i.test(s)) return true;
    if (/^view( all)?( \d[\d,]*)?( replies?)?$/i.test(s)) return true;
    if (/^\d+\s*[wdhms]$/i.test(s)) return true;                 // "2w", "13h", "45m"
    if (/^\d[\d,.]*\s*(likes?|replies?)$/i.test(s)) return true; // "4 likes", "2 replies"
    if (s === "·" || s === "•") return true;
    if (s.replace(/^@/, "").toLowerCase() === author) return true; // the commenter's handle
    return false;
  };
  let el = replyBtn.parentElement;
  for (let i = 0; i < 10 && el; i++, el = el.parentElement) {
    const texts = Array.from(el.querySelectorAll("span"))
      .filter((s) => s.children.length === 0)
      .map((s) => (s.innerText || "").trim())
      .filter((t) => t && !isJunk(t));
    if (texts.length) {
      const body = texts.sort((a, b) => b.length - a.length)[0]; // longest = the comment
      if (body && body.length >= 2) return body.slice(0, 400);
    }
  }
  return "";
}

// Detect logged-in username
function getLoggedInUsername() {
  try {
    const scripts = Array.from(document.querySelectorAll("script[type='application/json']"));
    for (const s of scripts) {
      const match = s.textContent.match(/"username"\s*:\s*"([^"]+)"/);
      if (match) return match[1];
    }
  } catch {}
  const navEl = document.querySelector('nav, [role="navigation"], header');
  if (navEl) {
    for (const link of navEl.querySelectorAll('a[href]')) {
      const match = link.getAttribute("href")?.match(/^\/([a-zA-Z0-9._]+)\/?$/);
      if (match) {
        const skip = ["explore","reels","direct","stories","accounts","p","tv","reel",""];
        if (!skip.includes(match[1])) return match[1];
      }
    }
  }
  return null;
}

// Ask background.js to call Groq API
// Fetch an AI-generated reply via background → backend. Background calls
// /api/ai/reply which routes to the user's configured provider (OpenAI /
// Groq / Claude / Gemini / Grok / Perplexity / Z.AI / Mistral / DeepSeek).
// Returns the reply text or null on failure (caller falls back to default).
function getAIReply(commentText, opts = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      {
        action: "GET_AI_REPLY",
        comment: commentText || "",
        author:    opts.author    || null,
        postOwner: opts.postOwner || null,
        myProfile: opts.myProfile || null,
        postUrl:   opts.postUrl   || null,
      },
      (res) => resolve(res?.reply || null)
    );
  });
}

function getFollowButtons(used) {
  return Array.from(document.querySelectorAll("button")).filter((el) => {
    if (used.has(el)) return false;
    const text = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
    return text === "Follow" || text === "Follow Back";
  });
}

function findModalScrollable() {
  // 1. Look inside any open dialog
  const dialog = document.querySelector('div[role="dialog"]');
  if (dialog) {
    for (const el of dialog.querySelectorAll("*")) {
      const s = window.getComputedStyle(el);
      if ((s.overflowY === "scroll" || s.overflowY === "auto") && el.scrollHeight > el.clientHeight + 10)
        return el;
    }
    if (dialog.scrollHeight > dialog.clientHeight + 10) return dialog;
  }

  // 2. Walk up from a "Following" / "Follow" button to find its scrollable ancestor
  const refBtn = Array.from(document.querySelectorAll("button")).find(
    (b) => ["Following", "Follow", "Follow Back"].includes((b.innerText || "").trim())
  );
  if (refBtn) {
    let el = refBtn.parentElement;
    for (let i = 0; i < 12; i++) {
      if (!el || el === document.body) break;
      const s = window.getComputedStyle(el);
      if ((s.overflowY === "scroll" || s.overflowY === "auto") && el.scrollHeight > el.clientHeight + 10)
        return el;
      el = el.parentElement;
    }
  }

  return dialog || null;
}

/* ===== REPLY DMs ===== */
async function handleReplyDMs(count) {
  progress("Looking for DM conversations…");

  if (!window.location.href.includes("/direct/")) {
    progress("❌ Open Instagram Direct Messages first, then click Reply DMs.");
    await sleep(3000);
    done();
    return;
  }

  // Scroll to top of DM list first
  window.scrollTo(0, 0);
  await sleep(800);

  // ── Scroll the conversation list panel to load more conversations ──────
  // Instagram uses virtual scrolling — only ~10 items are in the DOM at once.
  // We scroll the left panel to force more conversations to render.
  progress("Loading conversation list…");
  const listContainer = findDMListContainer();
  if (listContainer) {
    // Scroll down to load conversations up to count * 3 (extra buffer)
    for (let s = 0; s < 20; s++) {
      const before = getAllDMConversationLinks().length;
      listContainer.scrollBy({ top: 500, behavior: "smooth" });
      await sleep(600);
      const after = getAllDMConversationLinks().length;
      if (after >= count * 3) break;
      if (after === before && s > 3) break; // no new items loaded
    }
    // Scroll back to top so we click conversations in order
    listContainer.scrollTo({ top: 0, behavior: "smooth" });
    await sleep(500);
  }

  const allLinks = getAllDMConversationLinks();

  if (!allLinks.length) {
    progress("❌ No conversations found. Make sure you're on the Direct Messages page.");
    await sleep(4000);
    done();
    return;
  }

  progress(`Found ${allLinks.length} conversation(s). Scanning for ones needing a reply…`);
  await sleep(500);

  const myUsername = getLoggedInUsername();
  let replied = 0;
  let checked = 0;

  for (const { link, threadId } of allLinks) {
    if (STOP || replied >= count) break;

    checked++;
    progress(`🔍 Checking conversation ${checked}/${allLinks.length}…`);

    link.click();
    await sleep(2500);

    // Wait for message content to appear
    await waitFor(
      () => document.querySelector('div[dir="auto"][class], div[role="row"], div[data-lexical-editor]'),
      5000
    );
    await sleep(800);

    const messages = getConversationMessages();
    const targetUsername = getOpenConversationUsername();

    // Only reply when the last classified message was clearly received (from them).
    // "sent" → we already replied, skip.
    // null  → direction undetectable (safe default: skip and wait).
    if (messages.lastDir !== "received") {
      const reason = messages.lastDir === "sent" ? "last message is ours" : "direction unclear";
      progress(`⏭ @${targetUsername || "?"}: ${reason} — skipping.`);
      await sleep(400);
      continue;
    }

    progress(`💬 @${targetUsername || "?"}: "${(messages.lastReceived || "…").slice(0, 40)}" — generating reply…`);
    await sleep(400);

    const ai = await getAIDMReply(messages, { myProfile: myUsername, theirUsername: targetUsername });
    const replyText = ai.reply;

    if (!replyText && !ai.mediaUrl) {
      progress(`⚠️ AI reply failed (set a default provider in Settings → AI providers) — skipping.`);
      await sleep(1000);
      continue;
    }

    let sent = false;
    if (replyText) {
      progress(`✍️ Typing: "${replyText.slice(0, 50)}"`);
      await sleep(400);
      sent = await typeAndSendDM(replyText);
    }

    // If the bot chose to send a photo/video, attach + send it after the text.
    if (ai.mediaUrl) {
      progress(`📎 @${targetUsername || "?"}: sending media…`);
      try {
        const file = await fetchDmMediaFile(ai.mediaUrl);
        if (file) { const okMedia = await sendDMMedia(file); sent = sent || okMedia; }
      } catch (e) { console.warn('[BibixCS] DM media send error', e); }
    }

    if (!sent) {
      progress(`⚠️ Couldn't send the reply — skipping.`);
      await sleep(1000);
      continue;
    }

    saveAction({
      action:         "dm_reply",
      myProfile:      myUsername,
      targetUsername: targetUsername || "unknown",
      fullName:       null,
      followers:      null,
      replyText,
      postUrl:        window.location.href,
      postOwner:      null,
    });

    replied++;
    progress(`✉️ Replied ${replied}/${count} — @${targetUsername || "?"}`);
    await sleep(3000 + rand(1500));
  }

  progress(`✅ Done! Replied to ${replied} DM${replied !== 1 ? "s" : ""}.`);
  await sleep(2500);
  done();
}

/* ── Find the scrollable container of the DM conversation list ── */
function findDMListContainer() {
  // Walk up from the first conversation link to find the scrollable left panel
  const firstLink = document.querySelector('a[href*="/direct/t/"], a[href^="/direct/"]');
  if (!firstLink) return null;

  let node = firstLink.parentElement;
  for (let i = 0; i < 12; i++) {
    if (!node || node === document.body) break;
    const style = window.getComputedStyle(node);
    const rect  = node.getBoundingClientRect();
    // The list panel: scrollable, left side of screen, tall
    if (
      (style.overflowY === "auto" || style.overflowY === "scroll") &&
      rect.height > 200 &&
      rect.left < window.innerWidth * 0.5   // it's in the left half
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

/* ── Get all DM conversation links from the inbox list ── */
function getAllDMConversationLinks() {
  const seen  = new Set();
  const links = [];

  // Strategy 1 – standard /direct/t/ links (classic Instagram web)
  for (const a of document.querySelectorAll('a[href*="/direct/t/"]')) {
    const href  = a.getAttribute("href") || "";
    const match = href.match(/\/direct\/t\/([^/]+)/);
    if (!match) continue;
    const threadId = match[1];
    if (seen.has(threadId)) continue;
    seen.add(threadId);

    const rect = a.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;  // completely hidden

    links.push({ link: a, href, threadId });
  }

  // Strategy 2 – /direct/<numericId>/ or /direct/inbox/<id>/ variants
  if (!links.length) {
    for (const a of document.querySelectorAll('a[href^="/direct/"]')) {
      const href  = a.getAttribute("href") || "";
      // Skip inbox, new, requests pages
      if (/\/direct\/(inbox|new|requests)\/?$/.test(href)) continue;
      const match = href.match(/\/direct\/(?:t\/)?([^/]+)\/?$/);
      if (!match) continue;
      const threadId = match[1];
      if (seen.has(threadId)) continue;
      seen.add(threadId);

      const rect = a.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;

      links.push({ link: a, href, threadId });
    }
  }

  // Strategy 3 – clickable row elements in the DM list (Instagram sometimes uses divs)
  if (!links.length) {
    const rowCandidates = Array.from(
      document.querySelectorAll('div[role="button"], div[tabindex="0"], li')
    ).filter(el => {
      const rect = el.getBoundingClientRect();
      // Conversation rows: full-width of the panel, typical row height 60-100px
      return rect.width > 100 && rect.height >= 50 && rect.height <= 120 &&
             el.querySelector('img[alt]');    // has an avatar image
    });

    rowCandidates.forEach((el, i) => {
      const key = `row_${i}`;
      if (seen.has(key)) return;
      seen.add(key);
      links.push({ link: el, href: "", threadId: key });
    });
  }

  return links;
}

/* ── Find unread DM conversations (legacy, kept for reference) ── */
function findUnreadDMs(maxCount) {
  const results = [];
  const seenIds = new Set();

  // ── Strategy A: anchor links to /direct/t/ ──
  const allLinks = Array.from(document.querySelectorAll('a[href*="/direct/t/"]'));

  for (const link of allLinks) {
    const href  = link.getAttribute("href") || "";
    const match = href.match(/\/direct\/t\/([^/]+)/);
    if (!match) continue;
    const threadId = match[1];
    if (seenIds.has(threadId)) continue;
    seenIds.add(threadId);

    // The blue dot is a SIBLING of the <a> tag, so it lives in link.parentElement.
    // We must start checking AT link.parentElement (not skip it!).
    // Walk up checking each level until we either find a match or hit the page container.
    let found = false;
    let node  = link.parentElement || link;

    for (let i = 0; i < 8; i++) {
      if (!node || node === document.body) break;

      if (dmRowIsUnread(node, link)) {
        found = true;
        break;
      }

      // Stop if we've walked up into the full-page list container
      const r = node.getBoundingClientRect();
      if (r.width >= window.innerWidth * 0.9 && r.height > 300) break;

      node = node.parentElement;
    }

    if (found) {
      results.push({ link, href, threadId });
      if (results.length >= maxCount) break;
    }
  }

  // ── Strategy B: find "N new messages" text anywhere and trace back ──
  if (results.length < maxCount) {
    const newMsgNodes = Array.from(document.querySelectorAll("*")).filter(el =>
      el.childElementCount === 0 &&
      /\d+\s*new\s*message/i.test((el.innerText || "").trim())
    );

    for (const node of newMsgNodes) {
      let ancestor = node.parentElement;
      for (let i = 0; i < 12 && ancestor && ancestor !== document.body; i++) {
        const convLink = ancestor.querySelector('a[href*="/direct/t/"]');
        if (convLink) {
          const h = convLink.getAttribute("href") || "";
          const m = h.match(/\/direct\/t\/([^/]+)/);
          if (m && !seenIds.has(m[1])) {
            seenIds.add(m[1]);
            results.push({ link: convLink, href: h, threadId: m[1] });
          }
          break;
        }
        ancestor = ancestor.parentElement;
      }
      if (results.length >= maxCount) break;
    }
  }

  return results;
}

/* Detect unread signals in a DOM node and its descendants */
function dmRowIsUnread(node, link) {
  // Signal 1 — "X new messages" text (most reliable)
  for (const el of node.querySelectorAll("*")) {
    if (el.childElementCount === 0 && /\d+\s*new\s*message/i.test(el.innerText || ""))
      return true;
  }

  // Signal 2 — small blue circular element (the blue dot indicator)
  // Instagram blue ≈ rgb(0,149,246). Also catches close variants.
  for (const el of node.querySelectorAll("*")) {
    const rect = el.getBoundingClientRect();
    if (!rect.width || rect.width < 4 || rect.width > 28) continue;
    if (Math.abs(rect.width - rect.height) > 8) continue;  // must be roughly circular

    const bg  = window.getComputedStyle(el).backgroundColor;
    const rgb = bg.match(/\d+/g);
    if (!rgb || rgb.length < 3) continue;
    const [r, g, b] = rgb.map(Number);
    // Blue dominant: b > 100, b > r by at least 30, b > g (relaxed for different IG themes)
    if (b > 100 && b > r + 30 && b > g * 0.6) return true;
  }

  // Signal 3 — aria-label mentions unread
  if (/unread/i.test(node.getAttribute("aria-label") || "")) return true;

  // Signal 4 — bold preview text
  // In a conversation row: username text is always bold (skip it).
  // If the message preview text is also bold, the conversation is unread.
  const leafEls = Array.from(node.querySelectorAll("span, div")).filter(el =>
    el.childElementCount === 0 &&
    (el.innerText || "").trim().length > 2 &&
    (el.innerText || "").trim().length < 120
  );
  let boldCount = 0;
  for (const el of leafEls) {
    const fw   = parseInt(window.getComputedStyle(el).fontWeight || "400", 10);
    const text = (el.innerText || "").trim();
    if (fw >= 600) {
      boldCount++;
      // Skip the first bold (username). A 2nd+ bold non-timestamp text = unread preview.
      if (boldCount > 1 && text.length > 4 && !/^\d+[mhdwsy]$/.test(text)) return true;
    }
  }

  return false;
}

/* ── Classify a single message element as "sent" | "received" | null ── */
function classifyMsgEl(el, panelLeft, panelWidth) {
  const panelMid = panelLeft + panelWidth * 0.5;
  let node = el;

  for (let i = 0; i < 15; i++) {
    if (!node.parentElement || node === document.body) break;
    node = node.parentElement;

    const rect  = node.getBoundingClientRect();
    const style = window.getComputedStyle(node);

    // Skip containers that are full-page-wide or invisible
    if (!rect.width || rect.width > window.innerWidth * 0.92) continue;

    // ── CSS flex signals (most reliable) ──────────────────────────────────
    if (style.alignSelf === "flex-end")   return "sent";
    if (style.alignSelf === "flex-start") return "received";

    // margin:auto pushes element to one side
    const ml = style.marginLeft;
    const mr = style.marginRight;
    if (ml === "auto" && mr !== "auto" && rect.width < panelWidth * 0.8) return "sent";
    if (mr === "auto" && ml !== "auto" && rect.width < panelWidth * 0.8) return "received";

    // ── Background colour of the bubble ───────────────────────────────────
    const rgba = style.backgroundColor.match(/[\d.]+/g);
    if (rgba && rgba.length >= 3 && rect.width < panelWidth * 0.75 && rect.height < 220) {
      const [r, g, b] = rgba.map(Number);
      const alpha = rgba[3] !== undefined ? parseFloat(rgba[3]) : 1;
      // skip transparent or pure-white backgrounds (page/card backgrounds, not bubbles)
      if (alpha < 0.15 || (r > 248 && g > 248 && b > 248)) continue;
      // near-gray → received bubble
      const isGray = r > 170 && g > 170 && b > 170 && Math.abs(r - g) < 25 && Math.abs(g - b) < 25;
      if (isGray) return "received";
      // clearly coloured → sent bubble (Instagram default is blue ≈ 0,149,246)
      const isColoured = !isGray && (r + g + b) > 120;
      if (isColoured) return "sent";
    }

    // ── Position-based (fallback, only when panel is well-detected) ────────
    if (panelWidth < window.innerWidth * 0.9 && rect.width < panelWidth * 0.72) {
      const cx = rect.left + rect.width / 2;
      if (cx > panelMid + panelWidth * 0.08) return "sent";
      if (cx < panelMid - panelWidth * 0.08) return "received";
    }
  }

  return null; // genuinely indeterminate
}

/* ── Read messages from the open conversation ── */
function getConversationMessages() {
  // Locate the thread panel (right column in 2-col layout)
  let panelLeft  = 0;
  let panelWidth = window.innerWidth;

  for (const sel of ['div[role="grid"]', 'main section', 'main']) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 100 && r.width < window.innerWidth * 0.95) {
      panelLeft  = r.left;
      panelWidth = r.width;
      break;
    }
  }

  // Collect all text elements that look like message bubbles
  const candidates = Array.from(
    document.querySelectorAll('div[dir="auto"], span[dir="auto"]')
  ).filter(el => {
    const t = (el.innerText || "").trim();
    return t.length > 0 && t.length < 600 && el.childElementCount <= 3;
  });

  if (!candidates.length) return { lastReceived: null, lastDir: null, context: [] };

  const classified = [];
  for (const el of candidates) {
    const text = (el.innerText || "").trim();
    if (!text) continue;
    const dir = classifyMsgEl(el, panelLeft, panelWidth);
    if (dir) classified.push({ text, dir }); // skip truly unknown elements
  }

  // Deduplicate consecutive identical texts
  const deduped = classified.filter((m, i) =>
    i === 0 || m.text !== classified[i - 1].text
  );

  if (!deduped.length) return { lastReceived: null, lastDir: null, context: [] };

  const lastDir      = deduped[deduped.length - 1].dir;
  const received     = deduped.filter(m => m.dir === "received");
  const lastReceived = received.length ? received[received.length - 1].text : null;
  const context      = deduped.slice(-14).map(m => `${m.dir === "sent" ? "Me" : "Them"}: ${m.text}`);

  return { lastReceived, lastDir, context };
}

/* ── Get the username of the currently open conversation ── */
function getOpenConversationUsername() {
  // Words that are NOT Instagram usernames even though they appear in profile links
  const EXCLUDED = /^(instagram|meta|facebook|direct|explore|reels|stories|accounts|p|tv|reel|about|legal|privacy|help|terms)$/i;

  // Strategy 1: page title — Instagram sets it to "username • Chats • Direct • Instagram"
  // when a DM thread is open
  const titleMatch = document.title.match(/^([a-zA-Z0-9][a-zA-Z0-9._]{0,29})\s*[•·]/);
  if (titleMatch && !EXCLUDED.test(titleMatch[1])) return titleMatch[1];

  // Strategy 2: any <a href="/username/"> link in the top 250px of the page
  // The conversation header shows a clickable link to the profile
  const allLinks = Array.from(document.querySelectorAll('a[href]'));
  for (const a of allLinks) {
    const rect = a.getBoundingClientRect();
    if (rect.top > 250) continue;   // only look in the header area

    const href = a.getAttribute("href") || "";
    const m    = href.match(/^\/([a-zA-Z0-9][a-zA-Z0-9._]{0,29})\/?$/);
    if (!m || EXCLUDED.test(m[1])) continue;

    return m[1];
  }

  // Strategy 3: look for the username text displayed in the header
  // Instagram shows "h.a_2026 · Instagram" — grab the part before the dot/bullet
  const headerEl = document.querySelector('header, [role="banner"]');
  if (headerEl) {
    const spans = Array.from(headerEl.querySelectorAll("span, div, a")).filter(el =>
      el.childElementCount === 0
    );
    for (const el of spans) {
      const text = (el.innerText || "").trim();
      // Match a standalone Instagram username (no spaces, contains dots/underscores/digits)
      if (/^[a-zA-Z0-9][a-zA-Z0-9._]{2,29}$/.test(text) && !EXCLUDED.test(text)) {
        return text;
      }
    }
  }

  return null;
}

/* ── Type text into the DM input and send ── */
async function typeAndSendDM(text) {
  // Find the DM input — Instagram uses a Lexical contenteditable div
  const input =
    document.querySelector('div[data-lexical-editor="true"]')                    ||
    document.querySelector('div[contenteditable="true"][aria-placeholder]')       ||
    document.querySelector('div[contenteditable="true"][aria-label*="essage"]')   ||
    document.querySelector('div[contenteditable="true"][role="textbox"]')          ||
    document.querySelector('div[contenteditable="true"]');

  if (!input) return false;

  // ── Attempt 1: execCommand (works in most Chrome extension contexts) ──
  input.focus();
  input.click();
  await sleep(250);

  document.execCommand("selectAll",   false, null);
  document.execCommand("delete",      false, null);
  document.execCommand("insertText",  false, text);
  await sleep(300);

  let typed = (input.textContent || input.innerText || "").trim();

  // ── Attempt 2: ClipboardEvent paste (reliable for Lexical / React editors) ──
  if (!typed) {
    try {
      const dt = new DataTransfer();
      dt.setData("text/plain", text);
      input.dispatchEvent(new ClipboardEvent("paste", {
        clipboardData: dt,
        bubbles:       true,
        cancelable:    true,
      }));
      await sleep(300);
      typed = (input.textContent || input.innerText || "").trim();
    } catch (_) {}
  }

  // ── Attempt 3: Direct textContent + React-style InputEvent ──
  if (!typed) {
    const p = document.createElement("p");
    p.textContent = text;
    input.innerHTML = "";
    input.appendChild(p);
    input.dispatchEvent(new InputEvent("input", {
      bubbles:   true,
      inputType: "insertText",
      data:      text,
    }));
    await sleep(300);
    typed = (input.textContent || input.innerText || "").trim();
  }

  if (!typed) return false;   // nothing worked — bail

  // ── Find and click Send button (appears after text is typed) ──
  const sendBtn = await waitFor(() =>
    document.querySelector('[aria-label="Send"]')                                        ||
    document.querySelector('button[type="submit"]')                                       ||
    Array.from(document.querySelectorAll('[role="button"], button, svg')).find(el => {
      const label = (el.getAttribute("aria-label") || el.innerText || "").toLowerCase();
      return label === "send" || label === "send message";
    }),
  2500);

  if (sendBtn) {
    sendBtn.click();
  } else {
    // Fallback: Enter key (works in most Instagram DM inputs)
    input.dispatchEvent(new KeyboardEvent("keydown",  { key: "Enter", keyCode: 13, bubbles: true, cancelable: true }));
    input.dispatchEvent(new KeyboardEvent("keypress", { key: "Enter", keyCode: 13, bubbles: true, cancelable: true }));
    input.dispatchEvent(new KeyboardEvent("keyup",    { key: "Enter", keyCode: 13, bubbles: true }));
  }

  await sleep(800);
  return true;
}

/* ── Ask Groq for a DM reply with conversation context ── */
const DM_FALLBACK_REPLIES = [
  "Thanks for reaching out! 😊",
  "Hey, appreciate the message! 🙏",
  "Thanks! Will get back to you soon 😊",
  "Hey! Thanks for writing 🙌",
  "Appreciate it! Will reply properly soon 😊",
];

async function getAIDMReply(messages, opts = {}) {
  const context = messages.context.join("\n");
  const last = messages.lastReceived
    || (messages.context.length ? messages.context[messages.context.length - 1].replace(/^(Me|Them):\s*/, "") : "");

  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      {
        action: "GET_AI_DM_REPLY",
        lastMessage: last,
        context,
        myProfile:     opts.myProfile     || null,
        theirUsername: opts.theirUsername  || null,
      },
      (res) => {
        if (res?.reply || res?.media_url) {
          resolve({ reply: res.reply || "", mediaUrl: res.media_url || null, fromAI: true });
        } else {
          // Provider failed — fall back to a canned reply ONLY so the queue
          // keeps moving; the backend path above is the real one.
          console.warn('[BibixCS] DM AI reply failed:', res?.error);
          const fallback = DM_FALLBACK_REPLIES[Math.floor(Math.random() * DM_FALLBACK_REPLIES.length)];
          resolve({ reply: fallback, mediaUrl: null, fromAI: false });
        }
      }
    );
  });
}

// Attach + send a media File in the open DM thread. Uses IG's hidden
// <input type=file> (the photo/media button), sets the file via DataTransfer,
// waits for the preview, then clicks Send. Best-effort — logs and returns
// false if IG's composer doesn't accept it, so the text reply still stands.
async function sendDMMedia(file) {
  const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
  const input = inputs.find(i => /image|video/.test(i.getAttribute('accept') || '')) || inputs[inputs.length - 1];
  if (!input) { console.warn('[BibixCS] DM media: no file input found'); return false; }
  try {
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  } catch (e) { console.warn('[BibixCS] DM media attach failed', e); return false; }

  // Wait for the upload preview, then find + click Send.
  const sendBtn = await waitFor(() =>
    document.querySelector('[aria-label="Send"]') ||
    Array.from(document.querySelectorAll('[role="button"], button')).find(el =>
      ((el.getAttribute('aria-label') || el.innerText || '').trim().toLowerCase() === 'send')),
  8000);
  if (sendBtn) { sendBtn.click(); await sleep(1800); return true; }
  console.warn('[BibixCS] DM media: Send button not found after attach');
  return false;
}

async function fetchDmMediaFile(mediaUrl) {
  const res = await new Promise((r) => chrome.runtime.sendMessage({ action: 'GET_DM_MEDIA', url: mediaUrl }, r));
  if (!res || !res.dataUrl) { console.warn('[BibixCS] DM media fetch failed:', res?.error); return null; }
  const blob = await (await fetch(res.dataUrl)).blob();
  const ext = (res.mime || '').startsWith('video') ? 'mp4' : 'jpg';
  return new File([blob], `media.${ext}`, { type: res.mime || 'image/jpeg' });
}

/* ===== CAMPAIGN HELPERS ===== */

// Scrape like count and comment count from the post DOM
function getPostStats() {
  let postLikes = null, postComments = null;

  // Try embedded JSON scripts first (most reliable)
  try {
    for (const s of document.querySelectorAll("script")) {
      const t = s.textContent || "";
      if (!t.includes("like_count") && !t.includes("edge_media_preview_like")) continue;
      const lm = t.match(/"like_count"\s*:\s*(\d+)/) ||
                 t.match(/"edge_media_preview_like"[^{]*"count"\s*:\s*(\d+)/);
      const cm = t.match(/"comment_count"\s*:\s*(\d+)/) ||
                 t.match(/"edge_media_to_comment"[^{]*"count"\s*:\s*(\d+)/);
      if (lm) postLikes    = lm[1];
      if (cm) postComments = cm[1];
      if (postLikes && postComments) break;
    }
  } catch {}

  // DOM fallback
  if (!postLikes || !postComments) {
    for (const el of document.querySelectorAll("span, a, button")) {
      if (el.children.length > 1) continue;
      const t = (el.innerText || "").trim();
      if (!postLikes) {
        const m = t.match(/^([\d,]+)\s+like/i);
        if (m) postLikes = m[1].replace(/,/g, "");
      }
      if (!postComments) {
        const m = t.match(/^(?:view all\s+)?([\d,]+)\s+comment/i);
        if (m) postComments = m[1].replace(/,/g, "");
      }
      if (postLikes && postComments) break;
    }
  }

  return { postLikes, postComments };
}

// Get all post metadata including owner's profile info via hover
async function getPostMeta() {
  const postUrl   = getPostUrl();
  const postOwner = getPostOwner();
  const { postLikes, postComments } = getPostStats();

  let postOwnerFullName    = null;
  let postOwnerFollowers   = null;
  let postOwnerPosts       = null;

  if (postOwner) {
    const article    = document.querySelector("article");
    const ownerLink  = article
      ? Array.from(article.querySelectorAll("a[href]")).find((a) => {
          const h = (a.getAttribute("href") || "").replace(/\/$/, "");
          return h === `/${postOwner}`;
        })
      : null;

    if (ownerLink) {
      const info = await getProfileInfoByHover(ownerLink);
      postOwnerFullName  = info.fullName;
      postOwnerFollowers = info.followers;
    }
  }

  return { postUrl, postOwner, postOwnerFullName, postOwnerFollowers, postLikes, postComments };
}

// Start a campaign record in background storage; returns campaign ID
function startCampaign(data) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: "START_CAMPAIGN", campaign: data }, (res) => {
      resolve(res?.id || null);
    });
  });
}

// Update / close a campaign record
function finishCampaign(id, updates) {
  if (!id) return Promise.resolve();
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: "FINISH_CAMPAIGN", id, updates }, () => resolve());
  });
}

// Convert stored follower string ("1.2k", "45,000", "1M") to integer
function parseFollowerCount(val) {
  if (!val) return null;
  const s = String(val).replace(/,/g, "").trim().toLowerCase();
  if (s.endsWith("k")) return Math.round(parseFloat(s) * 1_000);
  if (s.endsWith("m")) return Math.round(parseFloat(s) * 1_000_000);
  const n = parseFloat(s);
  return isNaN(n) ? null : Math.round(n);
}

// Compute min / max / avg from an array of follower counts
function computeFollowerStats(values) {
  if (!values.length) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  return {
    count: values.length,
    min:   Math.min(...values),
    max:   Math.max(...values),
    avg:   Math.round(sum / values.length),
    total: sum,
  };
}

/* ===== UTILS ===== */
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const rand  = (max) => Math.floor(Math.random() * max);
const pick  = (arr) => arr[rand(arr.length)];
const progress = (text) => chrome.runtime.sendMessage({ type: "PROGRESS", text });
// `meta` carries optional `{ failed: true, error: string }` for explicit
// failures (wrong active account, unreachable post, etc.). Background uses
// these to mark the queue item with status='failed' + an error_message.
const done = (countDone = 0, meta = {}) =>
  chrome.runtime.sendMessage({ type: "DONE", countDone, ...(meta || {}) });

// Verify the currently-active IG account in this Chrome session matches
// what the batch was scheduled for. Returns { ok: true } on match (or if
// asAccount is null), or { ok: false, error: "..." } describing the
// mismatch. Caller is responsible for failing the queue item.
function checkActiveAccount(asAccount) {
  if (!asAccount) return { ok: true };
  const want = String(asAccount).trim().replace(/^@/, '').toLowerCase();
  if (!want) return { ok: true };
  const have = (getLoggedInUsername() || '').toLowerCase();
  if (have === want) return { ok: true };
  // Logged-out detection: if there's a "Log in" button visible OR the URL
  // has the standard logged-out chrome layout, give a more pointed error.
  const loggedOutSignal =
    !!document.querySelector('a[href="/accounts/login/"], a[href*="/accounts/login"]') ||
    /^Log[Ii]n( |$)/.test(document.body?.innerText?.split('\n')[0] || '');
  return {
    ok: false,
    error: have
      ? `Active IG account is @${have}, but this batch needs @${want}. Switch accounts in Instagram first, then resume the batch.`
      : (loggedOutSignal
        ? `Tab opened in a logged-out Instagram session (full-page view, "Log In" visible) — likely the new tab landed in an Incognito or non-logged-in Chrome window. Make sure the IG-logged-in window is in focus when batches dispatch.`
        : `Could not detect an active IG account in this Chrome — open instagram.com and sign in to @${want}, then retry.`),
  };
}

function waitFor(fn, timeout = 3000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const id = setInterval(() => {
      const result = fn();
      if (result) { clearInterval(id); resolve(result); }
      else if (Date.now() - start > timeout) { clearInterval(id); resolve(null); }
    }, 200);
  });
}

/* ============================================================================
   FOLLOWERS SNAPSHOT
   ----------------------------------------------------------------------------
   Triggered from the popup. Requires the "Followers" modal to be open on
   instagram.com/<username>/ (the dialog with the scrollable user list).
   Scrolls until exhausted, then sends every collected username to background.
============================================================================ */
async function handleSnapshotFollowers(autoOpen = false) {
  progress("Snapshotting followers…");

  // Wait for an already-open Followers modal. If none and autoOpen is set
  // (called from an automation), try to click the Followers link on the
  // profile page ourselves.
  let dialog = await waitFor(() => document.querySelector('div[role="dialog"]'), 4000);
  if (!dialog && autoOpen) {
    progress("Opening Followers list…");
    // The Followers link is `<a href="/USER/followers/">` in the profile
    // header. Match either by href ending or visible text.
    const link = Array.from(document.querySelectorAll('a[href$="/followers/"], a[href*="/followers/"]'))
      .find(a => /\/followers\/?$/.test(a.getAttribute('href') || ''));
    if (link) {
      link.click();
      dialog = await waitFor(() => document.querySelector('div[role="dialog"]'), 10000);
    }
  }
  if (!dialog) {
    progress("⚠ Followers modal not available. Open the profile and click Followers first.");
    notifyPopup({ type: "DONE" });
    return;
  }

  // Find the scrollable container inside the dialog
  const scrollable = findModalScrollable() || dialog.querySelector('div[style*="overflow"]') || dialog;

  const usernames = new Set();
  const collect = () => {
    dialog.querySelectorAll('a[role="link"][href^="/"]').forEach(a => {
      const href = a.getAttribute('href') || '';
      const m = href.match(/^\/([A-Za-z0-9._]+)\/?$/);
      if (m && !/^(explore|reels|stories|direct|accounts|p|tv|reel)$/.test(m[1])) {
        usernames.add(m[1].toLowerCase());
      }
    });
  };

  let lastHeight = -1;
  let stableLoops = 0;
  for (let i = 0; i < 200; i++) {
    if (STOP) break;
    collect();
    progress(`Scrolling followers… (${usernames.size} so far)`);
    scrollable.scrollTop = scrollable.scrollHeight;
    await sleep(800 + rand(400));
    if (scrollable.scrollHeight === lastHeight) {
      stableLoops++;
      if (stableLoops >= 4) break;
    } else {
      stableLoops = 0;
      lastHeight = scrollable.scrollHeight;
    }
  }
  collect();

  const list = [...usernames];
  const myProfile = getLoggedInUsername();
  progress(`Uploading snapshot (${list.length} followers)…`);

  chrome.runtime.sendMessage(
    { action: "BIBIX_SNAPSHOT_FOLLOWERS", followers: list, my_profile: myProfile },
    (res = {}) => {
      if (res.ok) progress(`✓ Snapshot saved (${list.length} followers)`);
      else       progress(`⚠ Snapshot failed: ${res.error || "no Bibix token"}`);
      notifyPopup({ type: "DONE" });
    }
  );
}

/* ============================================================================
   SCHEDULED POST PUBLISHER
   ----------------------------------------------------------------------------
   Polls Bibix every 60s for posts whose time has come. Drives the Instagram
   "Create" composer to publish each one. Best-effort: if any step fails, marks
   the post as 'failed' with the error message — visible in the Monday UI.

   Lifecycle:
     - Starts on document_idle.
     - Skips entirely if no Bibix token is connected.
     - Only claims posts whose `my_profile` is null or matches the current user.
============================================================================ */
let SCHEDULER_RUNNING = false;
let SCHEDULER_TIMER = null;

async function pollScheduledPosts(force = false) {
  // Per-device kill-switch — toggle lives in chrome.storage.local. Default ON.
  // `force=true` (manual "Check schedule now" button) bypasses the toggle.
  if (!force) {
    const { bibixAutomationEnabled } = await new Promise(r =>
      chrome.storage.local.get(["bibixAutomationEnabled"], r));
    if (bibixAutomationEnabled === false) {
      console.log("[BibixSched] automation disabled on this device — skipping poll");
      return;
    }
  }
  console.log("[BibixSched] poll called, force=", force);
  if (SCHEDULER_RUNNING && !force) { console.log("[BibixSched] already running, skipping"); return; }
  SCHEDULER_RUNNING = true;
  try {
    const myProfile = getLoggedInUsername();
    console.log("[BibixSched] current profile detected:", myProfile);
    if (!myProfile) { console.log("[BibixSched] no profile, exiting"); return; }

    // 1. Publish anything due for the currently-active account
    const due = await new Promise(resolve =>
      chrome.runtime.sendMessage({ action: "BIBIX_GET_DUE_POSTS", my_profile: myProfile }, res => resolve(res?.posts || []))
    );
    console.log(`[BibixSched] /due returned ${due.length} post(s) for @${myProfile}`);

    for (const post of due) {
      if (post.my_profile && post.my_profile.toLowerCase() !== myProfile.toLowerCase()) continue;
      try {
        progress(`📅 Publishing scheduled ${post.post_type} on @${myProfile}…`);
        await publishScheduledPost(post);
        chrome.runtime.sendMessage({ action: "BIBIX_UPDATE_SCHEDULED_POST", id: post.id, status: "posted" });
        progress(`✓ Posted ${post.post_type}`);
      } catch (e) {
        const errMsg = (e && e.message) || String(e);
        chrome.runtime.sendMessage({
          action: "BIBIX_UPDATE_SCHEDULED_POST",
          id: post.id, status: "failed", error_message: errMsg,
        });
        progress(`⚠ Publish failed: ${errMsg}`);
      }
      await sleep(3000);
    }

    // 2. Are there pending posts for OTHER accounts? If yes and cooldown
    //    allows, switch to one. After the switch the page reloads, and the
    //    next poll on the new page picks up posts for the new account.
    const pendingAccounts = await new Promise(resolve =>
      chrome.runtime.sendMessage({ action: "BIBIX_GET_PENDING_ACCOUNTS" }, res => resolve(res?.accounts || []))
    );
    console.log("[BibixSched] /pending-accounts returned:", pendingAccounts);
    const otherAccounts = pendingAccounts.filter(a => a && a.toLowerCase() !== myProfile.toLowerCase());
    console.log("[BibixSched] other accounts needing publish:", otherAccounts);
    if (otherAccounts.length === 0) { console.log("[BibixSched] nothing to switch to"); return; }

    const cd = await canSwitchNow();
    console.log("[BibixSched] cooldown check:", cd);
    if (!cd.allowed) {
      progress(`⏳ ${otherAccounts.length} other account(s) waiting — cooldown ${Math.ceil(cd.waitMs / 60000)}m`);
      return;
    }

    // Pick the first pending account (FIFO is good enough)
    const target = otherAccounts[0];
    console.log(`[BibixSched] switching from @${myProfile} → @${target}`);
    progress(`🔄 Switching from @${myProfile} to @${target}…`);
    await recordSwitchAndRollCooldown();
    // Note: switchToAccount returns when IG has reloaded the page; we don't
    // await it because the content script will be re-injected anyway.
    switchToAccount(target);
  } finally {
    SCHEDULER_RUNNING = false;
    // Signal background so it can close auto-opened tabs after a polling cycle
    try { chrome.runtime.sendMessage({ action: "SCHEDULER_POLL_DONE" }); } catch (_) {}
  }
}

async function publishScheduledPost(post) {
  const isVideo = (post.media_mime || "").includes("video");

  // 1. Fetch the media as a blob via background (so we can attach the auth token)
  const blob = await new Promise((resolve, reject) =>
    chrome.runtime.sendMessage({ action: "BIBIX_FETCH_MEDIA", id: post.id }, res => {
      if (!res?.ok) return reject(new Error(res?.error || "Could not fetch media"));
      const bin = atob(res.dataB64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      resolve(new Blob([arr], { type: res.mime || (isVideo ? "video/mp4" : "image/jpeg") }));
    })
  );
  const ext = isVideo ? "mp4" : "jpg";
  const file = new File([blob], `scheduled.${ext}`, { type: blob.type });

  // 2. Open the right composer. Instagram has a sub-menu after clicking
  //    "New post" — Post / Reel / Story / Live. We honor the post_type the
  //    user picked: "reel" → Reel composer, anything else → Post composer.
  //    The Post composer accepts videos (IG auto-converts them to Reels after
  //    upload) and works on accounts that don't expose the Reel menu item, so
  //    we don't force Reel just because the media is a video.
  const isReel = post.post_type === "reel";

  const createTrigger =
    [...document.querySelectorAll('svg[aria-label="New post"], svg[aria-label="Create"]')]
      .pop()?.closest('a, div[role="button"], button');
  if (!createTrigger) throw new Error('Create button not found — navigate to instagram.com home');
  console.log(`[BibixSched] opening composer for ${isReel ? "Reel" : "Post"}`);
  createTrigger.click();
  await sleep(1500);

  // Look for the right entry in the sub-menu that pops out after clicking
  // Create. IG's menu options may be: a/button/role=button/role=menuitem.
  // We search by visible text AND by aria-label, AND by href (for reels the
  // href sometimes ends with "/reels/").
  const matchItem = (label) => {
    const labelLower = label.toLowerCase();
    const items = document.querySelectorAll(
      'a, button, [role="button"], [role="menuitem"], div[tabindex="0"], li'
    );
    for (const it of items) {
      const txt = (it.innerText || it.textContent || "").trim().split("\n")[0].toLowerCase();
      if (txt === labelLower) return it;
      const aria = (it.getAttribute("aria-label") || "").toLowerCase();
      if (aria === labelLower) return it;
      const href = it.getAttribute("href") || "";
      if (labelLower === "reel" && /\/reels?(\/|$)/.test(href)) return it;
    }
    return null;
  };

  let menuItem = await waitFor(() => matchItem(isReel ? "reel" : "post"), 5000);

  if (!menuItem && isReel) {
    // Dump what IG actually shows in the Create menu — useful debugging info
    const visible = [...document.querySelectorAll(
      'a, button, [role="button"], [role="menuitem"], div[tabindex="0"]'
    )].map(el => (el.innerText || el.textContent || "").trim().split("\n")[0])
       .filter(t => t && t.length < 30);
    const menuItems = [...new Set(visible)].filter(t =>
      /^(post|reel|story|live|live video|ad|ai)$/i.test(t)
    );
    console.warn("[BibixSched] no Reel option. Create menu shows:", menuItems);
    throw new Error(
      `This account has no "Reel" option in the Create menu (saw: ${menuItems.join(", ") || "nothing"}). ` +
      `IG restricts Reels on some account types/regions. ` +
      `Try a Personal or Creator account, or post this video manually.`
    );
  }

  if (menuItem) {
    console.log(`[BibixSched] clicking menu option: "${menuItem.textContent.trim().slice(0, 30)}"`);
    menuItem.click();
    await sleep(2500);
  } else {
    console.log("[BibixSched] no submenu found — assuming composer opened directly");
  }
  await sleep(1000);

  // 3. Find the hidden file input and inject the file. IG renders 2–3
  //    different file inputs in the composer — one for image-only (JPEG),
  //    one for images (JPEG+PNG), and one with the full accept list
  //    including video/mp4. Picking the first match drops videos into the
  //    image-only input and IG rejects with "Only images can be posted."
  //    We pick the input whose `accept` matches our file's MIME type.
  const mimePrefix = isVideo ? "video/" : "image/";
  const findFileInput = () => {
    const all = [...document.querySelectorAll('input[type="file"]')];
    return all.find(el => (el.accept || "").includes(mimePrefix)) || all[0];
  };
  const fileInput = await waitFor(findFileInput, 8000);
  if (!fileInput) throw new Error("File input not found in composer");
  console.log(`[BibixSched] using file input accept="${fileInput.accept}"`);
  const dt = new DataTransfer();
  dt.items.add(file);
  fileInput.files = dt.files;
  fileInput.dispatchEvent(new Event("change", { bubbles: true }));
  // Videos take longer to process server-side; allow extra time before the
  // composer becomes interactive.
  await sleep(isVideo ? 8000 : 4000);

  // Dismiss the "Discard / Cover / Switch to Reel" popups IG sometimes shows.
  // Different IG versions label the confirm button differently.
  const dismissReelPrompt = () => {
    const btn = [...document.querySelectorAll(
      'div[role="dialog"] button, div[role="dialog"] [role="button"]'
    )].find(b => /^(ok|continue|switch|yes|share)$/i.test(
      (b.innerText || b.textContent || "").trim()
    ));
    if (btn) { console.log(`[BibixSched] dismissed popup via "${btn.textContent.trim()}"`); btn.click(); return true; }
    return false;
  };
  dismissReelPrompt();
  await sleep(1500);

  // 4. Click "Next" until we reach the caption step. Use waitFor with a
  //    generous timeout each iteration. Modern Instagram has TWO composer
  //    variants: the old dialog-style overlay and the newer /create/* full-page
  //    route — search whichever scope contains the composer.
  const composerScope = () => document.querySelector('div[role="dialog"]') || document.body;
  const findCaptionField = () => composerScope().querySelector(
    '[aria-label*="caption" i][contenteditable], ' +
    'textarea[aria-label*="caption" i], ' +
    '[contenteditable="true"][role="textbox"]'
  );
  const findNextButton = () => {
    const candidates = composerScope().querySelectorAll(
      'button, [role="button"], div[tabindex="0"], a[role="button"]'
    );
    return [...candidates].find(b => {
      const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
      if (txt === 'next' || txt.startsWith('next\n') || txt.startsWith('next ')) return true;
      const aria = (b.getAttribute('aria-label') || '').toLowerCase();
      return aria === 'next';
    });
  };
  const findShareButton = () => {
    const candidates = composerScope().querySelectorAll(
      'button, [role="button"], div[tabindex="0"], a[role="button"]'
    );
    return [...candidates].find(b => {
      const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
      return /^share(\s|$)/.test(txt) || (b.getAttribute('aria-label') || '').toLowerCase() === 'share';
    });
  };

  for (let i = 0; i < 8; i++) {
    if (findCaptionField()) { console.log(`[BibixSched] reached caption step after ${i} Next click(s)`); break; }
    console.log(`[BibixSched] waiting for Next button (step ${i + 1})…`);
    const next = await waitFor(findNextButton, 10000);
    if (!next) {
      if (dismissReelPrompt()) { await sleep(1500); continue; }
      throw new Error(`Composer stalled at step ${i + 1} — no "Next" button found within 10s`);
    }
    console.log(`[BibixSched] clicking Next (step ${i + 1})`);
    next.click();
    await sleep(isVideo ? 3000 : 2200);
  }

  // 5. Type the caption (if any). IG's caption editor uses a contenteditable
  //    that doesn't respond to execCommand on its own — we fall back to a
  //    synthetic paste event (which Lexical-style editors handle reliably).
  if (post.caption) {
    const captionEl = await waitFor(findCaptionField, 6000);
    if (captionEl) {
      console.log("[BibixSched] injecting caption");
      captionEl.focus();
      await sleep(300);

      let inserted = false;
      try { inserted = document.execCommand("insertText", false, post.caption); } catch (_) {}

      if (!inserted) {
        // Fall back to a synthesized paste event
        try {
          const dt = new DataTransfer();
          dt.setData("text/plain", post.caption);
          const pasteEvent = new ClipboardEvent("paste", {
            clipboardData: dt, bubbles: true, cancelable: true,
          });
          captionEl.dispatchEvent(pasteEvent);
          inserted = true;
        } catch (e) { console.warn("[BibixSched] paste fallback failed:", e?.message); }
      }
      await sleep(1500);
    } else {
      console.warn("[BibixSched] caption field not found within 6s — skipping caption");
    }
  }

  // 6. Click Share. Videos sometimes need extra time to finish uploading.
  console.log("[BibixSched] looking for Share button");
  const share = await waitFor(findShareButton, 8000);
  if (!share) throw new Error('"Share" button not found within 8s');
  console.log("[BibixSched] clicking Share");
  share.click();
  await sleep(isVideo ? 12000 : 6000);

  // 7. Dismiss the "Your post/reel has been shared" confirmation by clicking
  //    "Done" (or its variants). If not found, the composer usually closes on
  //    its own — not fatal.
  const findDoneButton = () => {
    const scope = document.querySelector('div[role="dialog"]') || document.body;
    const candidates = scope.querySelectorAll(
      'button, [role="button"], div[tabindex="0"], a[role="button"]'
    );
    return [...candidates].find(b => {
      const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
      if (txt === 'done' || txt === 'close') return true;
      const aria = (b.getAttribute('aria-label') || '').toLowerCase();
      return aria === 'done' || aria === 'close';
    });
  };
  const done = await waitFor(findDoneButton, 15000);
  if (done) {
    console.log("[BibixSched] clicking Done to close confirmation");
    done.click();
    await sleep(1000);
  } else {
    console.log("[BibixSched] no Done button found — confirmation may have auto-closed");
  }
}

// Start polling once the page is settled. Skip on subpages where the composer
// isn't reachable (login, reset, etc).
function startSchedulerPoller() {
  if (SCHEDULER_TIMER) return;
  if (!/instagram\.com\/(?:$|\?|[a-z0-9._]+\/?)/.test(location.href)) return;
  SCHEDULER_TIMER = setInterval(() => pollScheduledPosts(false), 60000);
  // Also run once after 8s so freshly-due posts get picked up quickly
  setTimeout(() => pollScheduledPosts(false), 8000);
}

/* ============================================================================
   DOWNLOADER
   ----------------------------------------------------------------------------
   Adds a small ⬇ button overlay on any photo/video element in a post, reel,
   or story. Clicking it fetches the media src and triggers a browser download.
============================================================================ */
const DOWNLOAD_BTN_ATTR = "data-bibix-dl";

function makeDownloadButton(mediaUrl, ext, isVideo, mediaEl) {
  const btn = document.createElement("button");
  btn.textContent = "⬇";
  btn.title = "Download (Bibix)";
  Object.assign(btn.style, {
    position: "absolute", top: "10px", right: "10px", zIndex: 9999,
    background: "rgba(0,0,0,.6)", color: "#fff", border: "none",
    borderRadius: "50%", width: "32px", height: "32px", fontSize: "16px",
    cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
    boxShadow: "0 2px 6px rgba(0,0,0,.3)",
  });
  btn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    btn.textContent = "…";

    let resolved = null;
    let realExt = ext;

    // Strategy 1: current page DOM has og:video (works on single-post pages)
    resolved = findRealMediaUrl(true);
    if (resolved) realExt = 'mp4';

    // Strategy 2: fetch the specific post's URL and parse its og:video
    // (handles profile/feed cases where multiple posts share one page)
    if (!resolved) {
      const postUrl = findPostUrlNear(mediaEl);
      if (postUrl) {
        btn.textContent = "🔄";
        const fetched = await fetchVideoUrlFromPost(postUrl);
        if (fetched) { resolved = fetched; realExt = 'mp4'; }
      }
    }

    // Strategy 3: if this isn't a video, just use the original media URL (image)
    if (!resolved) { resolved = mediaUrl; realExt = ext; }

    chrome.runtime.sendMessage(
      { action: "DOWNLOAD_MEDIA", url: resolved, filename: `instagram-${Date.now()}.${realExt}` },
      (res) => {
        btn.textContent = res?.ok ? "✓" : "⚠";
        if (!res?.ok) console.warn("Bibix downloader:", res?.error, "(url was:", resolved, ")");
        setTimeout(() => (btn.textContent = "⬇"), 1500);
      }
    );
  });
  return btn;
}

// Find the real video/image URL the same way fastdl.app does — from Instagram's
// own meta tags and embedded JSON. First checks the current page DOM, then
// falls back to fetching the specific post's URL (handles profile/feed cases
// where the page DOM's og:video describes a different post).
function findRealMediaUrl(isVideo) {
  if (isVideo) {
    const ogVideo = document.querySelector('meta[property="og:video"]')?.getAttribute('content')
                 || document.querySelector('meta[property="og:video:secure_url"]')?.getAttribute('content');
    if (ogVideo) return ogVideo;
    for (const s of document.querySelectorAll('script[type="application/json"]')) {
      const m = (s.textContent || '').match(/"video_url":"(https:\\?\/\\?\/[^"\\]+)"/);
      if (m) return m[1].replace(/\\\//g, '/').replace(/\\u0026/g, '&');
    }
    return null;
  } else {
    const ogImage = document.querySelector('meta[property="og:image"]')?.getAttribute('content');
    return ogImage || null;
  }
}

// Walk the DOM near `media` to find the link to its specific post/reel.
// Returns a full instagram.com URL or null.
function findPostUrlNear(media) {
  // 1. Closest <a> ancestor pointing to /p/ /reel/ /reels/
  let link = media.closest && media.closest('a[href*="/p/"], a[href*="/reel/"], a[href*="/reels/"]');
  if (link) return new URL(link.href, location.origin).toString();

  // 2. Walk up looking for a container that contains such a link
  let el = media.parentElement;
  for (let i = 0; i < 25 && el && el !== document.body; i++) {
    const found = el.querySelector('a[href*="/p/"], a[href*="/reel/"], a[href*="/reels/"]');
    if (found) return new URL(found.href, location.origin).toString();
    el = el.parentElement;
  }

  // 3. If we're on a single-post URL already, use that
  if (/\/(p|reel|reels)\/[^/]+/.test(location.pathname)) return location.href;

  return null;
}

// Fetch a single-post URL and pull og:video out of the response HTML.
// Same trick fastdl.app does on its server, just from inside the IG page.
async function fetchVideoUrlFromPost(postUrl) {
  try {
    const res = await fetch(postUrl, { credentials: 'include', headers: { 'Accept': 'text/html' } });
    const html = await res.text();
    let m = html.match(/<meta[^>]+property=["']og:video["'][^>]+content=["']([^"']+)["']/i)
         || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:video["']/i);
    if (m) return m[1].replace(/&amp;/g, '&');
    m = html.match(/"video_url":"(https:\\?\/\\?\/[^"\\]+)"/);
    if (m) return m[1].replace(/\\\//g, '/').replace(/\\u0026/g, '&');
  } catch (e) {
    console.warn("Bibix downloader: fetch failed for", postUrl, e);
  }
  return null;
}

function attachDownloadButtonsTo(media) {
  if (!media) return;
  // Walk up to find a container we can position-anchor on
  let container = media.parentElement;
  while (container && container !== document.body) {
    if (container.hasAttribute(DOWNLOAD_BTN_ATTR)) return;
    const rect = container.getBoundingClientRect();
    if (rect.width >= 200 && rect.height >= 200) break;
    container = container.parentElement;
  }
  if (!container || container === document.body) return;

  const isVideo = media.tagName === 'VIDEO';
  // For images we can use the element's src directly. For videos the <video>
  // tag holds a blob: URL, so we mark it as blob:placeholder and resolve the
  // real URL at click-time from the page's meta tags or webRequest capture.
  const src = isVideo
    ? 'blob:placeholder'
    : (media.currentSrc || media.src);
  if (!src) return;
  const ext = isVideo ? 'mp4' : 'jpg';

  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
  container.setAttribute(DOWNLOAD_BTN_ATTR, "1");
  container.appendChild(makeDownloadButton(src, ext, isVideo, media));
}

function scanForDownloadable() {
  // Any reasonably-sized <img> or <video> on the page that looks like IG media
  document.querySelectorAll('img, video').forEach(el => {
    const rect = el.getBoundingClientRect();
    if (rect.width < 200 || rect.height < 200) return; // skip avatars and icons
    // Skip ad sidebars, suggestions, etc — only attach to elements in the main content area
    if (!el.closest('article, main, section[role="main"], div[role="dialog"]')) return;
    attachDownloadButtonsTo(el);
  });
}

function startDownloaderObserver() {
  scanForDownloadable();
  const obs = new MutationObserver(() => {
    // Debounce: only run if we haven't run in the last 500ms
    if (startDownloaderObserver._t) return;
    startDownloaderObserver._t = setTimeout(() => {
      startDownloaderObserver._t = null;
      scanForDownloadable();
    }, 500);
  });
  obs.observe(document.body, { childList: true, subtree: true });
}

/* ============================================================================
   BOOTSTRAP — start observers/pollers when the page is ready
============================================================================ */
(function bootstrap() {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap);
    return;
  }
  // Small delay so React's first render settles
  setTimeout(() => {
    startDownloaderObserver();
    startSchedulerPoller();
  }, 2500);
})();

function notifyPopup(msg) { try { chrome.runtime.sendMessage(msg); } catch (_) {} }

/* ============================================================================
   MULTI-ACCOUNT SWITCHER
   ----------------------------------------------------------------------------
   Drives Instagram's built-in "Switch accounts" modal so the scheduler can
   publish posts on different accounts without the user clicking through the UI.

   Rate-limited: 5–12 min random cooldown between switches (re-rolled each
   time) to look natural to Instagram. Stored in chrome.storage.local so it
   survives page reloads (which IG triggers on every switch).
============================================================================ */
const SWITCH_LAST_AT_KEY    = "ig_switch_last_at";
const SWITCH_NEXT_AFTER_KEY = "ig_switch_next_after";

async function getSwitchCooldown() {
  return new Promise(r => chrome.storage.local.get([SWITCH_LAST_AT_KEY, SWITCH_NEXT_AFTER_KEY], r));
}

async function canSwitchNow() {
  const data = await getSwitchCooldown();
  const nextAfter = data[SWITCH_NEXT_AFTER_KEY] || 0;
  const now = Date.now();
  if (now < nextAfter) return { allowed: false, waitMs: nextAfter - now };
  return { allowed: true };
}

async function recordSwitchAndRollCooldown() {
  // Random 5–12 minutes, re-rolled each time so the spacing isn't predictable
  const minMs = 5 * 60 * 1000;
  const maxMs = 12 * 60 * 1000;
  const cooldown = minMs + Math.random() * (maxMs - minMs);
  await new Promise(r => chrome.storage.local.set({
    [SWITCH_LAST_AT_KEY]:    Date.now(),
    [SWITCH_NEXT_AFTER_KEY]: Date.now() + cooldown,
  }, r));
}

// Opens IG's "Switch accounts" modal. Returns the dialog element or null.
async function openSwitcherModal() {
  // Already open?
  let dialog = document.querySelector('div[role="dialog"]');
  if (dialog && /switch account/i.test(dialog.innerText || '')) return dialog;

  // Click the "More" / Settings hamburger in the left nav. IG uses different
  // SVG aria-labels across layouts; cover the common ones.
  const more = [...document.querySelectorAll(
    'svg[aria-label="Settings"], svg[aria-label="More"], svg[aria-label="Menu"]'
  )].map(s => s.closest('a, button, div[role="button"]')).find(Boolean);
  if (more) {
    more.click();
    await sleep(1200);
  }

  // Click the "Switch accounts" entry in the menu that just opened.
  const switchLink = [...document.querySelectorAll(
    'a, button, [role="button"], [role="menuitem"], div[tabindex]'
  )].find(el => /^switch\s+accounts?$/i.test((el.innerText || '').trim().split('\n')[0]));
  if (switchLink) {
    switchLink.click();
    await sleep(1200);
  }

  return await waitFor(() => {
    const d = document.querySelector('div[role="dialog"]');
    if (d && /switch account/i.test(d.innerText || '')) return d;
    return null;
  }, 5000);
}

function readUsernamesFromSwitcher(dialog) {
  if (!dialog) return [];
  const usernames = new Set();
  dialog.querySelectorAll('*').forEach(el => {
    if (el.children.length > 0) return;
    const txt = (el.textContent || '').trim();
    if (/^[a-zA-Z0-9._]{2,30}$/.test(txt) && !/^(switch|account|accounts|log|into|existing|cancel)$/i.test(txt)) {
      usernames.add(txt);
    }
  });
  return [...usernames];
}

// Switches to the given account. Returns true once the URL/page reflects it.
async function switchToAccount(targetUsername) {
  const current = getLoggedInUsername();
  if (!current) return false;
  if (current.toLowerCase() === targetUsername.toLowerCase()) return true;

  const dialog = await openSwitcherModal();
  if (!dialog) { progress("⚠ Switcher modal didn't open"); return false; }

  // Find the leaf element with the matching username text
  const target = [...dialog.querySelectorAll('*')].find(el => {
    if (el.children.length > 0) return false;
    return (el.textContent || '').trim().toLowerCase() === targetUsername.toLowerCase();
  });
  if (!target) { progress(`⚠ Account "${targetUsername}" not in switcher`); return false; }

  // Walk up to find the clickable container — usually a few levels up
  let clickable = target;
  for (let i = 0; i < 8 && clickable; i++) {
    if (clickable.matches('button, a, [role="button"], div[tabindex]')) break;
    if (!clickable.parentElement) break;
    clickable = clickable.parentElement;
  }
  clickable.click();

  // IG reloads the page on switch — wait for the new username to surface
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    const u = getLoggedInUsername();
    if (u && u.toLowerCase() === targetUsername.toLowerCase()) return true;
  }
  return false;
}

// Triggered from popup → scrapes the switcher modal and syncs to Bibix
async function handleScanAccounts() {
  progress("Opening account switcher…");
  const dialog = await openSwitcherModal();
  if (!dialog) {
    progress("⚠ Couldn't open the switcher — make sure you're logged in and on instagram.com");
    notifyPopup({ type: "DONE" });
    return;
  }
  const list = readUsernamesFromSwitcher(dialog);
  if (list.length === 0) {
    progress("⚠ No accounts found in the switcher");
    notifyPopup({ type: "DONE" });
    return;
  }
  progress(`Found ${list.length} accounts. Syncing…`);
  chrome.runtime.sendMessage(
    { action: "BIBIX_SCAN_ACCOUNTS", accounts: list },
    (res = {}) => {
      progress(res?.ok ? `✓ ${list.length} accounts synced` : "⚠ Sync failed");
      notifyPopup({ type: "DONE" });
    }
  );
}

// Manual switch trigger from popup
async function handleManualSwitch(targetUsername, waitCooldown = false) {
  if (!targetUsername) { progress("⚠ No username given"); notifyPopup({ type: "DONE" }); return; }
  progress(`Switching to @${targetUsername}…`);
  const cd = await canSwitchNow();
  if (!cd.allowed) {
    if (waitCooldown) {
      // Automation context: wait out the cooldown silently so a multi-account
      // sweep doesn't need babysitting. The cooldown's purpose (avoid rapid
      // switching that IG flags) is preserved — we still wait the full
      // duration before proceeding.
      const waitMin = Math.ceil(cd.waitMs / 60000);
      progress(`⏳ Cooldown — waiting ${waitMin} min before switching to @${targetUsername}…`);
      await sleep(cd.waitMs + 1000);
    } else {
      progress(`⏳ Cooldown — wait ${Math.ceil(cd.waitMs / 60000)} more minute(s)`);
      notifyPopup({ type: "DONE" });
      return;
    }
  }
  const ok = await switchToAccount(targetUsername);
  if (ok) {
    await recordSwitchAndRollCooldown();
    progress(`✓ Switched to @${targetUsername}`);
  } else {
    progress(`⚠ Switch to @${targetUsername} failed`);
  }
  notifyPopup({ type: "DONE" });
}

/* ============================================================================
   PROFILE RESEARCH SCRAPER
   ----------------------------------------------------------------------------
   Given a target username + post count, navigates the existing IG tab to the
   profile (background already did that), then iterates the first N post tiles
   in the grid. For each tile, dispatches a synthetic hover so IG's overlay
   appears (heart + chat icons with counts), reads the numbers, moves on. No
   modal opens; we stay on the profile page the whole time.
============================================================================ */

function parseSocialNumber(s) {
  if (!s) return null;
  s = String(s).replace(/,/g, "").trim();
  const m = s.match(/^([\d.]+)\s*([KMB])?$/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  const suffix = (m[2] || "").toUpperCase();
  if (suffix === "K") return Math.round(n * 1000);
  if (suffix === "M") return Math.round(n * 1000000);
  if (suffix === "B") return Math.round(n * 1000000000);
  return Math.round(n);
}

// Collect all unique post/reel anchors currently rendered in the grid.
// IG's hrefs are username-prefixed on profile pages (e.g.
// "/elizabethvasilenko/reel/SHORTCODE/") but the old "/p/SHORTCODE/" format
// still appears in some places — accept both.
function collectGridTiles() {
  const out = [];
  const seen = new Set();
  for (const a of document.querySelectorAll('a[href]')) {
    const href = a.getAttribute("href") || "";
    const m = href.match(/^\/(?:[\w._]+\/)?(p|reel)\/([\w-]+)\/?(?:\?.*)?$/);
    if (!m) continue;
    const shortcode = m[2];
    if (seen.has(shortcode)) continue;
    seen.add(shortcode);
    out.push({ anchor: a, shortcode, type: m[1] === "reel" ? "reel" : "post", href });
  }
  return out;
}

async function scrapeProfileGrid(targetUsername, count) {
  const expectedPrefix = `/${targetUsername.toLowerCase()}/`;
  if (!location.pathname.toLowerCase().startsWith(expectedPrefix)) {
    throw new Error(`Not on @${targetUsername}'s profile (path: ${location.pathname})`);
  }

  // Wait for the grid to render at least one tile.
  await waitFor(
    () => document.querySelector('a[href*="/p/"], a[href*="/reel/"]'),
    12000
  );

  // Scroll until we have enough tiles (or IG stops loading more).
  let tiles = collectGridTiles();
  let stagnantScrolls = 0;
  while (tiles.length < count && stagnantScrolls < 3) {
    const prevLen = tiles.length;
    window.scrollTo(0, document.body.scrollHeight);
    await sleep(1500);
    tiles = collectGridTiles();
    if (tiles.length === prevLen) stagnantScrolls++;
    else stagnantScrolls = 0;
  }

  window.scrollTo(0, 0);
  await sleep(400);

  const slice = tiles.slice(0, count);
  const results = [];

  for (let i = 0; i < slice.length; i++) {
    if (STOP) break;
    const tile = slice[i];

    // Re-query the anchor by href because IG re-renders during scrolling and
    // the original reference may be detached from the DOM.
    const anchors = [...document.querySelectorAll(`a[href="${tile.href}"]`)];
    const a = anchors[0];
    if (!a) {
      results.push({
        shortcode: tile.shortcode,
        post_url: `https://www.instagram.com${tile.href}`,
        post_type: tile.type,
        likes: null, views: null, comments: null,
      });
      continue;
    }

    a.scrollIntoView({ block: "center", behavior: "auto" });
    await sleep(350);

    // Synthesize a hover. IG's overlay uses both mouse and pointer events
    // depending on browser feature detection — fire both.
    const fireMouse = (type, el) => el.dispatchEvent(
      new MouseEvent(type, { bubbles: true, cancelable: true, view: window })
    );
    const firePointer = (type, el) => {
      try { el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true })); } catch (_) {}
    };
    fireMouse("mouseover", a);
    fireMouse("mouseenter", a);
    firePointer("pointerover", a);
    firePointer("pointerenter", a);
    await sleep(700);

    // Read the overlay numbers from the anchor's own innerText. The image
    // contributes no text, so anything in here came from the overlay layer
    // IG renders on hover (likes/views + comments).
    const text = (a.innerText || "").trim();
    const numbers = [...text.matchAll(/([\d.,]+\s*[KMB]?)/g)]
      .map(m => parseSocialNumber(m[1].trim()))
      .filter(n => n != null);

    let likes = null, views = null, comments = null;
    if (tile.type === "reel") {
      views    = numbers[0] ?? null;
      comments = numbers[1] ?? null;
    } else {
      likes    = numbers[0] ?? null;
      comments = numbers[1] ?? null;
    }

    results.push({
      shortcode: tile.shortcode,
      post_url: `https://www.instagram.com${tile.href}`,
      post_type: tile.type,
      likes, views, comments,
    });

    // Move the synthetic mouse off so the next iteration has a clean state.
    fireMouse("mouseout", a);
    fireMouse("mouseleave", a);
    await sleep(120);

    progress(`🔍 Scraped ${i + 1}/${slice.length} of @${targetUsername}`);
  }

  return results;
}

async function handleScrapeProfile(targetUsername, postCount, jobId) {
  const cleaned = String(targetUsername || "").trim().replace(/^@/, "").toLowerCase();
  const count = Math.max(1, Math.min(200, parseInt(postCount, 10) || 25));

  if (!cleaned) {
    chrome.runtime.sendMessage({
      action: "BIBIX_SCRAPE_DONE", job_id: jobId,
      status: "failed", error: "No target_username",
    });
    notifyPopup({ type: "DONE" });
    return;
  }

  progress(`🔍 Scraping @${cleaned} (${count} posts)…`);
  try {
    const posts = await scrapeProfileGrid(cleaned, count);
    progress(`✓ Scraped ${posts.length} posts from @${cleaned}`);
    chrome.runtime.sendMessage({
      action: "BIBIX_SCRAPE_DONE",
      job_id: jobId,
      target_username: cleaned,
      status: "completed",
      posts,
      posts_scraped: posts.length,
    });
  } catch (e) {
    const msg = (e && e.message) || String(e);
    progress(`⚠ Scrape failed: ${msg}`);
    chrome.runtime.sendMessage({
      action: "BIBIX_SCRAPE_DONE",
      job_id: jobId,
      target_username: cleaned,
      status: "failed",
      error: msg,
    });
  }
  notifyPopup({ type: "DONE" });
}

/* ===== PROFILE ENRICHMENT (country + joined month) =====
 * v1.43: scrape the "About this account" panel on a user's IG profile
 * to get country + date joined. Triggered by background.js poller which
 * spawns one tab at a time pointing at /<username>/, dispatches
 * ENRICH_PROFILE, then closes the tab after the result is posted.
 *
 * Flow inside the tab:
 *   1. Wait until the profile page is rendered (header + post grid).
 *   2. Find and click the "..." (More options) button next to the
 *      Follow / Message buttons.
 *   3. Click "About this account" in the dropdown menu.
 *   4. Parse the modal: country (under "Account based in"), joined
 *      month (under "Date joined").
 *   5. POST to /api/instagram/user-profiles via background.js, then
 *      tell background to close the tab.
 *
 * IG's modal structure changes occasionally so the selectors are kept
 * defensive (text-based with fallbacks). When IG hides "About" entirely
 * (e.g., small accounts), we still POST a row with country=null so the
 * backend marks the username enriched and doesn't keep re-trying.
 */
async function handleEnrichProfile(username) {
  const cleaned = String(username || "").trim().replace(/^@/, "").toLowerCase();
  if (!cleaned) {
    chrome.runtime.sendMessage({ action: "BIBIX_ENRICH_DONE", status: "failed", error: "no username" });
    return;
  }

  progress(`🌍 Enriching @${cleaned}…`);

  // Wait for profile page to render — looks for the header h2 with the
  // username, or the follower-count strong, whichever comes first.
  const waitForProfileReady = async (timeoutMs = 15000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const hdr = document.querySelector('header h2, main header h2');
      if (hdr) return true;
      await sleep(300);
    }
    return false;
  };

  const ready = await waitForProfileReady();
  if (!ready) {
    chrome.runtime.sendMessage({
      action: "BIBIX_ENRICH_DONE", username: cleaned,
      status: "failed", error: "profile_not_loaded",
    });
    return;
  }

  // Try to find the "..." (More options) button. IG renders it as an
  // svg with aria-label "Options" or a button containing such an svg.
  const findOptionsButton = () => {
    const svgs = Array.from(document.querySelectorAll('svg[aria-label]'));
    for (const svg of svgs) {
      const label = (svg.getAttribute('aria-label') || '').toLowerCase();
      if (label === 'options' || label === 'more options') {
        const btn = svg.closest('button, [role="button"], div[role="button"]');
        if (btn) return btn;
      }
    }
    return null;
  };

  // Click any element whose text exactly matches one of these labels.
  const clickByText = (texts, root = document) => {
    const target = texts.map(t => t.toLowerCase());
    const candidates = root.querySelectorAll('button, [role="button"], div[role="dialog"] *, [role="menuitem"]');
    for (const el of candidates) {
      const t = (el.innerText || el.textContent || '').trim().toLowerCase();
      if (!t) continue;
      if (target.some(tg => t === tg || t.startsWith(tg + '\n'))) {
        try { el.click(); return el; } catch (_) {}
      }
    }
    return null;
  };

  const optionsBtn = findOptionsButton();
  if (!optionsBtn) {
    chrome.runtime.sendMessage({
      action: "BIBIX_ENRICH_DONE", username: cleaned,
      status: "no_panel", error: "options_button_not_found",
    });
    return;
  }

  optionsBtn.click();
  await sleep(700 + rand(300));

  // After clicking "...", a menu (or dialog) appears with options
  // including "About this account". Click it.
  const aboutClicked = clickByText(['about this account']);
  if (!aboutClicked) {
    try { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); } catch (_) {}
    chrome.runtime.sendMessage({
      action: "BIBIX_ENRICH_DONE", username: cleaned,
      status: "no_panel", error: "about_link_not_found",
    });
    return;
  }

  // Wait for the modal to appear and content to render. The modal is a
  // div[role="dialog"]; we look for the label text "Account based in"
  // inside it.
  const waitForAboutModal = async (timeoutMs = 8000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const text = document.body.innerText || '';
      if (/Account based in/i.test(text) || /Date joined/i.test(text)) return true;
      await sleep(300);
    }
    return false;
  };

  const ok = await waitForAboutModal();
  if (!ok) {
    chrome.runtime.sendMessage({
      action: "BIBIX_ENRICH_DONE", username: cleaned,
      status: "no_panel", error: "about_modal_did_not_render",
    });
    return;
  }

  // Parse the modal content. The structure is reliably:
  //   "Date joined\nJune 2026"
  //   "Account based in\nUnited Kingdom"
  const modal = document.querySelector('div[role="dialog"]') || document.body;
  const fullText = modal.innerText || '';

  let country = null;
  const mCountry = fullText.match(/Account based in\s*\n?\s*([^\n]+)/i);
  if (mCountry) country = mCountry[1].trim();

  let joined = null;
  const mJoined = fullText.match(/Date joined\s*\n?\s*([^\n]+)/i);
  if (mJoined) joined = mJoined[1].trim();

  // Close the modal so the next enrichment iteration starts clean.
  const closeBtn = modal.querySelector('svg[aria-label="Close"]')?.closest('button, [role="button"]');
  if (closeBtn) { try { closeBtn.click(); } catch (_) {} }
  else { try { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); } catch (_) {} }

  chrome.runtime.sendMessage({
    action: "BIBIX_ENRICH_DONE",
    username: cleaned,
    status: "ok",
    country,
    joined_month: joined,
  });

  progress(`✓ Enriched @${cleaned}: ${country || 'no country'}`);
}
