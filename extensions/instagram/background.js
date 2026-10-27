// ── Groq API with retry ───────────────────────────────────────────────────────
// Retries up to 3 times on 5xx / network errors with exponential backoff.
// Returns the reply string on success, or null if all attempts fail.
async function groqWithRetry(apiKey, prompt, maxTokens = 100, attempts = 3) {
  const body = JSON.stringify({
    model: "llama-3.1-8b-instant",
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
  });

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method:  "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
        body,
      });

      // 5xx = server error → retry
      if (res.status >= 500) {
        if (attempt < attempts) {
          await new Promise(r => setTimeout(r, attempt * 1500)); // 1.5s, 3s backoff
          continue;
        }
        return null;
      }

      const data = await res.json();
      if (data.error) return null;
      return (data.choices?.[0]?.message?.content || "").trim() || null;

    } catch (_) {
      if (attempt < attempts) {
        await new Promise(r => setTimeout(r, attempt * 1500));
        continue;
      }
      return null;
    }
  }
  return null;
}

// ── Daily follower-count tracker ─────────────────────────────────────────────
// Once every 24h, the extension opens each of the user's IG profiles in a
// background tab and reads the follower count from the og:description meta
// tag (publicly visible — no login switch required). Counts are uploaded to
// Bibix so Monday can chart the trend.
const FOLLOWER_COUNT_ALARM = "bibixFollowerCount";
// Poll every 2 minutes so manual "Refresh now" triggers from Monday fire
// quickly. The 23h cooldown / calendar-day check inside the handler keeps
// the actual scrape work running at most once per day (unless triggered).
const FOLLOWER_COUNT_ALARM_PERIOD_MINUTES = 2;
const FOLLOWER_COUNT_LAST_RUN_KEY = "bibixLastFollowerCountAt";

function ensureFollowerCountAlarm() {
  chrome.alarms.get(FOLLOWER_COUNT_ALARM, (existing) => {
    if (!existing) chrome.alarms.create(FOLLOWER_COUNT_ALARM, { periodInMinutes: FOLLOWER_COUNT_ALARM_PERIOD_MINUTES });
  });
}
chrome.runtime.onInstalled.addListener(ensureFollowerCountAlarm);
chrome.runtime.onStartup.addListener(ensureFollowerCountAlarm);
ensureFollowerCountAlarm();

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== FOLLOWER_COUNT_ALARM) return;
  try { await runDailyFollowerCount(); }
  catch (e) { console.warn("[BibixBG] follower-count error:", e?.message || e); }
});

async function runDailyFollowerCount() {
  const { bibixAutomationEnabled, [FOLLOWER_COUNT_LAST_RUN_KEY]: lastRun } = await new Promise(r =>
    chrome.storage.local.get(["bibixAutomationEnabled", FOLLOWER_COUNT_LAST_RUN_KEY], r));
  if (bibixAutomationEnabled === false) return;

  // Check Monday for a manual "Refresh now" trigger. The endpoint
  // atomically clears the flag so we don't run twice for one click.
  let triggered = false;
  try {
    const r = await bibixGet("/follower-counts/should-trigger");
    triggered = !!r?.should_run;
  } catch (_) {}

  // Cooldown: skip if we've already counted today (unless manually triggered).
  // Using calendar-day comparison instead of a 23h sliding window so the
  // schedule doesn't drift later every day.
  const today = new Date().toDateString();
  const lastRunDay = lastRun ? new Date(lastRun).toDateString() : null;
  if (!triggered && lastRunDay === today) return;
  if (triggered) console.log("[BibixBG] follower-count: manual trigger received");

  // Pull list of the user's accounts from Bibix (the /accounts endpoint
  // returns just usernames synced from the extension's "Scan accounts" run).
  const accounts = await bibixGet("/accounts");
  if (!Array.isArray(accounts) || accounts.length === 0) {
    console.log("[BibixBG] follower-count: no accounts configured, skipping");
    return;
  }
  console.log(`[BibixBG] follower-count: scraping ${accounts.length} account(s)`);

  for (const username of accounts) {
    try {
      const count = await scrapeFollowerCount(username);
      if (Number.isFinite(count)) {
        await bibixPost("/follower-counts", { my_profile: username, follower_count: count });
        console.log(`[BibixBG] follower-count @${username} = ${count}`);
      } else {
        console.warn(`[BibixBG] follower-count @${username} unreadable`);
      }
    } catch (e) {
      console.warn(`[BibixBG] follower-count @${username} failed:`, e?.message || e);
    }
  }

  chrome.storage.local.set({ [FOLLOWER_COUNT_LAST_RUN_KEY]: Date.now() });
}

async function scrapeFollowerCount(username) {
  const url = `https://www.instagram.com/${encodeURIComponent(username)}/`;
  const tab = await chrome.tabs.create({ url, active: false });
  try {
    // Wait for the page to settle
    await new Promise((resolve) => {
      const listener = (tabId, info) => {
        if (tabId === tab.id && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener); resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
      setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(); }, 20000);
    });
    await new Promise(r => setTimeout(r, 3500)); // give React time to render the count in the DOM

    // IG's logged-in pages don't expose og:description anymore, so the
    // rendered DOM's innerText is the most reliable place to read the count
    // from. We fall back to the old meta + JSON strategies for accounts
    // viewed while logged out.
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const parseNum = (s) => {
          if (!s) return null;
          const clean = String(s).replace(/,/g, '').trim();
          const m = clean.match(/^([\d.]+)\s*([KMB])?$/i);
          if (!m) return null;
          const n = parseFloat(m[1]);
          if (!Number.isFinite(n)) return null;
          const suffix = (m[2] || '').toUpperCase();
          if (suffix === 'K') return Math.round(n * 1000);
          if (suffix === 'M') return Math.round(n * 1000000);
          if (suffix === 'B') return Math.round(n * 1000000000);
          return Math.round(n);
        };

        // Strategy 1: rendered page text (works on logged-in IG, which is what
        // the extension actually has access to). Rounded for accounts >= 1K.
        try {
          const txt = document.body?.innerText || '';
          const m = txt.match(/([\d,.]+\s*[KMB]?)\s+followers/i);
          if (m) {
            const n = parseNum(m[1]);
            if (Number.isFinite(n)) return n;
          }
        } catch {}

        // Strategy 2: og:description meta tag (logged-out / SEO views)
        try {
          const meta = document.querySelector('meta[property="og:description"], meta[name="description"]');
          if (meta) {
            const content = meta.getAttribute('content') || '';
            const m = content.match(/([\d,.]+\s*[KMB]?)\s+Followers/i);
            if (m) {
              const n = parseNum(m[1]);
              if (Number.isFinite(n)) return n;
            }
          }
        } catch {}

        // Strategy 3: parse embedded JSON for edge_followed_by.count
        try {
          const scripts = document.querySelectorAll('script[type="application/json"], script[type="application/ld+json"]');
          for (const s of scripts) {
            const txt = s.textContent || '';
            const m = txt.match(/"edge_followed_by"\s*:\s*\{\s*"count"\s*:\s*(\d+)/);
            if (m) return parseInt(m[1], 10);
          }
        } catch {}

        return null;
      },
    });
    return result?.result ?? null;
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

// One-time cleanup of legacy local caches (actionLog, campaignLog).
// Backend is now the source of truth — the extension only writes via
// bibixPost/bibixPatch and no longer mirrors data into chrome.storage.local.
// Idempotent; safe to call on every wake-up.
function cleanupLegacyLocalCaches() {
  try { chrome.storage.local.remove(["actionLog", "campaignLog"]); } catch (_) {}
}
chrome.runtime.onInstalled.addListener(cleanupLegacyLocalCaches);
chrome.runtime.onStartup.addListener(cleanupLegacyLocalCaches);
cleanupLegacyLocalCaches();

// ── Automations executor ─────────────────────────────────────────────────────
// Backend computes next_run_at for each automation. The extension polls
// /automations/due once a minute and runs whatever it finds. Result is
// reported back so backend rolls the schedule forward.
const AUTOMATIONS_ALARM = "bibixAutomations";
const AUTOMATIONS_ALARM_PERIOD_MINUTES = 1;

function ensureAutomationsAlarm() {
  chrome.alarms.get(AUTOMATIONS_ALARM, (existing) => {
    if (!existing) chrome.alarms.create(AUTOMATIONS_ALARM, { periodInMinutes: AUTOMATIONS_ALARM_PERIOD_MINUTES });
  });
}
chrome.runtime.onInstalled.addListener(ensureAutomationsAlarm);
chrome.runtime.onStartup.addListener(ensureAutomationsAlarm);
ensureAutomationsAlarm();

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== AUTOMATIONS_ALARM) return;
  try { await runAutomationsProcessor(); }
  catch (e) { console.warn("[BibixBG] automations error:", e?.message || e); }
});

// SAFETY: in-memory set of automation IDs whose previous run is still in
// progress. Without this, the 1-min alarm tick could start a NEW copy of a
// long-running automation (the multi-account scan_notifications sweep takes
// 30+ min). That's what produced the runaway loop: 20 concurrent copies of
// the same automation, each opening tabs and switching accounts.
const inflightAutomations = new Set();

// SAFETY: per-automation consecutive failure counter. After N failures in a
// row, we PATCH enabled=0 to stop the bleed automatically. Resets to 0 on
// the next success.
const automationFailCounts = new Map();
const AUTO_DISABLE_AFTER_FAILS = 3;

// SAFETY: kill switch persisted in chrome.storage.local. When true, NO
// extension activity proceeds — actions, automations, scrapes, scheduled
// posts, EVERYTHING pauses until the user un-flips it.
async function isKillSwitchOn() {
  const { bibixKillSwitch } = await new Promise(r =>
    chrome.storage.local.get(["bibixKillSwitch"], r));
  return bibixKillSwitch === true;
}

async function runAutomationsProcessor() {
  if (await isKillSwitchOn()) {
    console.log("[BibixBG] kill switch ON — automations skipped");
    return;
  }

  const { bibixAutomationEnabled } = await new Promise(r =>
    chrome.storage.local.get(["bibixAutomationEnabled"], r));
  if (bibixAutomationEnabled === false) return;

  const due = await bibixGet("/automations/due");
  if (!Array.isArray(due) || due.length === 0) return;
  console.log(`[BibixBG] automations: ${due.length} due`);

  for (const auto of due) {
    // SAFETY: skip if this automation's previous run is still going.
    // Critical for long-running sweeps (multi-account scans, etc).
    if (inflightAutomations.has(auto.id)) {
      console.log(`[BibixBG] automation "${auto.name}" already inflight — skipping this tick`);
      continue;
    }
    inflightAutomations.add(auto.id);
    try {
      await runOneAutomation(auto);
      await bibixRequest("PATCH", `/automations/${auto.id}/done`, { status: 'ok' });
      console.log(`[BibixBG] automation "${auto.name}" → ok`);
      automationFailCounts.delete(auto.id); // reset on success
    } catch (e) {
      const errMsg = e?.message || String(e);
      console.warn(`[BibixBG] automation "${auto.name}" failed:`, errMsg);
      await bibixRequest("PATCH", `/automations/${auto.id}/done`, { status: 'failed', error: errMsg });
      const fails = (automationFailCounts.get(auto.id) || 0) + 1;
      automationFailCounts.set(auto.id, fails);
      if (fails >= AUTO_DISABLE_AFTER_FAILS) {
        console.warn(`[BibixBG] automation "${auto.name}" hit ${fails} consecutive failures — auto-disabling`);
        await bibixRequest("PATCH", `/automations/${auto.id}`, { enabled: 0 }).catch(() => {});
        automationFailCounts.delete(auto.id);
      }
    } finally {
      inflightAutomations.delete(auto.id);
    }
  }
}

async function runOneAutomation(auto) {
  const actions  = Array.isArray(auto.actions)  ? auto.actions  : [];
  const accounts = Array.isArray(auto.accounts) ? auto.accounts : [];
  const errors = [];
  for (const action of actions) {
    for (const account of accounts) {
      try {
        await runAutomationAction(action, account);
      } catch (e) {
        errors.push(`${action}@${account}: ${e?.message || e}`);
      }
    }
  }
  if (errors.length) throw new Error(errors.join("; "));
}

async function runAutomationAction(action, account) {
  switch (action) {
    case 'follower_count': {
      // Reuses the existing public-profile scraper — no login switch needed.
      const count = await scrapeFollowerCount(account);
      if (Number.isFinite(count)) {
        await bibixPost("/follower-counts", { my_profile: account, follower_count: count });
        console.log(`[BibixBG]   follower_count @${account} = ${count}`);
      } else {
        throw new Error(`could not read follower count for @${account}`);
      }
      return;
    }
    case 'snapshot_followers_full': {
      // Open the account's own profile, ask the content script to auto-open
      // the Followers modal + scroll-collect every username. Requires the
      // Chrome session to be logged in AS this account (own followers
      // aren't visible to other accounts without following them).
      const url = `https://www.instagram.com/${encodeURIComponent(account)}/`;
      const tab = await chrome.tabs.create({ url, active: true });
      try {
        // Wait for the page to finish loading (or 20s safety cap).
        await new Promise((resolve) => {
          const onUpd = (tabId, info) => {
            if (tabId === tab.id && info.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(onUpd); resolve();
            }
          };
          chrome.tabs.onUpdated.addListener(onUpd);
          setTimeout(() => { chrome.tabs.onUpdated.removeListener(onUpd); resolve(); }, 20000);
        });
        await new Promise(r => setTimeout(r, 3000)); // React settle.

        // Listen for the content script's completion message so we can
        // close the tab and resolve. The existing BIBIX_SNAPSHOT_FOLLOWERS
        // handler in this same background script still saves the data via
        // bibixPost — we just observe to know when to move on.
        const completion = new Promise((resolve) => {
          const onMsg = (m, sender) => {
            if (sender.tab?.id === tab.id && m?.action === "BIBIX_SNAPSHOT_FOLLOWERS") {
              chrome.runtime.onMessage.removeListener(onMsg);
              resolve({ count: (m.followers || []).length });
            }
          };
          chrome.runtime.onMessage.addListener(onMsg);
          // Big window: scrolling thousands of followers can take a while.
          setTimeout(() => {
            chrome.runtime.onMessage.removeListener(onMsg);
            resolve(null);
          }, 5 * 60 * 1000); // 5 min cap
        });

        await chrome.tabs.sendMessage(tab.id, { action: "SNAPSHOT_FOLLOWERS", autoOpen: true })
          .catch(() => {});
        const result = await completion;
        if (!result) throw new Error(`snapshot_followers_full timed out for @${account}`);
        console.log(`[BibixBG]   snapshot_followers_full @${account} = ${result.count} followers`);
      } finally {
        chrome.tabs.remove(tab.id).catch(() => {});
      }
      return;
    }
    case 'scan_notifications': {
      // Open IG home, switch to the target account if needed, then auto-open
      // the Notifications panel and scan. Sequence:
      //   1. Create tab → wait for load
      //   2. Detect current Chrome IG account
      //   3. If ≠ target, send SWITCH_ACCOUNT and wait for the post-switch
      //      page reload + content-script re-injection, then verify
      //   4. Send SCAN_NOTIFICATIONS with autoOpen=true → wait for DONE
      //   5. Close tab
      // This lets a daily multi-account scan run unattended overnight.
      const url = `https://www.instagram.com/`;
      const tab = await chrome.tabs.create({ url, active: true });
      try {
        // Wait for initial load.
        await new Promise((resolve) => {
          const onUpd = (tabId, info) => {
            if (tabId === tab.id && info.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(onUpd); resolve();
            }
          };
          chrome.tabs.onUpdated.addListener(onUpd);
          setTimeout(() => { chrome.tabs.onUpdated.removeListener(onUpd); resolve(); }, 20000);
        });
        await new Promise(r => setTimeout(r, 3000));

        // Check current account on this tab.
        const currentAccount = await detectCurrentAccount(tab.id);
        const targetAccount = (account || '').toLowerCase();
        console.log(`[BibixBG]   scan_notifications: current=@${currentAccount || '?'} target=@${targetAccount}`);

        if (currentAccount && currentAccount.toLowerCase() !== targetAccount) {
          // Trigger account switch via the existing content-script handler.
          // The switch causes IG to reload the page; we listen for the DONE
          // ack and then wait for the new content script to be ready before
          // sending SCAN.
          console.log(`[BibixBG]   switching from @${currentAccount} → @${targetAccount}`);
          const switchDone = new Promise((resolve) => {
            const onMsg = (m, sender) => {
              if (sender.tab?.id === tab.id && m?.type === "DONE") {
                chrome.runtime.onMessage.removeListener(onMsg);
                resolve();
              }
            };
            chrome.runtime.onMessage.addListener(onMsg);
            // 15min cap — covers worst-case cooldown (12min) + switch + reload.
            // Cooldown is randomized 5-12min per recordSwitchAndRollCooldown.
            setTimeout(() => { chrome.runtime.onMessage.removeListener(onMsg); resolve(); }, 15 * 60 * 1000);
          });
          await chrome.tabs.sendMessage(tab.id, {
            action: "SWITCH_ACCOUNT",
            username: targetAccount,
            // Wait out the 5-12 min anti-flag cooldown silently. Without
            // this, only the first account in a multi-account sweep would
            // actually switch — the rest would all hit cooldown and skip.
            waitCooldown: true,
          }).catch(() => {});
          await switchDone;
          // Page reloaded as part of the switch — wait for the new content
          // script to inject + IG to hydrate.
          await new Promise(r => setTimeout(r, 6000));
          // Verify.
          const verified = await detectCurrentAccount(tab.id);
          if (!verified || verified.toLowerCase() !== targetAccount) {
            throw new Error(`Switch to @${targetAccount} failed (still @${verified || '?'})`);
          }
          console.log(`[BibixBG]   switch OK → @${verified}`);
        }

        // Listen for handleScanNotifications' done() — sent as { type: "DONE" }.
        const completion = new Promise((resolve) => {
          const onMsg = (m, sender) => {
            if (sender.tab?.id === tab.id && m?.type === "DONE") {
              chrome.runtime.onMessage.removeListener(onMsg);
              resolve({ count: m.countDone || 0 });
            }
          };
          chrome.runtime.onMessage.addListener(onMsg);
          setTimeout(() => {
            chrome.runtime.onMessage.removeListener(onMsg);
            resolve(null);
          }, 3 * 60 * 1000);
        });

        await chrome.tabs.sendMessage(tab.id, { action: "SCAN_NOTIFICATIONS", autoOpen: true })
          .catch(() => {});
        const result = await completion;
        if (!result) throw new Error(`scan_notifications timed out for @${account}`);
        console.log(`[BibixBG]   scan_notifications @${account} complete (${result.count} processed)`);
      } finally {
        chrome.tabs.remove(tab.id).catch(() => {});
      }
      return;
    }
    default:
      throw new Error(`unknown action type: ${action}`);
  }
}

// ── Action queue orchestration (likes + replies campaigns) ───────────────────
// Monday queues "do N likes / M replies on these posts as @X" campaigns.
// Each alarm tick we:
//   1. Time out any in-flight actions older than 10 min (mark failed).
//   2. Detect the currently-active IG account.
//   3. If the current account has pending work, claim a batch and dispatch
//      each item as its own background tab.
//   4. If a different account has work and nothing is in flight, trigger an
//      account switch (the content script handles the cooldown internally).
// Per-tab completion is reported via the existing "DONE" message that
// handleLikes / handleComments emit when finished — we listen for it below.
const ACTION_ALARM = "bibixActionQueue";
const ACTION_ALARM_PERIOD_MINUTES = 1;
const ACTIVE_ACTIONS_KEY = "bibixActiveActions";
// SAFETY: hard cap on total extension-controlled tabs (action queue + scrape +
// automation tabs). Was effectively unlimited via separate counters. With this
// ceiling, even a runaway loop can't open more than this number of tabs.
const GLOBAL_TAB_CAP = 3;
// Per-item hard cap is now a 24-hour safety net only. The real "is this
// tab stuck?" decision belongs to the 3-min progress-silence watchdog
// (ACTION_WATCHDOG_MS, set per-dispatch in dispatchActionItem) which
// resets every time the content script emits a PROGRESS message. So:
//   • Script actively liking (PROGRESS every few seconds) → runs forever
//   • Script crashed / wrong page / IG froze → fails in ~3 min
// 800-like, 2000-like, multi-hour overnight runs all just work as long
// as the script keeps reporting. 24h is just to catch true zombies
// (script kept reporting then Chrome itself froze, etc.).
const ACTION_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const MAX_CONCURRENT_ACTIONS = 6;

function ensureActionAlarm() {
  chrome.alarms.get(ACTION_ALARM, (existing) => {
    if (!existing) chrome.alarms.create(ACTION_ALARM, { periodInMinutes: ACTION_ALARM_PERIOD_MINUTES });
  });
}
chrome.runtime.onInstalled.addListener(ensureActionAlarm);
chrome.runtime.onStartup.addListener(ensureActionAlarm);
ensureActionAlarm();

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ACTION_ALARM) return;
  try {
    await sendActiveHeartbeats();
    await timeoutExpiredActions();
    await runActionProcessor();
  } catch (e) { console.warn("[BibixBG] action processor error:", e?.message || e); }
});

// Every alarm tick (~60s), ping the backend for each in-flight action
// to refresh its last_heartbeat_at column. The backend's stale-claim
// sweep uses that timestamp instead of "time since claimed", so a healthy
// long-running batch (hours-long like loop) is never falsely killed —
// only genuinely silent tabs (5+ min no heartbeat) get swept.
async function sendActiveHeartbeats() {
  const active = await getActiveActions();
  if (active.length === 0) return;
  for (const entry of active) {
    bibixPatch(`/action-queue/${entry.actionId}`, { heartbeat: true })
      .catch(e => console.warn(`[BibixBG] heartbeat for ${entry.actionId} failed:`, e?.message));
  }
}

async function getActiveActions() {
  const { [ACTIVE_ACTIONS_KEY]: list = [] } = await new Promise(r =>
    chrome.storage.local.get([ACTIVE_ACTIONS_KEY], r));
  return list;
}

async function setActiveActions(list) {
  return new Promise(r => chrome.storage.local.set({ [ACTIVE_ACTIONS_KEY]: list }, r));
}

async function timeoutExpiredActions() {
  const active = await getActiveActions();
  if (active.length === 0) return;
  const now = Date.now();
  const expired = active.filter(e => now - e.startedAt > ACTION_TIMEOUT_MS);
  if (expired.length === 0) return;
  for (const e of expired) {
    console.warn(`[BibixBG] action ${e.actionId} timed out`);
    bibixPatch(`/action-queue/${e.actionId}`, {
      // Don't pass count_done — leave it at whatever was last PATCHed
      // (preserves partial work; backend reconciler will fall back to
      // actual instagram_actions count if zero).
      status: 'failed', error_message: `Tab timed out after ${Math.round(ACTION_TIMEOUT_MS/60000)} minutes`,
    }).catch(() => {});
    chrome.tabs.remove(e.tabId).catch(() => {});
  }
  await setActiveActions(active.filter(e => now - e.startedAt <= ACTION_TIMEOUT_MS));
}

async function detectCurrentAccount(tabId) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        try {
          const scripts = document.querySelectorAll("script[type='application/json']");
          for (const s of scripts) {
            const m = (s.textContent || '').match(/"username"\s*:\s*"([^"]+)"/);
            if (m) return m[1];
          }
        } catch {}
        return null;
      },
    });
    return result?.result || null;
  } catch (e) {
    console.warn("[BibixBG] detectCurrentAccount failed:", e?.message);
    return null;
  }
}

async function ensureIGTab() {
  const tabs = await chrome.tabs.query({ url: "https://www.instagram.com/*" });
  if (tabs.length > 0) return tabs[0].id;
  const tab = await chrome.tabs.create({ url: "https://www.instagram.com/", active: false });
  await new Promise((resolve) => {
    const listener = (tabId, info) => {
      if (tabId === tab.id && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener); resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(); }, 30000);
  });
  await new Promise(r => setTimeout(r, 2500));
  return tab.id;
}

async function runActionProcessor() {
  if (await isKillSwitchOn()) {
    console.log("[BibixBG] kill switch ON — action processor skipped");
    return;
  }

  const { bibixAutomationEnabled } = await new Promise(r =>
    chrome.storage.local.get(["bibixAutomationEnabled"], r));
  if (bibixAutomationEnabled === false) return;

  const pendingAccounts = await bibixGet("/action-queue/pending-accounts");
  if (!Array.isArray(pendingAccounts) || pendingAccounts.length === 0) return;
  console.log("[BibixBG] action queue: pending accounts:", pendingAccounts);

  const active = await getActiveActions();
  // SAFETY: tighter cap than MAX_CONCURRENT_ACTIONS. Was 6, now hard-floored
  // at GLOBAL_TAB_CAP (3). Combined with visibility-aware dispatch (only one
  // tab focused at a time anyway), this caps the blast radius.
  const effectiveCap = Math.min(MAX_CONCURRENT_ACTIONS, GLOBAL_TAB_CAP);
  if (active.length >= effectiveCap) {
    console.log(`[BibixBG] action slots full (${active.length}/${effectiveCap}), waiting`);
    return;
  }

  const igTabId = await ensureIGTab();
  const currentAccount = await detectCurrentAccount(igTabId);
  console.log(`[BibixBG] current IG account: ${currentAccount}`);
  if (!currentAccount) return;

  const lc = currentAccount.toLowerCase();
  const firstPending = pendingAccounts[0];

  // v1.40: STRICT FIFO across accounts. The backend already orders
  // pendingAccounts by MIN(campaign.created_at) ASC — the first entry is
  // always the oldest-created batch's account. We must switch to it even
  // if the currently-logged-in IG account ALSO has pending work, otherwise
  // a user creating batch A first then batch B (different account) would
  // see B run while A sits forever — exactly the bug reported in the UI.
  //
  // Only exception: if there are in-flight items, finish them first
  // before switching. Interrupting a running batch mid-flight is worse
  // than a brief FIFO violation that resolves on the next poll.
  if (lc !== firstPending) {
    if (active.length > 0) {
      console.log(`[BibixBG] FIFO wait: oldest pending @${firstPending}, but @${currentAccount} has ${active.length} item(s) in flight — finishing those first`);
      return;
    }
    console.log(`[BibixBG] FIFO switch: @${currentAccount} → @${firstPending} (older pending)`);
    chrome.tabs.sendMessage(igTabId, { action: "SWITCH_ACCOUNT", username: firstPending }).catch(() => {});
    return;
  }

  // Current account has work — claim a batch. Use effectiveCap (the
  // tighter of MAX_CONCURRENT_ACTIONS and GLOBAL_TAB_CAP) so we never
  // claim more rows than we can safely dispatch.
  const slotsAvailable = effectiveCap - active.length;
  const url = `/action-queue/pending?as_account=${encodeURIComponent(currentAccount)}&limit=${slotsAvailable}`;
  const resp = await bibixGet(url);
  if (!resp || !Array.isArray(resp.items) || resp.items.length === 0) {
    console.log("[BibixBG] no items claimed (possibly all in flight on another device)"); return;
  }

  // PARALLEL processing: dispatch every item the backend claimed for us.
  // Earlier the slice(0,1) here stranded already-claimed items in 'claimed'
  // status forever (until the 10-min stale-claim sweep). Now we honor the
  // user's `concurrency` setting and open all claimed tabs.
  //
  // Trade-off: with multiple active tabs, only the LAST opened one keeps
  // focus, and IG's comment lazy-loader prefers visible tabs. So a batch
  // with concurrency=3 may have each item finish with partial counts
  // (e.g. 73/500) — that's what the new 'partial' status is for. Total
  // throughput across N tabs is still ≥ a single tab's because each one
  // gets at least the initial server-rendered batch of comments + scrolls.
  //
  // A small stagger (1.5s between opens) lets each tab briefly own focus
  // for its first comment-load before the next one steals it.
  console.log(`[BibixBG] dispatching ${resp.items.length} action(s) from campaign ${resp.campaign?.id}`);
  for (const item of resp.items) {
    await dispatchActionItem(item);
    await new Promise(r => setTimeout(r, 1500));
  }
}

// Normalize any IG post URL to the canonical modal format
// `https://www.instagram.com/p/SHORTCODE/?img_index=1` (or /reel/ for reels).
// This is required because IG renders profile-scoped URLs
// (`/USERNAME/p/CODE/`) as a full-page layout where the content script's
// comment selectors don't match. The modal layout (forced by /p/CODE/ and
// img_index=1) is what the script is tuned for.
function normalizePostUrl(rawUrl) {
  if (!rawUrl) return rawUrl;
  const m = String(rawUrl).match(/instagram\.com\/(?:[^/?#]+\/)?(p|reel|tv)\/([A-Za-z0-9_-]+)/);
  if (!m) return rawUrl;
  const [, kind, shortcode] = m;
  if (kind === 'p') {
    return `https://www.instagram.com/p/${shortcode}/?img_index=1`;
  }
  return `https://www.instagram.com/${kind}/${shortcode}/`;
}

async function dispatchActionItem(item) {
  // Normalize the stored URL to the canonical modal format so the comment
  // selectors in content.js match IG's layout (see normalizePostUrl above).
  const cleanUrl = normalizePostUrl(item.post_url);
  console.log(`[BibixBG] dispatch ${item.action_type} x${item.count_requested} → ${cleanUrl}`);

  // v1.42 DUPLICATE-TAB GUARD: if a tab is already open for this exact post
  // URL, do NOT open a second one. Two simultaneous content scripts on the
  // same post race each other — both pick the same comments (each tab has
  // its own usedAuthors Set), one likes the heart (Like → Unlike) and the
  // other re-clicks the same heart (Unlike → Like) effectively un-liking it.
  // That's the bug the user reported as "system is liking and unliking
  // the comments instead of leaving them liked".
  //
  // This can happen when: user clicks Retry on an item whose original tab
  // is still open from the previous attempt; user manually navigates to
  // the same post URL while a batch is running; a prior dispatch's tab
  // wasn't closed cleanly. Skip the dispatch — the existing tab is either
  // running or stuck; the heartbeat-based stale-claim sweep will release
  // the item if the existing tab is truly dead.
  try {
    const dupTabs = await chrome.tabs.query({ url: cleanUrl });
    if (dupTabs.length > 0) {
      console.warn(`[BibixBG] DUPLICATE GUARD: tab(s) already open for ${cleanUrl} (${dupTabs.map(t => t.id).join(',')}). NOT opening another — would race with existing content script.`);
      // Don't mark item as failed; leave it in claimed status. If the
      // existing tab finishes, normal flow proceeds. If it's truly stuck,
      // the 5-min heartbeat sweep will reset it to pending for re-claim.
      return;
    }
  } catch (_) { /* tabs.query can throw on extension startup; not fatal */ }

  // Find the window that has a logged-in IG tab. Without this, chrome.tabs
  // .create opens in the LAST-FOCUSED window — which could be Incognito or
  // a profile without an IG session.
  let targetWindowId = null;
  try {
    const igTabs = await chrome.tabs.query({ url: "https://www.instagram.com/*" });
    console.log(`[BibixBG] window-target: found ${igTabs.length} existing IG tab(s) across all windows`);
    for (const t of igTabs) {
      try {
        const win = await chrome.windows.get(t.windowId);
        console.log(`[BibixBG] window-target:   tab ${t.id} in window ${t.windowId} (incognito=${win.incognito})`);
        if (!targetWindowId && !win.incognito) targetWindowId = t.windowId;
      } catch (_) {}
    }
    if (targetWindowId == null) {
      console.warn(`[BibixBG] window-target: NO non-incognito IG window found. Tab will open in last-focused window (could be wrong). Open instagram.com in your main Chrome window first.`);
    } else {
      console.log(`[BibixBG] window-target: dispatching to window ${targetWindowId}`);
    }
  } catch (e) {
    console.warn("[BibixBG] window targeting lookup failed:", e?.message);
  }

  // KEY DESIGN: only ONE tab is active (foreground) at a time, even when
  // concurrency > 1. Reason: Chrome heavily throttles background tabs, and
  // IG's IntersectionObserver lazy-loader doesn't fire reliably without
  // visibility. Six tabs in parallel with active:true would result in only
  // the LAST one having focus — earlier ones go to background and barely
  // load any comments (the "only 12 visible comments" symptom).
  //
  // Instead: open new tabs as inactive (active:false). The content script
  // waits via waitUntilVisible() until we activate it. handleActionTabDone
  // activates the next inactive tab when the current one finishes. Result:
  // all tabs are queued and dispatched (no stuck-claimed), but they
  // process one-at-a-time with full focus (each can load its full comment
  // list reliably).
  const existingActive = await getActiveActions();
  const shouldActivate = existingActive.length === 0; // no active tab yet
  const createOpts = { url: cleanUrl, active: shouldActivate };
  if (targetWindowId != null) createOpts.windowId = targetWindowId;
  const tab = await chrome.tabs.create(createOpts);
  console.log(`[BibixBG] dispatch tab ${tab.id} created (active=${shouldActivate}, ${existingActive.length} already in flight)`);

  const active = await getActiveActions();
  active.push({
    tabId: tab.id,
    actionId: item.id,
    campaignId: item.campaign_id,
    actionType: item.action_type,
    countRequested: item.count_requested,
    postUrl: cleanUrl,
    startedAt: Date.now(),
  });
  await setActiveActions(active);

  bibixPatch(`/action-queue/${item.id}`, { status: 'running' }).catch(() => {});

  // Wait for tab to load then send the action message.
  // We pass `asAccount` so the content script can verify the active IG
  // account matches before performing any action — and fail loudly with a
  // clear error if it doesn't, instead of silently running under the wrong
  // account.
  const onUpdated = (tabId, info) => {
    if (tabId !== tab.id || info.status !== 'complete') return;
    chrome.tabs.onUpdated.removeListener(onUpdated);
    setTimeout(async () => {
      let replyTexts = [];
      if (item.reply_texts) { try { replyTexts = JSON.parse(item.reply_texts); } catch (_) {} }
      const asAccount = (item.as_account || '').toLowerCase() || null;
      // queueItemId tags the resulting instagram_campaigns row as a
      // batch sub-session so the unified feed dedupes it against the
      // parent action_campaigns entry.
      const msg = item.action_type === 'like'
        ? { action: 'RANDOM_LIKE', count: item.count_requested, asAccount, queueItemId: item.id }
        : {
            action: 'RANDOM_COMMENT',
            count: item.count_requested,
            replies: item.reply_source === 'custom' ? replyTexts : [],
            useAI: item.reply_source === 'ai',
            asAccount,
            queueItemId: item.id,
          };

      // sendMessage to the content script. If it rejects, the content script
      // didn't load — most likely the tab landed on a logged-out IG page
      // (full-page layout, no React app injection) or got navigated away
      // before document_idle. Fail fast instead of waiting 10 min for the
      // safety timeout.
      try {
        await chrome.tabs.sendMessage(tab.id, msg);
        console.log(`[BibixBG] sendMessage to action tab ${tab.id} acknowledged — script alive`);
      } catch (e) {
        const err = e?.message || String(e);
        console.warn(`[BibixBG] sendMessage to action tab ${tab.id} FAILED:`, err);
        await handleActionTabDone(tab.id, 0, {
          failed: true,
          error: `Content script never responded — likely the tab landed on a logged-out Instagram page or the extension was reloaded mid-dispatch. (sendMessage error: ${err})`,
        });
        return;
      }

      // Even if sendMessage was acknowledged, the script could still hang.
      // Set up a 3-minute progress-silence watchdog. If we get NO progress/
      // done messages in that window, fail with a clear reason. PROGRESS
      // messages reset it. (Raised from 90s — IG sometimes rate-limits for
      // 1-2 minutes between requests, especially on large like batches.)
      const ACTION_WATCHDOG_MS = 3 * 60 * 1000;
      const startedAt = Date.now();
      const watchdog = setInterval(async () => {
        const active = await getActiveActions();
        const entry = active.find(e => e.tabId === tab.id);
        if (!entry) {
          // Action completed (entry removed) — stop the watchdog.
          clearInterval(watchdog);
          return;
        }
        const elapsed = Date.now() - (entry.lastProgressAt || entry.startedAt || startedAt);
        if (elapsed > ACTION_WATCHDOG_MS) {
          clearInterval(watchdog);
          console.warn(`[BibixBG] watchdog: action tab ${tab.id} stalled >${ACTION_WATCHDOG_MS/1000}s without progress`);
          await handleActionTabDone(tab.id, 0, {
            failed: true,
            error: `Content script went silent for ${Math.round(elapsed/1000)}s — no progress messages received. Tab might be on a logged-out IG layout, or the script crashed.`,
          });
        }
      }, 20 * 1000);
    }, 4500);
  };
  chrome.tabs.onUpdated.addListener(onUpdated);
}

async function handleActionTabDone(tabId, countDone = 0, meta = {}) {
  if (!tabId) return;
  const active = await getActiveActions();
  const entry = active.find(e => e.tabId === tabId);
  if (!entry) return;
  // Terminal states reported to the backend, in order of "how complete":
  //   • completed   — count_done met or exceeded count_requested
  //   • partial     — content script gave up because it ran out of comments
  //                   to act on (meta.exhausted=true) BUT did some work.
  //                   Means: post had fewer likeable/replyable comments
  //                   than requested. UI shows "73/500" with a warning.
  //   • no_targets  — script reached the page but found NOTHING to do
  //   • failed      — explicit failure (wrong account, etc.) with error_message
  const actualCount = Number.isFinite(countDone) ? countDone : 0;
  const requested = entry.countRequested || 0;
  let status;
  let errorMessage = null;

  // Format the skip-breakdown into a one-liner so the user understands
  // the gap between requested vs performed. Examples:
  //   "(187 visible comments — 50 already liked, 30 dup-author, 10 own)"
  //   "(IG rate-limited: 47 attempts but only 12 succeeded — try slower
  //    pace or break into smaller batches)"
  const skipDetail = (() => {
    const s = meta?.skipBreakdown;
    if (!s) return '';
    const parts = [];
    if (s.alreadyLiked) parts.push(`${s.alreadyLiked} already liked`);
    if (s.duplicateAuthors) parts.push(`${s.duplicateAuthors} dup-author`);
    if (s.ownComments) parts.push(`${s.ownComments} own`);
    if (s.noAuthor) parts.push(`${s.noAuthor} no-author`);

    // Rate-limit detection: if >40% of attempted clicks failed to register,
    // call it out explicitly so the user understands it's IG-side, not us.
    const failed = s.failedClicks || 0;
    const attempts = s.totalAttempts || 0;
    const failureRate = attempts > 0 ? failed / attempts : 0;
    const rateLimited = failed >= 5 && failureRate >= 0.4;

    let suffix = '';
    if (parts.length) suffix = ` (${s.total} visible comments — ${parts.join(', ')})`;
    if (rateLimited) {
      suffix += ` | IG rate-limited ${failed} of ${attempts} clicks (${Math.round(failureRate * 100)}% rejected)`;
    }
    // Loader exit info — tells the user (without console) whether the
    // comment loader hit its target, gave up early, or got stuck. The
    // single most important diagnostic when "post seems big but script
    // got few likes": loaderFinalCount tells you what the script could
    // SEE in the DOM after expansion, loaderExitReason tells you why
    // it stopped expanding.
    if (s.loaderFinalCount != null && s.loaderExitReason && s.loaderExitReason !== 'target_reached') {
      suffix += ` | Loader stopped at ${s.loaderFinalCount} visible comments (iter=${s.loaderIterations}, reason=${s.loaderExitReason})`;
    }
    return suffix;
  })();

  if (meta && meta.failed) {
    status = 'failed';
    errorMessage = meta.error || 'Content script reported failure';
  } else if (actualCount === 0) {
    status = 'no_targets';
    if (skipDetail) errorMessage = `No likeable comments found${skipDetail}`;
  } else if (meta && meta.exhausted && actualCount < requested) {
    status = 'partial';
    errorMessage = `Only ${actualCount} of ${requested} actions possible — post ran out of likeable comments${skipDetail}.`;
  } else if (actualCount >= requested) {
    status = 'completed';
  } else {
    // count_done < requested but no exhausted flag — fallback to partial
    // so the UI doesn't say "completed" for an under-target result.
    status = 'partial';
    errorMessage = `Only ${actualCount} of ${requested} actions performed${skipDetail}.`;
  }
  console.log(`[BibixBG] action ${entry.actionId} ${status}: ${actualCount}/${requested}${errorMessage ? ` — ${errorMessage}` : ''}`);
  await bibixPatch(`/action-queue/${entry.actionId}`, {
    status,
    count_done: actualCount,
    error_message: errorMessage,
  }).catch(() => {});
  chrome.tabs.remove(tabId).catch(() => {});
  const remaining = active.filter(e => e.tabId !== tabId);
  await setActiveActions(remaining);

  // Visibility-aware rotation: activate the next queued tab so its
  // content script's waitUntilVisible resolves and work begins. Without
  // this, queued tabs would stay in background forever and never start.
  if (remaining.length > 0) {
    const next = remaining[0];
    try {
      await chrome.tabs.update(next.tabId, { active: true });
      console.log(`[BibixBG] activating next queued tab ${next.tabId} for action ${next.actionId}`);
    } catch (e) {
      console.warn(`[BibixBG] failed to activate queued tab ${next.tabId}:`, e?.message);
    }
  }

  // Sequential mode: now that this item is done, immediately kick off the
  // next poll cycle so the next item in the batch starts right away
  // instead of waiting up to a minute for the alarm to fire.
  setTimeout(() => {
    runActionProcessor().catch(e =>
      console.warn("[BibixBG] follow-up action processor error:", e?.message || e));
  }, 1500);
}

// Listen for the existing DONE / PROGRESS messages content scripts send.
// If the sender's tab is a tracked action tab, treat DONE as completion.
// The content script attaches the actual count of actions performed and
// (optionally) `failed:true` + `error` if it gave up explicitly.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === "DONE") {
    handleActionTabDone(sender.tab?.id, msg.countDone || 0, {
      failed: !!msg.failed,
      error: msg.error || null,
      exhausted: !!msg.exhausted,
      requested: msg.requested || null,
      skipBreakdown: msg.skipBreakdown || null,
    }).catch(() => {});
  }
  // PROGRESS messages reset the per-action watchdog. Without this, a tab
  // running for >90s straight (large like targets) would be force-failed
  // as "silent" even though it's actively reporting progress.
  if (msg?.type === "PROGRESS" && sender.tab?.id) {
    (async () => {
      const active = await getActiveActions();
      const idx = active.findIndex(e => e.tabId === sender.tab.id);
      if (idx >= 0) {
        active[idx].lastProgressAt = Date.now();
        await setActiveActions(active);
      }
    })().catch(() => {});
  }
});

// ── Background scrape-job poller (chrome.alarms) ─────────────────────────────
// Monday queues "scrape a profile, N posts" jobs. The extension polls every
// minute for the next pending job. When it finds one, it opens an IG tab to
// that profile, waits for the content script to scrape, uploads the results,
// marks the job done, and closes the tab.
const SCRAPE_ALARM = "bibixScrapeJobs";
const SCRAPE_ALARM_PERIOD_MINUTES = 1;
const SCRAPE_TABS_KEY = "bibixScrapeTabs";

function ensureScrapeAlarm() {
  chrome.alarms.get(SCRAPE_ALARM, (existing) => {
    if (!existing) chrome.alarms.create(SCRAPE_ALARM, { periodInMinutes: SCRAPE_ALARM_PERIOD_MINUTES });
  });
}
chrome.runtime.onInstalled.addListener(ensureScrapeAlarm);
chrome.runtime.onStartup.addListener(ensureScrapeAlarm);
ensureScrapeAlarm();

async function runScrapeJobPoller() {
  const { bibixAutomationEnabled } = await new Promise(r =>
    chrome.storage.local.get(["bibixAutomationEnabled"], r));
  if (bibixAutomationEnabled === false) return;

  const job = await bibixGet("/scrape-jobs/pending");
  if (!job || !job.id || !job.target_username) return;
  console.log(`[BibixBG] claimed scrape job ${job.id} for @${job.target_username}`);

  // Open an IG tab on the target profile in the background.
  const url = `https://www.instagram.com/${encodeURIComponent(job.target_username)}/`;
  const tab = await chrome.tabs.create({ url, active: false });
  console.log(`[BibixBG] opened scrape tab ${tab.id} → ${url}`);

  // Remember the (tabId, job) mapping so the message handler can clean up later.
  const { [SCRAPE_TABS_KEY]: list = [] } = await new Promise(r =>
    chrome.storage.local.get([SCRAPE_TABS_KEY], r));
  list.push({ tabId: tab.id, jobId: job.id, target: job.target_username, postCount: job.post_count, openedAt: Date.now() });
  chrome.storage.local.set({ [SCRAPE_TABS_KEY]: list });

  // Wait for the page to settle, then ask the content script to do the work.
  // We listen for chrome.tabs.onUpdated to avoid racing with IG's bundle.
  const onUpdated = (tabId, info) => {
    if (tabId !== tab.id || info.status !== "complete") return;
    chrome.tabs.onUpdated.removeListener(onUpdated);
    // Give content.js's document_idle injection a bit of head start.
    setTimeout(() => {
      chrome.tabs.sendMessage(tab.id, {
        action: "SCRAPE_PROFILE",
        target_username: job.target_username,
        post_count: job.post_count,
        job_id: job.id,
      }).catch((e) => console.warn(`[BibixBG] scrape send failed:`, e?.message || e));
    }, 2500);
  };
  chrome.tabs.onUpdated.addListener(onUpdated);

  // Safety net: if the content script never reports back within 5 min, mark
  // the job as failed and close the tab so we don't leak resources.
  setTimeout(() => failScrapeJobIfStuck(tab.id, job.id), 5 * 60 * 1000);
}

async function failScrapeJobIfStuck(tabId, jobId) {
  const { [SCRAPE_TABS_KEY]: list = [] } = await new Promise(r =>
    chrome.storage.local.get([SCRAPE_TABS_KEY], r));
  const entry = list.find(t => t.tabId === tabId && t.jobId === jobId);
  if (!entry) return;
  console.warn(`[BibixBG] scrape job ${jobId} stuck — marking failed and closing tab ${tabId}`);
  await bibixPatch(`/scrape-jobs/${jobId}`, { status: "failed", error_message: "Scraper timed out after 5 minutes" });
  chrome.tabs.remove(tabId).catch(() => {});
  chrome.storage.local.set({ [SCRAPE_TABS_KEY]: list.filter(t => t.tabId !== tabId) });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== SCRAPE_ALARM) return;
  try { await runScrapeJobPoller(); }
  catch (e) { console.warn("[BibixBG] scrape poller error:", e?.message || e); }
});

// ── Background scheduler (chrome.alarms) ─────────────────────────────────────
// Wakes every 5 min, checks Bibix for due posts across all the user's accounts.
// If any are due, ensures an Instagram tab is open (opening one in the
// background if necessary) so the content script can publish them. Tabs that
// the alarm opens are tracked and auto-closed after the polling cycle reports
// completion, so the user never sees lingering tabs they didn't open.
const SCHED_ALARM = "bibixScheduler";
const SCHED_ALARM_PERIOD_MINUTES = 5;
const AUTO_OPENED_TABS_KEY = "bibixAutoOpenedTabs";
const AUTO_OPEN_MAX_AGE_MS = 30 * 60 * 1000;

function ensureSchedulerAlarm() {
  chrome.alarms.get(SCHED_ALARM, (existing) => {
    if (!existing) chrome.alarms.create(SCHED_ALARM, { periodInMinutes: SCHED_ALARM_PERIOD_MINUTES });
  });
}
chrome.runtime.onInstalled.addListener(ensureSchedulerAlarm);
chrome.runtime.onStartup.addListener(ensureSchedulerAlarm);
ensureSchedulerAlarm();

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== SCHED_ALARM) return;
  try { await runBackgroundScheduler(); }
  catch (e) { console.warn("[BibixBG] scheduler error:", e?.message || e); }
});

async function runBackgroundScheduler() {
  const { bibixAutomationEnabled } = await new Promise(r =>
    chrome.storage.local.get(["bibixAutomationEnabled"], r));
  if (bibixAutomationEnabled === false) {
    console.log("[BibixBG] automation disabled on this device, skipping alarm");
    return;
  }

  const pending = await bibixGet("/scheduled-posts/pending-accounts");
  if (!Array.isArray(pending) || pending.length === 0) {
    console.log("[BibixBG] no pending posts on any account");
    return;
  }
  console.log(`[BibixBG] ${pending.length} account(s) have pending posts`);

  const tabs = await chrome.tabs.query({ url: "https://www.instagram.com/*" });
  if (tabs.length > 0) {
    console.log(`[BibixBG] reusing existing IG tab ${tabs[0].id}`);
    chrome.tabs.sendMessage(tabs[0].id, { action: "TRIGGER_SCHEDULE_POLL" }).catch(() => {});
    return;
  }

  const tab = await chrome.tabs.create({ url: "https://www.instagram.com/", active: false });
  console.log(`[BibixBG] opened IG tab ${tab.id} for scheduler (will close after publish)`);
  const { [AUTO_OPENED_TABS_KEY]: list = [] } = await new Promise(r =>
    chrome.storage.local.get([AUTO_OPENED_TABS_KEY], r));
  list.push({ tabId: tab.id, openedAt: Date.now() });
  chrome.storage.local.set({ [AUTO_OPENED_TABS_KEY]: list });
}

// Drop a tabId from the auto-opened list (always, regardless of close success).
async function forgetAutoOpenedTab(tabId) {
  const { [AUTO_OPENED_TABS_KEY]: list = [] } = await new Promise(r =>
    chrome.storage.local.get([AUTO_OPENED_TABS_KEY], r));
  const filtered = list.filter(t => t.tabId !== tabId);
  if (filtered.length !== list.length) {
    await new Promise(r => chrome.storage.local.set({ [AUTO_OPENED_TABS_KEY]: filtered }, r));
  }
}

// ── Capture IG video URLs as they're requested by the page ───────────────────
// Instagram serves videos via blob: URLs on the <video> element, so the only
// reliable way to download a reel is to intercept the underlying .mp4 fetch.
// Keyed by tabId so videos from different tabs don't get mixed up.
const capturedVideoUrls = {}; // { tabId: [{ url, ts }] }
try {
  chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
      if (details.tabId < 0) return;
      if (!/\.mp4(\?|$)/i.test(details.url)) return;
      const list = capturedVideoUrls[details.tabId] || (capturedVideoUrls[details.tabId] = []);
      list.push({ url: details.url, ts: Date.now() });
      if (list.length > 20) list.shift();
    },
    { urls: ["https://*.cdninstagram.com/*", "https://*.fbcdn.net/*"] }
  );
  chrome.tabs.onRemoved.addListener((tabId) => {
    delete capturedVideoUrls[tabId];
    forgetAutoOpenedTab(tabId).catch(() => {});
    // Also clean up scrape-tab tracking if the user manually closed the tab
    chrome.storage.local.get([SCRAPE_TABS_KEY], ({ [SCRAPE_TABS_KEY]: list = [] }) => {
      const filtered = list.filter(t => t.tabId !== tabId);
      if (filtered.length !== list.length) chrome.storage.local.set({ [SCRAPE_TABS_KEY]: filtered });
    });
    // If a tracked action tab was closed (manually or by us), drop its entry
    chrome.storage.local.get([ACTIVE_ACTIONS_KEY], ({ [ACTIVE_ACTIONS_KEY]: list = [] }) => {
      const filtered = list.filter(e => e.tabId !== tabId);
      if (filtered.length !== list.length) chrome.storage.local.set({ [ACTIVE_ACTIONS_KEY]: filtered });
    });
  });
} catch (e) { console.warn("webRequest listener failed:", e?.message); }

// ── Bibix API helpers ─────────────────────────────────────────────────────────
const BIBIX_PROD    = "https://bibix.ailabstech.com";
const BIBIX_STAGING = "https://staging.bibix.ailabstech.com";

async function getBibixConfig() {
  return new Promise(resolve => {
    chrome.storage.local.get(["bibixToken", "bibixStagingToken", "bibixStagingEnabled"], resolve);
  });
}

// Fire a single request to one server
async function bibixRequestTo(baseUrl, token, method, path, body) {
  if (!token) { console.log(`[BibixBG] ${method} ${baseUrl}${path} — SKIPPED (no token)`); return null; }
  try {
    const opts = {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${baseUrl}/api/instagram${path}`, opts);
    console.log(`[BibixBG] ${method} ${baseUrl}${path} → HTTP ${res.status}`);
    return res.ok ? res.json() : null;
  } catch (e) {
    console.log(`[BibixBG] ${method} ${baseUrl}${path} — ERROR ${e?.message || e}`);
    return null;
  }
}

// When staging sync is enabled, write to BOTH prod and staging and await
// both so neither write gets cancelled when the service worker goes idle.
// Prod is the canonical store (full history); staging is a working copy
// for live development. If only one token is configured, only that side
// gets the write.
async function bibixRequest(method, path, body) {
  const { bibixToken, bibixStagingToken, bibixStagingEnabled } = await getBibixConfig();
  const stagingActive = bibixStagingEnabled && bibixStagingToken;
  const prodPromise = bibixToken
    ? bibixRequestTo(BIBIX_PROD, bibixToken, method, path, body).catch(() => null)
    : Promise.resolve(null);
  const stagingPromise = stagingActive
    ? bibixRequestTo(BIBIX_STAGING, bibixStagingToken, method, path, body).catch(() => null)
    : Promise.resolve(null);
  const [prodResult, stagingResult] = await Promise.all([prodPromise, stagingPromise]);
  // Return staging when active (the UI being tested reads from staging), else prod.
  return stagingActive ? (stagingResult ?? prodResult) : prodResult;
}

const bibixPost  = (path, body) => bibixRequest("POST",  path, body);
const bibixPatch = (path, body) => bibixRequest("PATCH", path, body);

// READS: when staging sync is enabled, query staging — that's where the user
// is testing, and prod usually doesn't have the data they just created. When
// staging sync is off (normal production), query prod as before.
async function bibixGet(path) {
  const { bibixToken, bibixStagingToken, bibixStagingEnabled } = await getBibixConfig();
  if (bibixStagingEnabled && bibixStagingToken) {
    return bibixRequestTo(BIBIX_STAGING, bibixStagingToken, "GET", path, null);
  }
  return bibixRequestTo(BIBIX_PROD, bibixToken, "GET", path, null);
}

// ───────────────────────────────────────────────────────────────────────────
//  PROFILE ENRICHMENT POLLER (v1.43)
// ───────────────────────────────────────────────────────────────────────────
// Asks the backend every N minutes for a username that needs enrichment
// (country + joined month from "About this account"), then:
//   1. Opens a fresh tab on https://www.instagram.com/<username>/
//   2. Waits for the content script to dispatch BIBIX_ENRICH_DONE
//   3. POSTs the result to /api/instagram/user-profiles
//   4. Closes the tab
//
// Designed to be CONSERVATIVE:
//   • Only runs one profile at a time (no parallel enrichment)
//   • Skips entirely if any action batches are in flight (preserves bandwidth
//     and avoids competing for IG's rate-limit budget during real engagement)
//   • Skips if killswitch is on
//   • Caps wait per profile at 60s — gives up if IG doesn't render the About
//     panel quickly; backend marks it tried (so we don't loop on the same name)
//
// Cadence: 1 enrichment every ENRICH_ALARM_PERIOD_MINUTES (3) minutes.
// With the typical batch producing ~20 unique target usernames, that's
// ~60 minutes to fill in a fresh batch — slow on purpose, but unobtrusive.
const ENRICH_ALARM = "bibixEnrichProfilesAlarm";
const ENRICH_ALARM_PERIOD_MINUTES = 3;
const ENRICH_PER_TICK_LIMIT = 1;
const ENRICH_PROFILE_TIMEOUT_MS = 60 * 1000;

function ensureEnrichAlarm() {
  chrome.alarms.get(ENRICH_ALARM, (existing) => {
    if (!existing) chrome.alarms.create(ENRICH_ALARM, { periodInMinutes: ENRICH_ALARM_PERIOD_MINUTES });
  });
}
chrome.runtime.onInstalled.addListener(ensureEnrichAlarm);
chrome.runtime.onStartup.addListener(ensureEnrichAlarm);
ensureEnrichAlarm();

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ENRICH_ALARM) return;
  try { await runEnrichmentPoll(); }
  catch (e) { console.warn("[BibixBG] enrich poll error:", e?.message || e); }
});

async function runEnrichmentPoll() {
  if (await isKillSwitchOn()) return;

  // Skip if any action batches are currently in flight — don't compete for
  // IG bandwidth / rate-limit budget while real engagement is running.
  const active = await getActiveActions();
  if (active.length > 0) {
    console.log("[BibixBG] enrich: skipping — action batches in flight");
    return;
  }

  const pending = await bibixGet(`/user-profiles/pending?limit=${ENRICH_PER_TICK_LIMIT}`);
  if (!Array.isArray(pending) || pending.length === 0) {
    return; // nothing to enrich right now
  }

  const username = pending[0];
  console.log(`[BibixBG] enrich: starting @${username}`);
  await enrichOneProfile(username);
}

async function enrichOneProfile(username) {
  // Find a non-incognito IG window so the enrichment tab opens with the
  // user's IG session (same logic as action dispatch).
  let targetWindowId = null;
  try {
    const igTabs = await chrome.tabs.query({ url: "https://www.instagram.com/*" });
    for (const t of igTabs) {
      try {
        const win = await chrome.windows.get(t.windowId);
        if (!targetWindowId && !win.incognito) targetWindowId = t.windowId;
      } catch (_) {}
    }
  } catch (_) {}

  const url = `https://www.instagram.com/${username}/`;
  const createOpts = { url, active: false };
  if (targetWindowId != null) createOpts.windowId = targetWindowId;

  const tab = await chrome.tabs.create(createOpts);
  const tabId = tab.id;
  console.log(`[BibixBG] enrich: tab ${tabId} opened for @${username}`);

  // Wait for the content script to dispatch BIBIX_ENRICH_DONE OR timeout.
  const result = await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(onMsg);
      resolve({ status: "timeout", error: "content_script_silent" });
    }, ENRICH_PROFILE_TIMEOUT_MS);

    const onMsg = (msg, sender) => {
      if (msg?.action !== "BIBIX_ENRICH_DONE") return;
      if (sender?.tab?.id !== tabId) return;
      clearTimeout(timeout);
      chrome.runtime.onMessage.removeListener(onMsg);
      resolve(msg);
    };
    chrome.runtime.onMessage.addListener(onMsg);

    // Page needs to render before we trigger ENRICH. Send the message
    // after 4s so the content script has a chance to load + bind.
    setTimeout(() => {
      chrome.tabs.sendMessage(tabId, { action: "ENRICH_PROFILE", username }).catch(() => {});
    }, 4000);
  });

  // POST the result no matter what — even nulls. Backend treats it as
  // "enriched, no data found" which prevents re-trying forever.
  try {
    await bibixPost("/user-profiles", {
      username,
      country: result.country || null,
      joined_month: result.joined_month || null,
      error: result.error || null,
    });
    console.log(`[BibixBG] enrich: @${username} → ${result.status} (${result.country || 'no country'})`);
  } catch (e) {
    console.warn(`[BibixBG] enrich: POST failed for @${username}:`, e?.message);
  }

  // Close the tab. Best-effort — Chrome will reject if tab already closed.
  try { await chrome.tabs.remove(tabId); } catch (_) {}
}

// ── Message handler ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {

  /* ---- Shared Groq fetch with retry ---- */
  // (defined inside the listener so it closes over nothing special)

  /* ---- AI DM Reply via Groq ---- */
  if (msg.action === "GET_AI_DM_REPLY") {
    // Route through the Bibix backend's multi-provider AI (same as comment
    // replies) using the user's DEFAULT provider from Settings → AI providers.
    // The old path used a separate extension-local Groq key, so DMs silently
    // fell back to random canned replies whenever that key wasn't set.
    (async () => {
      try {
        const res = await bibixPost("/ai/dm-reply", {
          conversation:   msg.context       || "",
          last_message:   msg.lastMessage    || "",
          my_profile:     msg.myProfile      || null,
          their_username: msg.theirUsername  || null,
        });
        if (res && res.reply) sendResponse({ reply: res.reply });
        else sendResponse({ error: res?.error || "AI provider returned empty reply" });
      } catch (e) {
        sendResponse({ error: e?.message || "AI request failed" });
      }
    })();
    return true;
  }

  /* ---- AI Reply via backend (multi-provider) ----
     The user picks a provider + key in Monday's Settings → AI providers. The
     backend handles the actual generation (OpenAI / Groq / Claude / Gemini /
     Grok / Perplexity / Z.AI / Mistral / DeepSeek). This means:
       • the extension no longer needs the Groq key locally
       • staging vs prod is automatic — bibixPost uses the active token
       • adding a new provider is a backend-only change
  */
  if (msg.action === "GET_AI_REPLY") {
    (async () => {
      try {
        const res = await bibixPost("/ai/reply", {
          comment_text:   msg.comment   || "",
          comment_author: msg.author    || null,
          post_owner:     msg.postOwner || null,
          my_profile:     msg.myProfile || null,
          post_url:       msg.postUrl   || null,
        });
        if (res && res.reply) {
          sendResponse({ reply: res.reply });
        } else {
          sendResponse({ error: res?.error || "AI provider returned empty reply" });
        }
      } catch (e) {
        sendResponse({ error: e?.message || "AI request failed" });
      }
    })();
    return true;
  }

  /* ---- Save action — syncs directly to Bibix (no local cache) ---- */
  if (msg.action === "SAVE_ACTION") {
    (async () => {
      // Generate a stable id client-side so both prod and staging persist
      // the same row when the extension dual-writes.
      const id = (crypto.randomUUID && crypto.randomUUID()) ||
        (`act-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);

      // campaignId is now the UUID we generated at START_CAMPAIGN time —
      // identical on both prod and staging, no lookup needed.
      const campaign_id = msg.record.campaignId || null;

      await bibixPost("/actions", {
        id,
        date:           msg.record.date,
        action:         msg.record.action,
        myProfile:      msg.record.myProfile       || null,
        targetUsername: msg.record.targetUsername  || null,
        fullName:       msg.record.fullName        || null,
        followers:      msg.record.followers       || null,
        replyText:      msg.record.replyText       || null,
        postOwner:      msg.record.postOwner       || null,
        postUrl:        msg.record.postUrl         || null,
        campaign_id,
        my_profile:     msg.record.myProfile       || null,
        full_name:      msg.record.fullName        || null,
        post_owner:     msg.record.postOwner       || null,
        action_date:    msg.record.date            || null,
      });

      sendResponse({ ok: true });
    })();
    return true;
  }

  /* ---- GET_LOG — used by handleScanNotifications to build a dedup
     fingerprint set BEFORE writing. We fetch the last N received_* actions
     from the backend and remap to the shape notifFingerprint() expects.
     Without this, every re-scan re-saves the same notifications. */
  if (msg.action === "GET_LOG") {
    (async () => {
      try {
        const rows = await bibixGet(`/actions?type_like=${encodeURIComponent("received_%")}&limit=500`);
        const log = Array.isArray(rows)
          ? rows.map(r => ({
              targetUsername: r.username || r.target_username || null,
              action:         r.type,
              postUrl:        r.post_url || null,
              replyText:      r.reply_text || null,
            }))
          : [];
        sendResponse({ log });
      } catch (e) {
        console.warn("[BibixBG] GET_LOG fetch failed:", e?.message || e);
        sendResponse({ log: [] });
      }
    })();
    return true;
  }
  if (msg.action === "CLEAR_LOG") { sendResponse({ ok: true }); return true; }

  /* ---- Start a new campaign — syncs to Bibix only (no local cache) ---- */
  if (msg.action === "START_CAMPAIGN") {
    (async () => {
      const campaignId = (crypto.randomUUID && crypto.randomUUID()) ||
        (`camp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);

      await bibixPost("/campaigns", {
        id:                   campaignId,
        type:                 msg.campaign?.type || null,
        myProfile:            msg.campaign?.myProfile            || null,
        requested:            msg.campaign?.requested            || null,
        postUrl:              msg.campaign?.postUrl              || null,
        postOwner:            msg.campaign?.postOwner            || null,
        postOwnerFullName:    msg.campaign?.postOwnerFullName    || null,
        postOwnerFollowers:   msg.campaign?.postOwnerFollowers   || null,
        postLikes:            msg.campaign?.postLikes            || null,
        postComments:         msg.campaign?.postComments         || null,
        // When non-null, marks this row as a batch sub-session so the
        // unified Activity feed dedupes it against the parent batch.
        parent_queue_id:      msg.campaign?.parentQueueId        || null,
      });

      // Return the id so the caller can pass it as `campaignId` in subsequent
      // SAVE_ACTION calls. The id is the same on both prod and staging.
      sendResponse({ id: campaignId });
    })();
    return true;
  }

  /* ---- Finish / update a campaign — syncs to Bibix only (no local cache) ---- */
  if (msg.action === "FINISH_CAMPAIGN") {
    (async () => {
      if (msg.id) {
        await bibixPatch(`/campaigns/${msg.id}`, {
          status:        msg.updates?.status,
          completed:     msg.updates?.completed,
          followerStats: msg.updates?.followerStats || null,
          notes:         msg.updates?.notes || null,
        });
      }
      sendResponse({ ok: true });
    })();
    return true;
  }

  /* ---- Legacy GET_CAMPAIGNS / CLEAR_CAMPAIGNS — backend is the source
     of truth. Reply with safe defaults so old callers don't break. */
  if (msg.action === "GET_CAMPAIGNS")   { sendResponse({ campaigns: [] }); return true; }
  if (msg.action === "CLEAR_CAMPAIGNS") { sendResponse({ ok: true });       return true; }

  /* ---- Save/get Bibix config ---- */
  if (msg.action === "SAVE_BIBIX_CONFIG") {
    chrome.storage.local.set({ bibixToken: msg.token }, () => sendResponse({ ok: true }));
    return true;
  }
  if (msg.action === "SAVE_BIBIX_STAGING_CONFIG") {
    chrome.storage.local.set({
      bibixStagingToken:   msg.token,
      bibixStagingEnabled: msg.enabled,
    }, () => sendResponse({ ok: true }));
    return true;
  }
  if (msg.action === "GET_BIBIX_CONFIG") {
    chrome.storage.local.get(["bibixToken", "bibixStagingToken", "bibixStagingEnabled"], data => sendResponse(data));
    return true;
  }

  /* ---- Followers snapshot (sent by content script after scraping) ---- */
  if (msg.action === "BIBIX_SNAPSHOT_FOLLOWERS") {
    (async () => {
      const result = await bibixPost("/followers/snapshot", {
        my_profile: msg.my_profile || null,
        followers:  msg.followers  || [],
      });
      sendResponse(result ? { ok: true, ...result } : { ok: false, error: "Bibix sync failed (token missing or server unreachable)" });
    })();
    return true;
  }

  /* ---- Profile scrape finished (or failed) — upload + cleanup ----
     Content script sends this when its scrape loop ends. We push the rows to
     Bibix, mark the job's terminal status, and close the tab the background
     opened for this job. */
  if (msg.action === "BIBIX_SCRAPE_DONE") {
    (async () => {
      const tabId = _sender.tab?.id;
      try {
        if (msg.status === "completed" && Array.isArray(msg.posts) && msg.posts.length > 0) {
          await bibixPost("/scraped-posts", {
            target_username: msg.target_username,
            posts: msg.posts,
          });
        }
        await bibixPatch(`/scrape-jobs/${msg.job_id}`, {
          status: msg.status || "completed",
          error_message: msg.error || null,
          posts_scraped: msg.posts_scraped ?? (Array.isArray(msg.posts) ? msg.posts.length : 0),
        });
      } catch (e) {
        console.warn("[BibixBG] scrape upload error:", e?.message || e);
      } finally {
        // Close the tab and forget the mapping
        if (tabId) {
          chrome.storage.local.get([SCRAPE_TABS_KEY], ({ [SCRAPE_TABS_KEY]: list = [] }) => {
            const entry = list.find(t => t.tabId === tabId);
            if (entry) {
              console.log(`[BibixBG] closing scrape tab ${tabId} after job ${entry.jobId}`);
              chrome.tabs.remove(tabId).catch(() => {});
              chrome.storage.local.set({ [SCRAPE_TABS_KEY]: list.filter(t => t.tabId !== tabId) });
            }
          });
        }
        sendResponse({ ok: true });
      }
    })();
    return true;
  }

  /* ---- Scheduler signaled it finished a polling cycle ----
     If the tab was opened by the background alarm (not by the user), close it
     now so we don't leave stray IG tabs in the user's browser. Tabs the user
     opened themselves are left alone. */
  if (msg.action === "SCHEDULER_POLL_DONE") {
    const tabId = _sender.tab?.id;
    if (tabId) {
      chrome.storage.local.get([AUTO_OPENED_TABS_KEY], ({ [AUTO_OPENED_TABS_KEY]: list = [] }) => {
        const entry = list.find(t => t.tabId === tabId);
        if (entry) {
          console.log(`[BibixBG] closing auto-opened tab ${tabId} after scheduler finished`);
          chrome.tabs.remove(tabId).catch(() => {});
        }
      });
    }
    return;
  }

  /* ---- Scheduled posts polling (extension publisher) ---- */
  if (msg.action === "BIBIX_GET_DUE_POSTS") {
    (async () => {
      const profile = msg.my_profile ? `?my_profile=${encodeURIComponent(msg.my_profile)}` : "";
      const posts = await bibixGet(`/scheduled-posts/due${profile}`);
      sendResponse({ posts: Array.isArray(posts) ? posts : [] });
    })();
    return true;
  }

  if (msg.action === "BIBIX_UPDATE_SCHEDULED_POST") {
    (async () => {
      await bibixPatch(`/scheduled-posts/${msg.id}`, {
        status:        msg.status,
        error_message: msg.error_message || null,
      });
      sendResponse({ ok: true });
    })();
    return true;
  }

  /* ---- Downloader (uses chrome.downloads to bypass CORS on IG CDN) ---- */
  if (msg.action === "DOWNLOAD_MEDIA") {
    let url = msg.url;
    // If the content script gave us a blob URL, swap in the most recently
    // captured .mp4 for this tab (Instagram videos always come via blob)
    if (url && url.startsWith("blob:")) {
      const tabId = _sender.tab?.id;
      const list = capturedVideoUrls[tabId] || [];
      if (!list.length) {
        sendResponse({ ok: false, error: "No video URL captured yet — play the video for a moment, then click ⬇ again." });
        return true;
      }
      url = list[list.length - 1].url;
    }
    const ext = url.includes(".mp4") ? "mp4" : (msg.filename?.split(".").pop() || "jpg");
    chrome.downloads.download(
      { url, filename: msg.filename?.replace(/\.[a-z0-9]+$/i, `.${ext}`) || `instagram-${Date.now()}.${ext}`, saveAs: false },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ ok: true, id: downloadId });
        }
      }
    );
    return true;
  }

  /* ---- Multi-account: scan accounts → POST to Bibix ---- */
  if (msg.action === "BIBIX_SCAN_ACCOUNTS") {
    (async () => {
      const result = await bibixPost("/accounts/scan", { accounts: msg.accounts || [] });
      sendResponse(result ? { ok: true, ...result } : { ok: false });
    })();
    return true;
  }

  /* ---- Multi-account: get distinct profiles with pending due posts ---- */
  if (msg.action === "BIBIX_GET_PENDING_ACCOUNTS") {
    (async () => {
      const accounts = await bibixGet("/scheduled-posts/pending-accounts");
      sendResponse({ accounts: Array.isArray(accounts) ? accounts : [] });
    })();
    return true;
  }

  /* ---- Fetch scheduled-post media (returns base64 so content script can rebuild Blob) ---- */
  // Same staging-vs-prod routing as bibixGet — read from staging when staging
  // sync is enabled, since that's where the scheduled post + its file live.
  if (msg.action === "BIBIX_FETCH_MEDIA") {
    (async () => {
      const { bibixToken, bibixStagingToken, bibixStagingEnabled } = await getBibixConfig();
      const useStaging = bibixStagingEnabled && bibixStagingToken;
      const baseUrl = useStaging ? BIBIX_STAGING : BIBIX_PROD;
      const token   = useStaging ? bibixStagingToken : bibixToken;
      if (!token) { sendResponse({ ok: false, error: "Not connected to Bibix" }); return; }
      try {
        console.log(`[BibixBG] FETCH_MEDIA ${baseUrl}/scheduled-posts/${msg.id}/media`);
        const res = await fetch(`${baseUrl}/api/instagram/scheduled-posts/${msg.id}/media`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) { sendResponse({ ok: false, error: `HTTP ${res.status}` }); return; }
        const mime = res.headers.get("Content-Type") || "image/jpeg";
        const buf  = await res.arrayBuffer();
        // Convert ArrayBuffer → base64
        let bin = "";
        const bytes = new Uint8Array(buf);
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
          bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        }
        sendResponse({ ok: true, mime, dataB64: btoa(bin) });
      } catch (e) {
        sendResponse({ ok: false, error: e?.message || String(e) });
      }
    })();
    return true;
  }
});
