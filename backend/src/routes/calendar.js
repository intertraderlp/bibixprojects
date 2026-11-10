const express = require('express');
const { google } = require('googleapis');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'monday-secret-key-change-in-prod';
const APP_URL    = process.env.APP_URL || 'http://localhost:3000';

// ── DB setup ─────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS calendar_connections (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    expires_at TEXT,
    calendar_email TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

// ── Google helpers ────────────────────────────────────────────────────────────
function makeOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

async function getGoogleClient(conn) {
  const auth = makeOAuth2Client();
  auth.setCredentials({
    access_token:  conn.access_token,
    refresh_token: conn.refresh_token,
    expiry_date:   conn.expires_at ? new Date(conn.expires_at).getTime() : null,
  });
  auth.on('tokens', (tokens) => {
    db.prepare('UPDATE calendar_connections SET access_token=?, expires_at=? WHERE id=?')
      .run(tokens.access_token, tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null, conn.id);
  });
  return auth;
}

// ── Microsoft helpers ─────────────────────────────────────────────────────────
const MS_SCOPES = ['Calendars.ReadWrite', 'User.Read', 'offline_access'];

function getMsAuthUrl(state) {
  const clientId    = process.env.MS_CLIENT_ID;
  const redirectUri = encodeURIComponent(process.env.MS_REDIRECT_URI || 'http://localhost:3001/api/calendar/microsoft/callback');
  const scope       = encodeURIComponent(MS_SCOPES.join(' '));
  return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${clientId}&response_type=code&redirect_uri=${redirectUri}&scope=${scope}&response_mode=query&state=${state}`;
}

async function getMsTokens(code) {
  const fetch = require('node-fetch');
  const params = new URLSearchParams({
    client_id:     process.env.MS_CLIENT_ID,
    client_secret: process.env.MS_CLIENT_SECRET,
    code,
    redirect_uri:  process.env.MS_REDIRECT_URI || 'http://localhost:3001/api/calendar/microsoft/callback',
    grant_type:    'authorization_code',
  });
  const res  = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', { method: 'POST', body: params });
  return res.json();
}

async function refreshMsToken(conn) {
  const fetch = require('node-fetch');
  const params = new URLSearchParams({
    client_id:     process.env.MS_CLIENT_ID,
    client_secret: process.env.MS_CLIENT_SECRET,
    refresh_token: conn.refresh_token,
    grant_type:    'refresh_token',
    scope:         MS_SCOPES.join(' '),
  });
  const res  = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', { method: 'POST', body: params });
  const data = await res.json();
  if (data.access_token) {
    const expires = new Date(Date.now() + data.expires_in * 1000).toISOString();
    db.prepare('UPDATE calendar_connections SET access_token=?, refresh_token=?, expires_at=? WHERE id=?')
      .run(data.access_token, data.refresh_token || conn.refresh_token, expires, conn.id);
    return data.access_token;
  }
  throw new Error('Failed to refresh Microsoft token');
}

async function msGraphRequest(conn, path, method = 'GET', body = null) {
  const fetch  = require('node-fetch');
  let token    = conn.access_token;

  // Refresh if expired
  if (conn.expires_at && new Date(conn.expires_at) < new Date()) {
    token = await refreshMsToken(conn);
  }

  const opts = { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, opts);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error?.message || 'Microsoft Graph error');
  }
  if (method === 'DELETE') return null;
  return res.json();
}

// ── Status ────────────────────────────────────────────────────────────────────
router.get('/status', authenticate, (req, res) => {
  const conns = db.prepare('SELECT id, provider, calendar_email, created_at FROM calendar_connections WHERE user_id = ? ORDER BY created_at').all(req.user.id);
  const google    = conns.filter(c => c.provider === 'google');
  const microsoft = conns.filter(c => c.provider === 'microsoft');
  res.json({ google, microsoft });
});

// ── Google: initiate OAuth ────────────────────────────────────────────────────
router.get('/google/auth', authenticate, (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID) return res.status(503).json({ error: 'Google Calendar not configured' });
  const auth  = makeOAuth2Client();
  const state = jwt.sign({ userId: req.user.id }, JWT_SECRET, { expiresIn: '10m' });
  const url   = auth.generateAuthUrl({
    access_type: 'offline', prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/userinfo.email'],
    state,
  });
  res.json({ url });
});

// ── Google: OAuth callback ────────────────────────────────────────────────────
router.get('/google/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.redirect(`${APP_URL}/settings?calendar=error&msg=${error}`);

  let userId;
  try { userId = jwt.verify(state, JWT_SECRET).userId; }
  catch { return res.redirect(`${APP_URL}/settings?calendar=error&msg=invalid_state`); }

  try {
    const auth = makeOAuth2Client();
    const { tokens } = await auth.getToken(code);
    auth.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: 'v2', auth });
    const { data: profile } = await oauth2.userinfo.get();

    // Check if this Google account already connected for this user
    const existing = db.prepare("SELECT id FROM calendar_connections WHERE user_id=? AND provider='google' AND calendar_email=?").get(userId, profile.email);
    if (existing) {
      db.prepare('UPDATE calendar_connections SET access_token=?, refresh_token=?, expires_at=? WHERE id=?')
        .run(tokens.access_token, tokens.refresh_token || null, tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null, existing.id);
    } else {
      db.prepare('INSERT INTO calendar_connections (id,user_id,provider,access_token,refresh_token,expires_at,calendar_email) VALUES (?,?,?,?,?,?,?)')
        .run(uuidv4(), userId, 'google', tokens.access_token, tokens.refresh_token || null, tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null, profile.email);
    }
    res.redirect(`${APP_URL}/settings?calendar=connected`);
  } catch (err) {
    console.error('[Calendar] Google callback error:', err.message);
    res.redirect(`${APP_URL}/settings?calendar=error&msg=token_exchange_failed`);
  }
});

// ── Microsoft: initiate OAuth ─────────────────────────────────────────────────
router.get('/microsoft/auth', authenticate, (req, res) => {
  if (!process.env.MS_CLIENT_ID) return res.status(503).json({ error: 'Microsoft Calendar not configured' });
  const state = jwt.sign({ userId: req.user.id }, JWT_SECRET, { expiresIn: '10m' });
  res.json({ url: getMsAuthUrl(state) });
});

// ── Microsoft: OAuth callback ─────────────────────────────────────────────────
router.get('/microsoft/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.redirect(`${APP_URL}/settings?calendar=error&msg=${error}`);

  let userId;
  try { userId = jwt.verify(state, JWT_SECRET).userId; }
  catch { return res.redirect(`${APP_URL}/settings?calendar=error&msg=invalid_state`); }

  try {
    const tokens = await getMsTokens(code);
    if (tokens.error) throw new Error(tokens.error_description);

    // Get Microsoft profile
    const fetch   = require('node-fetch');
    const profRes = await fetch('https://graph.microsoft.com/v1.0/me', { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    const profile = await profRes.json();
    const email   = profile.mail || profile.userPrincipalName;
    const expires = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    const existing = db.prepare("SELECT id FROM calendar_connections WHERE user_id=? AND provider='microsoft' AND calendar_email=?").get(userId, email);
    if (existing) {
      db.prepare('UPDATE calendar_connections SET access_token=?, refresh_token=?, expires_at=? WHERE id=?')
        .run(tokens.access_token, tokens.refresh_token || null, expires, existing.id);
    } else {
      db.prepare('INSERT INTO calendar_connections (id,user_id,provider,access_token,refresh_token,expires_at,calendar_email) VALUES (?,?,?,?,?,?,?)')
        .run(uuidv4(), userId, 'microsoft', tokens.access_token, tokens.refresh_token || null, expires, email);
    }
    res.redirect(`${APP_URL}/settings?calendar=connected`);
  } catch (err) {
    console.error('[Calendar] Microsoft callback error:', err.message);
    res.redirect(`${APP_URL}/settings?calendar=error&msg=${encodeURIComponent(err.message)}`);
  }
});

// ── All user's board tasks that have a date value ─────────────────────────────
router.get('/board-tasks', authenticate, (req, res) => {
  const { start, end } = req.query; // YYYY-MM-DD strings
  try {
    const tasks = db.prepare(`
      SELECT
        i.id, i.name, i.board_id, i.group_id,
        b.name as board_name, b.icon as board_icon,
        iv.value as date_value
      FROM item_values iv
      JOIN board_columns c ON iv.column_id = c.id AND c.type = 'date'
      JOIN items i ON iv.item_id = i.id AND i.parent_item_id IS NULL
      JOIN groups g ON i.group_id = g.id
      JOIN boards b ON g.board_id = b.id
      WHERE (
        b.workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = ?)
        OR b.id IN (SELECT board_id FROM board_members WHERE user_id = ?)
      )
      AND iv.value IS NOT NULL AND iv.value != ''
      AND substr(iv.value, 1, 10) >= ? AND substr(iv.value, 1, 10) <= ?
      ORDER BY iv.value ASC
    `).all(req.user.id, req.user.id, start, end);
    res.json(tasks);
  } catch (err) {
    console.error('[Calendar] board-tasks error:', err.message);
    res.json([]);
  }
});

// ── Fetch events from ALL connected calendars ─────────────────────────────────
router.get('/events', authenticate, async (req, res) => {
  const { start, end } = req.query;
  const conns  = db.prepare('SELECT * FROM calendar_connections WHERE user_id=?').all(req.user.id);
  const events = [];

  await Promise.all(conns.map(async (conn) => {
    try {
      if (conn.provider === 'google') {
        const auth = await getGoogleClient(conn);
        const cal  = google.calendar({ version: 'v3', auth });
        const { data } = await cal.events.list({ calendarId: 'primary', timeMin: start, timeMax: end, singleEvents: true, orderBy: 'startTime', maxResults: 100 });
        (data.items || []).forEach(ev => events.push({ ...ev, _provider: 'google', _accountEmail: conn.calendar_email, _connId: conn.id }));
      } else if (conn.provider === 'microsoft') {
        const startEncoded = encodeURIComponent(start);
        const endEncoded   = encodeURIComponent(end);
        const data = await msGraphRequest(conn, `/me/calendarView?startDateTime=${startEncoded}&endDateTime=${endEncoded}&$top=100&$select=id,subject,start,end,location,bodyPreview,webLink,isAllDay`);
        (data.value || []).forEach(ev => events.push({
          id:      ev.id,
          summary: ev.subject,
          start:   { dateTime: ev.isAllDay ? undefined : ev.start.dateTime, date: ev.isAllDay ? ev.start.dateTime?.split('T')[0] : undefined },
          end:     { dateTime: ev.isAllDay ? undefined : ev.end.dateTime,   date: ev.isAllDay ? ev.end.dateTime?.split('T')[0] : undefined },
          location: ev.location?.displayName,
          description: ev.bodyPreview,
          htmlLink: ev.webLink,
          _provider: 'microsoft', _accountEmail: conn.calendar_email, _connId: conn.id,
        }));
      }
    } catch (err) { console.error(`[Calendar] fetch error (${conn.provider}/${conn.calendar_email}):`, err.message); }
  }));

  events.sort((a, b) => {
    const ta = a.start?.dateTime || a.start?.date || '';
    const tb = b.start?.dateTime || b.start?.date || '';
    return ta.localeCompare(tb);
  });

  res.json(events);
});

// ── Create event (provider specified or first available) ──────────────────────
router.post('/events', authenticate, async (req, res) => {
  const { title, start, end, location, description, attendees, allDay, connId } = req.body;

  const conn = connId
    ? db.prepare('SELECT * FROM calendar_connections WHERE id=? AND user_id=?').get(connId, req.user.id)
    : db.prepare('SELECT * FROM calendar_connections WHERE user_id=? LIMIT 1').get(req.user.id);

  if (!conn) return res.status(400).json({ error: 'No calendar connected' });

  try {
    if (conn.provider === 'google') {
      const auth = await getGoogleClient(conn);
      const cal  = google.calendar({ version: 'v3', auth });
      const tz   = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const event = {
        summary: title, location, description,
        start: allDay ? { date: start.split('T')[0] } : { dateTime: start, timeZone: tz },
        end:   allDay ? { date: end.split('T')[0]   } : { dateTime: end,   timeZone: tz },
        attendees: attendees?.length ? attendees.map(e => ({ email: e })) : undefined,
        reminders: { useDefault: true },
      };
      const { data } = await cal.events.insert({ calendarId: 'primary', resource: event, sendUpdates: attendees?.length ? 'all' : 'none' });
      res.json(data);
    } else if (conn.provider === 'microsoft') {
      const body = {
        subject: title,
        location: location ? { displayName: location } : undefined,
        body: description ? { contentType: 'text', content: description } : undefined,
        start: { dateTime: start, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
        end:   { dateTime: end,   timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
        isAllDay: allDay || false,
        attendees: attendees?.length ? attendees.map(e => ({ emailAddress: { address: e }, type: 'required' })) : undefined,
      };
      const data = await msGraphRequest(conn, '/me/events', 'POST', body);
      res.json(data);
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Delete event ──────────────────────────────────────────────────────────────
router.delete('/events/:connId/:eventId', authenticate, async (req, res) => {
  const conn = db.prepare('SELECT * FROM calendar_connections WHERE id=? AND user_id=?').get(req.params.connId, req.user.id);
  if (!conn) return res.status(404).json({ error: 'Connection not found' });
  try {
    if (conn.provider === 'google') {
      const auth = await getGoogleClient(conn);
      const cal  = google.calendar({ version: 'v3', auth });
      await cal.events.delete({ calendarId: 'primary', eventId: req.params.eventId });
    } else {
      await msGraphRequest(conn, `/me/events/${req.params.eventId}`, 'DELETE');
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Disconnect single account ─────────────────────────────────────────────────
router.delete('/disconnect/:connId', authenticate, (req, res) => {
  db.prepare('DELETE FROM calendar_connections WHERE id=? AND user_id=?').run(req.params.connId, req.user.id);
  res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════════════════
// Bibix meetings — native events with per-meeting visibility + sharing.
//   visibility 'details' → shared people see the full meeting
//   visibility 'busy'    → shared people only see a "Busy" block (no details)
//   internal audience    → Bibix users / groups (meeting_shares)
//   external audience     → a per-user public availability link (busy only)
// ════════════════════════════════════════════════════════════════════════════
const crypto = require('crypto');
const { shareTargets, userGroupIds, listShares } = require('../utils/sharing');

db.exec(`CREATE TABLE IF NOT EXISTS meetings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  location TEXT,
  start TEXT NOT NULL,
  end TEXT NOT NULL,
  all_day INTEGER NOT NULL DEFAULT 0,
  visibility TEXT NOT NULL DEFAULT 'details',
  external_conn_id TEXT,
  external_event_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);
db.exec(`CREATE TABLE IF NOT EXISTS meeting_shares (
  id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  access TEXT NOT NULL DEFAULT 'view',
  created_by TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(meeting_id, subject_type, subject_id)
)`);
try { db.exec('ALTER TABLE users ADD COLUMN availability_token TEXT'); } catch (_) {}

function toDbBool(v) { return v ? 1 : 0; }

// Mirror a Bibix meeting onto a connected external calendar; returns its event id.
async function createOnProvider(conn, { title, start, end, location, description, attendees, allDay }) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (conn.provider === 'google') {
    const auth = await getGoogleClient(conn);
    const cal  = google.calendar({ version: 'v3', auth });
    const event = {
      summary: title, location, description,
      start: allDay ? { date: start.split('T')[0] } : { dateTime: start, timeZone: tz },
      end:   allDay ? { date: end.split('T')[0]   } : { dateTime: end,   timeZone: tz },
      attendees: attendees?.length ? attendees.map(e => ({ email: e })) : undefined,
      reminders: { useDefault: true },
    };
    const { data } = await cal.events.insert({ calendarId: 'primary', resource: event, sendUpdates: attendees?.length ? 'all' : 'none' });
    return data.id;
  }
  if (conn.provider === 'microsoft') {
    const body = {
      subject: title,
      location: location ? { displayName: location } : undefined,
      body: description ? { contentType: 'text', content: description } : undefined,
      start: { dateTime: start, timeZone: tz },
      end:   { dateTime: end,   timeZone: tz },
      isAllDay: allDay || false,
      attendees: attendees?.length ? attendees.map(e => ({ emailAddress: { address: e }, type: 'required' })) : undefined,
    };
    const data = await msGraphRequest(conn, '/me/events', 'POST', body);
    return data.id;
  }
  return null;
}

async function updateOnProvider(conn, eventId, { title, start, end, location, description, allDay }) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (conn.provider === 'google') {
    const auth = await getGoogleClient(conn);
    const cal  = google.calendar({ version: 'v3', auth });
    await cal.events.patch({ calendarId: 'primary', eventId, resource: {
      summary: title, location, description,
      start: allDay ? { date: (start || '').split('T')[0] } : { dateTime: start, timeZone: tz },
      end:   allDay ? { date: (end   || '').split('T')[0] } : { dateTime: end,   timeZone: tz },
    } });
  } else if (conn.provider === 'microsoft') {
    await msGraphRequest(conn, `/me/events/${eventId}`, 'PATCH', {
      subject: title,
      location: location ? { displayName: location } : undefined,
      body: description ? { contentType: 'text', content: description } : undefined,
      start: { dateTime: start, timeZone: tz },
      end:   { dateTime: end,   timeZone: tz },
      isAllDay: !!allDay,
    });
  }
}

async function deleteOnProvider(conn, eventId) {
  if (conn.provider === 'google') {
    const auth = await getGoogleClient(conn);
    await google.calendar({ version: 'v3', auth }).events.delete({ calendarId: 'primary', eventId });
  } else if (conn.provider === 'microsoft') {
    await msGraphRequest(conn, `/me/events/${eventId}`, 'DELETE');
  }
}

function meetingIdsSharedWith(userId) {
  const gids = userGroupIds(userId);
  let sql = `SELECT meeting_id FROM meeting_shares WHERE (subject_type='user' AND subject_id=?)`;
  const params = [userId];
  if (gids.length) { sql += ` OR (subject_type='group' AND subject_id IN (${gids.map(() => '?').join(',')}))`; params.push(...gids); }
  return db.prepare(sql).all(...params).map(r => r.meeting_id);
}

function replaceMeetingShares(meetingId, shares, createdBy) {
  db.prepare('DELETE FROM meeting_shares WHERE meeting_id=?').run(meetingId);
  for (const s of (shares || [])) {
    if (!s || (s.subject_type !== 'user' && s.subject_type !== 'group') || !s.subject_id) continue;
    try {
      db.prepare('INSERT OR IGNORE INTO meeting_shares (id, meeting_id, subject_type, subject_id, access, created_by) VALUES (?,?,?,?,?,?)')
        .run(uuidv4(), meetingId, s.subject_type, s.subject_id, 'view', createdBy);
    } catch (_) {}
  }
}

function mapMeeting(m, { mine, strip, owner_name }) {
  const busy = !!strip;
  return {
    id: m.id,
    _kind: 'meeting',
    _mine: !!mine,
    _shared: !mine,
    _busy: busy,
    _visibility: m.visibility,
    owner_name: owner_name || null,
    title: busy ? 'Busy' : m.title,
    description: busy ? null : m.description,
    location: busy ? null : m.location,
    all_day: !!m.all_day,
    start: m.start,
    end: m.end,
    shares: mine ? listShares('meeting_shares', 'meeting_id', m.id) : undefined,
    external_conn_id: mine ? m.external_conn_id : undefined,
  };
}

// Users + groups available to share a meeting with.
router.get('/meetings/share-targets', authenticate, (req, res) => {
  res.json(shareTargets(req.user.id));
});

// List meetings in a range: owned (full) + shared-to-me ('busy' stripped of detail).
router.get('/meetings', authenticate, (req, res) => {
  const rangeStart = req.query.start || '0000';
  const rangeEnd   = req.query.end   || '9999';
  const out = [];

  const owned = db.prepare('SELECT * FROM meetings WHERE user_id=? AND start <= ? AND end >= ?')
    .all(req.user.id, rangeEnd, rangeStart);
  owned.forEach(m => out.push(mapMeeting(m, { mine: true, strip: false })));

  const sharedIds = meetingIdsSharedWith(req.user.id);
  if (sharedIds.length) {
    const ph  = sharedIds.map(() => '?').join(',');
    const rows = db.prepare(`SELECT m.*, u.name AS owner_name FROM meetings m JOIN users u ON u.id=m.user_id WHERE m.id IN (${ph}) AND m.start <= ? AND m.end >= ? AND m.user_id != ?`)
      .all(...sharedIds, rangeEnd, rangeStart, req.user.id);
    rows.forEach(m => out.push(mapMeeting(m, { mine: false, strip: m.visibility === 'busy', owner_name: m.owner_name })));
  }
  res.json(out);
});

// Create a Bibix meeting (optionally mirrored to an external calendar).
router.post('/meetings', authenticate, async (req, res) => {
  const { title, description, location, start, end, allDay, visibility, shares, externalConnId, attendees } = req.body;
  if (!title || !start || !end) return res.status(400).json({ error: 'title, start and end are required' });
  const vis = visibility === 'busy' ? 'busy' : 'details';
  const id = uuidv4();
  let externalEventId = null, externalWarning = null;

  if (externalConnId) {
    const conn = db.prepare('SELECT * FROM calendar_connections WHERE id=? AND user_id=?').get(externalConnId, req.user.id);
    if (conn) {
      try { externalEventId = await createOnProvider(conn, { title, start, end, location, description, attendees, allDay }); }
      catch (e) { externalWarning = `Saved in Bibix, but adding to ${conn.provider} failed: ${e.message}`; }
    }
  }

  db.prepare(`INSERT INTO meetings (id,user_id,title,description,location,start,end,all_day,visibility,external_conn_id,external_event_id)
              VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, req.user.id, title, description || null, location || null, start, end, toDbBool(allDay), vis, externalConnId || null, externalEventId);
  replaceMeetingShares(id, shares, req.user.id);

  const m = db.prepare('SELECT * FROM meetings WHERE id=?').get(id);
  res.json({ ...mapMeeting(m, { mine: true, strip: false }), externalWarning });
});

// Update an owned meeting (and best-effort its external mirror).
router.put('/meetings/:id', authenticate, async (req, res) => {
  const m = db.prepare('SELECT * FROM meetings WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!m) return res.status(404).json({ error: 'Meeting not found' });
  const { title, description, location, start, end, allDay, visibility, shares } = req.body;
  const vis = visibility === 'busy' ? 'busy' : (visibility === 'details' ? 'details' : m.visibility);
  const newAllDay = allDay === undefined ? m.all_day : toDbBool(allDay);

  db.prepare(`UPDATE meetings SET title=COALESCE(?,title), description=?, location=?, start=COALESCE(?,start), end=COALESCE(?,end), all_day=?, visibility=? WHERE id=?`)
    .run(title ?? null, description ?? null, location ?? null, start ?? null, end ?? null, newAllDay, vis, m.id);
  if (shares !== undefined) replaceMeetingShares(m.id, shares, req.user.id);

  if (m.external_conn_id && m.external_event_id) {
    const conn = db.prepare('SELECT * FROM calendar_connections WHERE id=? AND user_id=?').get(m.external_conn_id, req.user.id);
    if (conn) { try { await updateOnProvider(conn, m.external_event_id, { title: title ?? m.title, start: start ?? m.start, end: end ?? m.end, location: location ?? m.location, description: description ?? m.description, allDay: !!newAllDay }); } catch (_) {} }
  }
  const updated = db.prepare('SELECT * FROM meetings WHERE id=?').get(m.id);
  res.json(mapMeeting(updated, { mine: true, strip: false }));
});

// Delete an owned meeting (and its external mirror).
router.delete('/meetings/:id', authenticate, async (req, res) => {
  const m = db.prepare('SELECT * FROM meetings WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!m) return res.status(404).json({ error: 'Meeting not found' });
  if (m.external_conn_id && m.external_event_id) {
    const conn = db.prepare('SELECT * FROM calendar_connections WHERE id=? AND user_id=?').get(m.external_conn_id, req.user.id);
    if (conn) { try { await deleteOnProvider(conn, m.external_event_id); } catch (_) {} }
  }
  db.prepare('DELETE FROM meeting_shares WHERE meeting_id=?').run(m.id);
  db.prepare('DELETE FROM meetings WHERE id=?').run(m.id);
  res.json({ success: true });
});

// ── External availability link (public busy view) ─────────────────────────────
function ensureAvailabilityToken(userId) {
  const u = db.prepare('SELECT availability_token FROM users WHERE id=?').get(userId);
  if (u && u.availability_token) return u.availability_token;
  const token = crypto.randomBytes(16).toString('hex');
  db.prepare('UPDATE users SET availability_token=? WHERE id=?').run(token, userId);
  return token;
}

router.get('/availability-link', authenticate, (req, res) => {
  const token = ensureAvailabilityToken(req.user.id);
  res.json({ token, url: `${APP_URL}/availability/${token}` });
});

router.post('/availability-link/regenerate', authenticate, (req, res) => {
  const token = crypto.randomBytes(16).toString('hex');
  db.prepare('UPDATE users SET availability_token=? WHERE id=?').run(token, req.user.id);
  res.json({ token, url: `${APP_URL}/availability/${token}` });
});

// Public: anyone with the link sees busy blocks only (no titles/details).
router.get('/public/availability/:token', async (req, res) => {
  const { start, end } = req.query;
  const user = db.prepare('SELECT id, name FROM users WHERE availability_token=?').get(req.params.token);
  if (!user) return res.status(404).json({ error: 'Not found' });
  const rangeStart = start || '0000', rangeEnd = end || '9999';
  const busy = [];

  db.prepare('SELECT start, end, all_day FROM meetings WHERE user_id=? AND start <= ? AND end >= ?')
    .all(user.id, rangeEnd, rangeStart)
    .forEach(m => busy.push({ start: m.start, end: m.end, allDay: !!m.all_day }));

  if (start && end) {
    try {
      const conns = db.prepare('SELECT * FROM calendar_connections WHERE user_id=?').all(user.id);
      await Promise.all(conns.map(async (conn) => {
        try {
          if (conn.provider === 'google') {
            const auth = await getGoogleClient(conn);
            const cal  = google.calendar({ version: 'v3', auth });
            const { data } = await cal.events.list({ calendarId: 'primary', timeMin: start, timeMax: end, singleEvents: true, orderBy: 'startTime', maxResults: 100 });
            (data.items || []).forEach(ev => busy.push({ start: ev.start?.dateTime || ev.start?.date, end: ev.end?.dateTime || ev.end?.date, allDay: !ev.start?.dateTime }));
          } else if (conn.provider === 'microsoft') {
            const data = await msGraphRequest(conn, `/me/calendarView?startDateTime=${encodeURIComponent(start)}&endDateTime=${encodeURIComponent(end)}&$top=100&$select=start,end,isAllDay`);
            (data.value || []).forEach(ev => busy.push({ start: ev.start?.dateTime, end: ev.end?.dateTime, allDay: ev.isAllDay }));
          }
        } catch (_) {}
      }));
    } catch (_) {}
  }

  busy.sort((a, b) => (a.start || '').localeCompare(b.start || ''));
  res.json({ name: user.name, busy });
});

module.exports = router;
