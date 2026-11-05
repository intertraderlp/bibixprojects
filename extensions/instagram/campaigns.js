let allCampaigns = [];
let filtered     = [];

const TYPE_BADGE = {
  like:          { label: "❤️ Likes",    color: "#e63946" },
  comment_reply: { label: "💬 Replies",  color: "#3897f0" },
  follow:        { label: "👤 Follows",  color: "#8a3ab9" },
  unfollow:      { label: "👋 Unfollows", color: "#777"   },
};

/* ═══════════════════════════════ INIT ══════════════════════════════ */
chrome.runtime.sendMessage({ action: "GET_CAMPAIGNS" }, ({ campaigns }) => {
  allCampaigns = campaigns || [];
  filtered     = allCampaigns;
  populateProfileDropdown();
  render(filtered);
});

/* ═══════════════════════════ POPULATE DROPDOWN ══════════════════════ */
function populateProfileDropdown() {
  const sel = document.getElementById("filterProfile");
  const profiles = new Set(allCampaigns.map(c => c.myProfile).filter(Boolean));
  while (sel.options.length > 1) sel.remove(1);
  [...profiles].sort().forEach(p => {
    const o = document.createElement("option");
    o.value = p; o.textContent = "@" + p;
    sel.appendChild(o);
  });
}

/* ════════════════════════════ FILTERS ══════════════════════════════ */
function applyFilters() {
  const type     = document.getElementById("filterType").value;
  const status   = document.getElementById("filterStatus").value;
  const profile  = document.getElementById("filterProfile").value;
  const dateFrom = document.getElementById("filterDateFrom").value;
  const dateTo   = document.getElementById("filterDateTo").value;

  const fromTs = dateFrom ? new Date(dateFrom).getTime() : null;
  const toTs   = dateTo   ? new Date(dateTo + "T23:59:59").getTime() : null;

  filtered = allCampaigns.filter(c => {
    if (type    && c.type      !== type)    return false;
    if (status  && c.status    !== status)  return false;
    if (profile && c.myProfile !== profile) return false;
    const ts = new Date(c.date).getTime();
    if (fromTs !== null && ts < fromTs) return false;
    if (toTs   !== null && ts > toTs)   return false;
    return true;
  });

  render(filtered);
}

["filterType","filterStatus","filterProfile"].forEach(id =>
  document.getElementById(id).addEventListener("change", applyFilters)
);
["filterDateFrom","filterDateTo"].forEach(id =>
  document.getElementById(id).addEventListener("input", applyFilters)
);

document.getElementById("resetBtn").addEventListener("click", () => {
  ["filterType","filterStatus","filterProfile","filterDateFrom","filterDateTo"]
    .forEach(id => document.getElementById(id).value = "");
  applyFilters();
});

/* ════════════════════════════ RENDER ═══════════════════════════════ */
function render(campaigns) {
  const el    = document.getElementById("campaignList");
  const count = document.getElementById("countBar");

  count.textContent = `${campaigns.length} campaign${campaigns.length !== 1 ? "s" : ""}`;

  if (!campaigns.length) {
    el.innerHTML = '<p class="empty">No campaigns yet. Run a like, reply, follow or unfollow action to record your first campaign.</p>';
    return;
  }

  el.innerHTML = campaigns.map(c => buildCard(c)).join("");
}

function buildCard(c) {
  const badge   = TYPE_BADGE[c.type] || { label: c.type, color: "#999" };
  const done    = c.completed ?? 0;
  const req     = c.requested ?? 0;
  const pct     = req > 0 ? Math.round(done / req * 100) : 0;
  const barColor = pct >= 90 ? "#27ae60" : pct >= 60 ? "#f5a623" : "#e63946";

  const statusBadge = {
    done:    `<span class="status-badge status-done">✅ Done</span>`,
    stopped: `<span class="status-badge status-stopped">⚠️ Stopped</span>`,
    running: `<span class="status-badge status-running">🔄 Running</span>`,
  }[c.status] || "";

  /* ── Post section (likes / replies) ── */
  const isPostAction = ["like","comment_reply"].includes(c.type);

  const postSection = isPostAction ? `
    <div class="card-section">
      <div class="section-title">Post</div>
      ${row("Owner",    c.postOwner ? `<a href="https://instagram.com/${c.postOwner}" target="_blank">@${c.postOwner}</a>` : "—")}
      ${row("Full Name", c.postOwnerFullName || "—")}
      ${row("Followers", c.postOwnerFollowers ? fmt(c.postOwnerFollowers) : "—")}
      ${row("Post Likes",    c.postLikes    ? Number(c.postLikes).toLocaleString()    : "—")}
      ${row("Post Comments", c.postComments ? Number(c.postComments).toLocaleString() : "—")}
      ${row("URL", c.postUrl ? `<a href="${c.postUrl}" target="_blank">Open post ↗</a>` : "—")}
    </div>` : `
    <div class="card-section">
      <div class="section-title">Context</div>
      ${row("Profile", c.myProfile ? `<a href="https://instagram.com/${c.myProfile}" target="_blank">@${c.myProfile}</a>` : "—")}
      ${row("Source page", c.contextUrl ? `<a href="${c.contextUrl}" target="_blank">Open ↗</a>` : "—")}
    </div>`;

  /* ── Follower stats section ── */
  const fs = c.followerStats;
  const statsSection = `
    <div class="card-section">
      <div class="section-title">Target Profile Stats</div>
      ${fs ? `
        <div class="stats-grid">
          <div class="stat-box"><div class="stat-value">${fmtShort(fs.avg)}</div><div class="stat-label">Avg followers</div></div>
          <div class="stat-box"><div class="stat-value">${fmtShort(fs.min)}</div><div class="stat-label">Min followers</div></div>
          <div class="stat-box"><div class="stat-value">${fmtShort(fs.max)}</div><div class="stat-label">Max followers</div></div>
          <div class="stat-box"><div class="stat-value">${fs.count}</div><div class="stat-label">With data</div></div>
        </div>
        <div style="margin-top:8px;font-size:11px;color:#aaa">Total reach: ${Number(fs.total).toLocaleString()} followers</div>
      ` : `<p style="color:#ccc;font-size:12px;margin-top:4px">No follower data collected</p>`}
    </div>`;

  return `
    <div class="campaign-card">
      <div class="card-header">
        <div class="card-header-left">
          <span class="type-badge" style="background:${badge.color}">${badge.label}</span>
          <span class="card-date">${fmtDate(c.date)}</span>
          ${statusBadge}
        </div>
        <div class="card-header-right">
          <div class="completion">${done} / ${req} completed</div>
          <div style="display:flex;align-items:center;gap:6px">
            <div class="progress-track" style="width:100px">
              <div class="progress-fill" style="width:${pct}%;background:${barColor}"></div>
            </div>
            <span style="font-size:12px;color:${barColor};font-weight:bold">${pct}%</span>
          </div>
        </div>
      </div>
      <div class="card-body">
        ${postSection}
        ${statsSection}
      </div>
    </div>`;
}

/* ── helpers ── */
function row(label, value) {
  return `
    <div class="info-row">
      <span class="info-label">${label}</span>
      <span class="info-value">${value}</span>
    </div>`;
}

function fmt(val) {
  if (!val) return "—";
  const n = parseFloat(String(val).replace(/,/g, ""));
  return isNaN(n) ? val : n.toLocaleString();
}

function fmtShort(n) {
  if (!n && n !== 0) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + "K";
  return n.toString();
}

function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/* ═══════════════════════ EXPORT CSV ════════════════════════════════ */
document.getElementById("exportBtn").addEventListener("click", () => {
  const headers = [
    "Date","Type","Status","My Profile",
    "Requested","Completed","Completion %",
    "Post Owner","Post Owner Followers","Post Owner Full Name","Post Likes","Post Comments","Post URL",
    "Context URL",
    "Follower Avg","Follower Min","Follower Max","Follower Count","Follower Total",
  ];

  const rows = filtered.map(c => {
    const done = c.completed ?? 0;
    const req  = c.requested ?? 0;
    const fs   = c.followerStats || {};
    return [
      fmtDate(c.date),
      c.type,
      c.status,
      c.myProfile || "",
      req, done,
      req > 0 ? Math.round(done / req * 100) + "%" : "—",
      c.postOwner || "",
      c.postOwnerFollowers || "",
      c.postOwnerFullName || "",
      c.postLikes    || "",
      c.postComments || "",
      c.postUrl      || "",
      c.contextUrl   || "",
      fs.avg   || "",
      fs.min   || "",
      fs.max   || "",
      fs.count || "",
      fs.total || "",
    ].map(v => (typeof v === "string" && v.includes(",")) ? `"${v}"` : v);
  });

  const csv  = [headers, ...rows].map(r => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = `bibix-campaigns-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

/* ═══════════════════════ CLEAR ALL ═════════════════════════════════ */
document.getElementById("clearBtn").addEventListener("click", () => {
  if (!confirm("Clear all campaigns? This cannot be undone.")) return;
  chrome.runtime.sendMessage({ action: "CLEAR_CAMPAIGNS" }, () => {
    allCampaigns = []; filtered = [];
    populateProfileDropdown();
    render([]);
  });
});
