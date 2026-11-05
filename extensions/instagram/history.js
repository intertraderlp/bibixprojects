let allRecords   = [];   // full dataset from storage
let filtered     = [];   // after applying filters
let currentPage  = 1;
let perPage      = 50;

const BADGE = {
  like:                  '<span class="badge badge-like">❤️ Liked comment</span>',
  comment_reply:         '<span class="badge badge-comment">💬 Replied</span>',
  follow:                '<span class="badge badge-follow">👤 Followed</span>',
  unfollow:              '<span class="badge badge-unfollow">👋 Unfollowed</span>',
  dm_reply:              '<span class="badge" style="background:#2ecc71">✉️ DM Reply</span>',
  new_follower:          '<span class="badge" style="background:#27ae60">➕ New Follower</span>',
  received_like_post:    '<span class="badge" style="background:#e91e63">❤️ Got Like (post)</span>',
  received_like_comment: '<span class="badge" style="background:#e91e63">❤️ Got Like (comment)</span>',
  received_comment:      '<span class="badge" style="background:#2196f3">💬 Got Comment</span>',
  received_reply:        '<span class="badge" style="background:#2196f3">↩️ Got Reply</span>',
  received_mention:      '<span class="badge" style="background:#9c27b0">📣 Got Mention</span>',
};

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/* ───────────────────────── POPULATE DROPDOWNS ──────────────────────────── */
function populateDropdown(selectId, values, labelPrefix = "@") {
  const sel = document.getElementById(selectId);
  const current = sel.value; // preserve selection if re-populating
  // keep only the first "All …" option
  while (sel.options.length > 1) sel.remove(1);
  [...values].sort().forEach((v) => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = labelPrefix + v;
    sel.appendChild(opt);
  });
  // restore selection if value still exists
  if ([...sel.options].some((o) => o.value === current)) sel.value = current;
}

function refreshDropdowns() {
  const profiles   = new Set();
  const postOwners = new Set();

  allRecords.forEach((r) => {
    if (r.myProfile  && r.myProfile  !== "unknown") profiles.add(r.myProfile);
    if (r.postOwner) postOwners.add(r.postOwner);
  });

  populateDropdown("filterProfile",   profiles);
  populateDropdown("filterPostOwner", postOwners);
}

/* ───────────────────────────── RENDER TABLE ───────────────────────────── */
function renderTable(records) {
  const tbody = document.getElementById("tableBody");

  if (!records.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty">No records match your filters.</td></tr>';
    return;
  }

  const start = (currentPage - 1) * perPage;
  const page  = records.slice(start, start + perPage);

  tbody.innerHTML = page.map((r) => `
    <tr>
      <td>${formatDate(r.date)}</td>
      <td>@${r.myProfile}</td>
      <td>${BADGE[r.action] || r.action}</td>
      <td><a href="https://instagram.com/${r.targetUsername}" target="_blank">@${r.targetUsername}</a></td>
      <td>${r.fullName || "—"}</td>
      <td>${r.followers ? Number(r.followers).toLocaleString() : "—"}</td>
      <td class="reply-text" title="${(r.replyText || "").replace(/"/g, "&quot;")}">${r.replyText || "—"}</td>
      <td>${r.postOwner ? `<a href="https://instagram.com/${r.postOwner}" target="_blank">@${r.postOwner}</a>` : "—"}</td>
      <td>${r.postUrl ? `<a href="${r.postUrl}" target="_blank">Open ↗</a>` : "—"}</td>
    </tr>
  `).join("");
}

/* ───────────────────────────── PAGINATION ─────────────────────────────── */
function renderPagination(total) {
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const pag = document.getElementById("pagination");
  const countEl = document.getElementById("count");

  const start = total === 0 ? 0 : (currentPage - 1) * perPage + 1;
  const end   = Math.min(currentPage * perPage, total);
  countEl.innerText = `${total} record${total !== 1 ? "s" : ""} — showing ${start}–${end}`;

  if (totalPages <= 1) { pag.innerHTML = ""; return; }

  const delta = 2;
  const pages = [];
  for (let i = 1; i <= totalPages; i++) {
    if (
      i === 1 || i === totalPages ||
      (i >= currentPage - delta && i <= currentPage + delta)
    ) {
      pages.push(i);
    } else if (pages[pages.length - 1] !== "…") {
      pages.push("…");
    }
  }

  let html = `<button id="pgPrev" ${currentPage === 1 ? "disabled" : ""}>‹ Prev</button>`;
  for (const p of pages) {
    if (p === "…") {
      html += `<span class="page-info">…</span>`;
    } else {
      html += `<button class="pg-num ${p === currentPage ? "active" : ""}" data-page="${p}">${p}</button>`;
    }
  }
  html += `<button id="pgNext" ${currentPage === totalPages ? "disabled" : ""}>Next ›</button>`;
  pag.innerHTML = html;

  document.getElementById("pgPrev").addEventListener("click", () => goToPage(currentPage - 1));
  document.getElementById("pgNext").addEventListener("click", () => goToPage(currentPage + 1));
  pag.querySelectorAll(".pg-num").forEach((btn) => {
    btn.addEventListener("click", () => goToPage(Number(btn.dataset.page)));
  });
}

function goToPage(n) {
  const totalPages = Math.ceil(filtered.length / perPage);
  currentPage = Math.max(1, Math.min(n, totalPages));
  renderTable(filtered);
  renderPagination(filtered.length);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ───────────────────────────── FILTERS ────────────────────────────────── */
function applyFilters() {
  const action     = document.getElementById("filterAction").value;
  const profile    = document.getElementById("filterProfile").value;
  const user       = document.getElementById("filterUser").value.toLowerCase().trim();
  const postOwner  = document.getElementById("filterPostOwner").value;
  const dateFrom   = document.getElementById("filterDateFrom").value;
  const dateTo     = document.getElementById("filterDateTo").value;
  const followOp   = document.getElementById("filterFollowersOp").value;
  const followVal  = parseFloat(document.getElementById("filterFollowersVal").value);
  const followVal2 = parseFloat(document.getElementById("filterFollowersVal2").value);

  const fromTs = dateFrom ? new Date(dateFrom).getTime()               : null;
  const toTs   = dateTo   ? new Date(dateTo + "T23:59:59").getTime()   : null;

  filtered = allRecords.filter((r) => {
    if (action    && r.action !== action)                                    return false;
    if (profile   && r.myProfile  !== profile)                               return false;
    if (postOwner && r.postOwner  !== postOwner)                             return false;
    if (user      && !(r.targetUsername || "").toLowerCase().includes(user)) return false;

    const recTs = new Date(r.date).getTime();
    if (fromTs !== null && recTs < fromTs) return false;
    if (toTs   !== null && recTs > toTs)   return false;

    if (followOp) {
      const fCount = parseFollowers(r.followers);
      if (fCount === null) return false;
      if (!isNaN(followVal)) {
        if (followOp === "gt"      && !(fCount >  followVal))  return false;
        if (followOp === "gte"     && !(fCount >= followVal))  return false;
        if (followOp === "lt"      && !(fCount <  followVal))  return false;
        if (followOp === "lte"     && !(fCount <= followVal))  return false;
        if (followOp === "eq"      && !(fCount === followVal)) return false;
        if (followOp === "between" && !isNaN(followVal2) &&
            !(fCount >= followVal && fCount <= followVal2))    return false;
      }
    }

    return true;
  });

  currentPage = 1;
  renderTable(filtered);
  renderPagination(filtered.length);
}

function parseFollowers(val) {
  if (!val) return null;
  const s = String(val).replace(/,/g, "").trim().toLowerCase();
  if (s.endsWith("k")) return parseFloat(s) * 1_000;
  if (s.endsWith("m")) return parseFloat(s) * 1_000_000;
  if (s.endsWith("b")) return parseFloat(s) * 1_000_000_000;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

/* ───────────────────────────── EXPORT CSV ──────────────────────────────── */
function exportCSV(records) {
  const headers = ["Date", "My Profile", "Action", "Target Username", "Full Name", "Followers", "Reply", "Post Owner", "Post URL"];
  const rows = records.map((r) => [
    formatDate(r.date),
    r.myProfile,
    r.action,
    r.targetUsername,
    r.fullName || "",
    r.followers || "",
    r.replyText ? `"${r.replyText.replace(/"/g, '""')}"` : "",
    r.postOwner || "",
    r.postUrl || "",
  ]);

  const csv = [headers, ...rows].map((r) => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `bibix-ig-history-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ───────────────────────────── INIT ─────────────────────────────────────── */
chrome.runtime.sendMessage({ action: "GET_LOG" }, ({ log }) => {
  allRecords = log || [];
  filtered   = allRecords;
  refreshDropdowns();
  renderTable(filtered);
  renderPagination(filtered.length);
});

/* ── Filter listeners ── */
// Selects → "change" | text/number inputs → "input"
const filterIds = [
  "filterAction", "filterProfile", "filterPostOwner",
  "filterUser",
  "filterDateFrom", "filterDateTo",
  "filterFollowersOp", "filterFollowersVal", "filterFollowersVal2",
];
filterIds.forEach((id) => {
  const el = document.getElementById(id);
  el.addEventListener(el.tagName === "SELECT" ? "change" : "input", applyFilters);
});

// Show/hide second followers input for "between"
document.getElementById("filterFollowersOp").addEventListener("change", function () {
  const isBetween = this.value === "between";
  document.getElementById("filterFollowersBetweenLabel").style.display = isBetween ? "inline" : "none";
  document.getElementById("filterFollowersVal2").style.display         = isBetween ? "inline-block" : "none";
});

/* ── Per-page selector ── */
document.getElementById("perPageSelect").addEventListener("change", function () {
  perPage = parseInt(this.value, 10);
  currentPage = 1;
  renderTable(filtered);
  renderPagination(filtered.length);
});

/* ── Reset ── */
document.getElementById("resetBtn").addEventListener("click", () => {
  ["filterAction","filterProfile","filterPostOwner",
   "filterUser","filterDateFrom","filterDateTo",
   "filterFollowersOp","filterFollowersVal","filterFollowersVal2"
  ].forEach((id) => { document.getElementById(id).value = ""; });
  document.getElementById("filterFollowersBetweenLabel").style.display = "none";
  document.getElementById("filterFollowersVal2").style.display = "none";
  applyFilters();
});

/* ── Campaigns ── */
document.getElementById("campaignsBtn").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("campaigns.html") });
});

/* ── Dashboard ── */
document.getElementById("dashboardBtn").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
});

/* ── Export (respects current filters) ── */
document.getElementById("exportBtn").addEventListener("click", () => exportCSV(filtered));

/* ── Clear All ── */
document.getElementById("clearBtn").addEventListener("click", () => {
  if (!confirm("Clear all history? This cannot be undone.")) return;
  chrome.runtime.sendMessage({ action: "CLEAR_LOG" }, () => {
    allRecords = [];
    filtered   = [];
    refreshDropdowns();
    renderTable([]);
    renderPagination(0);
  });
});
