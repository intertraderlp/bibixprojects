/* ═══════════════════════════════════════════════════════
   Bibix IG — Analytics Dashboard
   ═══════════════════════════════════════════════════════ */

let allRecords = [];
let periodDays = 30;

/* ── Action metadata ── */
const OUTBOUND = ["like", "comment_reply", "follow", "unfollow"];
const INBOUND  = ["new_follower", "received_like_post", "received_like_reel",
                  "received_like_comment", "received_comment", "received_reply", "received_mention"];

const ACTION_COLOR = {
  like:                  "#e63946",
  comment_reply:         "#3897f0",
  follow:                "#8a3ab9",
  unfollow:              "#999",
  new_follower:          "#27ae60",
  received_like_post:    "#e91e63",
  received_like_reel:    "#e91e63",
  received_like_comment: "#e91e63",
  received_comment:      "#2196f3",
  received_reply:        "#2196f3",
  received_mention:      "#9c27b0",
};

const ACTION_LABEL = {
  like:                  "❤️ Liked",
  comment_reply:         "💬 Replied",
  follow:                "👤 Followed",
  unfollow:              "👋 Unfollowed",
  new_follower:          "➕ New Follower",
  received_like_post:    "❤️ Got Like (post)",
  received_like_reel:    "❤️ Got Like (reel)",
  received_like_comment: "❤️ Got Like (comment)",
  received_comment:      "💬 Got Comment",
  received_reply:        "↩️ Got Reply",
  received_mention:      "📣 Got Mention",
};

/* ════════════════════════ INIT ═══════════════════════ */
chrome.runtime.sendMessage({ action: "GET_LOG" }, ({ log }) => {
  allRecords = log || [];
  document.getElementById("loading").style.display = "none";
  document.getElementById("main").style.display    = "block";
  render();
});

function render() {
  const records = filterByPeriod(allRecords, periodDays);
  renderCards(records);
  renderActivityCharts(records);
  renderConversions();          // always uses allRecords for accuracy
  renderBestPosts();
  renderBestTimes(records);
  renderTopUsers(records);
}

/* ════════════════════ PERIOD FILTER ═════════════════ */
function filterByPeriod(records, days) {
  if (!days) return records;
  const cutoff = Date.now() - days * 86_400_000;
  return records.filter(r => new Date(r.date).getTime() >= cutoff);
}

/* ══════════════════ SUMMARY CARDS ═══════════════════ */
function renderCards(records) {
  const outbound     = records.filter(r => OUTBOUND.includes(r.action) && r.action !== "unfollow");
  const newFollowers = records.filter(r => r.action === "new_follower");

  // Follow-back rate
  const iFollowed     = new Set(records.filter(r => r.action === "follow").map(r => r.targetUsername));
  const followedBack  = new Set(allRecords.filter(r => r.action === "new_follower" && iFollowed.has(r.targetUsername)).map(r => r.targetUsername));
  const followBackPct = iFollowed.size ? Math.round(followedBack.size / iFollowed.size * 100) : 0;

  // Engagement-to-follower conversion (likes + replies only)
  const iEngaged      = new Set(records.filter(r => ["like","comment_reply"].includes(r.action)).map(r => r.targetUsername));
  const engagedFollowed = new Set(allRecords.filter(r => r.action === "new_follower" && iEngaged.has(r.targetUsername)).map(r => r.targetUsername));
  const engagePct     = iEngaged.size ? Math.round(engagedFollowed.size / iEngaged.size * 100) : 0;

  document.getElementById("summaryCards").innerHTML = `
    <div class="card green">
      <div class="card-value">${newFollowers.length}</div>
      <div class="card-label">New Followers</div>
      <div class="card-sub">in selected period</div>
    </div>
    <div class="card blue">
      <div class="card-value">${outbound.length}</div>
      <div class="card-label">Outbound Actions</div>
      <div class="card-sub">${records.filter(r=>r.action==="like").length} likes · ${records.filter(r=>r.action==="comment_reply").length} replies · ${records.filter(r=>r.action==="follow").length} follows</div>
    </div>
    <div class="card purple">
      <div class="card-value">${followBackPct}%</div>
      <div class="card-label">Follow-back Rate</div>
      <div class="card-sub">${followedBack.size} of ${iFollowed.size} followed you back</div>
    </div>
    <div class="card pink">
      <div class="card-value">${engagePct}%</div>
      <div class="card-label">Engagement → Follower</div>
      <div class="card-sub">${engagedFollowed.size} of ${iEngaged.size} liked/replied users followed you</div>
    </div>
  `;
}

/* ═══════════════════ ACTIVITY CHARTS ════════════════ */
function renderActivityCharts(records) {
  const { buckets, getKey } = buildBuckets(periodDays, records);

  // Build counts per bucket
  const outByBucket = {}, inByBucket = {};
  buckets.forEach(b => { outByBucket[b.key] = 0; inByBucket[b.key] = 0; });

  records.forEach(r => {
    const k = getKey(r.date);
    if (outByBucket[k] !== undefined && OUTBOUND.includes(r.action) && r.action !== "unfollow")
      outByBucket[k]++;
    if (inByBucket[k]  !== undefined && INBOUND.includes(r.action))
      inByBucket[k]++;
  });

  const outData = buckets.map(b => ({ label: b.label, value: outByBucket[b.key] || 0, full: b.key }));
  const inData  = buckets.map(b => ({ label: b.label, value: inByBucket[b.key]  || 0, full: b.key }));

  // Breakdown by type
  const outBreak = {}, inBreak = {};
  records.forEach(r => {
    if (OUTBOUND.includes(r.action)) outBreak[r.action] = (outBreak[r.action] || 0) + 1;
    if (INBOUND.includes(r.action))  inBreak[r.action]  = (inBreak[r.action]  || 0) + 1;
  });

  document.getElementById("chartOutbound").innerHTML =
    svgBarChart(outData, "#3897f0") + renderBreakdown(outBreak);

  document.getElementById("chartInbound").innerHTML =
    svgBarChart(inData, "#27ae60") + renderBreakdown(inBreak);
}

/* Build day or month buckets depending on period */
function buildBuckets(days, records) {
  if (days > 0) {
    // Day buckets
    const buckets = [];
    const now = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      buckets.push({ key, label: `${d.getMonth()+1}/${d.getDate()}` });
    }
    return { buckets, getKey: iso => iso.slice(0, 10) };
  } else {
    // Month buckets for "all time"
    const monthSet = new Set(records.map(r => r.date.slice(0, 7)));
    const buckets  = [...monthSet].sort().map(m => {
      const [y, mo] = m.split("-");
      return { key: m, label: new Date(+y, +mo - 1).toLocaleString("default",{month:"short", year:"2-digit"}) };
    });
    return { buckets, getKey: iso => iso.slice(0, 7) };
  }
}

function renderBreakdown(breakdown) {
  const items = Object.entries(breakdown)
    .sort((a, b) => b[1] - a[1])
    .map(([action, count]) => `
      <span class="breakdown-item">
        <span class="dot" style="background:${ACTION_COLOR[action]||'#999'}"></span>
        ${ACTION_LABEL[action]||action}: <strong>${count}</strong>
      </span>
    `).join("");
  return `<div class="breakdown">${items || '<span style="color:#ccc;font-size:12px">No data</span>'}</div>`;
}

/* ════════════════════ WHO FOLLOWED BACK ═════════════ */
function findConversions() {
  // Build map: targetUsername → first outbound engagement record
  const firstEngagement = {};
  [...allRecords]
    .filter(r => ["like", "comment_reply", "follow"].includes(r.action))
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .forEach(r => {
      if (!firstEngagement[r.targetUsername]) firstEngagement[r.targetUsername] = r;
    });

  // Match new_follower records with a prior engagement
  return allRecords
    .filter(r => r.action === "new_follower")
    .reduce((acc, r) => {
      const prior = firstEngagement[r.targetUsername];
      if (prior && new Date(r.date) >= new Date(prior.date)) {
        acc.push({
          username:      r.targetUsername,
          fullName:      r.fullName || prior.fullName || null,
          followers:     r.followers || prior.followers || null,
          ourAction:     prior.action,
          ourActionDate: prior.date,
          followedDate:  r.date,
          postUrl:       prior.postUrl || null,
          postOwner:     prior.postOwner || null,
          diffMs:        new Date(r.date) - new Date(prior.date),
        });
      }
      return acc;
    }, [])
    .sort((a, b) => new Date(b.followedDate) - new Date(a.followedDate));
}

function renderConversions() {
  const conversions = findConversions();
  const sub = document.getElementById("conversionSub");
  const el  = document.getElementById("conversionTable");

  if (!conversions.length) {
    sub.textContent = "";
    el.innerHTML = '<p class="empty">No conversions yet — keep engaging!</p>';
    return;
  }

  sub.textContent = `${conversions.length} user${conversions.length !== 1 ? "s" : ""} followed you after you engaged with them`;

  el.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>User</th>
          <th>Full Name</th>
          <th>Followers</th>
          <th>Your Action</th>
          <th>Action Date</th>
          <th>Followed You</th>
          <th>Time to Convert</th>
          <th>Post</th>
        </tr>
      </thead>
      <tbody>
        ${conversions.slice(0, 50).map(c => `
          <tr>
            <td><a href="https://instagram.com/${c.username}" target="_blank">@${c.username}</a></td>
            <td>${c.fullName || "—"}</td>
            <td>${c.followers ? Number(c.followers).toLocaleString() : "—"}</td>
            <td>${ACTION_LABEL[c.ourAction] || c.ourAction}</td>
            <td>${fmtDate(c.ourActionDate)}</td>
            <td>${fmtDate(c.followedDate)}</td>
            <td><span class="conv-badge">${fmtDiff(c.diffMs)}</span></td>
            <td>${c.postUrl ? `<a href="${c.postUrl}" target="_blank">Open ↗</a>` : "—"}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
    ${conversions.length > 50 ? `<p class="table-note">Showing top 50 of ${conversions.length}</p>` : ""}
  `;
}

/* ═════════════════ BEST POSTS BY CONVERSION ═════════ */
function renderBestPosts() {
  const el = document.getElementById("bestPosts");

  // Group outbound (like + reply) by postUrl
  const postMap = {};
  allRecords
    .filter(r => ["like","comment_reply"].includes(r.action) && r.postUrl)
    .forEach(r => {
      if (!postMap[r.postUrl]) {
        postMap[r.postUrl] = {
          postUrl:   r.postUrl,
          postOwner: r.postOwner || null,
          actions:   0,
          users:     new Set(),
          typeCount: {},
        };
      }
      postMap[r.postUrl].actions++;
      postMap[r.postUrl].users.add(r.targetUsername);
      postMap[r.postUrl].typeCount[r.action] = (postMap[r.postUrl].typeCount[r.action] || 0) + 1;
    });

  if (!Object.keys(postMap).length) {
    el.innerHTML = '<p class="empty">No post engagement data yet.</p>';
    return;
  }

  // New-follower set for cross-reference
  const followerSet = new Set(allRecords.filter(r => r.action === "new_follower").map(r => r.targetUsername));

  const posts = Object.values(postMap)
    .map(p => {
      const converted = [...p.users].filter(u => followerSet.has(u)).length;
      return {
        ...p,
        uniqueUsers: p.users.size,
        converted,
        convRate: p.users.size ? Math.round(converted / p.users.size * 100) : 0,
      };
    })
    .sort((a, b) => b.converted - a.converted || b.actions - a.actions)
    .slice(0, 25);

  el.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Post Owner</th>
          <th>Post</th>
          <th>Actions</th>
          <th>Unique Users Engaged</th>
          <th>Converted to Followers</th>
          <th>Conversion Rate</th>
        </tr>
      </thead>
      <tbody>
        ${posts.map(p => {
          const pctColor = p.convRate > 20 ? "#27ae60" : p.convRate > 8 ? "#f5a623" : "#e63946";
          const typeDesc = Object.entries(p.typeCount).map(([a,c]) => `${c} ${a.replace("comment_reply","repl.").replace("like","like")}`).join(" · ");
          return `
            <tr>
              <td>${p.postOwner ? `<a href="https://instagram.com/${p.postOwner}" target="_blank">@${p.postOwner}</a>` : "—"}</td>
              <td><a href="${p.postUrl}" target="_blank">Open ↗</a></td>
              <td>${p.actions} <span style="color:#bbb;font-size:11px">${typeDesc}</span></td>
              <td>${p.uniqueUsers}</td>
              <td><strong style="color:${p.converted>0?"#27ae60":"#ccc"}">${p.converted}</strong></td>
              <td>
                <div class="rate-bar">
                  <div class="rate-track">
                    <div class="rate-fill" style="width:${p.convRate}%;background:${pctColor}"></div>
                  </div>
                  <span style="font-size:12px;color:${pctColor};font-weight:bold">${p.convRate}%</span>
                </div>
              </td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `;
}

/* ══════════════════ BEST TIMES TO ENGAGE ════════════ */
function renderBestTimes(records) {
  const el = document.getElementById("bestTimes");
  const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

  const outActions = records.filter(r => ["like","comment_reply","follow"].includes(r.action));

  // By day of week
  const outByDow  = Array(7).fill(0);
  outActions.forEach(r => outByDow[new Date(r.date).getDay()]++);

  // Conversions triggered per day of week
  const convs = findConversions();
  const convByDow = Array(7).fill(0);
  convs.forEach(c => convByDow[new Date(c.ourActionDate).getDay()]++);

  const maxDow = Math.max(...outByDow, 1);

  const dowBars = DAYS.map((label, i) => `
    <div class="time-col">
      <div class="time-bar-wrap">
        ${convByDow[i] ? `<div class="time-conv">+${convByDow[i]}</div>` : ""}
        <div class="time-bar" style="height:${Math.round(outByDow[i]/maxDow*80)}px;background:#3897f0"></div>
      </div>
      <div class="time-label">${label}</div>
      <div class="time-val">${outByDow[i] || "—"}</div>
    </div>
  `).join("");

  // By hour of day
  const outByHour = Array(24).fill(0);
  outActions.forEach(r => outByHour[new Date(r.date).getHours()]++);
  const maxHour = Math.max(...outByHour, 1);

  const hourBars = Array.from({length:24}, (_, i) => `
    <div class="time-col time-col-hour">
      <div class="time-bar-wrap">
        <div class="time-bar" style="height:${Math.round(outByHour[i]/maxHour*80)}px;background:#8a3ab9"></div>
      </div>
      <div class="time-label">${i}</div>
      <div class="time-val" style="font-size:9px">${outByHour[i]||""}</div>
    </div>
  `).join("");

  el.innerHTML = `
    <div class="col-box">
      <h4>By Day of Week <span class="hint-text">bars = actions · green = conversions triggered</span></h4>
      <div class="time-bars">${dowBars}</div>
    </div>
    <div class="col-box">
      <h4>By Hour of Day <span class="hint-text">(your local time)</span></h4>
      <div class="time-bars" style="gap:1px">${hourBars}</div>
    </div>
  `;
}

/* ═════════════════════ TOP USERS ════════════════════ */
function renderTopUsers(records) {
  const el = document.getElementById("topUsers");

  // Who engaged with me most (inbound)
  const inMap = {};
  records.filter(r => INBOUND.includes(r.action)).forEach(r => {
    if (!inMap[r.targetUsername])
      inMap[r.targetUsername] = { u: r.targetUsername, n: r.fullName, f: r.followers, total: 0, types: {} };
    inMap[r.targetUsername].total++;
    inMap[r.targetUsername].types[r.action] = (inMap[r.targetUsername].types[r.action] || 0) + 1;
    if (r.fullName && !inMap[r.targetUsername].n) inMap[r.targetUsername].n = r.fullName;
  });

  // Who I engaged with most (outbound)
  const outMap = {};
  records.filter(r => OUTBOUND.includes(r.action)).forEach(r => {
    if (!outMap[r.targetUsername])
      outMap[r.targetUsername] = { u: r.targetUsername, n: r.fullName, f: r.followers, total: 0, types: {} };
    outMap[r.targetUsername].total++;
    outMap[r.targetUsername].types[r.action] = (outMap[r.targetUsername].types[r.action] || 0) + 1;
    if (r.fullName && !outMap[r.targetUsername].n) outMap[r.targetUsername].n = r.fullName;
  });

  const followerSet = new Set(allRecords.filter(r => r.action === "new_follower").map(r => r.targetUsername));

  const userTable = (users) => `
    <table>
      <thead>
        <tr><th>User</th><th>Full Name</th><th>Followers</th><th>Interactions</th><th>Followed You?</th></tr>
      </thead>
      <tbody>
        ${users.map(u => `
          <tr>
            <td><a href="https://instagram.com/${u.u}" target="_blank">@${u.u}</a></td>
            <td>${u.n || "—"}</td>
            <td>${u.f ? Number(u.f).toLocaleString() : "—"}</td>
            <td>
              <strong>${u.total}</strong>
              <span style="color:#bbb;font-size:11px;margin-left:4px">
                ${Object.entries(u.types).map(([a,c]) => `${c}× ${ACTION_LABEL[a]||a}`).join(" · ")}
              </span>
            </td>
            <td>${followerSet.has(u.u) ? '<span class="conv-badge">✓ Yes</span>' : '<span style="color:#ccc;font-size:12px">—</span>'}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;

  const topIn  = Object.values(inMap).sort((a,b) => b.total - a.total).slice(0, 15);
  const topOut = Object.values(outMap).sort((a,b) => b.total - a.total).slice(0, 15);

  el.innerHTML = `
    <div class="col-box">
      <h4>Users Who Engaged With You Most</h4>
      ${topIn.length ? userTable(topIn) : '<p class="empty">No inbound data yet.</p>'}
    </div>
    <div class="col-box">
      <h4>Users You Engaged With Most</h4>
      ${topOut.length ? userTable(topOut) : '<p class="empty">No outbound data yet.</p>'}
    </div>
  `;
}

/* ════════════════════ SVG BAR CHART ═════════════════ */
function svgBarChart(data, color) {
  if (!data.length || data.every(d => d.value === 0))
    return '<p class="empty-chart">No activity in this period</p>';

  const maxVal = Math.max(...data.map(d => d.value), 1);
  const H      = 90;    // bar area height
  const lblH   = 16;
  const svgH   = H + lblH;
  const barW   = Math.max(3, Math.floor(540 / data.length) - 2);
  const gap    = 2;
  const svgW   = data.length * (barW + gap);

  // Show at most 12 date labels
  const step = Math.ceil(data.length / 12);

  const bars = data.map((d, i) => {
    const h = Math.max(2, Math.round(d.value / maxVal * H));
    const x = i * (barW + gap);
    const y = H - h;
    const showLabel = i === 0 || i === data.length - 1 || i % step === 0;
    return `
      <rect x="${x}" y="${y}" width="${barW}" height="${h}" fill="${color}" rx="1" opacity="0.85">
        <title>${d.full}: ${d.value}</title>
      </rect>
      ${showLabel ? `<text x="${x + barW/2}" y="${H + 13}" text-anchor="middle" font-size="8" fill="#bbb">${d.label}</text>` : ""}
    `;
  }).join("");

  return `
    <div style="overflow-x:auto;margin-bottom:8px">
      <svg viewBox="0 0 ${svgW} ${svgH}" width="100%"
           style="height:${svgH}px;display:block;min-width:${Math.min(svgW,220)}px"
           preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
        ${bars}
      </svg>
    </div>`;
}

/* ═══════════════════════ UTILS ══════════════════════ */
function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtDiff(ms) {
  if (ms < 0) return "—";
  const m = Math.floor(ms / 60_000);
  if (m < 60)   return `${m}m`;
  const h = Math.floor(ms / 3_600_000);
  if (h < 24)   return `${h}h`;
  return `${Math.floor(ms / 86_400_000)}d`;
}

/* ══════════════════ PERIOD BUTTONS ══════════════════ */
document.querySelectorAll(".period-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".period-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    periodDays = parseInt(btn.dataset.days, 10);
    render();
  });
});

/* ══════════════════ BACK BUTTON ═════════════════════ */
document.getElementById("backBtn").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("history.html") });
  window.close();
});
