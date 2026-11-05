let running = false;

/* ---------- Kill switch (global pause for ALL extension activity) -----------
   Reads/writes chrome.storage.local.bibixKillSwitch. The background's
   runActionProcessor, runAutomationsProcessor, scrape poller, and scheduled
   posts poller all check isKillSwitchOn() at entry and bail when true.
   This is a hard pause — flip it back off to resume. */
(function wireKillSwitch() {
  const toggle = document.getElementById('killSwitchToggle');
  const slider = document.getElementById('killSwitchSlider');
  if (!toggle || !slider) return;
  const paint = (on) => {
    slider.style.backgroundColor = on ? '#dc2626' : '#ccc';
    slider.innerHTML = `<span style="position:absolute;content:'';height:14px;width:14px;left:${on ? 21 : 3}px;top:3px;background:white;transition:0.2s;border-radius:50%;"></span>`;
  };
  chrome.storage.local.get(['bibixKillSwitch'], (d) => {
    const on = !!d.bibixKillSwitch;
    toggle.checked = on;
    paint(on);
  });
  toggle.addEventListener('change', () => {
    const on = toggle.checked;
    chrome.storage.local.set({ bibixKillSwitch: on }, () => paint(on));
  });
})();

/* ---------- Collapsible sections (persist open/closed) ---------- */
const SECTION_KEY = "popupSectionState";
const sections = document.querySelectorAll("details.section");

chrome.storage.local.get(SECTION_KEY, (data) => {
  const state = data[SECTION_KEY] || {};
  sections.forEach((s) => {
    const name = s.dataset.section;
    if (name in state) s.open = !!state[name];
  });
});

/* ---------- Per-user tab visibility ----------------------------------------
   The backend's GET /api/instagram/extension/permissions returns
   { allowed_tabs: [...] | null }. null means "show all". An empty array
   means "hide everything actionable" (the user can still paste their token
   via Sync if it's explicitly allowed). */
(async function applyTabPermissions() {
  const { bibixToken, bibixStagingToken, bibixStagingEnabled } = await new Promise(r =>
    chrome.storage.local.get(["bibixToken", "bibixStagingToken", "bibixStagingEnabled"], r));
  const useStaging = bibixStagingEnabled && bibixStagingToken;
  const baseUrl = useStaging ? "https://staging.bibix.ailabstech.com" : "https://bibix.ailabstech.com";
  const token = useStaging ? bibixStagingToken : bibixToken;
  if (!token) return;  // No token yet → leave all tabs visible so user can set it up
  try {
    const res = await fetch(`${baseUrl}/api/instagram/extension/permissions`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
    const { allowed_tabs } = await res.json();
    if (!Array.isArray(allowed_tabs)) return;  // null → show all
    const allowedSet = new Set(allowed_tabs);
    // Always allow "sync" so the user can update their token if it expires
    allowedSet.add("sync");
    sections.forEach((s) => {
      if (!allowedSet.has(s.dataset.section)) s.style.display = "none";
    });
  } catch (_) { /* Network errors → leave all visible */ }
})();

/* ---------- Clock-drift strip --------------------------------------------------
   Renders something like "Server 14:32 UTC · You 16:32 UTC+2 · ✓ in sync" at
   the top of the popup so the user can see whether their PC clock is aligned
   with the Monday server (which is what computes automation next_run_at).
   Re-fetches every 60s while the popup is open. */
(async function renderTimeStrip() {
  const el = document.getElementById("timeStrip");
  if (!el) return;
  async function tick() {
    const { bibixToken, bibixStagingToken, bibixStagingEnabled } = await new Promise(r =>
      chrome.storage.local.get(["bibixToken", "bibixStagingToken", "bibixStagingEnabled"], r));
    const useStaging = bibixStagingEnabled && bibixStagingToken;
    const baseUrl = useStaging ? "https://staging.bibix.ailabstech.com" : "https://bibix.ailabstech.com";
    const token = useStaging ? bibixStagingToken : bibixToken;
    if (!token) { el.textContent = ""; return; }
    try {
      const fetchedAt = Date.now();
      const res = await fetch(`${baseUrl}/api/instagram/server-time`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) { el.textContent = ""; return; }
      const { server_time } = await res.json();
      const serverMs = new Date(server_time).getTime();
      if (!Number.isFinite(serverMs)) return;
      const now = Date.now();
      // Server "now" approximated by server_time + elapsed since fetch (RTT).
      const serverNow = serverMs + (now - fetchedAt);
      const driftMs = now - serverNow;
      const driftAbsMin = Math.round(Math.abs(driftMs) / 60000);
      const pad = (n) => String(n).padStart(2, "0");
      const utcStr = `${pad(new Date(serverNow).getUTCHours())}:${pad(new Date(serverNow).getUTCMinutes())} UTC`;
      const localStr = `${pad(new Date(now).getHours())}:${pad(new Date(now).getMinutes())}`;
      const tzMin = -new Date().getTimezoneOffset();
      const tzLbl = tzMin === 0 ? "UTC" : `UTC${tzMin > 0 ? "+" : ""}${tzMin / 60}`;
      const driftLbl = driftAbsMin === 0
        ? "✓ in sync"
        : `Δ ${driftMs > 0 ? "+" : "−"}${driftAbsMin}m`;
      const color = driftAbsMin === 0 ? "#16a34a" : driftAbsMin >= 5 ? "#ea580c" : "#888";
      el.innerHTML =
        `Server ${utcStr} · You ${localStr} ${tzLbl} · ` +
        `<span style="color:${color}">${driftLbl}</span>` +
        (useStaging ? ' · <span style="color:#a855f7">staging</span>' : "");
    } catch (_) {
      el.textContent = "";
    }
  }
  tick();
  setInterval(tick, 60 * 1000);
})();

sections.forEach((s) => {
  s.addEventListener("toggle", () => {
    chrome.storage.local.get(SECTION_KEY, (data) => {
      const state = data[SECTION_KEY] || {};
      state[s.dataset.section] = s.open;
      chrome.storage.local.set({ [SECTION_KEY]: state });
    });
  });
});

/* ---------- Toggle custom replies ---------- */
const toggleBtn = document.getElementById("toggleComments");
const container = document.getElementById("customCommentContainer");
const textarea = document.getElementById("customComments");

toggleBtn.addEventListener("click", () => {
  const isOpen = container.style.display === "block";
  container.style.display = isOpen ? "none" : "block";
  toggleBtn.innerText = isOpen ? "+" : "−";
  if (isOpen) textarea.value = "";
});

/* ---------- AI toggle ----------------------------------------------------
   AI replies are now generated by the backend using the user's per-account
   provider key (Monday → Accounts → AI providers). The toggle just decides
   whether RANDOM_COMMENT carries useAI=true. No local key storage. */
const aiToggle = document.getElementById("aiToggle");
const aiHint   = document.getElementById("aiHint");

chrome.storage.local.get("aiEnabled", ({ aiEnabled }) => {
  if (aiEnabled) {
    aiToggle.checked = true;
    aiHint.style.display = "block";
  }
});

aiToggle.addEventListener("change", () => {
  const on = aiToggle.checked;
  aiHint.style.display = on ? "block" : "none";
  chrome.storage.local.set({ aiEnabled: on });
});

// Clicking the "Monday → Accounts → AI providers" link opens the right
// page in Monday (staging or prod, matching the current token).
document.getElementById("aiSettingsLink").addEventListener("click", async (e) => {
  e.preventDefault();
  const { bibixStagingEnabled, bibixStagingToken } = await new Promise(r =>
    chrome.storage.local.get(["bibixStagingEnabled", "bibixStagingToken"], r));
  const useStaging = bibixStagingEnabled && bibixStagingToken;
  const base = useStaging ? "https://staging.bibix.ailabstech.com" : "https://bibix.ailabstech.com";
  chrome.tabs.create({ url: `${base}/instagram?tab=accounts` });
});

// One-time cleanup: legacy `groqApiKey` is no longer used (backend stores
// the keys per user). Strip it so it doesn't sit in storage forever.
chrome.storage.local.remove("groqApiKey");

/* ---------- Send message to content.js ---------- */
async function send(action, payload = {}) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  try {
    await chrome.tabs.sendMessage(tab.id, { action, ...payload });
  } catch {
    alert("Open an Instagram post first, then try again.");
    resetUI();
  }
}

/* ---------- UI helpers ---------- */
function showLoader(text) {
  running = true;
  document.getElementById("controls").style.display = "none";
  document.getElementById("loader").style.display = "block";
  document.getElementById("status").innerText = text;
}

function resetUI() {
  running = false;
  document.getElementById("controls").style.display = "block";
  document.getElementById("loader").style.display = "none";
}

/* ---------- Likes ---------- */
document.getElementById("runLikes").addEventListener("click", () => {
  const count = parseInt(document.getElementById("likeCount").value, 10);
  if (!count || count < 1) return alert("Enter a valid number of likes.");
  showLoader(`Liking ${count} comments…`);
  send("RANDOM_LIKE", { count });
});

/* ---------- Replies ---------- */
document.getElementById("runComments").addEventListener("click", () => {
  const count = parseInt(document.getElementById("commentCount").value, 10);
  if (!count || count < 1) return alert("Enter a valid number of replies.");

  const useAI = aiToggle.checked;

  const replies = textarea.value
    .split(/[\n,]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  showLoader(`Replying to ${count} comments…`);
  send("RANDOM_COMMENT", { count, replies, useAI });
});

/* ---------- Follow ---------- */
document.getElementById("runFollow").addEventListener("click", () => {
  const count = parseInt(document.getElementById("followCount").value, 10);
  if (!count || count < 1) return alert("Enter a valid number of people to follow.");
  showLoader(`Following ${count} people…`);
  send("RANDOM_FOLLOW", { count });
});

/* ---------- Unfollow ---------- */
document.getElementById("runUnfollow").addEventListener("click", () => {
  const count = parseInt(document.getElementById("unfollowCount").value, 10);
  if (!count || count < 1) return alert("Enter a valid number of people to unfollow.");
  showLoader(`Unfollowing ${count} people…`);
  send("UNFOLLOW_PEOPLE", { count });
});

/* ---------- Stop ---------- */
document.getElementById("stop").addEventListener("click", () => {
  send("STOP_ALL");
  resetUI();
});

/* ---------- Reply DMs ---------- */
document.getElementById("runReplyDMs").addEventListener("click", () => {
  const count = parseInt(document.getElementById("dmCount").value, 10);
  if (!count || count < 1) return alert("Enter how many DMs to reply to.");
  showLoader(`Replying to ${count} unread DMs…`);
  send("REPLY_DMS", { count });
});

/* ---------- Scan Notifications ---------- */
document.getElementById("runScanNotif").addEventListener("click", () => {
  showLoader("Scanning notifications…");
  send("SCAN_NOTIFICATIONS");
});

/* ---------- Snapshot Followers ---------- */
document.getElementById("runSnapshotFollowers").addEventListener("click", () => {
  showLoader("Snapshotting followers…");
  send("SNAPSHOT_FOLLOWERS");
});

/* ---------- Check schedule now ---------- */
document.getElementById("checkSchedNow").addEventListener("click", () => {
  showLoader("Checking for due posts…");
  send("TRIGGER_SCHEDULE_POLL");
  // Reset after a short delay — the poll runs in the background and reports via PROGRESS
  setTimeout(resetUI, 1500);
});

/* ---------- Automation enabled toggle (per-device kill-switch) ---------- */
const automationToggle = document.getElementById("automationToggle");
chrome.storage.local.get(["bibixAutomationEnabled"], ({ bibixAutomationEnabled }) => {
  // Default ON if never set
  automationToggle.checked = bibixAutomationEnabled !== false;
});
automationToggle.addEventListener("change", () => {
  chrome.storage.local.set({ bibixAutomationEnabled: automationToggle.checked });
});

/* ---------- Accounts: detect, scan, render, switch ---------- */
async function detectCurrentAccount() {
  // Ask the content script for the username it sees on the page
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/instagram\.com/.test(tab.url || "")) {
      document.getElementById("acctCurrent").textContent = "(open instagram.com to detect)";
      return;
    }
    chrome.scripting.executeScript(
      { target: { tabId: tab.id }, func: () => {
        try {
          const scripts = Array.from(document.querySelectorAll("script[type='application/json']"));
          for (const s of scripts) {
            const m = s.textContent.match(/"username"\s*:\s*"([^"]+)"/);
            if (m) return m[1];
          }
        } catch {}
        return null;
      }},
      (results) => {
        const username = results?.[0]?.result;
        document.getElementById("acctCurrent").textContent = username ? "@" + username : "(unknown)";
      }
    );
  } catch (_) {}
}
detectCurrentAccount();

async function renderAccountsList() {
  const { bibixToken } = await new Promise(r => chrome.runtime.sendMessage({ action: "GET_BIBIX_CONFIG" }, r));
  if (!bibixToken) return;
  try {
    const res = await fetch("https://bibix.ailabstech.com/api/instagram/accounts", {
      headers: { Authorization: "Bearer " + bibixToken },
    });
    if (!res.ok) return;
    const accounts = await res.json();
    const card = document.getElementById("acctListCard");
    const list = document.getElementById("acctList");
    const count = document.getElementById("acctCount");
    if (!Array.isArray(accounts) || accounts.length === 0) { card.style.display = "none"; return; }
    card.style.display = "block";
    count.textContent = `(${accounts.length})`;
    list.innerHTML = "";
    accounts.forEach(u => {
      const row = document.createElement("button");
      row.textContent = "@" + u;
      Object.assign(row.style, {
        display: "block", width: "100%", textAlign: "left", padding: "8px",
        marginBottom: "4px", background: "#f7f7f7", color: "#333",
        border: "1px solid #eee", borderRadius: "6px", cursor: "pointer", fontSize: "13px", fontWeight: "normal",
      });
      row.addEventListener("click", () => {
        showLoader(`Switching to @${u}…`);
        send("SWITCH_ACCOUNT", { username: u });
      });
      list.appendChild(row);
    });
  } catch (_) {}
}
renderAccountsList();

/* ---------- Scan Accounts ---------- */
document.getElementById("runScanAccounts").addEventListener("click", () => {
  showLoader("Scanning accounts from Instagram…");
  send("SCAN_ACCOUNTS");
  // After completion the popup will receive a DONE message; refresh the list a moment later
  setTimeout(renderAccountsList, 3000);
});

/* ---------- Bibix connection ---------- */
const BIBIX_PROD_URL    = "https://bibix.ailabstech.com";
const BIBIX_STAGING_URL = "https://staging.bibix.ailabstech.com";

function setBibixStatus(connected, label) {
  document.getElementById("bibixDot").style.background = connected ? "#27ae60" : (label.includes("❌") ? "#e63946" : "#ccc");
  document.getElementById("bibixConnLabel").textContent = label;
}

function setStagingStatus(connected, label) {
  document.getElementById("bibixStagingDot").style.background = connected ? "#8a3ab9" : (label.includes("❌") ? "#e63946" : "#ccc");
  document.getElementById("bibixStagingLabel").textContent = label;
}

// Verify a token against an env and return "<name> (<email>)" or null.
async function whoAmI(baseUrl, token) {
  try {
    const res = await fetch(`${baseUrl}/api/instagram/auth/verify`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const u = data.user || data;
    const name  = u?.name  || "";
    const email = u?.email || "";
    if (name && email) return `${name} (${email})`;
    return name || email || "user";
  } catch { return null; }
}

// Load saved config and restore UI — re-verify tokens so we can show the
// connected user's name/email every time the popup opens.
chrome.runtime.sendMessage({ action: "GET_BIBIX_CONFIG" }, async (res = {}) => {
  const { bibixToken, bibixStagingToken, bibixStagingEnabled } = res;
  if (bibixToken) {
    document.getElementById("bibixToken").value = bibixToken;
    setBibixStatus(true, "Verifying…");
    const label = await whoAmI(BIBIX_PROD_URL, bibixToken);
    if (label) setBibixStatus(true, `Connected as ${label} ✓`);
    else setBibixStatus(false, "❌ Token rejected — reconnect");
  }
  if (bibixStagingEnabled) {
    document.getElementById("stagingToggle").checked = true;
    document.getElementById("stagingFields").style.display = "block";
    if (bibixStagingToken) {
      document.getElementById("bibixStagingToken").value = bibixStagingToken;
      setStagingStatus(true, "Verifying…");
      const label = await whoAmI(BIBIX_STAGING_URL, bibixStagingToken);
      if (label) setStagingStatus(true, `Connected as ${label} ✓`);
      else setStagingStatus(false, "❌ Token rejected — reconnect");
    }
  }
});

// Toggle staging section visibility
document.getElementById("stagingToggle").addEventListener("change", function() {
  const on = this.checked;
  document.getElementById("stagingFields").style.display = on ? "block" : "none";
  if (!on) {
    chrome.runtime.sendMessage({ action: "SAVE_BIBIX_STAGING_CONFIG", token: null, enabled: false });
    setStagingStatus(false, "Off");
  }
});

// Connect to production
document.getElementById("saveBibixConfig").addEventListener("click", async () => {
  const token = document.getElementById("bibixToken").value.trim();
  if (!token) return alert("Paste your production API token first.");
  setBibixStatus(false, "Verifying…");
  try {
    const res = await fetch(`${BIBIX_PROD_URL}/api/instagram/auth/verify`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error("Invalid token");
    const data = await res.json();
    const label = data.user?.name || data.name || data.email || "user";
    chrome.runtime.sendMessage({ action: "SAVE_BIBIX_CONFIG", token }, () => {
      setBibixStatus(true, `Connected as ${label} ✓`);
    });
  } catch {
    setBibixStatus(false, "❌ Invalid token — check and retry");
  }
});

// Connect to staging
document.getElementById("saveStagingConfig").addEventListener("click", async () => {
  const token = document.getElementById("bibixStagingToken").value.trim();
  if (!token) return alert("Paste your staging API token first.");
  setStagingStatus(false, "Verifying…");
  try {
    const res = await fetch(`${BIBIX_STAGING_URL}/api/instagram/auth/verify`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error("Invalid token");
    const data = await res.json();
    const label = data.user?.name || data.name || data.email || "user";
    chrome.runtime.sendMessage({ action: "SAVE_BIBIX_STAGING_CONFIG", token, enabled: true }, () => {
      setStagingStatus(true, `Connected as ${label} ✓`);
    });
  } catch {
    setStagingStatus(false, "❌ Invalid token — check and retry");
  }
});

/* ---------- History ---------- */
/* ---------- Pages buttons open Monday (Bibix is the source of truth) ---- */
async function openInMonday(path) {
  const { bibixStagingEnabled } = await new Promise(r =>
    chrome.storage.local.get(["bibixStagingEnabled"], r));
  const base = bibixStagingEnabled
    ? "https://staging.bibix.ailabstech.com"
    : "https://bibix.ailabstech.com";
  chrome.tabs.create({ url: `${base}${path}` });
}

document.getElementById("historyBtn").addEventListener("click", () => {
  // Monday's Instagram → History tab
  openInMonday("/marketing/instagram");
});

/* ---------- Dashboard ---------- */
document.getElementById("dashboardBtn").addEventListener("click", () => {
  openInMonday("/marketing/instagram");
});

/* ---------- Campaigns ---------- */
document.getElementById("campaignsBtn").addEventListener("click", () => {
  openInMonday("/marketing/instagram");
});

/* ---------- Progress messages from content.js ---------- */
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "PROGRESS") {
    document.getElementById("status").innerText = msg.text;
  }
  if (msg.type === "DONE") {
    resetUI();
  }
});
