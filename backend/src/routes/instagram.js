const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { authenticate, authenticateFlexible } = require('../middleware/auth');

const router = express.Router();

// ── Media uploads for scheduled posts ────────────────────────────────────────
const IG_UPLOADS_DIR = path.join(__dirname, '../../data/instagram-uploads');
fs.mkdirSync(IG_UPLOADS_DIR, { recursive: true });
const igStorage = multer.diskStorage({
  destination: IG_UPLOADS_DIR,
  filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname) || ''}`),
});
const igUpload = multer({ storage: igStorage, limits: { fileSize: 100 * 1024 * 1024 } });
router.UPLOADS_DIR = IG_UPLOADS_DIR;

// ── Tables ────────────────────────────────────────────────────────────────────
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS instagram_actions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      username TEXT,
      follower_count INTEGER,
      post_url TEXT,
      reply_text TEXT,
      comment_text TEXT,
      campaign_id TEXT,
      my_profile TEXT,
      full_name TEXT,
      post_owner TEXT,
      action_date DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS instagram_campaigns (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT DEFAULT 'running',
      actions_count INTEGER DEFAULT 0,
      new_followers INTEGER DEFAULT 0,
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      ended_at DATETIME,
      notes TEXT
    );
    CREATE TABLE IF NOT EXISTS instagram_scheduled_posts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      my_profile TEXT,
      post_type TEXT DEFAULT 'post',
      caption TEXT,
      hashtags TEXT,
      location TEXT,
      media_filename TEXT,
      media_mime TEXT,
      media_size INTEGER,
      scheduled_at DATETIME NOT NULL,
      status TEXT DEFAULT 'scheduled',
      posted_at DATETIME,
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS instagram_follower_snapshots (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      my_profile TEXT,
      captured_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      follower_count INTEGER,
      followers_json TEXT
    );
    CREATE TABLE IF NOT EXISTS instagram_scrape_jobs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      target_username TEXT NOT NULL,
      post_count INTEGER NOT NULL DEFAULT 25,
      status TEXT NOT NULL DEFAULT 'pending',
      error_message TEXT,
      posts_scraped INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      started_at DATETIME,
      completed_at DATETIME
    );
    CREATE TABLE IF NOT EXISTS instagram_scraped_posts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      target_username TEXT NOT NULL,
      shortcode TEXT NOT NULL,
      post_url TEXT NOT NULL,
      post_type TEXT,
      likes INTEGER,
      views INTEGER,
      comments INTEGER,
      caption TEXT,
      last_scraped_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, target_username, shortcode)
    );
    CREATE TABLE IF NOT EXISTS instagram_action_campaigns (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT,
      as_account TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      total_requested INTEGER DEFAULT 0,
      total_completed INTEGER DEFAULT 0,
      concurrency INTEGER DEFAULT 6,
      consecutive_failures INTEGER DEFAULT 0,
      start_at DATETIME,
      started_at DATETIME,
      ended_at DATETIME,
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS instagram_follower_counts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      my_profile TEXT NOT NULL,
      follower_count INTEGER NOT NULL,
      captured_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS instagram_action_queue (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      as_account TEXT NOT NULL,
      post_url TEXT NOT NULL,
      action_type TEXT NOT NULL,
      count_requested INTEGER NOT NULL,
      count_done INTEGER DEFAULT 0,
      reply_source TEXT,
      reply_texts TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      claimed_at DATETIME,
      started_at DATETIME,
      completed_at DATETIME,
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_ig_sched_due
      ON instagram_scheduled_posts(status, scheduled_at);
    CREATE INDEX IF NOT EXISTS idx_ig_snap_user_profile
      ON instagram_follower_snapshots(user_id, my_profile, captured_at);
    CREATE INDEX IF NOT EXISTS idx_ig_scrape_pending
      ON instagram_scrape_jobs(user_id, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_ig_scraped_user_target
      ON instagram_scraped_posts(user_id, target_username, last_scraped_at);
    CREATE INDEX IF NOT EXISTS idx_ig_action_queue_pending
      ON instagram_action_queue(user_id, as_account, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_ig_action_campaign_status
      ON instagram_action_campaigns(user_id, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_ig_follower_counts_user_profile
      ON instagram_follower_counts(user_id, my_profile, captured_at);
    CREATE INDEX IF NOT EXISTS idx_ig_actions_user_created
      ON instagram_actions(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_ig_actions_user_type_created
      ON instagram_actions(user_id, type, created_at);
    -- Hot path: campaignPerformance & /campaigns enrichment look up
    -- "who did we engage with on this post" — was a full table scan.
    CREATE INDEX IF NOT EXISTS idx_ig_actions_user_profile_post_type
      ON instagram_actions(user_id, my_profile, post_url, type);
    -- Hot path: followersBack/engagementBack looks up inbound events
    -- by username. Critical when instagram_actions grows past 10k rows.
    CREATE INDEX IF NOT EXISTS idx_ig_actions_user_type_username
      ON instagram_actions(user_id, type, username);
    -- Hot path: /campaigns enrichment joins on (campaign_id, user_id).
    CREATE INDEX IF NOT EXISTS idx_ig_actions_campaign
      ON instagram_actions(campaign_id, user_id);
    -- Hot path: dashboard attribution self-join matches on (username,
    -- user_id, action_date) when looking for the prior outbound that
    -- preceded each inbound event.
    CREATE INDEX IF NOT EXISTS idx_ig_actions_user_username_date
      ON instagram_actions(user_id, username, action_date);
    -- /stats funnel + attribution match outbound→inbound rows by username and
    -- walk created_at; without this the correlated subqueries scan per row.
    CREATE INDEX IF NOT EXISTS idx_ig_actions_user_username_created
      ON instagram_actions(user_id, username, created_at);
    CREATE TABLE IF NOT EXISTS instagram_automations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      schedule_type TEXT NOT NULL,
      schedule_time TEXT,
      schedule_days TEXT,
      schedule_interval_minutes INTEGER,
      actions TEXT NOT NULL,
      accounts TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      next_run_at DATETIME,
      last_run_at DATETIME,
      last_status TEXT,
      last_error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_ig_automations_due
      ON instagram_automations(enabled, next_run_at);

    -- ─── DM bot: per-account conversation config + media library ─────────────
    -- One config row per (user, my_profile). my_profile '__default__' is the
    -- fallback used when a specific account has no config yet.
    CREATE TABLE IF NOT EXISTS instagram_dm_bot_configs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      my_profile TEXT NOT NULL DEFAULT '__default__',
      enabled INTEGER NOT NULL DEFAULT 1,
      tone TEXT DEFAULT 'friendly',
      instructions TEXT,
      goal_link TEXT,
      goal_note TEXT,
      media_mode TEXT DEFAULT 'auto',       -- off | auto (let the AI decide when)
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, my_profile)
    );
    -- Images/videos the bot may send mid-conversation. when_to_send is a
    -- free-text rule the AI reads to decide if now is the right moment.
    CREATE TABLE IF NOT EXISTS instagram_dm_bot_media (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      my_profile TEXT NOT NULL DEFAULT '__default__',
      kind TEXT,                            -- image | video
      filename TEXT NOT NULL,
      mime TEXT,
      size INTEGER,
      caption TEXT,
      when_to_send TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_ig_dm_media_user_profile
      ON instagram_dm_bot_media(user_id, my_profile);

    -- ─── Per-username profile enrichment ────────────────────────────────────
    -- The "About this account" panel on IG profiles exposes Date Joined +
    -- Account Based In (country). We capture it asynchronously after batches
    -- run (Phase 2 — extension scraper) so the dashboard / History can show
    -- the country of users we engaged with.
    --
    -- Keyed on (user_id, username) so different admin accounts can have
    -- their own enrichment timeline; we never want one user's stale data
    -- to satisfy another's pending request.
    --
    -- last_enriched_at lets the queue prefer never-seen-before usernames
    -- first, then refresh stale ones (>30d) on a slower cadence.
    CREATE TABLE IF NOT EXISTS instagram_user_profiles (
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      country TEXT,
      country_code TEXT,
      joined_month TEXT,
      full_name TEXT,
      followers INTEGER,
      bio TEXT,
      verified INTEGER,
      private INTEGER,
      enrichment_error TEXT,
      last_enriched_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, username)
    );
    -- Discovery hot path: find usernames in instagram_actions not yet in
    -- instagram_user_profiles. Index on (user_id, username) for the
    -- LEFT JOIN, plus on last_enriched_at for the stale-refresh pass.
    CREATE INDEX IF NOT EXISTS idx_ig_user_profiles_user
      ON instagram_user_profiles(user_id, username);
    CREATE INDEX IF NOT EXISTS idx_ig_user_profiles_stale
      ON instagram_user_profiles(user_id, last_enriched_at);
  `);
} catch (e) { console.error('Instagram table init error (non-fatal):', e.message); }

// Without planner statistics SQLite may ignore the username index for the
// /stats attribution subquery and sort per row. Runs once per database.
try {
  let analyzed = false;
  try { analyzed = !!db.prepare("SELECT 1 FROM sqlite_stat1 WHERE idx = 'idx_ig_actions_user_username_created'").get(); } catch { /* no stats table yet */ }
  if (!analyzed) db.exec('ANALYZE instagram_actions');
} catch (e) { console.error('Instagram ANALYZE skipped:', e.message); }

// Migrate existing DBs — ignore errors if columns already exist
['my_profile TEXT', 'full_name TEXT', 'post_owner TEXT', 'action_date DATETIME'].forEach(col => {
  try { db.exec(`ALTER TABLE instagram_actions ADD COLUMN ${col}`); } catch (_) {}
});
// Manual sessions need the requested count and primary post URL so the UI
// can show "X / Y actions performed" and a direct link to the post. The
// extension already sends `requested` and `postUrl` in the START_CAMPAIGN
// payload; we just weren't storing them.
['total_requested INTEGER', 'post_url TEXT'].forEach(col => {
  try { db.exec(`ALTER TABLE instagram_campaigns ADD COLUMN ${col}`); } catch (_) {}
});
// Per-user list of detected Instagram accounts (scanned by the extension from
// IG's "Switch accounts" modal). Stored as a JSON array on the users row.
try { db.exec('ALTER TABLE users ADD COLUMN instagram_accounts TEXT'); } catch (_) {}
// Older deployments created instagram_action_campaigns without as_account.
try { db.exec('ALTER TABLE instagram_action_campaigns ADD COLUMN as_account TEXT'); } catch (_) {}
// Manual follower-count trigger flag — Monday sets it, extension consumes it.
try { db.exec('ALTER TABLE users ADD COLUMN instagram_follower_trigger_at DATETIME'); } catch (_) {}
// Per-user extension tab visibility (JSON array of allowed section names).
// NULL or empty array = all tabs visible (backward-compatible default).
try { db.exec('ALTER TABLE users ADD COLUMN instagram_extension_tabs TEXT'); } catch (_) {}
// is_system marks automations the app auto-creates per tracked account
// (e.g. the daily follower-count scrape). These can be edited/disabled but
// not deleted — removing the IG account is how you get rid of them.
try { db.exec('ALTER TABLE instagram_automations ADD COLUMN is_system INTEGER NOT NULL DEFAULT 0'); } catch (_) {}
// tz_offset_minutes: the user's UTC offset (e.g. +180 for UTC+3) captured
// when the automation was created/edited. schedule_time is interpreted as
// LOCAL time in this offset, so "Daily 10:00" fires at 10:00 the user's
// time regardless of the server's own timezone. Default 0 = treat as UTC.
try { db.exec('ALTER TABLE instagram_automations ADD COLUMN tz_offset_minutes INTEGER NOT NULL DEFAULT 0'); } catch (_) {}
// parent_queue_id: when an action-queue batch item dispatches and the content
// script calls startCampaign, the resulting instagram_campaigns row gets
// tagged with the originating queue item id. The /campaigns list endpoint
// excludes these so batch sub-sessions don't pollute the "manual" section
// (they're already represented by their parent action_campaign row).
try { db.exec('ALTER TABLE instagram_campaigns ADD COLUMN parent_queue_id TEXT'); } catch (_) {}
// last_heartbeat_at: extension periodically PATCHes the queue item with
// heartbeat=true while actively running. Backend updates this column.
// The stale-claim sweep checks heartbeat freshness instead of time-since-
// claimed — so a 5-hour batch with a healthy script is NEVER touched,
// while a stuck/crashed tab gets swept within 5 minutes of going silent.
try { db.exec('ALTER TABLE instagram_action_queue ADD COLUMN last_heartbeat_at DATETIME'); } catch (_) {}
// Remembered per-user default offset so server-created system automations
// can use the right timezone too.
try { db.exec('ALTER TABLE users ADD COLUMN instagram_tz_offset_minutes INTEGER'); } catch (_) {}

// helper — which user_id to query
function targetUser(req) {
  const { as_user } = req.query;
  if (as_user && (req.user.role === 'super_admin' || req.user.role === 'admin')) return as_user;
  return req.user.id;
}

// ── Extension auth verify (uses instagram_api_token, not JWT) ────────────────
router.get('/auth/verify', function(req, res) {
  var authHeader = req.headers['authorization'] || '';
  var token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return res.status(401).json({ error: 'No token' });
  var user = db.prepare('SELECT id, name, email, role FROM users WHERE instagram_api_token = ?').get(token);
  if (!user) return res.status(401).json({ error: 'Invalid token' });
  res.json({ ok: true, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

// ── Actions ───────────────────────────────────────────────────────────────────
router.post("/actions", authenticateFlexible, (req, res) => {
  var b = req.body;
  // Accept both backend field names and extension field names
  var type           = b.type           || b.action         || null;
  var username       = b.username       || b.targetUsername  || null;
  var follower_count = b.follower_count  || b.followers      || null;
  var post_url       = b.post_url       || b.postUrl         || null;
  var reply_text     = b.reply_text     || b.replyText       || null;
  var comment_text   = b.comment_text   || null;
  var campaign_id    = b.campaign_id    || null;
  var my_profile     = b.my_profile     || b.myProfile       || null;
  var full_name      = b.full_name      || b.fullName        || null;
  var post_owner     = b.post_owner     || b.postOwner       || null;
  var action_date    = b.action_date    || b.date            || null;

  if (!type) return res.status(400).json({ error: 'type required' });

  // Enrich from prior history. The notification scanner (post-optimization)
  // no longer hovers each row to read follower_count + full_name, so those
  // arrive null. Lookup the most recent row for this same username that
  // already has the data (typically from likes/follows/manual scans) and
  // copy it over. No IG hits, instant, and the History view stops showing
  // "—" for users we've already met.
  if (username && (full_name == null || follower_count == null)) {
    var prior = db.prepare(`
      SELECT full_name, follower_count FROM instagram_actions
      WHERE user_id = ? AND username = ?
        AND (full_name IS NOT NULL OR follower_count IS NOT NULL)
      ORDER BY created_at DESC LIMIT 1
    `).get(req.user.id, username);
    if (prior) {
      if (full_name == null) full_name = prior.full_name || null;
      if (follower_count == null) follower_count = prior.follower_count || null;
    }
  }

  // Accept a client-provided id so dual-write to prod+staging uses the
  // SAME id on both, otherwise prod's actions wouldn't link to its own
  // campaign rows. INSERT OR IGNORE makes the second write idempotent.
  var id = b.id || uuidv4();
  db.prepare(`
    INSERT OR IGNORE INTO instagram_actions
      (id,user_id,type,username,follower_count,post_url,reply_text,comment_text,campaign_id,my_profile,full_name,post_owner,action_date)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(id, req.user.id, type, username, follower_count, post_url, reply_text, comment_text, campaign_id, my_profile, full_name, post_owner, action_date);
  res.json({ id });
});

// Backfill full_name + follower_count on existing instagram_actions rows
// that have them as null, using the most recent row for the SAME username
// that does have them. One-shot, idempotent, single UPDATE — no IG calls.
// Useful after the notification scanner stopped hovering: existing rows
// with "—" get filled in from history.
router.post('/actions/backfill', authenticateFlexible, (req, res) => {
  const uid = req.user.id;
  const r = db.prepare(`
    UPDATE instagram_actions
    SET full_name = COALESCE(full_name, (
          SELECT full_name FROM instagram_actions ia2
          WHERE ia2.user_id = instagram_actions.user_id
            AND ia2.username = instagram_actions.username
            AND ia2.full_name IS NOT NULL
          ORDER BY ia2.created_at DESC LIMIT 1
        )),
        follower_count = COALESCE(follower_count, (
          SELECT follower_count FROM instagram_actions ia3
          WHERE ia3.user_id = instagram_actions.user_id
            AND ia3.username = instagram_actions.username
            AND ia3.follower_count IS NOT NULL
          ORDER BY ia3.created_at DESC LIMIT 1
        ))
    WHERE user_id = ? AND username IS NOT NULL
      AND (full_name IS NULL OR follower_count IS NULL)
  `).run(uid);
  res.json({ updated: r.changes });
});

router.post('/actions/bulk', authenticateFlexible, (req, res) => {
  const { actions } = req.body;
  if (!Array.isArray(actions)) return res.status(400).json({ error: 'actions array required' });
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO instagram_actions (id,user_id,type,username,follower_count,post_url,reply_text,comment_text,campaign_id)
    VALUES (?,?,?,?,?,?,?,?,?)
  `);
  const insert = db.transaction((rows) => {
    for (const a of rows) {
      stmt.run(a.id || uuidv4(), req.user.id, a.type, a.username||null, a.follower_count||null,
        a.post_url||null, a.reply_text||null, a.comment_text||null, a.campaign_id||null);
    }
  });
  insert(actions);
  res.json({ inserted: actions.length });
});

router.get("/actions", authenticateFlexible, (req, res) => {
  const uid = targetUser(req);
  const { type, type_like, limit = 200, offset = 0 } = req.query;
  // LEFT JOIN instagram_user_profiles so each row carries the target user's
  // enriched country (when known). p.country is NULL for un-enriched
  // usernames — the frontend renders "—" in that case. Joining on
  // LOWER(a.username) because profiles are stored lowercase but
  // instagram_actions might preserve mixed-case usernames.
  let q = `
    SELECT a.*,
           p.country     AS user_country,
           p.country_code AS user_country_code,
           p.joined_month AS user_joined_month
    FROM instagram_actions a
    LEFT JOIN instagram_user_profiles p
      ON p.user_id = a.user_id AND p.username = LOWER(a.username)
    WHERE a.user_id = ?
  `;
  const params = [uid];
  if (type) { q += ' AND a.type = ?'; params.push(type); }
  // type_like='received_%' lets the extension fetch all received_* rows
  // in one call for notification-dedup. SQLite LIKE is case-insensitive
  // by default for ASCII, which is what we want here.
  if (type_like) { q += ' AND a.type LIKE ?'; params.push(String(type_like)); }
  q += ' ORDER BY a.created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), Number(offset));
  res.json(db.prepare(q).all(...params));
});

// ── Campaigns ─────────────────────────────────────────────────────────────────
router.post("/campaigns", authenticateFlexible, (req, res) => {
  const b = req.body || {};
  const { id: providedId, type, notes, parent_queue_id } = b;
  if (!type) return res.status(400).json({ error: 'type required' });
  // Same idempotency as /actions — accept client-provided id so dual-write
  // to prod+staging produces matching rows on both backends.
  // parent_queue_id tags a campaign as a sub-session of an action-queue
  // batch item, so the unified activity feed can dedupe (the parent
  // action-campaign row already represents this work).
  //
  // total_requested + post_url come from the extension's START_CAMPAIGN —
  // they let the Manual sessions UI render "X / Y actions" + a direct link.
  const id = providedId || uuidv4();
  const requested = Number.isFinite(b.requested) ? b.requested : null;
  const postUrl = b.postUrl || b.post_url || null;
  db.prepare(`
    INSERT OR IGNORE INTO instagram_campaigns
      (id, user_id, type, notes, parent_queue_id, total_requested, post_url)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.user.id, type, notes || null, parent_queue_id || null, requested, postUrl);
  res.json(db.prepare('SELECT * FROM instagram_campaigns WHERE id = ?').get(id));
});

router.patch("/campaigns/:id", authenticateFlexible, (req, res) => {
  var b = req.body;
  var status        = b.status || null;
  var actions_count = b.actions_count != null ? b.actions_count : (b.completed != null ? b.completed : null);
  // followerStats can be { gained: N } or { after: N, before: M } or just a number
  var new_followers = b.new_followers != null ? b.new_followers
    : (b.followerStats && b.followerStats.gained != null) ? b.followerStats.gained
    : (b.followerStats && b.followerStats.after != null && b.followerStats.before != null) ? (b.followerStats.after - b.followerStats.before)
    : null;
  var notes         = b.notes || null;
  const camp = db.prepare('SELECT * FROM instagram_campaigns WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!camp) return res.status(404).json({ error: 'Not found' });
  db.prepare(`UPDATE instagram_campaigns SET
    status = COALESCE(?, status),
    actions_count = COALESCE(?, actions_count),
    new_followers = COALESCE(?, new_followers),
    notes = COALESCE(?, notes),
    ended_at = CASE WHEN ? IN ('completed','stopped','done') THEN CURRENT_TIMESTAMP ELSE ended_at END
    WHERE id = ?
  `).run(status||null, actions_count??null, new_followers??null, notes||null, status||null, req.params.id);
  res.json(db.prepare('SELECT * FROM instagram_campaigns WHERE id = ?').get(req.params.id));
});

router.get("/campaigns", authenticateFlexible, (req, res) => {
  const uid = targetUser(req);
  // Pagination — same shape as /action-campaigns. Default 10, max 100.
  const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 10));
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  const total = db.prepare(
    'SELECT COUNT(*) AS n FROM instagram_campaigns WHERE user_id = ? AND parent_queue_id IS NULL'
  ).get(uid)?.n || 0;
  // Only show MANUAL extension popup runs — sub-sessions created by queue
  // dispatch (parent_queue_id IS NOT NULL) are deduped against their parent
  // action_campaigns row.
  const rows = db.prepare(`
    SELECT ic.*,
      CASE
        WHEN ic.actions_count > 0 THEN ic.actions_count
        ELSE (SELECT COUNT(*) FROM instagram_actions ia
              WHERE ia.campaign_id = ic.id AND ia.user_id = ic.user_id)
      END AS actions_count
    FROM instagram_campaigns ic
    WHERE ic.user_id = ?
      AND ic.parent_queue_id IS NULL
    ORDER BY ic.started_at DESC LIMIT ? OFFSET ?
  `).all(uid, limit, offset);

  // Enrich each row with:
  //   • post_urls  — distinct posts touched by this campaign's actions
  //   • my_profile — which IG account performed the actions
  //   • engagement_back — count of received_* events from users we engaged
  //                       with in this campaign, after the campaign started.
  //                       Captures likes/replies/follows that came back as
  //                       a direct result of this outreach.
  //
  // Done as small per-row sub-queries (cheap on SQLite at <200 campaigns).
  const enrichMeta = db.prepare(`
    SELECT GROUP_CONCAT(DISTINCT post_url) AS posts,
           MAX(my_profile) AS my_profile
    FROM instagram_actions
    WHERE campaign_id = ? AND user_id = ? AND post_url IS NOT NULL
  `);
  // Manual-session attribution: instagram_actions.campaign_id DOES match
  // instagram_campaigns.id for manual sessions (no indirection), so we can
  // filter on that directly. The "engaged-with" set is everyone we acted
  // on in this session.
  const enrichFollowersBack = db.prepare(`
    SELECT COUNT(DISTINCT r.username) AS n FROM instagram_actions r
    WHERE r.user_id = ?
      AND r.type = 'new_follower'
      AND datetime(r.action_date) >= datetime(?)
      AND r.username IN (
        SELECT DISTINCT username FROM instagram_actions
        WHERE campaign_id = ? AND user_id = ? AND username IS NOT NULL
      )
  `);
  const enrichEngagementBack = db.prepare(`
    SELECT COUNT(*) AS n FROM instagram_actions r
    WHERE r.user_id = ?
      AND r.type LIKE 'received_%'
      AND datetime(r.action_date) >= datetime(?)
      AND r.username IN (
        SELECT DISTINCT username FROM instagram_actions
        WHERE campaign_id = ? AND user_id = ? AND username IS NOT NULL
      )
  `);
  for (const c of rows) {
    const meta = enrichMeta.get(c.id, uid);
    c.post_urls = meta?.posts ? meta.posts.split(',').filter(Boolean) : [];
    c.my_profile = meta?.my_profile || null;
    const since = c.started_at || c.created_at || new Date().toISOString();
    // Attribution-based follow-backs (people from this session who then
    // followed us). The legacy `new_followers` column is a snapshot-delta
    // count — total new followers during the window from ANY source,
    // including organic. We keep it as `new_followers_snapshot` for
    // back-compat but the frontend should display followers_back.
    const fb = enrichFollowersBack.get(uid, since, c.id, uid);
    c.followers_back = fb?.n || 0;
    c.new_followers_snapshot = c.new_followers;
    const eb = enrichEngagementBack.get(uid, since, c.id, uid);
    c.engagement_back = eb?.n || 0;
  }

  res.json({
    rows,
    total,
    limit,
    offset,
    has_more: offset + rows.length < total,
  });
});

// ── Stats / Dashboard ─────────────────────────────────────────────────────────
// Inbound event types the dashboard knows how to display. The notification
// scanner writes `received_*`; older code used `got_*`. We accept both names
// for backwards-compat — each card sums all aliases together.
const INBOUND_TYPE_ALIASES = {
  new_follower:      ['new_follower'],
  got_like_post:     ['received_like_post', 'got_like_post'],
  got_like_reel:     ['received_like_reel', 'got_like_reel'],
  got_like_comment:  ['received_like_comment', 'got_like_comment'],
  got_comment:       ['received_comment', 'got_comment'],
  got_reply:         ['received_reply', 'got_reply'],
  got_mention:       ['received_mention', 'got_mention'],
};
// Every inbound type across all aliases — used in the funnel's
// "any-engagement-back" check.
const ALL_INBOUND_TYPES = Object.values(INBOUND_TYPE_ALIASES).flat();

// In-memory cache for /stats responses. The endpoint runs many per-row
// sub-queries (campaignPerformance × N queue items + attribution self-join
// + per-account growth + ...) and was slow at the dashboard's natural
// refresh rate. 30s TTL is enough that repeated dashboard views feel
// instant, but fresh enough that the user isn't looking at stale data.
// The Refresh button busts the cache via ?bust=<timestamp> in the URL
// (any unrecognized query param makes the cache key unique).
const STATS_CACHE = new Map();          // key → { body, ts }
const STATS_CACHE_TTL_MS = 10 * 1000;
// Janitor: drop entries older than 5× TTL to bound the map size.
setInterval(() => {
  const cutoff = Date.now() - STATS_CACHE_TTL_MS * 5;
  for (const [k, v] of STATS_CACHE) {
    if (v.ts < cutoff) STATS_CACHE.delete(k);
  }
}, STATS_CACHE_TTL_MS).unref?.();

// 'YYYY-MM-DD HH:MM:SS' UTC — the format CURRENT_TIMESTAMP writes into
// created_at, so a plain string comparison is exact and index-friendly.
const sqlTs = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

router.get("/stats", authenticateFlexible, (req, res) => {
  const uid = targetUser(req);
  const days = parseInt(req.query.days, 10) || 30;

  // Cache key includes uid + every query param that affects the response
  // (date range, profiles filter, action-type filter, batch_id filter).
  // ?bust= is deliberately not part of the key: a Refresh recomputes and
  // replaces the shared entry instead of caching under a one-off key.
  const cacheKey = JSON.stringify({
    uid, days,
    from: req.query.from || null, to: req.query.to || null,
    profiles: req.query.profiles || null,
    action_types: req.query.action_types || null,
    batch_id: req.query.batch_id || null,
  });
  if (!req.query.bust) {
    const cached = STATS_CACHE.get(cacheKey);
    if (cached && Date.now() - cached.ts < STATS_CACHE_TTL_MS) {
      return res.json(cached.body);
    }
  }
  // Override res.json to capture the response into the cache.
  const origJson = res.json.bind(res);
  res.json = (body) => {
    STATS_CACHE.set(cacheKey, { body, ts: Date.now() });
    return origJson(body);
  };

  // ── Time window on a raw datetime column — never wrapped in datetime()/date(),
  // which would stop the (user_id, …, created_at) indexes from serving the
  // range. Either the custom from/to range (inclusive days) or `days` back.
  let window;
  const fromDay = req.query.from && req.query.to ? String(req.query.from).slice(0, 10) : null;
  const toDay   = req.query.from && req.query.to ? String(req.query.to).slice(0, 10) : null;
  if (fromDay && toDay && !isNaN(Date.parse(fromDay + 'T00:00:00Z')) && !isNaN(Date.parse(toDay + 'T00:00:00Z'))) {
    const start = `${fromDay} 00:00:00`;
    const end = sqlTs(Date.parse(toDay + 'T00:00:00Z') + 86400000); // exclusive: the day after `to`
    window = { sql: (col) => `${col} >= ? AND ${col} < ?`, params: [start, end], start };
  } else {
    const start = sqlTs(Date.now() - days * 86400000);
    window = { sql: (col) => `${col} >= ?`, params: [start], start };
  }

  // ── Build a reusable WHERE clause + param list based on the query filters
  // (profiles[], action_types[], batch_id, and the time window).
  const filtersBase = ['user_id = ?', window.sql('created_at')];
  const baseParams = [uid, ...window.params];

  if (req.query.profiles) {
    const profiles = String(req.query.profiles).split(',').map(p => p.trim().replace(/^@/, '').toLowerCase()).filter(Boolean);
    if (profiles.length > 0) {
      filtersBase.push(`LOWER(my_profile) IN (${profiles.map(() => '?').join(',')})`);
      baseParams.push(...profiles);
    }
  }

  if (req.query.batch_id) {
    filtersBase.push('campaign_id = ?');
    baseParams.push(String(req.query.batch_id));
  }

  // action_types is applied separately: many sections want it; some don't
  // (e.g. the inbound "Returns Received" section ignores it because that's
  // about *what came back* regardless of which outbound type we filtered).
  const actionFilterSql = () => {
    if (!req.query.action_types) return { sql: '', params: [] };
    const types = String(req.query.action_types).split(',').map(t => t.trim()).filter(Boolean);
    if (types.length === 0) return { sql: '', params: [] };
    return {
      sql: ` AND type IN (${types.map(() => '?').join(',')})`,
      params: types,
    };
  };

  const baseWhere = filtersBase.join(' AND ');
  const af = actionFilterSql();
  const whereWithAction = baseWhere + af.sql;

  // ── Outbound stats (filtered) ──────────────────────────────────────────
  const total = db.prepare(`SELECT COUNT(*) as n FROM instagram_actions WHERE ${whereWithAction}`).get(...baseParams, ...af.params).n;
  const byType = db.prepare(`SELECT type, COUNT(*) as n FROM instagram_actions WHERE ${whereWithAction} GROUP BY type`).all(...baseParams, ...af.params);
  const follows = (byType.find(r => r.type === 'follow') || {}).n || 0;
  const newFollowers = db.prepare(`SELECT COUNT(*) as n FROM instagram_actions WHERE ${baseWhere} AND type = 'new_follower'`).get(...baseParams).n;
  const followBack = total > 0 ? Math.round((newFollowers / total) * 100) : 0;
  const daily = db.prepare(`
    SELECT date(created_at) as day, type, COUNT(*) as n
    FROM instagram_actions WHERE ${whereWithAction}
    GROUP BY day, type ORDER BY day ASC
  `).all(...baseParams, ...af.params);
  const topUsers = db.prepare(`
    SELECT username, COUNT(*) as n FROM instagram_actions
    WHERE ${whereWithAction} AND username IS NOT NULL
    GROUP BY username ORDER BY n DESC LIMIT 10
  `).all(...baseParams, ...af.params);

  // ── Inbound counts by type ─────────────────────────────────────────────
  // Each "Returns Received" card sums all aliases (received_* + got_*) so
  // historic scans counted under the older naming still appear.
  const inboundCounts = {};
  for (const [canonical, aliases] of Object.entries(INBOUND_TYPE_ALIASES)) {
    const placeholders = aliases.map(() => '?').join(',');
    const row = db.prepare(`
      SELECT COUNT(*) AS n FROM instagram_actions
      WHERE ${baseWhere} AND type IN (${placeholders})
    `).get(...baseParams, ...aliases);
    inboundCounts[canonical] = row?.n || 0;
  }

  // ── Funnel — "of unique users I targeted with action X, how many later
  // engaged back in ANY way?" This is more useful than strict like→like
  // pairings: when I like someone's comment, they often follow / like /
  // mention me back rather than liking my own comment specifically.
  const inboundPlaceholders = ALL_INBOUND_TYPES.map(() => '?').join(',');
  const FUNNEL_ROWS = [
    { sent: 'follow',        label: 'Follow → any engagement back' },
    { sent: 'like',          label: 'Like → any engagement back' },
    { sent: 'comment',       label: 'Comment → any engagement back' },
    { sent: 'comment_reply', label: 'Reply → any engagement back' },
  ];
  const funnel = [];
  for (const row of FUNNEL_ROWS) {
    const sent = db.prepare(`
      SELECT COUNT(DISTINCT username) AS n FROM instagram_actions
      WHERE ${baseWhere} AND type = ? AND username IS NOT NULL
    `).get(...baseParams, row.sent)?.n || 0;
    // Same filters + window as `sent` (it used to scan the user's whole
    // history per request, and the ratio could exceed 100%).
    const returned = db.prepare(`
      SELECT COUNT(DISTINCT a.username) AS n FROM instagram_actions a
      WHERE ${baseWhere} AND a.type = ? AND a.username IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM instagram_actions b
          WHERE b.user_id = a.user_id
            AND b.username = a.username
            AND b.type IN (${inboundPlaceholders})
            AND b.created_at >= a.created_at
        )
    `).get(...baseParams, row.sent, ...ALL_INBOUND_TYPES)?.n || 0;
    funnel.push({
      action_type: row.sent,
      paired_with: 'any_inbound',
      label: row.label,
      sent, returned,
      percent: sent > 0 ? Math.round((returned / sent) * 1000) / 10 : null,
    });
  }

  // ── Follower growth — same logic as before, respecting profile filter ──
  // We don't filter follower-counts by end date in the cur/prev queries — we
  // want the latest snapshot inside the period and the latest snapshot
  // before the period started.
  const periodStart = window.start;

  let profilesInPeriod = db.prepare(`
    SELECT DISTINCT my_profile FROM instagram_follower_counts WHERE user_id = ?
  `).all(uid).map(r => r.my_profile).filter(Boolean);
  // Respect the profiles filter if set
  if (req.query.profiles) {
    const want = new Set(String(req.query.profiles).split(',').map(p => p.trim().replace(/^@/, '').toLowerCase()).filter(Boolean));
    profilesInPeriod = profilesInPeriod.filter(p => want.has(String(p).toLowerCase()));
  }

  let curTotal = 0, prevTotal = 0;
  const perAccount = [];
  for (const profile of profilesInPeriod) {
    const cur = db.prepare(`
      SELECT follower_count FROM instagram_follower_counts
      WHERE user_id = ? AND my_profile = ? AND captured_at >= ?
      ORDER BY captured_at DESC LIMIT 1
    `).get(uid, profile, periodStart);
    const prev = db.prepare(`
      SELECT follower_count FROM instagram_follower_counts
      WHERE user_id = ? AND my_profile = ? AND captured_at < ?
      ORDER BY captured_at DESC LIMIT 1
    `).get(uid, profile, periodStart);
    const curN  = cur?.follower_count  ?? null;
    const prevN = prev?.follower_count ?? null;
    if (curN  != null) curTotal  += curN;
    if (prevN != null) prevTotal += prevN;
    const series = db.prepare(`
      SELECT date(captured_at) AS day, follower_count
      FROM instagram_follower_counts
      WHERE user_id = ? AND my_profile = ?
        AND captured_at >= ?
      ORDER BY captured_at ASC
    `).all(uid, profile, periodStart);
    const byDay = {};
    for (const r of series) byDay[r.day] = r.follower_count;
    perAccount.push({
      profile,
      current: curN,
      previous: prevN,
      delta: (curN != null && prevN != null) ? curN - prevN : null,
      percent: (curN != null && prevN && prevN > 0)
        ? Math.round(((curN - prevN) / prevN) * 1000) / 10
        : null,
      series: Object.entries(byDay).map(([day, count]) => ({ day, count })),
    });
  }
  perAccount.sort((a, b) => (b.current || 0) - (a.current || 0));

  const followerGrowth = {
    current: curTotal,
    previous: prevTotal,
    delta: curTotal - prevTotal,
    percent: prevTotal > 0 ? Math.round(((curTotal - prevTotal) / prevTotal) * 1000) / 10 : null,
  };

  // ── Conversion attribution ──────────────────────────────────────────────
  // For every INBOUND engagement we got (new_follower or received_*),
  // look back at our outbound actions to the same user and find the most
  // recent one. That outbound gets credit. Lets the user see: "I liked X's
  // reel, then X liked my post / commented / followed me."
  //
  // Strategy:
  //   • Outbound types are like, comment, comment_reply, reply, follow.
  //   • Inbound types are new_follower + everything LIKE 'received_%'.
  //   • Time filter on the INBOUND's created_at (the event we're crediting).
  //   • Per row we also expose `inbound_type`, the human-readable inbound
  //     action, so the frontend can group by it.
  const attributionRows = db.prepare(`
    SELECT
      nf.username       AS follower,
      nf.type           AS inbound_type,
      nf.my_profile     AS my_profile,
      nf.full_name      AS full_name,
      nf.follower_count AS follower_count,
      nf.created_at     AS followed_at,
      nf.action_date    AS inbound_action_date,
      nf.post_url       AS inbound_post_url,
      nf.reply_text     AS inbound_text,
      a.type            AS attributed_type,
      a.post_url        AS attributed_post,
      a.post_owner      AS attributed_post_owner,
      a.campaign_id     AS attributed_campaign,
      a.created_at      AS attributed_at,
      CAST((JULIANDAY(nf.created_at) - JULIANDAY(a.created_at)) * 24 * 60 AS INTEGER) AS minutes_to_convert
    FROM instagram_actions nf
    LEFT JOIN instagram_actions a ON a.id = (
      SELECT inner_a.id FROM instagram_actions inner_a
      WHERE inner_a.user_id = nf.user_id
        AND inner_a.username = nf.username
        AND (
             inner_a.my_profile = nf.my_profile
          OR inner_a.my_profile IS NULL
          OR nf.my_profile IS NULL
        )
        AND inner_a.type IN ('like', 'comment', 'comment_reply', 'reply', 'follow')
        AND inner_a.created_at <= nf.created_at
      ORDER BY inner_a.created_at DESC
      LIMIT 1
    )
    WHERE nf.user_id = ?
      AND (nf.type = 'new_follower' OR nf.type LIKE 'received_%')
      AND ${window.sql('nf.created_at')}
      ${req.query.profiles ? `AND LOWER(nf.my_profile) IN (${String(req.query.profiles).split(',').map(() => '?').join(',')})` : ''}
    ORDER BY nf.created_at DESC
    LIMIT 500
  `).all(
    uid,
    ...window.params,
    ...(req.query.profiles ? String(req.query.profiles).split(',').map(p => p.trim().replace(/^@/, '').toLowerCase()).filter(Boolean) : [])
  );

  // Roll-up.
  const attributed = attributionRows.filter(r => r.attributed_type);
  const organic   = attributionRows.length - attributed.length;
  const avgMinutes = attributed.length > 0
    ? Math.round(attributed.reduce((s, r) => s + (r.minutes_to_convert || 0), 0) / attributed.length)
    : null;
  // Breakdown by OUTBOUND type (which of our actions earned the response).
  const byAttributedType = {};
  for (const r of attributed) {
    byAttributedType[r.attributed_type] = (byAttributedType[r.attributed_type] || 0) + 1;
  }
  // Breakdown by INBOUND type (what kind of response we got).
  const byInboundType = {};
  for (const r of attributionRows) {
    byInboundType[r.inbound_type] = (byInboundType[r.inbound_type] || 0) + 1;
  }
  // Cross-table: outbound × inbound (which outbound action → which inbound).
  // Lets the user see "of all the likes I gave, how many came back as
  // follows, comments, etc.?"
  const conversionMatrix = {};
  for (const r of attributed) {
    const key = `${r.attributed_type}→${r.inbound_type}`;
    conversionMatrix[key] = (conversionMatrix[key] || 0) + 1;
  }

  const attribution = {
    // Kept for back-compat with existing frontend reads
    total_new_followers: attributionRows.length,
    attributed_count: attributed.length,
    organic_count: organic,
    attribution_rate: attributionRows.length > 0
      ? Math.round((attributed.length / attributionRows.length) * 1000) / 10
      : null,
    avg_minutes_to_convert: avgMinutes,
    by_attributed_type: Object.entries(byAttributedType).map(([type, count]) => ({
      type, count,
      percent: attributed.length > 0 ? Math.round((count / attributed.length) * 1000) / 10 : 0,
    })).sort((a, b) => b.count - a.count),
    by_inbound_type: Object.entries(byInboundType).map(([type, count]) => ({
      type, count,
      percent: attributionRows.length > 0 ? Math.round((count / attributionRows.length) * 1000) / 10 : 0,
    })).sort((a, b) => b.count - a.count),
    conversion_matrix: Object.entries(conversionMatrix).map(([key, count]) => {
      const [outbound, inbound] = key.split('→');
      return { outbound, inbound, count };
    }).sort((a, b) => b.count - a.count),
    rows: attributionRows,
  };

  // ── Campaign performance ───────────────────────────────────────────────
  // Outbound perspective: one row per executed batch queue item, showing
  // what we asked for vs what was done, how many of those targets came
  // back as new followers, and the conversion %. Replaces the user's
  // intuitive "for this post, what did my campaign do?" view that the
  // inbound-row attribution table doesn't give them.
  const profilesFilter = req.query.profiles
    ? String(req.query.profiles).split(',').map(p => p.trim().replace(/^@/, '').toLowerCase()).filter(Boolean)
    : [];
  const dateFrom = req.query.from && req.query.to ? String(req.query.from).slice(0,10) : null;
  const dateTo = req.query.from && req.query.to ? String(req.query.to).slice(0,10) : null;

  let queueSql = `
    SELECT q.id, q.campaign_id, q.post_url, q.action_type, q.as_account,
           q.count_requested, q.count_done, q.status,
           COALESCE(q.completed_at, q.claimed_at, q.started_at) AS action_date,
           q.claimed_at
    FROM instagram_action_queue q
    WHERE q.user_id = ?
      AND (q.completed_at IS NOT NULL OR q.count_done > 0)
  `;
  const queueParams = [uid];
  if (dateFrom && dateTo) {
    queueSql += ` AND date(COALESCE(q.completed_at, q.claimed_at, q.started_at)) BETWEEN ? AND ?`;
    queueParams.push(dateFrom, dateTo);
  } else {
    queueSql += ` AND datetime(COALESCE(q.completed_at, q.claimed_at, q.started_at)) >= datetime('now', '-${days} days')`;
  }
  if (profilesFilter.length > 0) {
    queueSql += ` AND LOWER(q.as_account) IN (${profilesFilter.map(() => '?').join(',')})`;
    queueParams.push(...profilesFilter);
  }
  queueSql += ` ORDER BY action_date DESC LIMIT 100`;
  const queueItems = db.prepare(queueSql).all(...queueParams);

  // Per queue item, look up distinct targets + which of them became
  // followers / liked our posts / commented on our posts. Per-row.
  //
  // NOTE: we don't filter on instagram_actions.campaign_id because that
  // column references the sub-session (instagram_campaigns.id created by
  // startCampaign), NOT the queue.campaign_id (action_campaign.id). We
  // match by (account + post_url + type + time window) which works for
  // ALL extension versions and is robust to the sub-session indirection.
  //
  // IMPORTANT (fixed): if windowStart is NULL (the batch never even
  // claimed an item — count_done=0), we MUST return zero targets. The
  // previous code's `(? IS NULL OR datetime >= ?)` clause evaluated to
  // TRUE when windowStart was null, matching ALL historical actions on
  // that post. That's how a 0/500 batch was showing 9 followers back —
  // they came from a PRIOR successful batch on the same post.
  const performanceRows = [];
  for (const q of queueItems) {
    const windowStart = q.claimed_at || q.action_date || null;
    // No upper bound — inbound engagement can come days after the batch
    // finished. (Previously bounded by completed_at, which clipped late
    // attribution.)
    let targets = [];
    if (windowStart) {
      targets = db.prepare(`
        SELECT DISTINCT username FROM instagram_actions
        WHERE user_id = ?
          AND my_profile = ?
          AND post_url = ?
          AND type = ?
          AND datetime(action_date) >= datetime(?)
          AND username IS NOT NULL
      `).all(uid, q.as_account, q.post_url, q.action_type, windowStart)
        .map(r => r.username);
    }

    let followersBack = 0;
    let likesBack = 0;
    let commentsBack = 0;
    let avgMinutesToFollowback = null;
    if (targets.length > 0) {
      const ph = targets.map(() => '?').join(',');
      // All inbound events from THESE targets after the batch started.
      // We split into followers vs likes-back vs comments-back so the UI
      // can show separate columns ("when they like my posts back",
      // "when they comment", etc).
      const inbound = db.prepare(`
        SELECT username, type, created_at FROM instagram_actions
        WHERE user_id = ?
          AND (type = 'new_follower' OR type LIKE 'received_%')
          AND username IN (${ph})
          AND datetime(created_at) > datetime(?)
      `).all(uid, ...targets, windowStart);

      const followerEvents = [];
      for (const ev of inbound) {
        if (ev.type === 'new_follower') {
          followerEvents.push(ev);
        } else if (/^received_(like|got_like)/.test(ev.type)) {
          likesBack++;
        } else if (/^received_(comment|reply|got_comment|got_reply|got_mention|mention)/.test(ev.type)) {
          commentsBack++;
        }
      }
      followersBack = followerEvents.length;
      if (followerEvents.length > 0) {
        const baseMs = new Date(windowStart).getTime();
        let sumMin = 0, n = 0;
        for (const fb of followerEvents) {
          const diff = (new Date(fb.created_at).getTime() - baseMs) / 60000;
          if (diff > 0) { sumMin += diff; n++; }
        }
        if (n > 0) avgMinutesToFollowback = Math.round(sumMin / n);
      }
    }
    const totalEngagementBack = followersBack + likesBack + commentsBack;
    // Conversion is specifically the follower-acquisition rate.
    // Likes back and comments back are tracked separately in their own
    // columns; mixing them into the conversion % overstates how many
    // people actually FOLLOWED back, which is the primary KPI.
    const conversionRate = q.count_done > 0
      ? Math.round((followersBack / q.count_done) * 1000) / 10
      : null;

    performanceRows.push({
      queue_id: q.id,
      campaign_id: q.campaign_id,
      post_url: q.post_url,
      action_type: q.action_type,
      as_account: q.as_account,
      count_requested: q.count_requested,
      count_done: q.count_done,
      status: q.status,
      action_date: q.action_date,
      targets: targets.length,
      followers_back: followersBack,
      likes_back: likesBack,
      comments_back: commentsBack,
      total_engagement_back: totalEngagementBack,
      avg_minutes_to_followback: avgMinutesToFollowback,
      conversion_rate: conversionRate,
    });
  }

  const campaignPerformance = {
    rows: performanceRows,
    totals: {
      batches: performanceRows.length,
      requested: performanceRows.reduce((s, r) => s + (r.count_requested || 0), 0),
      done: performanceRows.reduce((s, r) => s + (r.count_done || 0), 0),
      followers_back: performanceRows.reduce((s, r) => s + (r.followers_back || 0), 0),
      avg_conversion: (() => {
        const rated = performanceRows.filter(r => r.conversion_rate != null);
        if (rated.length === 0) return null;
        return Math.round(rated.reduce((s, r) => s + r.conversion_rate, 0) / rated.length * 10) / 10;
      })(),
    },
  };

  res.json({
    total, byType, follows, newFollowers, followBack, daily, topUsers,
    followerGrowth,
    perAccountGrowth: perAccount,
    inboundCounts,
    funnel,
    attribution,
    campaignPerformance,
  });
});

// ── Post returns ─────────────────────────────────────────────────────────────
// "For the people I engaged on post X with action A, who came back?" One row
// per (post, action type). Requested = what the extension asked for (from the
// run records); Performed = what actually ran (rows in instagram_actions); a
// user counts as returned when any inbound event from them (follow / like /
// comment / mention) lands within `return_days` after my FIRST action on them.
const RETURN_OUTBOUND = ['like', 'follow', 'comment', 'comment_reply', 'reply'];
// Fold comment_reply → reply so replies from every extension version group
// together; everything else keeps its own name.
const CANON = `CASE %COL% WHEN 'comment_reply' THEN 'reply' ELSE %COL% END`;
const canon = (col) => CANON.replaceAll('%COL%', col);
const RETURN_GROUPS = {
  followed:  ['new_follower'],
  liked:     ['received_like_post', 'got_like_post', 'received_like_reel', 'got_like_reel', 'received_like_comment', 'got_like_comment'],
  commented: ['received_comment', 'got_comment', 'received_reply', 'got_reply', 'received_mention', 'got_mention'],
};
const RETURN_INBOUND = Object.values(RETURN_GROUPS).flat();
const inList = (arr) => arr.map(() => '?').join(',');

// Window of MY actions: ?from=YYYY-MM-DD&to=YYYY-MM-DD (inclusive days) or ?days=N.
function actionWindow(q, defaultDays) {
  const from = q.from && q.to ? String(q.from).slice(0, 10) : null;
  const to   = q.from && q.to ? String(q.to).slice(0, 10) : null;
  if (from && to && !isNaN(Date.parse(from + 'T00:00:00Z')) && !isNaN(Date.parse(to + 'T00:00:00Z'))) {
    const end = sqlTs(Date.parse(to + 'T00:00:00Z') + 86400000);
    return { sql: (c) => `${c} >= ? AND ${c} < ?`, params: [`${from} 00:00:00`, end], label: `${from} → ${to}` };
  }
  const days = Math.max(1, Math.min(3650, parseInt(q.days, 10) || defaultDays));
  return { sql: (c) => `${c} >= ?`, params: [sqlTs(Date.now() - days * 86400000)], label: `last ${days} days` };
}
function profilesFilter(q) {
  const list = q.profiles ? String(q.profiles).split(',').map(p => p.trim().replace(/^@/, '').toLowerCase()).filter(Boolean) : [];
  return list.length ? { sql: ` AND LOWER(my_profile) IN (${inList(list)})`, params: list } : { sql: '', params: [] };
}
const returnDaysOf = (q) => Math.max(1, Math.min(365, parseInt(q.return_days, 10) || 30));
function actFilter(q) {
  const a = typeof q.action === 'string' && q.action ? q.action : null;
  // 'reply' also matches the raw comment_reply rows.
  if (a === 'reply') return { sql: ` AND type IN ('reply','comment_reply')`, params: [] };
  if (a) return { sql: ` AND type = ?`, params: [a] };
  return { sql: '', params: [] };
}

// Distinct (post, act, my_profile, target) with the time of my first action —
// the base for returns. postUrl: undefined = every post; '' = actions with no
// post (bare follows). act limits to one canonical action type.
function targetsCte(uid, win, prof, postUrl, act) {
  const postSql = postUrl === undefined ? '' : (postUrl === '' ? ` AND post_url IS NULL` : ` AND post_url = ?`);
  return {
    sql: `
      SELECT post_url, ${canon('type')} AS act, my_profile, username,
             MIN(created_at) AS first_at, MIN(post_owner) AS post_owner
      FROM instagram_actions
      WHERE user_id = ? AND type IN (${inList(RETURN_OUTBOUND)}) AND username IS NOT NULL
        AND ${win.sql('created_at')}${prof.sql}${postSql}${act.sql}
      GROUP BY post_url, act, my_profile, username`,
    params: [uid, ...RETURN_OUTBOUND, ...win.params, ...prof.params, ...(postUrl ? [postUrl] : []), ...act.params],
  };
}
function returnsJoin(uid, returnDays) {
  return {
    sql: `
      JOIN instagram_actions b
        ON b.user_id = ? AND b.username = t.username
       AND b.type IN (${inList(RETURN_INBOUND)})
       AND b.created_at > t.first_at AND b.created_at <= datetime(t.first_at, ?)
       AND (b.my_profile = t.my_profile OR b.my_profile IS NULL OR t.my_profile IS NULL)`,
    params: [uid, ...RETURN_INBOUND, `+${returnDays} days`],
  };
}
const groupFlag = (g) => `MAX(b.type IN (${inList(RETURN_GROUPS[g])}))`;
const groupParams = () => [...RETURN_GROUPS.followed, ...RETURN_GROUPS.liked, ...RETURN_GROUPS.commented];

router.get('/post-returns', authenticateFlexible, (req, res) => {
  const uid = targetUser(req);
  const win = actionWindow(req.query, 90);
  const prof = profilesFilter(req.query);
  const returnDays = returnDaysOf(req.query);
  const noAct = { sql: '', params: [] };
  const t = targetsCte(uid, win, prof, undefined, noAct);
  const j = returnsJoin(uid, returnDays);

  // Performed: actual actions that ran, per (post, act).
  const performed = db.prepare(`
    SELECT COALESCE(post_url, '') AS post_url, ${canon('type')} AS act,
           COUNT(*) AS performed, COUNT(DISTINCT username) AS users,
           MIN(created_at) AS first_at, MAX(created_at) AS last_at,
           MIN(post_owner) AS post_owner, GROUP_CONCAT(DISTINCT my_profile) AS my_profiles
    FROM instagram_actions
    WHERE user_id = ? AND type IN (${inList(RETURN_OUTBOUND)}) AND username IS NOT NULL
      AND ${win.sql('created_at')}${prof.sql}
    GROUP BY post_url, act
  `).all(uid, ...RETURN_OUTBOUND, ...win.params, ...prof.params);

  // Requested: what the extension asked for, from run records (instagram_campaigns
  // is the unified per-run table — manual sessions and batch sub-sessions both
  // land here with total_requested + post_url). Campaigns carry no my_profile,
  // so requested is not split by account when a profile filter is active.
  const requested = db.prepare(`
    SELECT COALESCE(post_url, '') AS post_url, ${canon('type')} AS act,
           SUM(COALESCE(total_requested, 0)) AS requested,
           SUM(total_requested IS NOT NULL) AS runs_with_req, COUNT(*) AS runs
    FROM instagram_campaigns
    WHERE user_id = ? AND post_url IS NOT NULL AND ${win.sql('started_at')}
    GROUP BY post_url, act
  `).all(uid, ...win.params);

  // Returns per (post, act).
  const returned = db.prepare(`
    WITH t AS (${t.sql}),
    r AS (
      SELECT t.post_url, t.act, t.username,
             ${groupFlag('followed')} AS followed, ${groupFlag('liked')} AS liked, ${groupFlag('commented')} AS commented,
             MIN(b.created_at) AS first_return_at, MIN(t.first_at) AS first_at
      FROM t ${j.sql}
      GROUP BY t.post_url, t.act, t.username
    )
    SELECT COALESCE(post_url, '') AS post_url, act, COUNT(*) AS returned,
           SUM(followed) AS followed, SUM(liked) AS liked, SUM(commented) AS commented,
           AVG((JULIANDAY(first_return_at) - JULIANDAY(first_at)) * 24) AS avg_hours_to_return
    FROM r GROUP BY post_url, act
  `).all(...t.params, ...groupParams(), ...j.params);

  const uniqueTargets = db.prepare(`WITH t AS (${t.sql}) SELECT COUNT(DISTINCT username) AS users FROM t`).get(...t.params);
  const uniqueReturned = db.prepare(`
    WITH t AS (${t.sql}),
    r AS (
      SELECT t.username, ${groupFlag('followed')} AS followed, ${groupFlag('liked')} AS liked, ${groupFlag('commented')} AS commented
      FROM t ${j.sql} GROUP BY t.username
    )
    SELECT COUNT(*) AS returned, SUM(followed) AS followed, SUM(liked) AS liked, SUM(commented) AS commented FROM r
  `).get(...t.params, ...groupParams(), ...j.params);

  const profiles = db.prepare(`
    SELECT DISTINCT my_profile FROM instagram_actions WHERE user_id = ? AND my_profile IS NOT NULL ORDER BY my_profile
  `).all(uid).map(r => r.my_profile);

  // Latest run per (post, act): its status + the reason code the extension
  // stamped into notes (reason=<code>), so the dashboard can say WHY a request
  // didn't finish. SQLite returns the MAX(started_at) row's bare columns.
  const latestRuns = db.prepare(`
    SELECT COALESCE(post_url, '') AS post_url, ${canon('type')} AS act,
           status, notes, MAX(started_at) AS started_at
    FROM instagram_campaigns
    WHERE user_id = ? AND post_url IS NOT NULL AND ${win.sql('started_at')}
    GROUP BY post_url, act
  `).all(uid, ...win.params);
  const parseReason = (notes) => {
    const m = /reason=([a-z_]+)/i.exec(notes || '');
    return m ? m[1] : null;
  };

  const K = (u, a) => `${u}\u0000${a}`;
  const reqBy = new Map(requested.map(r => [K(r.post_url, r.act), r]));
  const retBy = new Map(returned.map(r => [K(r.post_url, r.act), r]));
  const runBy = new Map(latestRuns.map(r => [K(r.post_url, r.act), r]));
  const rows = performed.map(p => {
    const key = K(p.post_url, p.act);
    const req = reqBy.get(key);
    const ret = retBy.get(key) || {};
    const run = runBy.get(key);
    const followed = ret.followed || 0;
    const requestedN = req && req.runs_with_req > 0 ? req.requested : null;
    // Reason the request did/didn't finish. Prefer the extension's own code;
    // otherwise infer from requested vs performed.
    let reason = parseReason(run && run.notes);
    if (!reason && requestedN != null) reason = p.performed >= requestedN ? 'target_reached' : 'incomplete';
    return {
      post_url: p.post_url, action: p.act, post_owner: p.post_owner,
      my_profiles: p.my_profiles ? String(p.my_profiles).split(',') : [],
      first_at: p.first_at, last_at: p.last_at,
      requested: requestedN,
      performed: p.performed, users: p.users,
      returned: ret.returned || 0, followed, liked: ret.liked || 0, commented: ret.commented || 0,
      avg_hours_to_return: ret.avg_hours_to_return != null ? Math.round(ret.avg_hours_to_return * 10) / 10 : null,
      rate: p.performed ? Math.round((followed / p.performed) * 1000) / 10 : null,
      reason,
      run_status: run ? run.status : null,
      run_notes: run ? run.notes : null,
    };
  }).sort((a, b) => (a.last_at < b.last_at ? 1 : -1));

  const sum = (k) => rows.reduce((s, r) => s + (r[k] || 0), 0);
  const users = uniqueTargets?.users || 0;
  res.json({
    window: { label: win.label, return_days: returnDays },
    profiles,
    totals: {
      posts: new Set(rows.map(r => r.post_url)).size, rows: rows.length,
      requested: sum('requested'), performed: sum('performed'), users,
      returned: uniqueReturned?.returned || 0,
      followed: uniqueReturned?.followed || 0, liked: uniqueReturned?.liked || 0, commented: uniqueReturned?.commented || 0,
      rate: sum('performed') ? Math.round(((uniqueReturned?.followed || 0) / sum('performed')) * 1000) / 10 : null,
    },
    posts: rows,
  });
});

// Per-(post, action) drill-down: every targeted user, what I did, what they did back.
router.get('/post-returns/users', authenticateFlexible, (req, res) => {
  const uid = targetUser(req);
  const win = actionWindow(req.query, 90);
  const prof = profilesFilter(req.query);
  const returnDays = returnDaysOf(req.query);
  const act = actFilter(req.query);
  const postUrl = typeof req.query.post_url === 'string' ? req.query.post_url : '';
  const postSql = postUrl ? ` AND post_url = ?` : ` AND post_url IS NULL`;

  const actionRows = db.prepare(`
    SELECT username, type, created_at, my_profile, full_name, follower_count FROM instagram_actions
    WHERE user_id = ? AND type IN (${inList(RETURN_OUTBOUND)}) AND username IS NOT NULL
      AND ${win.sql('created_at')}${prof.sql}${postSql}${act.sql}
    ORDER BY created_at ASC LIMIT 8000
  `).all(uid, ...RETURN_OUTBOUND, ...win.params, ...prof.params, ...(postUrl ? [postUrl] : []), ...act.params);

  const byUser = new Map();
  for (const a of actionRows) {
    const u = byUser.get(a.username) || { username: a.username, my_profile: a.my_profile, first_at: a.created_at, full_name: null, follower_count: null, my_actions: [], returns: [] };
    if (a.created_at < u.first_at) u.first_at = a.created_at;
    u.my_actions.push({ type: a.type === 'comment_reply' ? 'reply' : a.type, at: a.created_at });
    if (a.full_name && !u.full_name) u.full_name = a.full_name;
    if (a.follower_count != null && u.follower_count == null) u.follower_count = a.follower_count;
    byUser.set(a.username, u);
  }

  const usernames = [...byUser.keys()];
  const inbound = [];
  for (let i = 0; i < usernames.length; i += 400) {
    const chunk = usernames.slice(i, i + 400);
    inbound.push(...db.prepare(`
      SELECT username, type, created_at, my_profile, post_url FROM instagram_actions
      WHERE user_id = ? AND type IN (${inList(RETURN_INBOUND)}) AND username IN (${inList(chunk)})
      ORDER BY created_at ASC
    `).all(uid, ...RETURN_INBOUND, ...chunk));
  }
  const toMs = (s) => Date.parse(String(s).replace(' ', 'T') + 'Z');
  const windowMs = returnDays * 86400000;
  const groupOf = (type) => Object.keys(RETURN_GROUPS).find(g => RETURN_GROUPS[g].includes(type)) || 'other';
  for (const b of inbound) {
    const u = byUser.get(b.username);
    if (!u) continue;
    const t0 = toMs(u.first_at), t1 = toMs(b.created_at);
    if (!(t1 > t0 && t1 <= t0 + windowMs)) continue;
    if (b.my_profile && u.my_profile && b.my_profile !== u.my_profile) continue;
    u.returns.push({ type: b.type, group: groupOf(b.type), at: b.created_at, post_url: b.post_url, hours_after: Math.round((t1 - t0) / 3600000 * 10) / 10 });
  }
  const users = [...byUser.values()]
    .map(u => ({ ...u, returned: u.returns.length > 0 }))
    .sort((a, b) => (Number(b.returned) - Number(a.returned)) || (a.first_at < b.first_at ? 1 : -1));
  res.json({ post_url: postUrl, action: req.query.action || null, return_days: returnDays, users, truncated: actionRows.length >= 8000 });
});

// ── Admin: list all users with stats ─────────────────────────────────────────
router.get('/admin/users', authenticate, (req, res) => {
  if (req.user.role !== 'super_admin' && req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const users = db.prepare(`
    SELECT u.id, u.name, u.email,
      (SELECT COUNT(*) FROM instagram_actions ia WHERE ia.user_id = u.id) as total_actions,
      (SELECT COUNT(*) FROM instagram_campaigns ic WHERE ic.user_id = u.id) as total_campaigns,
      (SELECT MAX(created_at) FROM instagram_actions ia WHERE ia.user_id = u.id) as last_action
    FROM users u ORDER BY total_actions DESC
  `).all();
  res.json(users);
});

// ── Scheduled Posts ──────────────────────────────────────────────────────────
// Create a scheduled post — multipart/form-data with `media` file + fields.
router.post('/scheduled-posts', authenticateFlexible, igUpload.single('media'), (req, res) => {
  const b = req.body || {};
  const scheduled_at = b.scheduled_at || b.scheduledAt;
  if (!scheduled_at) return res.status(400).json({ error: 'scheduled_at required' });
  if (!req.file) return res.status(400).json({ error: 'media file required' });

  const id = uuidv4();
  db.prepare(`
    INSERT INTO instagram_scheduled_posts
      (id, user_id, my_profile, post_type, caption, hashtags, location,
       media_filename, media_mime, media_size, scheduled_at, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled')
  `).run(
    id, req.user.id,
    b.my_profile || b.myProfile || null,
    b.post_type  || b.postType  || 'post',
    b.caption    || null,
    b.hashtags   || null,
    b.location   || null,
    req.file.filename, req.file.mimetype, req.file.size,
    scheduled_at,
  );
  res.json(db.prepare('SELECT * FROM instagram_scheduled_posts WHERE id = ?').get(id));
});

// List user's scheduled posts.
router.get('/scheduled-posts', authenticateFlexible, (req, res) => {
  const uid = targetUser(req);
  const { status } = req.query;
  let q = 'SELECT * FROM instagram_scheduled_posts WHERE user_id = ?';
  const params = [uid];
  if (status) { q += ' AND status = ?'; params.push(status); }
  q += ' ORDER BY scheduled_at ASC LIMIT 500';
  res.json(db.prepare(q).all(...params));
});

// Extension polls this every 60s — returns posts whose time has arrived but are still 'scheduled'.
// Flips them to 'claimed' atomically so two extension instances don't double-publish.
router.get('/scheduled-posts/due', authenticateFlexible, (req, res) => {
  const { my_profile, myProfile } = req.query;
  const profile = my_profile || myProfile || null;

  const rows = db.prepare(`
    SELECT * FROM instagram_scheduled_posts
    WHERE user_id = ?
      AND status = 'scheduled'
      AND datetime(scheduled_at) <= datetime('now')
      ${profile ? "AND (my_profile = ? OR my_profile IS NULL)" : ''}
    ORDER BY scheduled_at ASC
    LIMIT 5
  `).all(...(profile ? [req.user.id, profile] : [req.user.id]));

  const claim = db.prepare(`UPDATE instagram_scheduled_posts SET status = 'claimed' WHERE id = ? AND status = 'scheduled'`);
  const claimed = [];
  for (const r of rows) {
    const info = claim.run(r.id);
    if (info.changes > 0) claimed.push({ ...r, status: 'claimed', media_url: `/api/instagram/scheduled-posts/${r.id}/media` });
  }
  res.json(claimed);
});

// Serve the media file for a scheduled post (extension downloads then uploads to IG).
router.get('/scheduled-posts/:id/media', authenticateFlexible, (req, res) => {
  const row = db.prepare('SELECT * FROM instagram_scheduled_posts WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!row || !row.media_filename) return res.status(404).json({ error: 'Not found' });
  const filePath = path.join(IG_UPLOADS_DIR, row.media_filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File missing' });
  res.setHeader('Content-Type', row.media_mime || 'application/octet-stream');
  res.sendFile(filePath);
});

// Update a scheduled post. The extension calls this with `status` after a
// publish attempt; the UI calls it with edit fields (caption, time, account,
// post_type). Editing is blocked once a post has been claimed/posted.
router.patch('/scheduled-posts/:id', authenticateFlexible, (req, res) => {
  const b = req.body || {};
  const row = db.prepare('SELECT * FROM instagram_scheduled_posts WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Not found' });

  // If this isn't a status update (i.e. it's a user edit), refuse if the post
  // has already been published or is in flight.
  const isUserEdit = b.status == null;
  if (isUserEdit && ['posted', 'claimed'].includes(row.status)) {
    return res.status(409).json({ error: `Cannot edit a post that's already ${row.status}` });
  }

  const myProfile = b.my_profile != null
    ? (typeof b.my_profile === 'string' ? b.my_profile.replace(/^@/, '') : null)
    : null;

  db.prepare(`
    UPDATE instagram_scheduled_posts SET
      status        = COALESCE(?, status),
      scheduled_at  = COALESCE(?, scheduled_at),
      caption       = COALESCE(?, caption),
      post_type     = COALESCE(?, post_type),
      my_profile    = COALESCE(?, my_profile),
      posted_at     = CASE WHEN ? = 'posted' THEN CURRENT_TIMESTAMP ELSE posted_at END,
      error_message = COALESCE(?, error_message)
    WHERE id = ?
  `).run(
    b.status || null,
    b.scheduled_at || b.scheduledAt || null,
    b.caption ?? null,
    b.post_type || b.postType || null,
    myProfile,
    b.status || null,
    b.error_message || b.errorMessage || null,
    req.params.id,
  );
  res.json(db.prepare('SELECT * FROM instagram_scheduled_posts WHERE id = ?').get(req.params.id));
});

// Replace the media file on an existing scheduled post (multipart/form-data
// with `media` field). Refuses if the post is already in flight or posted.
router.post('/scheduled-posts/:id/media', authenticateFlexible, igUpload.single('media'), (req, res) => {
  const row = db.prepare('SELECT * FROM instagram_scheduled_posts WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (['posted', 'claimed'].includes(row.status)) {
    return res.status(409).json({ error: `Cannot replace media on a post that's already ${row.status}` });
  }
  if (!req.file) return res.status(400).json({ error: 'media file required' });

  // Delete the old file off disk
  if (row.media_filename) {
    try { fs.unlinkSync(path.join(IG_UPLOADS_DIR, row.media_filename)); } catch (_) {}
  }
  db.prepare(`
    UPDATE instagram_scheduled_posts SET
      media_filename = ?, media_mime = ?, media_size = ?
    WHERE id = ?
  `).run(req.file.filename, req.file.mimetype, req.file.size, req.params.id);
  res.json(db.prepare('SELECT * FROM instagram_scheduled_posts WHERE id = ?').get(req.params.id));
});

router.delete('/scheduled-posts/:id', authenticateFlexible, (req, res) => {
  const row = db.prepare('SELECT * FROM instagram_scheduled_posts WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.media_filename) {
    try { fs.unlinkSync(path.join(IG_UPLOADS_DIR, row.media_filename)); } catch (_) {}
  }
  db.prepare('DELETE FROM instagram_scheduled_posts WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── Distinct accounts whose due posts are waiting ───────────────────────────
// Used by the scheduler to decide whether it's worth switching IG accounts.
router.get('/scheduled-posts/pending-accounts', authenticateFlexible, (req, res) => {
  const rows = db.prepare(`
    SELECT DISTINCT my_profile FROM instagram_scheduled_posts
    WHERE user_id = ?
      AND status = 'scheduled'
      AND datetime(scheduled_at) <= datetime('now')
      AND my_profile IS NOT NULL AND my_profile != ''
  `).all(req.user.id);
  res.json(rows.map(r => r.my_profile));
});

// ── Account list (multi-profile management) ──────────────────────────────────
// The extension scans IG's "Switch accounts" modal and submits the list here;
// the frontend reads it back to populate dropdowns. We also union in any
// UI button labels that the extension's account auto-detector accidentally
// picked up as if they were Instagram usernames. Real IG usernames are
// always lowercase, but case-insensitive match here for safety.
const RESERVED_IG_USERNAMES = new Set([
  'close', 'cancel', 'save', 'back', 'next', 'done', 'more', 'menu',
  'home', 'search', 'explore', 'profile', 'messages', 'notifications',
  'create', 'settings', 'about', 'help', 'logout', 'login', 'signup',
  'instagram', 'meta', 'facebook', 'reels', 'feed', 'inbox',
]);

// Normalize + validate an Instagram username. Returns the canonical
// lowercase form on success, or null if the input doesn't look like a
// real IG handle (UI label, empty, bad chars, reserved word).
function normalizeIgUsername(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(/^@/, '').toLowerCase();
  if (!trimmed) return null;
  if (!/^[a-z0-9._]{1,30}$/.test(trimmed)) return null;
  if (RESERVED_IG_USERNAMES.has(trimmed)) return null;
  return trimmed;
}

// my_profile values seen in the user's data so manual entries aren't lost.
// Merges the scanned list with whatever's already stored — so manual entries
// added via the UI aren't wiped every time the extension scans.
router.post('/accounts/scan', authenticateFlexible, (req, res) => {
  const incoming = Array.isArray(req.body.accounts) ? req.body.accounts : [];
  const cleaned = [];
  const rejected = [];
  for (const raw of incoming) {
    const u = normalizeIgUsername(raw);
    if (u) cleaned.push(u);
    else if (typeof raw === 'string' && raw.trim()) rejected.push(raw.trim());
  }
  const row = db.prepare('SELECT instagram_accounts FROM users WHERE id = ?').get(req.user.id);
  let existing = [];
  if (row?.instagram_accounts) {
    try { existing = JSON.parse(row.instagram_accounts) || []; } catch (_) {}
  }
  // Also strip any previously stored reserved/invalid entries on each scan
  // so phantom rows like "@Close" auto-clean themselves.
  existing = existing.filter(a => normalizeIgUsername(a) !== null);
  const merged = [...new Set([...existing, ...cleaned])].sort();
  db.prepare('UPDATE users SET instagram_accounts = ? WHERE id = ?')
    .run(JSON.stringify(merged), req.user.id);
  // Auto-create daily follower-count automations for any newly-added accounts.
  try { ensureSystemAutomations(req.user.id); } catch (_) {}
  // Append each newly-added account to the multi-account scan row.
  try {
    const newOnes = cleaned.filter(a => !existing.includes(a));
    for (const a of newOnes) syncSystemScanAccounts(req.user.id, { added: a });
  } catch (_) {}
  res.json({ ok: true, count: merged.length, accounts: merged, rejected });
});

// Add a single account manually (e.g. for accounts not yet logged into IG)
router.post('/accounts', authenticateFlexible, (req, res) => {
  const username = normalizeIgUsername(req.body.username || '');
  if (!username) {
    return res.status(400).json({ error: 'Invalid Instagram username (must be lowercase a-z, 0-9, dot, underscore — and not a UI label like "close" or "cancel")' });
  }
  const row = db.prepare('SELECT instagram_accounts FROM users WHERE id = ?').get(req.user.id);
  let list = [];
  if (row?.instagram_accounts) {
    try { list = JSON.parse(row.instagram_accounts) || []; } catch (_) {}
  }
  // Strip any pre-existing phantom entries
  list = list.filter(a => normalizeIgUsername(a) !== null);
  if (!list.includes(username)) list.push(username);
  list = [...new Set(list)].sort();
  db.prepare('UPDATE users SET instagram_accounts = ? WHERE id = ?')
    .run(JSON.stringify(list), req.user.id);
  // Auto-create the daily follower-count automation for the new account.
  try { ensureSystemAutomations(req.user.id); } catch (_) {}
  // Append the new account to the multi-account scan row if it exists.
  // (No-op if user hasn't had any accounts before — ensureSystemAutomations
  // will create the row with the right list on next /automations fetch.)
  try { syncSystemScanAccounts(req.user.id, { added: username }); } catch (_) {}
  res.json({ ok: true, accounts: list });
});

router.delete('/accounts/:username', authenticateFlexible, (req, res) => {
  const target = (req.params.username || '').trim().replace(/^@/, '').toLowerCase();
  const row = db.prepare('SELECT instagram_accounts FROM users WHERE id = ?').get(req.user.id);
  let list = [];
  if (row?.instagram_accounts) {
    try { list = JSON.parse(row.instagram_accounts) || []; } catch (_) {}
  }
  list = list.filter(a => a.toLowerCase() !== target);
  db.prepare('UPDATE users SET instagram_accounts = ? WHERE id = ?')
    .run(JSON.stringify(list), req.user.id);
  // Remove the system automation that was auto-created for this account
  // (one that covers only this single account). Manual automations the user
  // created that happen to include this account are left untouched.
  try {
    const sysAutos = db.prepare(
      "SELECT id, accounts FROM instagram_automations WHERE user_id = ? AND is_system = 1"
    ).all(req.user.id);
    for (const a of sysAutos) {
      let accs = [];
      try { accs = JSON.parse(a.accounts || '[]'); } catch (_) {}
      if (accs.length === 1 && accs[0] === target) {
        db.prepare('DELETE FROM instagram_automations WHERE id = ?').run(a.id);
      }
    }
  } catch (_) {}
  // Drop the removed account from the multi-account scan row's accounts.
  // Doesn't touch other fields (time, name, enabled) — preserves user edits.
  try { syncSystemScanAccounts(req.user.id, { removed: target }); } catch (_) {}
  res.json({ ok: true, accounts: list });
});

router.get('/accounts', authenticateFlexible, (req, res) => {
  const uid = targetUser(req);
  const row = db.prepare('SELECT instagram_accounts FROM users WHERE id = ?').get(uid);
  let scanned = [];
  if (row?.instagram_accounts) {
    try { scanned = JSON.parse(row.instagram_accounts) || []; } catch (_) {}
  }
  const seen = db.prepare(`
    SELECT DISTINCT my_profile FROM instagram_actions
      WHERE user_id = ? AND my_profile IS NOT NULL AND my_profile != ''
    UNION
    SELECT DISTINCT my_profile FROM instagram_follower_snapshots
      WHERE user_id = ? AND my_profile IS NOT NULL AND my_profile != ''
    UNION
    SELECT DISTINCT my_profile FROM instagram_scheduled_posts
      WHERE user_id = ? AND my_profile IS NOT NULL AND my_profile != ''
  `).all(uid, uid, uid).map(r => r.my_profile);
  res.json([...new Set([...scanned, ...seen])].sort());
});

// ── User Profile Enrichment (country + joined month + bio) ──────────────────
// Phase 1: backend foundation. Phase 2 (extension scraper) lands tomorrow.
//
// The extension visits each engaged user's profile, clicks "About this
// account", and reads back the country + date joined. It UPSERTs here.
// History queries LEFT JOIN this table so country shows in the UI without
// blocking the main batch flow.
//
// POST /user-profiles  — UPSERT enrichment data for one username
// Body: { username, country, country_code, joined_month, full_name,
//         followers, bio, verified, private, error }
// Idempotent — extension can re-POST safely (e.g., after a refresh).
router.post('/user-profiles', authenticateFlexible, (req, res) => {
  const uid = targetUser(req);
  const b = req.body || {};
  const username = String(b.username || '').trim().replace(/^@/, '').toLowerCase();
  if (!username) return res.status(400).json({ error: 'username required' });
  db.prepare(`
    INSERT INTO instagram_user_profiles
      (user_id, username, country, country_code, joined_month, full_name,
       followers, bio, verified, private, enrichment_error, last_enriched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, username) DO UPDATE SET
      country = COALESCE(excluded.country, instagram_user_profiles.country),
      country_code = COALESCE(excluded.country_code, instagram_user_profiles.country_code),
      joined_month = COALESCE(excluded.joined_month, instagram_user_profiles.joined_month),
      full_name = COALESCE(excluded.full_name, instagram_user_profiles.full_name),
      followers = COALESCE(excluded.followers, instagram_user_profiles.followers),
      bio = COALESCE(excluded.bio, instagram_user_profiles.bio),
      verified = COALESCE(excluded.verified, instagram_user_profiles.verified),
      private = COALESCE(excluded.private, instagram_user_profiles.private),
      enrichment_error = excluded.enrichment_error,
      last_enriched_at = CURRENT_TIMESTAMP
  `).run(
    uid, username,
    b.country || null,
    b.country_code || null,
    b.joined_month || null,
    b.full_name || null,
    Number.isFinite(b.followers) ? b.followers : null,
    b.bio || null,
    b.verified === true ? 1 : (b.verified === false ? 0 : null),
    b.private === true ? 1 : (b.private === false ? 0 : null),
    b.error || null
  );
  res.json({ ok: true });
});

// GET /user-profiles/pending?limit=20
// Returns up to N usernames that need enrichment — usernames we've engaged
// with (appear in instagram_actions) but have no row in
// instagram_user_profiles, OR have a row older than 30 days.
// Used by the extension's background poller to pace the enrichment queue.
router.get('/user-profiles/pending', authenticateFlexible, (req, res) => {
  const uid = targetUser(req);
  const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 20));
  const rows = db.prepare(`
    SELECT DISTINCT a.username
    FROM instagram_actions a
    LEFT JOIN instagram_user_profiles p
      ON p.user_id = a.user_id AND p.username = LOWER(a.username)
    WHERE a.user_id = ?
      AND a.username IS NOT NULL AND a.username != ''
      AND a.type IN ('like', 'reply', 'follow', 'comment', 'comment_reply')
      AND (p.username IS NULL OR datetime(p.last_enriched_at) < datetime('now', '-30 days'))
    ORDER BY a.created_at DESC
    LIMIT ?
  `).all(uid, limit).map(r => r.username);
  res.json(rows);
});

// GET /user-profiles/:username — read a single enriched profile
// Used by the History UI to fetch country on-demand if the LEFT JOIN
// isn't enough (e.g., re-enrich button in the future).
router.get('/user-profiles/:username', authenticateFlexible, (req, res) => {
  const uid = targetUser(req);
  const username = String(req.params.username || '').trim().replace(/^@/, '').toLowerCase();
  if (!username) return res.status(400).json({ error: 'username required' });
  const row = db.prepare(`
    SELECT * FROM instagram_user_profiles WHERE user_id = ? AND username = ?
  `).get(uid, username);
  res.json(row || null);
});

// ── Follower Snapshots ───────────────────────────────────────────────────────
// Extension posts the followers list it scraped from instagram.com.
router.post('/followers/snapshot', authenticateFlexible, (req, res) => {
  const b = req.body || {};
  const followers = Array.isArray(b.followers) ? b.followers : [];
  const id = uuidv4();
  db.prepare(`
    INSERT INTO instagram_follower_snapshots (id, user_id, my_profile, follower_count, followers_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, req.user.id, b.my_profile || b.myProfile || null, followers.length, JSON.stringify(followers));
  res.json({ id, follower_count: followers.length });
});

// Diff the latest snapshot against the most recent older one (or one ≥ `days` ago).
router.get('/followers/changes', authenticateFlexible, (req, res) => {
  const uid = targetUser(req);
  const { my_profile, days = 7 } = req.query;
  const profile = my_profile || null;

  const latest = db.prepare(`
    SELECT * FROM instagram_follower_snapshots
    WHERE user_id = ? ${profile ? 'AND my_profile = ?' : ''}
    ORDER BY captured_at DESC LIMIT 1
  `).get(...(profile ? [uid, profile] : [uid]));

  if (!latest) return res.json({ latest: null, baseline: null, gained: [], lost: [] });

  const baseline = db.prepare(`
    SELECT * FROM instagram_follower_snapshots
    WHERE user_id = ? ${profile ? 'AND my_profile = ?' : ''}
      AND captured_at < ?
      AND datetime(captured_at) <= datetime('now', '-${Number(days)} days')
    ORDER BY captured_at DESC LIMIT 1
  `).get(...(profile ? [uid, profile, latest.captured_at] : [uid, latest.captured_at]));

  const fallbackBaseline = baseline || db.prepare(`
    SELECT * FROM instagram_follower_snapshots
    WHERE user_id = ? ${profile ? 'AND my_profile = ?' : ''} AND id != ?
    ORDER BY captured_at DESC LIMIT 1
  `).get(...(profile ? [uid, profile, latest.id] : [uid, latest.id]));

  if (!fallbackBaseline) {
    return res.json({ latest: { ...latest, followers_json: undefined }, baseline: null, gained: [], lost: [] });
  }

  const latestSet  = new Set(JSON.parse(latest.followers_json || '[]'));
  const baseSet    = new Set(JSON.parse(fallbackBaseline.followers_json || '[]'));
  const gained = [...latestSet].filter(u => !baseSet.has(u));
  const lost   = [...baseSet].filter(u => !latestSet.has(u));
  res.json({
    latest:   { id: latest.id, captured_at: latest.captured_at, follower_count: latest.follower_count, my_profile: latest.my_profile },
    baseline: { id: fallbackBaseline.id, captured_at: fallbackBaseline.captured_at, follower_count: fallbackBaseline.follower_count },
    gained, lost,
  });
});

// List snapshots (without the giant followers_json blob).
router.get('/followers/snapshots', authenticateFlexible, (req, res) => {
  const uid = targetUser(req);
  const { my_profile } = req.query;
  const rows = db.prepare(`
    SELECT id, my_profile, captured_at, follower_count
    FROM instagram_follower_snapshots
    WHERE user_id = ? ${my_profile ? 'AND my_profile = ?' : ''}
    ORDER BY captured_at DESC LIMIT 100
  `).all(...(my_profile ? [uid, my_profile] : [uid]));
  res.json(rows);
});

// ── Profile scraping (research) ──────────────────────────────────────────────
// Monday queues a job → extension's background alarm claims it → extension
// opens an IG tab to the target profile → content script scrapes the first N
// post tiles via hover overlay → results upserted into instagram_scraped_posts.

function cleanUsername(u) {
  // Accept any common form: bare `name`, `@name`, or a full IG URL like
  // `https://www.instagram.com/name/` — return the canonical lowercase
  // username, or empty string if nothing recognizable was found.
  const raw = String(u || '').trim();
  if (!raw) return '';
  const urlMatch = raw.match(/instagram\.com\/([^/?#@\s]+)/i);
  if (urlMatch) return urlMatch[1].toLowerCase();
  return raw.replace(/^@/, '').toLowerCase();
}

// Monday creates a job
router.post('/scrape-jobs', authenticateFlexible, (req, res) => {
  const uid = targetUser(req);
  const target = cleanUsername(req.body?.target_username);
  if (!target) return res.status(400).json({ error: 'target_username required' });
  // Defense in depth — reject anything that doesn't look like a valid IG
  // username after normalization. Frontend already validates but the
  // backend can't trust that for direct API calls.
  if (!/^[a-z0-9._]{1,30}$/.test(target)) {
    return res.status(400).json({ error: `"${req.body?.target_username}" doesn't look like a valid Instagram username. Use just the handle (e.g. "natgeo") or a full profile URL.` });
  }
  const count = Math.max(1, Math.min(200, parseInt(req.body?.post_count, 10) || 25));
  const id = uuidv4();
  db.prepare(`
    INSERT INTO instagram_scrape_jobs (id, user_id, target_username, post_count)
    VALUES (?, ?, ?, ?)
  `).run(id, uid, target, count);
  const row = db.prepare('SELECT * FROM instagram_scrape_jobs WHERE id = ?').get(id);
  res.json(row);
});

// Monday lists this user's jobs (most recent first)
router.get('/scrape-jobs', authenticateFlexible, (req, res) => {
  const uid = targetUser(req);
  const rows = db.prepare(`
    SELECT * FROM instagram_scrape_jobs
    WHERE user_id = ?
    ORDER BY created_at DESC LIMIT 100
  `).all(uid);
  res.json(rows);
});

// Extension polls for the next pending job, claiming it atomically.
//
// Before picking a new job we sweep any stale `running` claims for this user
// — if a previous extension crashed or the Chrome tab was closed mid-scrape,
// the job would otherwise sit in `running` forever and block the queue.
// 2 minutes is plenty for a real scrape; anything older is presumed dead.
router.get('/scrape-jobs/pending', authenticateFlexible, (req, res) => {
  const uid = targetUser(req);
  db.prepare(`
    UPDATE instagram_scrape_jobs
    SET status = 'failed',
        error_message = COALESCE(error_message, 'Abandoned: extension never reported completion (stale claim).'),
        completed_at = CURRENT_TIMESTAMP
    WHERE user_id = ? AND status = 'running'
      AND datetime(started_at) < datetime('now', '-2 minutes')
  `).run(uid);

  const job = db.prepare(`
    SELECT * FROM instagram_scrape_jobs
    WHERE user_id = ? AND status = 'pending'
    ORDER BY created_at ASC LIMIT 1
  `).get(uid);
  if (!job) return res.json(null);
  const claim = db.prepare(`
    UPDATE instagram_scrape_jobs
    SET status = 'running', started_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'pending'
  `).run(job.id);
  if (claim.changes === 0) return res.json(null);
  res.json({ ...job, status: 'running' });
});

// Extension updates job status when scraping finishes (or fails)
router.patch('/scrape-jobs/:id', authenticateFlexible, (req, res) => {
  const uid = targetUser(req);
  const { status, error_message, posts_scraped } = req.body || {};
  const isTerminal = status === 'completed' || status === 'failed';
  db.prepare(`
    UPDATE instagram_scrape_jobs
    SET status = COALESCE(?, status),
        error_message = COALESCE(?, error_message),
        posts_scraped = COALESCE(?, posts_scraped),
        completed_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE completed_at END
    WHERE id = ? AND user_id = ?
  `).run(status || null, error_message || null, posts_scraped ?? null, isTerminal ? 1 : 0, req.params.id, uid);
  res.json({ ok: true });
});

// Delete a single scrape job. Does NOT delete the scraped posts the job
// produced — those live in instagram_scraped_posts and represent the data.
router.delete('/scrape-jobs/:id', authenticateFlexible, (req, res) => {
  const uid = targetUser(req);
  const r = db.prepare('DELETE FROM instagram_scrape_jobs WHERE id = ? AND user_id = ?')
    .run(req.params.id, uid);
  if (r.changes === 0) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

// Bulk-clear scrape jobs. Optional `?status=failed` to only clear failed
// ones (handy after the URL-parsing bug filled the list with junk rows).
router.delete('/scrape-jobs', authenticateFlexible, (req, res) => {
  const uid = targetUser(req);
  const status = typeof req.query.status === 'string' ? req.query.status : null;
  const r = status
    ? db.prepare('DELETE FROM instagram_scrape_jobs WHERE user_id = ? AND status = ?').run(uid, status)
    : db.prepare('DELETE FROM instagram_scrape_jobs WHERE user_id = ?').run(uid);
  res.json({ ok: true, deleted: r.changes });
});

// Delete all scraped posts for a single profile.
router.delete('/scraped-profiles/:username', authenticateFlexible, (req, res) => {
  const uid = targetUser(req);
  const target = String(req.params.username || '').trim().replace(/^@/, '').toLowerCase();
  if (!target) return res.status(400).json({ error: 'username required' });
  const r = db.prepare('DELETE FROM instagram_scraped_posts WHERE user_id = ? AND target_username = ?')
    .run(uid, target);
  res.json({ ok: true, deleted: r.changes });
});

// Bulk-clear all scraped post data for the current user.
router.delete('/scraped-profiles', authenticateFlexible, (req, res) => {
  const uid = targetUser(req);
  const r = db.prepare('DELETE FROM instagram_scraped_posts WHERE user_id = ?').run(uid);
  res.json({ ok: true, deleted: r.changes });
});

// Extension uploads scraped data — bulk upsert
router.post('/scraped-posts', authenticateFlexible, (req, res) => {
  const uid = targetUser(req);
  const target = cleanUsername(req.body?.target_username);
  const posts = Array.isArray(req.body?.posts) ? req.body.posts : [];
  if (!target) return res.status(400).json({ error: 'target_username required' });

  const upsert = db.prepare(`
    INSERT INTO instagram_scraped_posts
      (id, user_id, target_username, shortcode, post_url, post_type, likes, views, comments, caption, last_scraped_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, target_username, shortcode) DO UPDATE SET
      post_url = excluded.post_url,
      post_type = excluded.post_type,
      likes = excluded.likes,
      views = excluded.views,
      comments = excluded.comments,
      caption = excluded.caption,
      last_scraped_at = CURRENT_TIMESTAMP
  `);
  // No transaction wrapper — our db wrapper doesn't expose .transaction().
  // For 5–25 rows the perf impact of individual auto-commits is negligible.
  let inserted = 0;
  for (const p of posts) {
    if (!p?.shortcode) continue;
    upsert.run(
      uuidv4(), uid, target,
      String(p.shortcode),
      String(p.post_url || ''),
      p.post_type === 'reel' ? 'reel' : 'post',
      Number.isFinite(p.likes) ? p.likes : null,
      Number.isFinite(p.views) ? p.views : null,
      Number.isFinite(p.comments) ? p.comments : null,
      p.caption ? String(p.caption).slice(0, 500) : null
    );
    inserted++;
  }
  res.json({ ok: true, count: inserted });
});

// Monday reads scraped posts — by target_username for detail, or grouped summary
router.get('/scraped-posts', authenticateFlexible, (req, res) => {
  const uid = targetUser(req);
  const target = req.query.target_username ? cleanUsername(req.query.target_username) : null;
  if (target) {
    const rows = db.prepare(`
      SELECT * FROM instagram_scraped_posts
      WHERE user_id = ? AND target_username = ?
      ORDER BY last_scraped_at DESC LIMIT 500
    `).all(uid, target);
    return res.json(rows);
  }
  const rows = db.prepare(`
    SELECT target_username,
           COUNT(*) AS post_count,
           MAX(last_scraped_at) AS last_scraped_at
    FROM instagram_scraped_posts
    WHERE user_id = ?
    GROUP BY target_username
    ORDER BY last_scraped_at DESC
  `).all(uid);
  res.json(rows);
});

// ── Scheduled action campaigns (likes + replies orchestration) ───────────────
// Monday creates a campaign with N atomic queue items (one per post × action
// type). The extension's background alarm picks the oldest pending campaign,
// claims rows for the IG account it can run as, opens up to `concurrency`
// tabs in parallel, runs likes/replies, marks rows done. After all of an
// account's rows are done, switches accounts (respecting cooldown).

// Monday creates a campaign (starts as 'draft' — items added separately,
// then explicitly Sent to transition into the run queue).
router.post('/action-campaigns', authenticateFlexible, (req, res) => {
  const uid = targetUser(req);
  const { name, as_account, concurrency, start_at, items, free_text } = req.body || {};
  if (!as_account) return res.status(400).json({ error: 'as_account required' });
  const cid = uuidv4();
  const conc = Math.max(1, Math.min(6, parseInt(concurrency, 10) || 6));
  const cleanedAcct = String(as_account).trim().replace(/^@/, '').toLowerCase();
  // Auto-format name if not supplied: "@account YYYY-MM-DD HH:mm — free_text"
  let finalName = name && name.trim();
  if (!finalName) {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    finalName = `@${cleanedAcct} ${stamp}` + (free_text ? ` — ${String(free_text).trim()}` : '');
  }
  db.prepare(`
    INSERT INTO instagram_action_campaigns
      (id, user_id, name, as_account, status, total_requested, concurrency, start_at)
    VALUES (?, ?, ?, ?, 'draft', 0, ?, ?)
  `).run(cid, uid, finalName, cleanedAcct, conc, start_at || null);

  // Optionally seed with items if the caller passed any. Enforce the 20-item cap.
  // (Was 6 — raised so users can spread 800+ likes across enough posts to
  // overcome the per-post dedup loss.)
  if (Array.isArray(items) && items.length > 0) {
    if (items.length > 20) return res.status(400).json({ error: 'A campaign can hold at most 20 items.' });
    const insertItem = db.prepare(`
      INSERT INTO instagram_action_queue
        (id, campaign_id, user_id, as_account, post_url, action_type, count_requested, reply_source, reply_texts)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    let total = 0;
    for (const it of items) {
      const actionType = it.action_type === 'reply' ? 'reply' : 'like';
      const count = Math.max(1, parseInt(it.count, 10) || 1);
      total += count;
      insertItem.run(
        uuidv4(), cid, uid, cleanedAcct,
        String(it.post_url || ''),
        actionType, count,
        actionType === 'reply' ? (it.reply_source || 'default') : null,
        actionType === 'reply' && Array.isArray(it.reply_texts) ? JSON.stringify(it.reply_texts) : null
      );
    }
    db.prepare('UPDATE instagram_action_campaigns SET total_requested = ? WHERE id = ?').run(total, cid);
  }
  const row = db.prepare('SELECT * FROM instagram_action_campaigns WHERE id = ?').get(cid);
  res.json(row);
});

// Monday lists this user's action campaigns. Includes item count + the
// as_account derived from any of the campaign's items so the UI can display
// the target IG account on the list page.
router.get('/action-campaigns', authenticateFlexible, (req, res) => {
  const uid = targetUser(req);
  // Pagination: default page size 10 (small, fast-loading). Frontend
  // requests more via ?limit=10&offset=10 ("Load more" button).
  // Cap limit at 100 to prevent abuse / runaway queries.
  const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 10));
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

  // Total row count for the "Load more" button — lets the UI know if
  // there are more pages without paginating to find out.
  const total = db.prepare(
    'SELECT COUNT(*) AS n FROM instagram_action_campaigns WHERE user_id = ?'
  ).get(uid)?.n || 0;

  const rows = db.prepare(`
    SELECT c.*,
           (SELECT COUNT(*) FROM instagram_action_queue q WHERE q.campaign_id = c.id) AS items_count,
           COALESCE(c.as_account,
                    (SELECT q.as_account FROM instagram_action_queue q WHERE q.campaign_id = c.id LIMIT 1)
           ) AS as_account
    FROM instagram_action_campaigns c
    WHERE c.user_id = ?
    ORDER BY c.created_at DESC LIMIT ? OFFSET ?
  `).all(uid, limit, offset);

  // Reconcile total_completed against actual instagram_actions rows. The
  // stored count_done is only PATCHed at the script's final DONE — if the
  // watchdog kills the tab first, the stored count stays at 0 even though
  // many likes were performed.
  //
  // Robust match: count actions by the batch's account, of the right
  // outbound types, performed on the batch's post URLs, during the batch's
  // run window. Works for ALL extension versions (doesn't need
  // parent_queue_id linkage).
  const liveTotal = db.prepare(`
    SELECT COUNT(*) AS n FROM instagram_actions a
    WHERE a.user_id = ?
      AND a.my_profile = ?
      AND a.type IN ('like', 'reply', 'follow', 'comment', 'comment_reply')
      AND datetime(a.action_date) >= datetime(?)
      AND datetime(a.action_date) <= COALESCE(datetime(?), datetime('now'))
      AND a.post_url IN (
        SELECT post_url FROM instagram_action_queue WHERE campaign_id = ?
      )
  `);
  for (const c of rows) {
    const since = c.started_at || c.created_at || new Date().toISOString();
    const live = liveTotal.get(uid, c.as_account || '', since, c.ended_at || null, c.id)?.n || 0;
    if (live > (c.total_completed || 0)) c.total_completed = live;
  }

  // Enrich each batch with conversion metrics: how many of the people we
  // engaged with came back as followers / engagement events.
  //
  // The OLD query joined directly on action.campaign_id = action_campaign.id,
  // which never matched anything (instagram_actions.campaign_id references
  // the sub-session campaign created by startCampaign, NOT the action
  // campaign). That's why every batch showed "+0 followers back".
  //
  // Robust approach: "everyone this batch engaged with" = every outbound
  // action by the batch's account (my_profile) during the batch's run
  // window. Works for old AND new batches regardless of whether the
  // parent_queue_id linkage was set by a recent extension version.
  const followersBack = db.prepare(`
    SELECT COUNT(DISTINCT r.username) AS n
    FROM instagram_actions r
    WHERE r.user_id = ?
      AND r.type = 'new_follower'
      AND datetime(r.action_date) >= datetime(?)
      AND r.username IN (
        SELECT DISTINCT a.username FROM instagram_actions a
        WHERE a.user_id = ?
          AND a.my_profile = ?
          AND a.type IN ('like', 'reply', 'follow')
          AND datetime(a.action_date) >= datetime(?)
          AND datetime(a.action_date) <= COALESCE(datetime(?), datetime('now'))
          AND a.username IS NOT NULL
      )
  `);
  const engagementBack = db.prepare(`
    SELECT COUNT(*) AS n FROM instagram_actions r
    WHERE r.user_id = ?
      AND r.type LIKE 'received_%'
      AND datetime(r.action_date) >= datetime(?)
      AND r.username IN (
        SELECT DISTINCT a.username FROM instagram_actions a
        WHERE a.user_id = ?
          AND a.my_profile = ?
          AND a.type IN ('like', 'reply', 'follow')
          AND datetime(a.action_date) >= datetime(?)
          AND datetime(a.action_date) <= COALESCE(datetime(?), datetime('now'))
          AND a.username IS NOT NULL
      )
  `);
  for (const c of rows) {
    // Use started_at if set, otherwise created_at as the attribution window.
    const since = c.started_at || c.created_at || new Date().toISOString();
    const until = c.ended_at || null;  // null = COALESCE to now (still running)
    const acct = c.as_account || '';
    const fb = followersBack.get(uid, since, uid, acct, since, until);
    const eb = engagementBack.get(uid, since, uid, acct, since, until);
    c.followers_back = fb?.n || 0;
    c.engagement_back = eb?.n || 0;
  }

  // Paginated response shape: rows + total + has_more flag for the UI.
  // Kept rows at the top level too for any old client that ignores the
  // new envelope keys, though the frontend already reads .rows now.
  res.json({
    rows,
    total,
    limit,
    offset,
    has_more: offset + rows.length < total,
  });
});

// Add a single item to an existing campaign (draft or pending/running).
// Enforces the per-campaign 20-item cap.
router.post('/action-campaigns/:id/items', authenticateFlexible, (req, res) => {
  const uid = targetUser(req);
  const cid = req.params.id;
  const campaign = db.prepare('SELECT * FROM instagram_action_campaigns WHERE id = ? AND user_id = ?').get(cid, uid);
  if (!campaign) return res.status(404).json({ error: 'not found' });
  if (campaign.status === 'completed' || campaign.status === 'cancelled') {
    return res.status(400).json({ error: 'Cannot add items to a completed or cancelled campaign.' });
  }
  const current = db.prepare('SELECT COUNT(*) AS n FROM instagram_action_queue WHERE campaign_id = ?').get(cid);
  if ((current?.n || 0) >= 20) return res.status(400).json({ error: 'Campaign already has 20 items (max).' });

  const { post_url, action_type, count, reply_source, reply_texts, as_account } = req.body || {};
  if (!post_url) return res.status(400).json({ error: 'post_url required' });
  // Campaign-level as_account is the source of truth. Fall back to existing
  // items (for legacy campaigns without the column) and finally the body.
  const existing = db.prepare('SELECT as_account FROM instagram_action_queue WHERE campaign_id = ? LIMIT 1').get(cid);
  const acct = campaign.as_account
    || existing?.as_account
    || (as_account && String(as_account).trim().replace(/^@/, '').toLowerCase());
  if (!acct) return res.status(400).json({ error: 'as_account required for the first item' });

  const at = action_type === 'reply' ? 'reply' : 'like';
  const cnt = Math.max(1, parseInt(count, 10) || 1);
  const itemId = uuidv4();
  db.prepare(`
    INSERT INTO instagram_action_queue
      (id, campaign_id, user_id, as_account, post_url, action_type, count_requested, reply_source, reply_texts)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    itemId, cid, uid, acct, String(post_url),
    at, cnt,
    at === 'reply' ? (reply_source || 'default') : null,
    at === 'reply' && Array.isArray(reply_texts) ? JSON.stringify(reply_texts) : null
  );

  // Refresh campaign totals
  const stats = db.prepare(`
    SELECT SUM(count_requested) AS req FROM instagram_action_queue WHERE campaign_id = ?
  `).get(cid);
  db.prepare('UPDATE instagram_action_campaigns SET total_requested = ? WHERE id = ?').run(stats?.req || 0, cid);

  res.json(db.prepare('SELECT * FROM instagram_action_queue WHERE id = ?').get(itemId));
});

// Edit an item (only allowed while it's still pending — once
// claimed/running/completed, edits are rejected). Accepts any subset of:
//   count_requested, post_url, action_type, reply_source, reply_texts
// so the user can fix a typo in a URL, swap a reply source from default to
// custom, etc. without having to recreate the batch.
router.patch('/action-campaigns/:id/items/:itemId', authenticateFlexible, (req, res) => {
  const uid = targetUser(req);
  const item = db.prepare(`
    SELECT * FROM instagram_action_queue
    WHERE id = ? AND campaign_id = ? AND user_id = ?
  `).get(req.params.itemId, req.params.id, uid);
  if (!item) return res.status(404).json({ error: 'item not found' });
  if (item.status !== 'pending') {
    return res.status(400).json({ error: `Cannot edit item with status '${item.status}'.` });
  }

  // Build the UPDATE dynamically from whichever fields the client sent.
  const sets = [];
  const params = [];
  const { count_requested, post_url, action_type, reply_source, reply_texts } = req.body || {};
  if (count_requested !== undefined) {
    sets.push('count_requested = ?');
    params.push(Math.max(1, parseInt(count_requested, 10) || 1));
  }
  if (typeof post_url === 'string' && post_url.trim()) {
    sets.push('post_url = ?');
    params.push(post_url.trim());
  }
  if (action_type === 'like' || action_type === 'reply') {
    sets.push('action_type = ?');
    params.push(action_type);
  }
  if (reply_source === 'default' || reply_source === 'custom' || reply_source === 'ai') {
    sets.push('reply_source = ?');
    params.push(reply_source);
  } else if (reply_source === null) {
    sets.push('reply_source = NULL');
  }
  if (Array.isArray(reply_texts)) {
    sets.push('reply_texts = ?');
    params.push(JSON.stringify(reply_texts));
  } else if (reply_texts === null) {
    sets.push('reply_texts = NULL');
  }
  if (sets.length === 0) {
    return res.status(400).json({ error: 'No editable fields supplied.' });
  }
  params.push(item.id);
  db.prepare(`UPDATE instagram_action_queue SET ${sets.join(', ')} WHERE id = ?`).run(...params);

  // Refresh campaign-level total_requested only if count changed.
  if (count_requested !== undefined) {
    const stats = db.prepare(`
      SELECT SUM(count_requested) AS req FROM instagram_action_queue WHERE campaign_id = ?
    `).get(req.params.id);
    db.prepare('UPDATE instagram_action_campaigns SET total_requested = ? WHERE id = ?').run(stats?.req || 0, req.params.id);
  }

  res.json({ ok: true });
});

// Remove an item (only if it's pending).
router.delete('/action-campaigns/:id/items/:itemId', authenticateFlexible, (req, res) => {
  const uid = targetUser(req);
  const item = db.prepare(`
    SELECT * FROM instagram_action_queue
    WHERE id = ? AND campaign_id = ? AND user_id = ?
  `).get(req.params.itemId, req.params.id, uid);
  if (!item) return res.status(404).json({ error: 'item not found' });
  if (item.status !== 'pending') {
    return res.status(400).json({ error: `Cannot remove item with status '${item.status}'.` });
  }
  db.prepare('DELETE FROM instagram_action_queue WHERE id = ?').run(item.id);

  const stats = db.prepare(`
    SELECT SUM(count_requested) AS req FROM instagram_action_queue WHERE campaign_id = ?
  `).get(req.params.id);
  db.prepare('UPDATE instagram_action_campaigns SET total_requested = ? WHERE id = ?').run(stats?.req || 0, req.params.id);

  res.json({ ok: true });
});

// Patch editable campaign fields (start_at, name, concurrency) — useful when
// the user wants to schedule the campaign for a future time after creating it
// or rename it. Allowed in any status except completed/cancelled.
router.patch('/action-campaigns/:id', authenticateFlexible, (req, res) => {
  const uid = targetUser(req);
  const campaign = db.prepare('SELECT * FROM instagram_action_campaigns WHERE id = ? AND user_id = ?').get(req.params.id, uid);
  if (!campaign) return res.status(404).json({ error: 'not found' });
  if (campaign.status === 'completed' || campaign.status === 'cancelled') {
    return res.status(400).json({ error: `Cannot edit a ${campaign.status} campaign.` });
  }
  const { start_at, name, concurrency } = req.body || {};
  const fields = [];
  const params = [];
  if (start_at !== undefined) { fields.push('start_at = ?'); params.push(start_at || null); }
  if (name !== undefined) { fields.push('name = ?'); params.push(String(name).slice(0, 200) || null); }
  if (concurrency !== undefined) {
    const c = Math.max(1, Math.min(6, parseInt(concurrency, 10) || 6));
    fields.push('concurrency = ?'); params.push(c);
  }
  if (fields.length === 0) return res.json({ ok: true });
  params.push(req.params.id);
  db.prepare(`UPDATE instagram_action_campaigns SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  res.json({ ok: true });
});

// Send a draft campaign — transitions to 'pending' so the extension picks it
// up on its next poll cycle. Refuses if the campaign has no items.
router.post('/action-campaigns/:id/send', authenticateFlexible, (req, res) => {
  const uid = targetUser(req);
  const campaign = db.prepare('SELECT * FROM instagram_action_campaigns WHERE id = ? AND user_id = ?').get(req.params.id, uid);
  if (!campaign) return res.status(404).json({ error: 'not found' });
  if (campaign.status !== 'draft') return res.status(400).json({ error: `Campaign is not a draft (status=${campaign.status}).` });
  const items = db.prepare('SELECT COUNT(*) AS n FROM instagram_action_queue WHERE campaign_id = ?').get(req.params.id);
  if ((items?.n || 0) === 0) return res.status(400).json({ error: 'Cannot send a campaign with no items.' });
  db.prepare(`UPDATE instagram_action_campaigns SET status = 'pending' WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

// Delete a campaign + its items entirely. Allowed in any status.
router.delete('/action-campaigns/:id', authenticateFlexible, (req, res) => {
  const uid = targetUser(req);
  const r = db.prepare('DELETE FROM instagram_action_campaigns WHERE id = ? AND user_id = ?').run(req.params.id, uid);
  if (r.changes === 0) return res.status(404).json({ error: 'not found' });
  db.prepare('DELETE FROM instagram_action_queue WHERE campaign_id = ? AND user_id = ?').run(req.params.id, uid);
  res.json({ ok: true });
});

// Duplicate a campaign into a fresh draft. Copies as_account, concurrency,
// and every queue item (post_url, action_type, count_requested, reply_source,
// reply_texts) — but with new UUIDs and reset execution state so the user
// can re-run the same plan or tweak it before sending.
router.post('/action-campaigns/:id/duplicate', authenticateFlexible, (req, res) => {
  const uid = targetUser(req);
  const src = db.prepare('SELECT * FROM instagram_action_campaigns WHERE id = ? AND user_id = ?').get(req.params.id, uid);
  if (!src) return res.status(404).json({ error: 'not found' });
  const items = db.prepare('SELECT * FROM instagram_action_queue WHERE campaign_id = ? AND user_id = ?').all(req.params.id, uid);

  const newId = uuidv4();
  // Append " (copy)" to the name, but if it already ends with that and a
  // number, increment. e.g. "Foo" → "Foo (copy)" → "Foo (copy 2)" → "Foo (copy 3)".
  const baseName = (src.name || `Batch ${src.id.slice(0, 8)}`).replace(/\s+\(copy(?:\s+\d+)?\)\s*$/i, '');
  const existing = db.prepare(
    `SELECT name FROM instagram_action_campaigns WHERE user_id = ? AND name LIKE ?`
  ).all(uid, `${baseName}%`).map(r => r.name);
  let suffix = ' (copy)';
  let n = 2;
  while (existing.includes(baseName + suffix)) {
    suffix = ` (copy ${n})`;
    n++;
  }
  const newName = baseName + suffix;

  db.prepare(`
    INSERT INTO instagram_action_campaigns
      (id, user_id, name, as_account, status, total_requested, concurrency, start_at)
    VALUES (?, ?, ?, ?, 'draft', 0, ?, NULL)
  `).run(newId, uid, newName, src.as_account, src.concurrency || 6);

  // Copy items with fresh UUIDs and reset execution state.
  const insertItem = db.prepare(`
    INSERT INTO instagram_action_queue
      (id, campaign_id, user_id, as_account, post_url, action_type, count_requested, reply_source, reply_texts)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  let total = 0;
  for (const it of items) {
    total += it.count_requested || 0;
    insertItem.run(
      uuidv4(), newId, uid, it.as_account || src.as_account,
      it.post_url, it.action_type, it.count_requested,
      it.reply_source, it.reply_texts
    );
  }
  db.prepare('UPDATE instagram_action_campaigns SET total_requested = ? WHERE id = ?').run(total, newId);

  res.json(db.prepare('SELECT * FROM instagram_action_campaigns WHERE id = ?').get(newId));
});

// Monday: campaign detail + per-action breakdown
router.get('/action-campaigns/:id', authenticateFlexible, (req, res) => {
  const uid = targetUser(req);
  const campaign = db.prepare(`
    SELECT * FROM instagram_action_campaigns WHERE id = ? AND user_id = ?
  `).get(req.params.id, uid);
  if (!campaign) return res.status(404).json({ error: 'not found' });
  const items = db.prepare(`
    SELECT * FROM instagram_action_queue
    WHERE campaign_id = ? ORDER BY created_at ASC
  `).all(req.params.id);

  // Reconcile each item's count_done against actual instagram_actions.
  // Stored count_done only updates at the script's final DONE — if the
  // watchdog kills the tab first, it stays 0 even though likes happened.
  //
  // Robust match: actions by the item's account, on the item's post URL,
  // of the matching type, during the item's run window. Works for ALL
  // extension versions (doesn't depend on parent_queue_id linkage).
  const liveCount = db.prepare(`
    SELECT COUNT(*) AS n FROM instagram_actions a
    WHERE a.user_id = ?
      AND a.my_profile = ?
      AND a.post_url = ?
      AND a.type = ?
      AND (? IS NULL OR datetime(a.action_date) >= datetime(?))
      AND (? IS NULL OR datetime(a.action_date) <= datetime(?))
  `);
  let totalLive = 0;
  for (const it of items) {
    const since = it.claimed_at || it.started_at || null;
    const until = it.completed_at || null;
    const live = liveCount.get(
      uid, it.as_account || '', it.post_url, it.action_type,
      since, since, until, until
    )?.n || 0;
    it.count_done_stored = it.count_done;
    it.count_done = Math.max(it.count_done || 0, live);
    totalLive += it.count_done;
  }
  if (totalLive > (campaign.total_completed || 0)) {
    campaign.total_completed_stored = campaign.total_completed;
    campaign.total_completed = totalLive;
  }

  res.json({ campaign, items });
});

// Monday: cancel campaign — pending items get skipped; in-flight ones finish
router.post('/action-campaigns/:id/cancel', authenticateFlexible, (req, res) => {
  const uid = targetUser(req);
  db.prepare(`
    UPDATE instagram_action_campaigns
    SET status = 'cancelled', ended_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ?
  `).run(req.params.id, uid);
  db.prepare(`
    UPDATE instagram_action_queue
    SET status = 'cancelled'
    WHERE campaign_id = ? AND status = 'pending'
  `).run(req.params.id);
  res.json({ ok: true });
});

// Monday: pause a running/pending campaign. In-flight items (claimed/
// running queue rows) keep running to completion — pausing only stops
// NEW items from being claimed by the extension. The user can resume
// later to continue the remaining pending items where the batch left off.
router.post('/action-campaigns/:id/pause', authenticateFlexible, (req, res) => {
  const uid = targetUser(req);
  db.prepare(`
    UPDATE instagram_action_campaigns
    SET status = 'paused'
    WHERE id = ? AND user_id = ? AND status IN ('pending', 'running')
  `).run(req.params.id, uid);
  // Also flip pending queue items to 'paused' so /pending-accounts
  // doesn't pick them up. Items already 'claimed' or 'running' keep
  // running until they naturally finish (then they're terminal anyway).
  db.prepare(`
    UPDATE instagram_action_queue
    SET status = 'paused'
    WHERE campaign_id = ? AND status = 'pending'
  `).run(req.params.id);
  res.json({ ok: true });
});

// Monday: resume paused campaign
router.post('/action-campaigns/:id/resume', authenticateFlexible, (req, res) => {
  const uid = targetUser(req);
  db.prepare(`
    UPDATE instagram_action_campaigns
    SET status = 'pending', consecutive_failures = 0, error_message = NULL
    WHERE id = ? AND user_id = ? AND status IN ('paused', 'failed')
  `).run(req.params.id, uid);
  // Flip the items that were paused back to pending so they can be
  // claimed by the extension on the next poll cycle.
  db.prepare(`
    UPDATE instagram_action_queue
    SET status = 'pending'
    WHERE campaign_id = ? AND status = 'paused'
  `).run(req.params.id);
  res.json({ ok: true });
});

// Extension: list IG accounts that have pending action-queue items for this user.
// Lets the extension know which accounts it should consider switching to.
router.get('/action-queue/pending-accounts', authenticateFlexible, (req, res) => {
  const uid = targetUser(req);
  // Sweep stale claimed/running rows before listing pending accounts. If a
  // previous Chrome tab crashed or the user closed it, the row would sit in
  // `claimed`/`running` forever and the rest of the batch would stall.
  // Heartbeat-based stale-claim sweep. The extension PATCHes the queue
  // item every ~60s with heartbeat=true while the script is actively
  // running (comment loader, likes loop, anything). This UPDATE marks
  // an item as abandoned ONLY when 5+ minutes have passed since the
  // last heartbeat — meaning the extension truly has stopped reporting.
  //
  // Why heartbeat instead of "time since claimed":
  //   • A 5-hour batch with a healthy script NEVER gets touched (every
  //     heartbeat resets the clock).
  //   • A force-killed extension (Chrome crashed, laptop slept, the
  //     user uninstalled mid-run) goes silent and gets swept in 5 min.
  //   • No arbitrary upper bound on how long a batch can run.
  //
  // Legacy rows that pre-date the last_heartbeat_at column have NULL —
  // fall back to claimed_at with a generous 60-min window so they
  // aren't immediately swept just because they were already in flight
  // before this migration shipped.
  db.prepare(`
    UPDATE instagram_action_queue
    SET status = 'failed',
        error_message = COALESCE(error_message, 'Abandoned: extension never reported completion (stale claim).'),
        completed_at = CURRENT_TIMESTAMP
    WHERE user_id = ? AND status IN ('claimed', 'running')
      AND (
        (last_heartbeat_at IS NOT NULL
          AND datetime(last_heartbeat_at) < datetime('now', '-5 minutes'))
        OR
        (last_heartbeat_at IS NULL
          AND datetime(COALESCE(claimed_at, started_at, created_at)) < datetime('now', '-60 minutes'))
      )
  `).run(uid);

  // After sweeping items, any parent campaign whose queue is fully terminal
  // (no pending/claimed/running left) should transition out of 'running'
  // so the UI stops showing it as live. Without this, a sweep just leaves
  // dangling 'running' campaigns with all-failed items.
  db.prepare(`
    UPDATE instagram_action_campaigns
    SET status = 'completed',
        ended_at = COALESCE(ended_at, CURRENT_TIMESTAMP)
    WHERE user_id = ?
      AND status IN ('pending', 'running')
      AND NOT EXISTS (
        SELECT 1 FROM instagram_action_queue q
        WHERE q.campaign_id = instagram_action_campaigns.id
          AND q.status IN ('pending', 'claimed', 'running')
      )
      AND EXISTS (
        SELECT 1 FROM instagram_action_queue q
        WHERE q.campaign_id = instagram_action_campaigns.id
      )
  `).run(uid);

  // Order accounts by the created_at of their oldest eligible pending
  // campaign — strict FIFO across accounts. If @A's oldest campaign was
  // created before @B's oldest, the extension switches to @A first.
  const rows = db.prepare(`
    SELECT q.as_account, MIN(c.created_at) AS oldest_campaign
    FROM instagram_action_queue q
    JOIN instagram_action_campaigns c ON c.id = q.campaign_id
    WHERE q.user_id = ?
      AND q.status = 'pending'
      AND c.status IN ('pending', 'running')
      AND (c.start_at IS NULL OR datetime(c.start_at) <= datetime('now'))
    GROUP BY q.as_account
    ORDER BY oldest_campaign ASC
  `).all(uid);
  res.json(rows.map(r => r.as_account));
});

// Extension: claim the next batch of pending actions for a given account.
// Atomically transitions up to N rows from 'pending' to 'claimed' and returns
// them so the background can dispatch them across multiple tabs.
router.get('/action-queue/pending', authenticateFlexible, (req, res) => {
  const uid = targetUser(req);
  const acct = String(req.query.as_account || '').trim().replace(/^@/, '').toLowerCase();
  const limit = Math.max(1, Math.min(6, parseInt(req.query.limit, 10) || 1));
  if (!acct) return res.status(400).json({ error: 'as_account required' });

  // Find the oldest eligible campaign for this user+account combo so we don't
  // interleave campaigns. We pick at most `limit` items, all from the same
  // campaign, and atomically claim them.
  const campaign = db.prepare(`
    SELECT c.* FROM instagram_action_campaigns c
    WHERE c.user_id = ?
      AND c.status IN ('pending', 'running')
      AND (c.start_at IS NULL OR datetime(c.start_at) <= datetime('now'))
      AND EXISTS (
        SELECT 1 FROM instagram_action_queue q
        WHERE q.campaign_id = c.id
          AND q.user_id = c.user_id
          AND q.as_account = ?
          AND q.status = 'pending'
      )
    ORDER BY c.created_at ASC LIMIT 1
  `).get(uid, acct);

  if (!campaign) return res.json({ campaign: null, items: [] });

  // Mark campaign as running if it wasn't already
  if (campaign.status === 'pending') {
    db.prepare(`
      UPDATE instagram_action_campaigns
      SET status = 'running', started_at = COALESCE(started_at, CURRENT_TIMESTAMP)
      WHERE id = ? AND status = 'pending'
    `).run(campaign.id);
  }

  // Claim up to `limit` rows one-by-one (atomic via the WHERE status='pending').
  // The shared db wrapper doesn't expose transactions, so we just loop.
  const claimed = [];
  for (let i = 0; i < limit; i++) {
    const row = db.prepare(`
      SELECT id FROM instagram_action_queue
      WHERE campaign_id = ? AND user_id = ? AND as_account = ? AND status = 'pending'
      ORDER BY created_at ASC LIMIT 1
    `).get(campaign.id, uid, acct);
    if (!row) break;
    const claim = db.prepare(`
      UPDATE instagram_action_queue
      SET status = 'claimed', claimed_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'pending'
    `).run(row.id);
    if (claim.changes > 0) {
      claimed.push(db.prepare('SELECT * FROM instagram_action_queue WHERE id = ?').get(row.id));
    }
  }
  res.json({ campaign, items: claimed });
});

// Extension: report progress / completion on a queue item.
// Body: { status, count_done, error_message }
router.patch('/action-queue/:id', authenticateFlexible, (req, res) => {
  const uid = targetUser(req);
  const { status, count_done, error_message, heartbeat } = req.body || {};

  // FAST PATH: heartbeat-only ping. The extension hits this every ~60s
  // while actively running an item, so the stale-claim sweep can tell
  // "this tab is still alive" without any other state change. Doesn't
  // require any other field to be set.
  if (heartbeat === true && !status && count_done == null && !error_message) {
    db.prepare(`
      UPDATE instagram_action_queue
      SET last_heartbeat_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ? AND status IN ('claimed', 'running')
    `).run(req.params.id, uid);
    return res.json({ ok: true });
  }
  // Terminal statuses, in order of "how complete was the work":
  //   completed  — count_done met or exceeded count_requested
  //   partial    — content script gave up early (post ran out of targets)
  //                but did some work. count_done > 0 but < count_requested.
  //   no_targets — reached the page but found nothing to act on (0 actions)
  //   failed     — explicit failure (wrong account, post unreachable, etc.)
  //   cancelled  — user pressed Cancel on the batch
  const isTerminal = status === 'completed'
    || status === 'partial'
    || status === 'failed'
    || status === 'cancelled'
    || status === 'no_targets';

  const item = db.prepare('SELECT * FROM instagram_action_queue WHERE id = ? AND user_id = ?').get(req.params.id, uid);
  if (!item) return res.status(404).json({ error: 'not found' });

  db.prepare(`
    UPDATE instagram_action_queue
    SET status = COALESCE(?, status),
        count_done = COALESCE(?, count_done),
        error_message = COALESCE(?, error_message),
        started_at = COALESCE(started_at, CASE WHEN ? = 'running' THEN CURRENT_TIMESTAMP ELSE NULL END),
        last_heartbeat_at = CURRENT_TIMESTAMP,
        completed_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE completed_at END
    WHERE id = ? AND user_id = ?
  `).run(
    status || null,
    Number.isFinite(count_done) ? count_done : null,
    error_message || null,
    status || null,
    isTerminal ? 1 : 0,
    req.params.id, uid
  );

  // Roll up campaign-level counters and consecutive_failures tracking.
  if (isTerminal) {
    const camp = db.prepare('SELECT * FROM instagram_action_campaigns WHERE id = ?').get(item.campaign_id);
    if (camp) {
      const stats = db.prepare(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
          SUM(CASE WHEN status IN ('pending', 'claimed', 'running') THEN 1 ELSE 0 END) AS remaining
        FROM instagram_action_queue WHERE campaign_id = ?
      `).get(camp.id);
      const totalCompletedCount = Number.isFinite(count_done) ? count_done : 0;
      const newCompleted = (camp.total_completed || 0) + totalCompletedCount;
      const newFails = status === 'failed' ? (camp.consecutive_failures || 0) + 1 : 0;
      let newStatus = camp.status;
      let newEnded = null;
      if (stats.remaining === 0) {
        newStatus = 'completed';
        newEnded = 1;
      } else if (newFails >= 3) {
        newStatus = 'paused';
      }
      db.prepare(`
        UPDATE instagram_action_campaigns
        SET total_completed = ?,
            consecutive_failures = ?,
            status = ?,
            ended_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE ended_at END,
            error_message = CASE WHEN ? = 'paused' THEN '3 consecutive failures — likely rate-limited by Instagram. Resume manually.' ELSE error_message END
        WHERE id = ?
      `).run(newCompleted, newFails, newStatus, newEnded ? 1 : 0, newStatus, camp.id);
    }
  }
  res.json({ ok: true });
});

// ── Retry a failed/partial/no_targets queue item ─────────────────────────────
// Resets the row back to 'pending' so the extension's dispatch loop picks it
// up on its next poll. Use cases:
//   • failed: tab went silent / crashed → retry afresh (count_done reset)
//   • partial: post had enough comments but loader ran out → retry to push
//     toward the full target. IG already remembers the comments we liked
//     before, so the new attempt automatically skips them and only adds
//     incremental likes toward the target.
//   • no_targets: post had nothing eligible at the time → retry to see if
//     IG has surfaced more comments since.
//   • cancelled: user cancelled mid-batch → can be revived via retry.
//   • completed: no-op (don't allow re-running a successful item).
//   • pending/claimed/running: no-op (already in flight).
//
// Also re-opens the parent campaign if it was 'paused' (after 3 consecutive
// failures) or 'completed' (final item finished but user wants to extend).
router.post('/action-queue/:id/retry', authenticateFlexible, (req, res) => {
  const uid = targetUser(req);
  const item = db.prepare('SELECT * FROM instagram_action_queue WHERE id = ? AND user_id = ?').get(req.params.id, uid);
  if (!item) return res.status(404).json({ error: 'not found' });

  const RETRYABLE = ['failed', 'partial', 'no_targets', 'cancelled'];
  if (!RETRYABLE.includes(item.status)) {
    return res.status(400).json({ error: `cannot retry status='${item.status}' (only ${RETRYABLE.join('/')})` });
  }

  // Reset the item — clear all in-flight markers and counters so a fresh
  // attempt starts cleanly. Keep count_requested unchanged.
  db.prepare(`
    UPDATE instagram_action_queue
    SET status = 'pending',
        count_done = 0,
        error_message = NULL,
        claimed_at = NULL,
        started_at = NULL,
        completed_at = NULL,
        last_heartbeat_at = NULL
    WHERE id = ?
  `).run(req.params.id);

  // Re-open the parent campaign if it was paused/completed — there's pending
  // work again. Reset consecutive_failures so the auto-pause-after-3 logic
  // gives the retry a clean window.
  const camp = db.prepare('SELECT * FROM instagram_action_campaigns WHERE id = ?').get(item.campaign_id);
  if (camp && (camp.status === 'paused' || camp.status === 'completed')) {
    db.prepare(`
      UPDATE instagram_action_campaigns
      SET status = 'running',
          ended_at = NULL,
          consecutive_failures = 0,
          error_message = NULL
      WHERE id = ?
    `).run(camp.id);
  }

  res.json({ ok: true });
});

// ── Daily follower count tracking ────────────────────────────────────────────
// Extension scrapes the public profile page of each managed account once a
// day, reads the follower count from the og:description meta tag, and POSTs
// it here. Monday reads the time series back to show trends + day-over-day
// deltas in the Followers tab.

// Extension uploads a single follower count for a profile
router.post('/follower-counts', authenticateFlexible, (req, res) => {
  const uid = targetUser(req);
  const { my_profile, follower_count } = req.body || {};
  if (!my_profile || !Number.isFinite(Number(follower_count))) {
    return res.status(400).json({ error: 'my_profile and follower_count (number) required' });
  }
  const cleaned = String(my_profile).trim().replace(/^@/, '').toLowerCase();
  const id = uuidv4();
  db.prepare(`
    INSERT INTO instagram_follower_counts (id, user_id, my_profile, follower_count)
    VALUES (?, ?, ?, ?)
  `).run(id, uid, cleaned, Math.round(Number(follower_count)));
  res.json({ id });
});

// Monday reads the time series. Supports:
//   ?my_profile=X     — filter to a single profile (otherwise: all profiles)
//   ?aggregate=day|month — bucket by day or month; default = day
//   ?limit=N          — how many buckets to return; default = 60
router.get('/follower-counts', authenticateFlexible, (req, res) => {
  const uid = targetUser(req);
  const aggregate = req.query.aggregate === 'month' ? 'month' : 'day';
  const limit = Math.max(1, Math.min(365, parseInt(req.query.limit, 10) || 60));
  const profileFilter = req.query.my_profile
    ? String(req.query.my_profile).trim().replace(/^@/, '').toLowerCase()
    : null;

  // SQLite strftime: %Y-%m-%d for day, %Y-%m for month. Use the LATEST count
  // in each bucket so multiple scrapes per day collapse to the most recent.
  const bucketExpr = aggregate === 'month'
    ? `strftime('%Y-%m', captured_at)`
    : `strftime('%Y-%m-%d', captured_at)`;

  // Per (profile, bucket) take the latest follower_count.
  const rows = db.prepare(`
    SELECT my_profile,
           ${bucketExpr} AS bucket,
           follower_count
    FROM (
      SELECT my_profile, captured_at, follower_count,
             ROW_NUMBER() OVER (
               PARTITION BY my_profile, ${bucketExpr}
               ORDER BY captured_at DESC
             ) AS rn
      FROM instagram_follower_counts
      WHERE user_id = ?
        ${profileFilter ? 'AND my_profile = ?' : ''}
    )
    WHERE rn = 1
    ORDER BY my_profile ASC, bucket DESC
    LIMIT ?
  `).all(...(profileFilter ? [uid, profileFilter, limit] : [uid, limit]));

  // Compute delta from previous bucket (same profile) and shape the response.
  // Group by profile so the frontend can show one block per profile.
  const byProfile = {};
  for (const r of rows) {
    (byProfile[r.my_profile] ??= []).push(r);
  }
  const out = Object.entries(byProfile).map(([profile, list]) => {
    // list is currently DESC; reverse to ASC for delta calc
    const asc = [...list].reverse();
    const series = asc.map((row, i) => ({
      bucket: row.bucket,
      follower_count: row.follower_count,
      delta: i === 0 ? null : row.follower_count - asc[i - 1].follower_count,
    }));
    // Return DESC for display
    return { my_profile: profile, points: series.reverse() };
  });
  // Sort profiles by latest count desc for stable display
  out.sort((a, b) => (b.points[0]?.follower_count || 0) - (a.points[0]?.follower_count || 0));
  res.json(out);
});

// Monday calls this to force the extension to scrape follower counts on its
// next 2-minute poll, instead of waiting for the daily cycle.
router.post('/follower-counts/trigger', authenticateFlexible, (req, res) => {
  const uid = targetUser(req);
  db.prepare('UPDATE users SET instagram_follower_trigger_at = CURRENT_TIMESTAMP WHERE id = ?').run(uid);
  res.json({ ok: true });
});

// Extension polls this on every alarm tick. If a trigger is pending, returns
// should_run=true AND atomically clears the flag so we don't run twice.
router.get('/follower-counts/should-trigger', authenticateFlexible, (req, res) => {
  const uid = targetUser(req);
  const row = db.prepare('SELECT instagram_follower_trigger_at FROM users WHERE id = ?').get(uid);
  if (!row?.instagram_follower_trigger_at) return res.json({ should_run: false });
  const result = db.prepare(`
    UPDATE users SET instagram_follower_trigger_at = NULL
    WHERE id = ? AND instagram_follower_trigger_at IS NOT NULL
  `).run(uid);
  res.json({ should_run: result.changes > 0 });
});

// ── AI caption generator (Groq) ──────────────────────────────────────────────
// Uses Groq's vision model when the user uploaded an image so the caption is
// actually about the picture. For video uploads we fall back to a text-only
// model (Groq doesn't accept raw video) and rely on the topic/comments the
// user typed. Requires GROQ_API_KEY in backend/.env.
const fetchFn = (typeof fetch === 'function') ? fetch : require('node-fetch');
router.post('/ai-caption', authenticateFlexible, async (req, res) => {
  // Prefer the user's configured Groq key (from /api/ai/providers); fall
  // back to the server-wide env var for back-compat / single-user setups.
  const userRow = db.prepare(
    "SELECT api_key FROM user_ai_providers WHERE user_id = ? AND provider = 'groq'"
  ).get(req.user.id);
  const apiKey = userRow?.api_key || process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'No Groq API key configured. Add one in Settings → AI providers, or set GROQ_API_KEY in backend/.env.' });

  const { topic, tone, include_hashtags, comments, image_b64, mime_type } = req.body || {};
  const isImage = !!(mime_type && /^image\//i.test(mime_type) && image_b64);
  // Groq vision model — check https://console.groq.com/docs/models for current.
  // Llama 4 Scout is the current vision-capable model after the 3.2-vision
  // family was decommissioned.
  const model = isImage ? 'meta-llama/llama-4-scout-17b-16e-instruct' : 'llama-3.1-8b-instant';

  let prompt = `Write a short, engaging Instagram caption${isImage ? ' for this image' : ''}.`;
  if (topic) prompt += ` Topic: "${String(topic).slice(0, 500)}".`;
  if (tone) prompt += ` Tone: ${tone}.`;
  if (comments) prompt += ` Additional notes from the user: "${String(comments).slice(0, 500)}".`;
  prompt += include_hashtags
    ? ' Include 3–5 relevant hashtags at the end.'
    : ' Do not include any hashtags.';
  prompt += ' Keep the whole caption under 220 characters. Return only the caption text — no quotes, no preamble.';

  const messages = isImage
    ? [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${mime_type};base64,${image_b64}` } },
        ],
      }]
    : [{ role: 'user', content: prompt }];

  try {
    const r = await fetchFn('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model, max_tokens: 250, messages }),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      return res.status(502).json({ error: `Groq HTTP ${r.status}: ${text.slice(0, 300)}` });
    }
    const data = await r.json();
    const caption = String(data?.choices?.[0]?.message?.content || '').trim();
    if (!caption) return res.status(502).json({ error: 'Groq returned an empty caption.' });
    res.json({ caption, used_vision: isImage });
  } catch (e) {
    res.status(502).json({ error: e?.message || 'Groq fetch failed' });
  }
});

// ── Extension tab visibility per user ────────────────────────────────────────
// Permissions live in users.permissions (the existing JSON column managed
// from the admin User Management page) using nested dotted keys:
//   marketing                            → enables the Marketing module
//   marketing.instagram                  → enables Instagram inside Marketing
//   marketing.instagram.engagement       → per-tab visibility (and so on)
// Absent keys default to "enabled" — only an explicit `false` disables.
// Elevated roles (super_admin / admin) always see everything.
const VALID_EXT_TABS = ['engagement', 'messaging', 'insights', 'accounts', 'schedule', 'sync', 'pages'];

router.get('/extension/permissions', authenticateFlexible, (req, res) => {
  const uid = req.user.id;
  const row = db.prepare('SELECT permissions, role FROM users WHERE id = ?').get(uid);
  // Elevated users always see every tab
  if (row?.role === 'super_admin' || row?.role === 'admin') {
    return res.json({ allowed_tabs: null });
  }
  let perms = {};
  try { perms = JSON.parse(row?.permissions || '{}'); } catch (_) {}
  // Marketing or Instagram module disabled → no popup tabs visible
  if (perms.marketing === false || perms['marketing.instagram'] === false) {
    return res.json({ allowed_tabs: [] });
  }
  // Per-tab: only explicit `false` hides a tab. Absent = visible.
  const allowed = VALID_EXT_TABS.filter(t => perms[`marketing.instagram.${t}`] !== false);
  // If everything's allowed, return null so the popup keeps its "show all" path
  res.json({ allowed_tabs: allowed.length === VALID_EXT_TABS.length ? null : allowed });
});

// ── System health / QA dashboard ─────────────────────────────────────────────
// Per-user health summary — aggregates status indicators for every
// Instagram-side feature so the user can spot regressions and stuck schedules
// at a glance. Each block returns the current counts + a derived `status`
// (ok / late / failing / unknown) the UI uses to pick a color. Read-only.
router.get('/admin/health', authenticateFlexible, (req, res) => {
  const uid = req.user.id;

  // ── Daily follower counts ──────────────────────────────────────────────
  const fcLast = db.prepare(`
    SELECT MAX(captured_at) AS last_at,
           (SELECT COUNT(DISTINCT my_profile) FROM instagram_follower_counts WHERE user_id = ?) AS profiles_tracked
    FROM instagram_follower_counts WHERE user_id = ?
  `).get(uid, uid);
  const fcAgeMs = fcLast?.last_at ? (Date.now() - new Date(fcLast.last_at).getTime()) : null;
  const followerCounts = {
    last_capture_at: fcLast?.last_at || null,
    profiles_tracked: fcLast?.profiles_tracked || 0,
    status: !fcLast?.last_at ? 'unknown'
          : fcAgeMs < 26 * 3600 * 1000 ? 'ok'
          : fcAgeMs < 72 * 3600 * 1000 ? 'late'
          : 'failing',
  };

  // ── Scheduled posts ─────────────────────────────────────────────────────
  const spByStatus = db.prepare(`
    SELECT status, COUNT(*) AS n FROM instagram_scheduled_posts
    WHERE user_id = ? GROUP BY status
  `).all(uid);
  const spOverdue = db.prepare(`
    SELECT COUNT(*) AS n FROM instagram_scheduled_posts
    WHERE user_id = ? AND status IN ('scheduled', 'claimed')
      AND datetime(scheduled_at) < datetime('now', '-15 minutes')
  `).get(uid)?.n || 0;
  const scheduledPosts = {
    by_status: Object.fromEntries(spByStatus.map(r => [r.status, r.n])),
    overdue: spOverdue,
    status: spOverdue > 0 ? 'late'
          : (spByStatus.find(r => r.status === 'failed')?.n || 0) > 0 ? 'failing'
          : 'ok',
  };

  // ── Action batches (formerly Campaigns) ────────────────────────────────
  const abByStatus = db.prepare(`
    SELECT status, COUNT(*) AS n FROM instagram_action_campaigns
    WHERE user_id = ? GROUP BY status
  `).all(uid);
  const abStalledRunning = db.prepare(`
    SELECT COUNT(*) AS n FROM instagram_action_campaigns
    WHERE user_id = ? AND status = 'running'
      AND datetime(started_at) < datetime('now', '-1 hour')
  `).get(uid)?.n || 0;
  const actionBatches = {
    by_status: Object.fromEntries(abByStatus.map(r => [r.status, r.n])),
    stalled_running: abStalledRunning,
    status: abStalledRunning > 0 ? 'late'
          : (abByStatus.find(r => r.status === 'paused')?.n || 0) > 0 ? 'failing'
          : 'ok',
  };

  // ── Scrape jobs ────────────────────────────────────────────────────────
  const sjByStatus = db.prepare(`
    SELECT status, COUNT(*) AS n FROM instagram_scrape_jobs
    WHERE user_id = ? GROUP BY status
  `).all(uid);
  const sjStalledRunning = db.prepare(`
    SELECT COUNT(*) AS n FROM instagram_scrape_jobs
    WHERE user_id = ? AND status = 'running'
      AND datetime(started_at) < datetime('now', '-15 minutes')
  `).get(uid)?.n || 0;
  const scrapeJobs = {
    by_status: Object.fromEntries(sjByStatus.map(r => [r.status, r.n])),
    stalled_running: sjStalledRunning,
    status: sjStalledRunning > 0 ? 'late'
          : (sjByStatus.find(r => r.status === 'failed')?.n || 0) > 0 ? 'failing'
          : 'ok',
  };

  // ── Extension activity (proxy: how recent any action was logged) ───────
  const extLastAction = db.prepare(`
    SELECT MAX(created_at) AS last_at FROM instagram_actions WHERE user_id = ?
  `).get(uid)?.last_at;
  const ext24h = db.prepare(`
    SELECT COUNT(*) AS n FROM instagram_actions
    WHERE user_id = ? AND datetime(created_at) >= datetime('now', '-1 day')
  `).get(uid)?.n || 0;
  const extAgeMs = extLastAction ? (Date.now() - new Date(extLastAction).getTime()) : null;
  const extensionActivity = {
    last_action_at: extLastAction || null,
    actions_last_24h: ext24h,
    status: !extLastAction ? 'unknown'
          : extAgeMs < 24 * 3600 * 1000 ? 'ok'
          : extAgeMs < 7 * 24 * 3600 * 1000 ? 'late'
          : 'failing',
  };

  // ── This user's own permissions ────────────────────────────────────────
  // Read the current user's permissions JSON and surface which Instagram
  // extension tabs they're allowed to see.
  const userRow = db.prepare('SELECT permissions, role FROM users WHERE id = ?').get(uid);
  let userPerms = {};
  try { userPerms = JSON.parse(userRow?.permissions || '{}'); } catch (_) {}
  const isElevated = userRow?.role === 'super_admin' || userRow?.role === 'admin';
  const igTabs = ['engagement', 'messaging', 'insights', 'accounts', 'schedule', 'sync', 'pages'];
  const tabsAllowed = isElevated
    ? igTabs.length
    : (userPerms.marketing === false || userPerms['marketing.instagram'] === false)
      ? 1 // only Sync
      : igTabs.filter(t => userPerms[`marketing.instagram.${t}`] !== false).length;
  const permissions = {
    role: userRow?.role || 'user',
    tabs_allowed: tabsAllowed,
    total_tabs: igTabs.length,
    status: 'ok',
  };

  // ── IG accounts configured ─────────────────────────────────────────────
  const acctRow = db.prepare('SELECT instagram_accounts FROM users WHERE id = ?').get(uid);
  let accountsCount = 0;
  try { accountsCount = JSON.parse(acctRow?.instagram_accounts || '[]').length; } catch (_) {}
  const accounts = {
    count: accountsCount,
    status: accountsCount > 0 ? 'ok' : 'unknown',
  };

  // ── Automations ────────────────────────────────────────────────────────
  // Total + enabled count + last fire status. WARN if there are some
  // automations but none enabled; FAILING if the last fire reported failure.
  const autoStats = db.prepare(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) AS enabled,
           MAX(last_run_at) AS last_run
    FROM instagram_automations WHERE user_id = ?
  `).get(uid) || {};
  let lastStatus = null;
  if (autoStats.last_run) {
    lastStatus = db.prepare(`
      SELECT last_status FROM instagram_automations
      WHERE user_id = ? AND last_run_at = ?
      LIMIT 1
    `).get(uid, autoStats.last_run)?.last_status || null;
  }
  const automations = {
    total: autoStats.total || 0,
    enabled: autoStats.enabled || 0,
    last_run_at: autoStats.last_run || null,
    last_status: lastStatus,
    status: !autoStats.total
      ? 'unknown'
      : lastStatus === 'failed'
        ? 'failing'
        : (autoStats.enabled === 0)
          ? 'late'
          : 'ok',
  };

  res.json({
    generated_at: new Date().toISOString(),
    follower_counts: followerCounts,
    scheduled_posts: scheduledPosts,
    action_batches: actionBatches,
    scrape_jobs: scrapeJobs,
    extension_activity: extensionActivity,
    permissions,
    accounts,
    automations,
  });
});

// ── Automations (board-style recurring jobs) ─────────────────────────────────
// Each automation is a recurring task. Backend computes next_run_at based on
// the schedule definition. Extension polls /automations/due every minute,
// runs the listed actions on the listed accounts, then reports back so the
// backend computes the next next_run_at.

const VALID_ACTIONS = ['follower_count', 'scan_notifications', 'snapshot_followers_full'];
const VALID_SCHEDULE_TYPES = ['daily', 'weekly', 'interval'];

// Compute the next time this automation should run, given the current time.
// Daily: today at schedule_time if future, else tomorrow at schedule_time.
// Weekly: next matching weekday at schedule_time.
// Interval: now + schedule_interval_minutes.
function computeNextRunAt(automation, baseDate = new Date()) {
  const base = new Date(baseDate);
  if (automation.schedule_type === 'interval') {
    const mins = Math.max(1, Number(automation.schedule_interval_minutes) || 60);
    return new Date(base.getTime() + mins * 60 * 1000).toISOString();
  }

  // schedule_time is the user's LOCAL HH:MM. Convert to a UTC minute-of-day
  // using their stored offset so the job fires at the intended local time
  // regardless of the server's own timezone.
  const offsetMin = Number(automation.tz_offset_minutes) || 0; // e.g. +180 for UTC+3
  const [hhRaw, mmRaw] = String(automation.schedule_time || '09:00').split(':').map(n => parseInt(n, 10));
  const localHH = Number.isFinite(hhRaw) ? hhRaw : 9;
  const localMM = Number.isFinite(mmRaw) ? mmRaw : 0;
  // local minute-of-day → UTC minute-of-day
  let utcMinutes = (localHH * 60 + localMM) - offsetMin;
  utcMinutes = ((utcMinutes % 1440) + 1440) % 1440; // normalize 0..1439
  const utcHH = Math.floor(utcMinutes / 60);
  const utcMM = utcMinutes % 60;

  // Build the target using UTC setters (timezone-independent).
  const target = new Date(base);
  target.setUTCHours(utcHH, utcMM, 0, 0);

  if (automation.schedule_type === 'daily') {
    if (target <= base) target.setUTCDate(target.getUTCDate() + 1);
    return target.toISOString();
  }
  if (automation.schedule_type === 'weekly') {
    // schedule_days = comma-separated 0-6 (Sun=0) in the USER's local frame.
    // We approximate by matching against the UTC weekday of the candidate;
    // for offsets within ±12h this is correct on the chosen day in almost
    // all cases (the firing instant lands on the same local day).
    const allowed = String(automation.schedule_days || '')
      .split(',').map(d => parseInt(d.trim(), 10)).filter(d => d >= 0 && d <= 6);
    if (allowed.length === 0) {
      if (target <= base) target.setUTCDate(target.getUTCDate() + 1);
      return target.toISOString();
    }
    for (let i = 0; i < 8; i++) {
      const candidate = new Date(target);
      candidate.setUTCDate(target.getUTCDate() + i);
      // Weekday as seen in the user's local timezone (shift by offset).
      const localDay = new Date(candidate.getTime() + offsetMin * 60 * 1000).getUTCDay();
      if (allowed.includes(localDay) && candidate > base) {
        return candidate.toISOString();
      }
    }
    target.setUTCDate(target.getUTCDate() + 7);
    return target.toISOString();
  }
  return new Date(base.getTime() + 24 * 60 * 60 * 1000).toISOString();
}

function sanitizeAutomationBody(body, isUpdate = false) {
  const out = {};
  if (body.name !== undefined) out.name = String(body.name).slice(0, 200);
  if (body.schedule_type !== undefined) {
    if (!VALID_SCHEDULE_TYPES.includes(body.schedule_type)) {
      throw new Error(`schedule_type must be one of: ${VALID_SCHEDULE_TYPES.join(', ')}`);
    }
    out.schedule_type = body.schedule_type;
  }
  if (body.schedule_time !== undefined) out.schedule_time = body.schedule_time ? String(body.schedule_time).slice(0, 5) : null;
  if (body.schedule_days !== undefined) {
    const arr = Array.isArray(body.schedule_days) ? body.schedule_days : String(body.schedule_days).split(',');
    out.schedule_days = arr.map(d => parseInt(d, 10)).filter(d => d >= 0 && d <= 6).join(',') || null;
  }
  if (body.schedule_interval_minutes !== undefined) {
    out.schedule_interval_minutes = Math.max(1, parseInt(body.schedule_interval_minutes, 10) || 60);
  }
  if (body.actions !== undefined) {
    if (!Array.isArray(body.actions)) throw new Error('actions must be an array');
    const clean = body.actions.filter(a => VALID_ACTIONS.includes(a));
    if (clean.length === 0) throw new Error(`actions must contain at least one of: ${VALID_ACTIONS.join(', ')}`);
    out.actions = JSON.stringify(clean);
  }
  if (body.accounts !== undefined) {
    if (!Array.isArray(body.accounts)) throw new Error('accounts must be an array');
    const clean = body.accounts.map(a => String(a).trim().replace(/^@/, '').toLowerCase()).filter(Boolean);
    out.accounts = JSON.stringify(clean);
  }
  if (body.enabled !== undefined) out.enabled = body.enabled ? 1 : 0;
  if (body.tz_offset_minutes !== undefined) {
    const n = parseInt(body.tz_offset_minutes, 10);
    // Sane bounds: -14h..+14h covers every real timezone.
    out.tz_offset_minutes = (Number.isFinite(n) && n >= -840 && n <= 840) ? n : 0;
  }
  if (!isUpdate) {
    if (!out.name) throw new Error('name required');
    if (!out.schedule_type) throw new Error('schedule_type required');
    if (!out.actions) throw new Error('actions required');
    if (!out.accounts) throw new Error('accounts required');
  }
  return out;
}

function parseAutomationRow(row) {
  if (!row) return null;
  let actions = [], accounts = [];
  try { actions = row.actions ? JSON.parse(row.actions) : []; } catch (_) {}
  try { accounts = row.accounts ? JSON.parse(row.accounts) : []; } catch (_) {}
  return { ...row, actions, accounts, enabled: !!row.enabled, is_system: !!row.is_system, tz_offset_minutes: row.tz_offset_minutes || 0 };
}

// Auto-create the built-in "Daily follower count" automation for each tracked
// IG account that doesn't already have a system automation. Times are
// staggered 20 min apart starting at 09:00 so multiple accounts don't all
// hit Instagram simultaneously. Idempotent — safe to call repeatedly.
function ensureSystemAutomations(userId) {
  const acctRow = db.prepare('SELECT instagram_accounts, instagram_tz_offset_minutes FROM users WHERE id = ?').get(userId);
  let accounts = [];
  try { accounts = JSON.parse(acctRow?.instagram_accounts || '[]') || []; } catch (_) {}
  if (!accounts.length) return;
  // Use the user's remembered timezone offset (captured when they last
  // created/edited an automation in Monday). Defaults to 0/UTC if unknown —
  // the user can edit the time afterward.
  const userOffset = Number.isFinite(acctRow?.instagram_tz_offset_minutes)
    ? acctRow.instagram_tz_offset_minutes : 0;

  // Self-correct existing system automations whose stored offset is stale
  // (e.g. created before the user's timezone was known). Keep their
  // schedule_time but apply the correct offset and recompute next_run_at.
  if (Number.isFinite(acctRow?.instagram_tz_offset_minutes)) {
    const staleSystem = db.prepare(
      'SELECT * FROM instagram_automations WHERE user_id = ? AND is_system = 1 AND tz_offset_minutes != ?'
    ).all(userId, userOffset);
    for (const r of staleSystem) {
      const next = computeNextRunAt({ ...r, tz_offset_minutes: userOffset });
      db.prepare(
        'UPDATE instagram_automations SET tz_offset_minutes = ?, next_run_at = ? WHERE id = ?'
      ).run(userOffset, next, r.id);
    }
  }

  // Existing system automations keyed by the single account they cover.
  const existing = db.prepare(
    "SELECT id, accounts FROM instagram_automations WHERE user_id = ? AND is_system = 1"
  ).all(userId);
  const covered = new Set();
  for (const r of existing) {
    try {
      const accs = JSON.parse(r.accounts || '[]');
      if (accs.length === 1) covered.add(accs[0]);
    } catch (_) {}
  }

  let slot = 0;
  const cleanAccounts = [];
  for (const acct of accounts) {
    const a = String(acct).trim().replace(/^@/, '').toLowerCase();
    if (!a) continue;
    cleanAccounts.push(a);
    if (covered.has(a)) { slot++; continue; }
    // Stagger: 09:00, 09:20, 09:40, 10:00 …
    const baseMin = 9 * 60 + slot * 20;
    const hh = String(Math.floor(baseMin / 60) % 24).padStart(2, '0');
    const mm = String(baseMin % 60).padStart(2, '0');
    const auto = {
      schedule_type: 'daily',
      schedule_time: `${hh}:${mm}`,
      schedule_days: null,
      schedule_interval_minutes: null,
      tz_offset_minutes: userOffset,
    };
    const id = uuidv4();
    db.prepare(`
      INSERT INTO instagram_automations
        (id, user_id, name, schedule_type, schedule_time, schedule_days,
         schedule_interval_minutes, actions, accounts, enabled, is_system, tz_offset_minutes, next_run_at)
      VALUES (?, ?, ?, 'daily', ?, NULL, NULL, ?, ?, 1, 1, ?, ?)
    `).run(
      id, userId, `Daily follower count — @${a}`,
      `${hh}:${mm}`,
      JSON.stringify(['follower_count']),
      JSON.stringify([a]),
      userOffset,
      computeNextRunAt(auto)
    );
    slot++;
  }

  // ─── Multi-account daily notifications scan ─────────────────────────────────
  // One system row that sweeps every tracked account in turn. The extension's
  // runOneAutomation loops over the accounts array; each iteration auto-
  // switches Chrome and respects IG's 5-12min anti-flag cooldown internally.
  //
  // Important: we ONLY create this row the first time. After creation the
  // user owns it — they can edit the time, prune the accounts list, change
  // the name, etc. Those edits persist across page loads. Account add/remove
  // is handled in syncSystemScanAccounts() (called from /accounts routes),
  // which appends new accounts and drops removed ones without overwriting
  // the user's other choices.
  //
  // SAFETY (post-runaway): if multiple system rows exist (a previous bug
  // created duplicates), keep the oldest one and disable+delete the rest
  // BEFORE running the create check. Without this we'd just skip creation
  // and leave the dupes firing in parallel.
  const scanActionsJson = JSON.stringify(['scan_notifications']);
  const allScanRows = db.prepare(
    'SELECT id, created_at, enabled FROM instagram_automations WHERE user_id = ? AND is_system = 1 AND actions = ? ORDER BY created_at ASC'
  ).all(userId, scanActionsJson);
  if (allScanRows.length > 1) {
    // Keep [0] (oldest), nuke the rest.
    const keepId = allScanRows[0].id;
    for (const row of allScanRows.slice(1)) {
      db.prepare('DELETE FROM instagram_automations WHERE id = ?').run(row.id);
      console.warn(`[ensureSystemAutomations] removed duplicate scan_notifications row ${row.id} for user ${userId} (kept ${keepId})`);
    }
  }
  const scanRow = allScanRows[0] || null;
  if (cleanAccounts.length > 0 && !scanRow) {
    // First-time creation. Default schedule: daily 03:00, all accounts.
    const auto = {
      schedule_type: 'daily',
      schedule_time: '03:00',
      schedule_days: null,
      schedule_interval_minutes: null,
      tz_offset_minutes: userOffset,
    };
    db.prepare(`
      INSERT INTO instagram_automations
        (id, user_id, name, schedule_type, schedule_time, schedule_days,
         schedule_interval_minutes, actions, accounts, enabled, is_system, tz_offset_minutes, next_run_at)
      VALUES (?, ?, ?, 'daily', '03:00', NULL, NULL, ?, ?, 1, 1, ?, ?)
    `).run(
      uuidv4(), userId, 'Daily notifications scan',
      scanActionsJson, JSON.stringify(cleanAccounts), userOffset, computeNextRunAt(auto)
    );
  }
}

// Called from POST/DELETE /accounts endpoints to keep the scan_notifications
// system row's accounts list synced with the user's tracked accounts —
// without overwriting any other field they may have edited. Add a newly
// added account, drop a deleted one. If the row doesn't exist yet (user
// never had any accounts before), do nothing — ensureSystemAutomations
// will create it on the next /automations fetch.
function syncSystemScanAccounts(userId, { added = null, removed = null } = {}) {
  const scanActionsJson = JSON.stringify(['scan_notifications']);
  const row = db.prepare(
    'SELECT id, accounts FROM instagram_automations WHERE user_id = ? AND is_system = 1 AND actions = ? LIMIT 1'
  ).get(userId, scanActionsJson);
  if (!row) return;
  let list = [];
  try { list = JSON.parse(row.accounts || '[]'); } catch (_) {}
  const before = JSON.stringify(list);
  if (added) {
    const a = String(added).trim().replace(/^@/, '').toLowerCase();
    if (a && !list.includes(a)) list.push(a);
  }
  if (removed) {
    const r = String(removed).trim().replace(/^@/, '').toLowerCase();
    list = list.filter(x => x !== r);
  }
  const after = JSON.stringify(list);
  if (after !== before) {
    db.prepare('UPDATE instagram_automations SET accounts = ? WHERE id = ?').run(after, row.id);
  }
}

// Monday lists all automations for this user. We lazily backfill system
// automations here so existing users (who added accounts before this
// feature existed) get their per-account daily follower-count jobs.
router.get('/automations', authenticateFlexible, (req, res) => {
  const uid = targetUser(req);
  try { ensureSystemAutomations(uid); } catch (e) { console.warn('ensureSystemAutomations failed:', e.message); }
  const rows = db.prepare(`
    SELECT * FROM instagram_automations WHERE user_id = ?
    ORDER BY is_system ASC, created_at DESC LIMIT 200
  `).all(uid);
  res.json(rows.map(parseAutomationRow));
});

// Monday creates a new automation
router.post('/automations', authenticateFlexible, (req, res) => {
  const uid = targetUser(req);
  let fields;
  try { fields = sanitizeAutomationBody(req.body, false); }
  catch (e) { return res.status(400).json({ error: e.message }); }
  const tzOffset = fields.tz_offset_minutes || 0;
  // Remember this offset as the user's default so server-created system
  // automations (per-account follower scrapes) use the right timezone too.
  try { db.prepare('UPDATE users SET instagram_tz_offset_minutes = ? WHERE id = ?').run(tzOffset, uid); } catch (_) {}
  const id = uuidv4();
  const next = computeNextRunAt(fields);
  db.prepare(`
    INSERT INTO instagram_automations
      (id, user_id, name, schedule_type, schedule_time, schedule_days,
       schedule_interval_minutes, actions, accounts, enabled, tz_offset_minutes, next_run_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, uid, fields.name, fields.schedule_type,
    fields.schedule_time || null, fields.schedule_days || null,
    fields.schedule_interval_minutes || null,
    fields.actions, fields.accounts,
    fields.enabled === undefined ? 1 : fields.enabled,
    tzOffset,
    next
  );
  res.json(parseAutomationRow(db.prepare('SELECT * FROM instagram_automations WHERE id = ?').get(id)));
});

// Monday updates an existing automation
router.patch('/automations/:id', authenticateFlexible, (req, res) => {
  const uid = targetUser(req);
  let fields;
  try { fields = sanitizeAutomationBody(req.body, true); }
  catch (e) { return res.status(400).json({ error: e.message }); }
  const existing = db.prepare('SELECT * FROM instagram_automations WHERE id = ? AND user_id = ?').get(req.params.id, uid);
  if (!existing) return res.status(404).json({ error: 'not found' });

  // Remember the user's timezone offset for future system automations.
  if (fields.tz_offset_minutes !== undefined) {
    try { db.prepare('UPDATE users SET instagram_tz_offset_minutes = ? WHERE id = ?').run(fields.tz_offset_minutes, uid); } catch (_) {}
  }

  const cols = [];
  const params = [];
  for (const [k, v] of Object.entries(fields)) {
    cols.push(`${k} = ?`);
    params.push(v);
  }
  // If anything that affects scheduling changed (including the timezone
  // offset), recompute next_run_at.
  const scheduleChanged = ['schedule_type', 'schedule_time', 'schedule_days', 'schedule_interval_minutes', 'enabled', 'tz_offset_minutes']
    .some(k => k in fields);
  if (scheduleChanged) {
    const merged = { ...parseAutomationRow(existing), ...fields };
    const next = computeNextRunAt({
      schedule_type: merged.schedule_type,
      schedule_time: merged.schedule_time,
      schedule_days: merged.schedule_days,
      schedule_interval_minutes: merged.schedule_interval_minutes,
      tz_offset_minutes: merged.tz_offset_minutes,
    });
    cols.push('next_run_at = ?');
    params.push(next);
  }
  cols.push('updated_at = CURRENT_TIMESTAMP');
  params.push(req.params.id, uid);

  db.prepare(`UPDATE instagram_automations SET ${cols.join(', ')} WHERE id = ? AND user_id = ?`).run(...params);
  res.json(parseAutomationRow(db.prepare('SELECT * FROM instagram_automations WHERE id = ?').get(req.params.id)));
});

// Monday deletes an automation
router.delete('/automations/:id', authenticateFlexible, (req, res) => {
  const uid = targetUser(req);
  const row = db.prepare('SELECT is_system FROM instagram_automations WHERE id = ? AND user_id = ?').get(req.params.id, uid);
  if (!row) return res.status(404).json({ error: 'not found' });
  // System automations are tied to a tracked IG account — you remove them by
  // removing the account (Accounts tab), not by deleting the automation.
  // They can still be disabled or have their schedule edited.
  if (row.is_system) {
    return res.status(400).json({ error: 'This is a built-in per-account task. Disable it instead, or remove the Instagram account to delete it.' });
  }
  db.prepare('DELETE FROM instagram_automations WHERE id = ? AND user_id = ?').run(req.params.id, uid);
  res.json({ ok: true });
});

// Monday manually triggers a run. Sets next_run_at = now so the extension
// picks it up immediately on its next poll.
router.post('/automations/:id/run-now', authenticateFlexible, (req, res) => {
  const uid = targetUser(req);
  const row = db.prepare('SELECT * FROM instagram_automations WHERE id = ? AND user_id = ?').get(req.params.id, uid);
  if (!row) return res.status(404).json({ error: 'not found' });
  db.prepare(`
    UPDATE instagram_automations
    SET next_run_at = CURRENT_TIMESTAMP, enabled = 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(req.params.id);
  res.json({ ok: true });
});

// Extension polls this every minute and gets back the automations that are
// due AND enabled for this user. The extension then executes them.
router.get('/automations/due', authenticateFlexible, (req, res) => {
  const uid = req.user.id;
  const rows = db.prepare(`
    SELECT * FROM instagram_automations
    WHERE user_id = ?
      AND enabled = 1
      AND next_run_at IS NOT NULL
      AND datetime(next_run_at) <= datetime('now')
    ORDER BY next_run_at ASC
    LIMIT 20
  `).all(uid);
  res.json(rows.map(parseAutomationRow));
});

// Extension reports completion. We compute the new next_run_at and store
// run status so the UI can show health.
router.patch('/automations/:id/done', authenticateFlexible, (req, res) => {
  const uid = req.user.id;
  const row = db.prepare('SELECT * FROM instagram_automations WHERE id = ? AND user_id = ?').get(req.params.id, uid);
  if (!row) return res.status(404).json({ error: 'not found' });
  const status = String(req.body?.status || 'ok');
  const err = req.body?.error || null;
  const next = computeNextRunAt(row);
  db.prepare(`
    UPDATE instagram_automations
    SET last_run_at = CURRENT_TIMESTAMP,
        last_status = ?,
        last_error = ?,
        next_run_at = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(status, err, next, req.params.id);
  res.json({ ok: true });
});

// ── Server time / clock-drift helper ─────────────────────────────────────────
// Returns the server's authoritative ISO timestamp. The frontend uses this to
// detect drift between the user's local clock and the server (which is where
// automations are scheduled). Helps debug "why did the automation fire then?"
// surprises caused by misaligned clocks.
router.get('/server-time', authenticateFlexible, (req, res) => {
  const now = new Date();
  res.json({
    server_time: now.toISOString(),
    server_tz_offset_minutes: now.getTimezoneOffset(),
  });
});

// ── DM bot: per-account config + media library ───────────────────────────────
const DM_PROFILE = (q) => {
  const p = (q.my_profile || q.myProfile || '').toString().trim().replace(/^@/, '').toLowerCase();
  return p || '__default__';
};
const DM_CONFIG_DEFAULTS = { enabled: 1, tone: 'friendly', instructions: '', goal_link: '', goal_note: '', media_mode: 'auto' };

// Read a config for an account, falling back to the account's own row, then the
// '__default__' row, then built-in defaults.
function loadDmConfig(uid, profile) {
  const row = db.prepare('SELECT * FROM instagram_dm_bot_configs WHERE user_id = ? AND my_profile = ?').get(uid, profile)
    || (profile !== '__default__' ? db.prepare("SELECT * FROM instagram_dm_bot_configs WHERE user_id = ? AND my_profile = '__default__'").get(uid) : null);
  return { my_profile: profile, ...DM_CONFIG_DEFAULTS, ...(row || {}) };
}
function loadDmMedia(uid, profile) {
  const rows = db.prepare(`
    SELECT * FROM instagram_dm_bot_media WHERE user_id = ? AND my_profile IN (?, '__default__') ORDER BY created_at DESC
  `).all(uid, profile);
  return rows;
}
router.loadDmConfig = loadDmConfig;
router.loadDmMedia = loadDmMedia;

router.get('/dm-bot/config', authenticateFlexible, (req, res) => {
  const uid = targetUser(req);
  const profile = DM_PROFILE(req.query);
  res.json({
    config: loadDmConfig(uid, profile),
    media: loadDmMedia(uid, profile).map(m => ({
      id: m.id, my_profile: m.my_profile, kind: m.kind, caption: m.caption,
      when_to_send: m.when_to_send, size: m.size,
      url: `/api/instagram/dm-bot/media/${m.id}/file`,
    })),
    profiles: db.prepare('SELECT DISTINCT my_profile FROM instagram_actions WHERE user_id = ? AND my_profile IS NOT NULL ORDER BY my_profile').all(uid).map(r => r.my_profile),
  });
});

router.put('/dm-bot/config', authenticateFlexible, (req, res) => {
  const uid = targetUser(req);
  const b = req.body || {};
  const profile = DM_PROFILE(b);
  const cur = db.prepare('SELECT id FROM instagram_dm_bot_configs WHERE user_id = ? AND my_profile = ?').get(uid, profile);
  const vals = {
    enabled: b.enabled === false || b.enabled === 0 ? 0 : 1,
    tone: (b.tone || 'friendly').toString().slice(0, 40),
    instructions: (b.instructions || '').toString().slice(0, 4000),
    goal_link: (b.goal_link || '').toString().slice(0, 500),
    goal_note: (b.goal_note || '').toString().slice(0, 1000),
    media_mode: b.media_mode === 'off' ? 'off' : 'auto',
  };
  if (cur) {
    db.prepare(`UPDATE instagram_dm_bot_configs SET enabled=?, tone=?, instructions=?, goal_link=?, goal_note=?, media_mode=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(vals.enabled, vals.tone, vals.instructions, vals.goal_link, vals.goal_note, vals.media_mode, cur.id);
  } else {
    db.prepare(`INSERT INTO instagram_dm_bot_configs (id, user_id, my_profile, enabled, tone, instructions, goal_link, goal_note, media_mode) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(uuidv4(), uid, profile, vals.enabled, vals.tone, vals.instructions, vals.goal_link, vals.goal_note, vals.media_mode);
  }
  res.json({ ok: true, config: loadDmConfig(uid, profile) });
});

router.post('/dm-bot/media', authenticateFlexible, igUpload.single('media'), (req, res) => {
  const uid = req.user.id;
  const b = req.body || {};
  if (!req.file) return res.status(400).json({ error: 'media file required' });
  const profile = DM_PROFILE(b);
  const kind = (req.file.mimetype || '').startsWith('video') ? 'video' : 'image';
  const id = uuidv4();
  db.prepare(`INSERT INTO instagram_dm_bot_media (id, user_id, my_profile, kind, filename, mime, size, caption, when_to_send) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(id, uid, profile, kind, req.file.filename, req.file.mimetype, req.file.size, (b.caption || '').slice(0, 300), (b.when_to_send || '').slice(0, 500));
  res.json({ ok: true, id });
});

router.patch('/dm-bot/media/:id', authenticateFlexible, (req, res) => {
  const uid = req.user.id;
  const b = req.body || {};
  const r = db.prepare('UPDATE instagram_dm_bot_media SET caption = COALESCE(?, caption), when_to_send = COALESCE(?, when_to_send) WHERE id = ? AND user_id = ?')
    .run(b.caption != null ? String(b.caption).slice(0, 300) : null, b.when_to_send != null ? String(b.when_to_send).slice(0, 500) : null, req.params.id, uid);
  res.json({ ok: true, changed: r.changes });
});

router.delete('/dm-bot/media/:id', authenticateFlexible, (req, res) => {
  const uid = req.user.id;
  const row = db.prepare('SELECT filename FROM instagram_dm_bot_media WHERE id = ? AND user_id = ?').get(req.params.id, uid);
  if (row) { try { fs.unlinkSync(path.join(IG_UPLOADS_DIR, row.filename)); } catch (_) {} }
  const r = db.prepare('DELETE FROM instagram_dm_bot_media WHERE id = ? AND user_id = ?').run(req.params.id, uid);
  res.json({ ok: true, deleted: r.changes });
});

// Serve a media file (the extension fetches this to attach in the DM).
router.get('/dm-bot/media/:id/file', authenticateFlexible, (req, res) => {
  const uid = targetUser(req);
  const row = db.prepare('SELECT * FROM instagram_dm_bot_media WHERE id = ? AND user_id = ?').get(req.params.id, uid);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const fp = path.join(IG_UPLOADS_DIR, row.filename);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'File missing' });
  res.setHeader('Content-Type', row.mime || 'application/octet-stream');
  res.sendFile(fp);
});

module.exports = router;
