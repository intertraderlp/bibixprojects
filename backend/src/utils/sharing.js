// Shared helpers for sharing a resource (invoice / agreement) with users & groups.
// A "share" row: { id, <resource>_id, subject_type:'user'|'group', subject_id, access:'view'|'edit' }.
const db = require('../db/database');

// Group ids a user belongs to.
function userGroupIds(userId) {
  try {
    return db.prepare('SELECT group_id FROM user_group_members WHERE user_id = ?').all(userId).map(r => r.group_id);
  } catch { return []; }
}

// Effective access ('edit' | 'view' | null) a user has on one resource via shares.
// table/idCol are hardcoded by callers (never user input).
function accessFor(table, idCol, resourceId, userId) {
  const gids = userGroupIds(userId);
  let sql = `SELECT access FROM ${table} WHERE ${idCol} = ? AND (subject_type = 'user' AND subject_id = ?`;
  const params = [resourceId, userId];
  if (gids.length) {
    sql += ` OR subject_type = 'group' AND subject_id IN (${gids.map(() => '?').join(',')})`;
    params.push(...gids);
  }
  sql += ')';
  const rows = db.prepare(sql).all(...params);
  if (!rows.length) return null;
  return rows.some(r => r.access === 'edit') ? 'edit' : 'view';
}

// Map of resourceId -> 'edit'|'view' for every resource shared with this user.
function sharedAccessMap(table, idCol, userId) {
  const gids = userGroupIds(userId);
  const rows = db.prepare(`SELECT ${idCol} AS rid, access FROM ${table} WHERE subject_type = 'user' AND subject_id = ?`).all(userId);
  if (gids.length) {
    rows.push(...db.prepare(`SELECT ${idCol} AS rid, access FROM ${table} WHERE subject_type = 'group' AND subject_id IN (${gids.map(() => '?').join(',')})`).all(...gids));
  }
  const map = new Map();
  for (const r of rows) {
    if (map.get(r.rid) === 'edit') continue;
    map.set(r.rid, r.access === 'edit' ? 'edit' : (map.get(r.rid) || 'view'));
  }
  return map;
}

// List shares for one resource with the subject's display name resolved.
function listShares(table, idCol, resourceId) {
  const rows = db.prepare(`SELECT * FROM ${table} WHERE ${idCol} = ? ORDER BY created_at`).all(resourceId);
  return rows.map(r => {
    let subject_name = '', subject_email = null;
    if (r.subject_type === 'user') {
      const u = db.prepare('SELECT name, email FROM users WHERE id = ?').get(r.subject_id);
      subject_name = u ? u.name : 'Unknown user';
      subject_email = u ? u.email : null;
    } else {
      const g = db.prepare('SELECT name FROM user_groups WHERE id = ?').get(r.subject_id);
      subject_name = g ? g.name : 'Unknown group';
    }
    return { ...r, subject_name, subject_email };
  });
}

// Users (excluding self) and groups available to share with.
function shareTargets(excludeUserId) {
  let users = [], groups = [];
  try { users = db.prepare('SELECT id, name, email FROM users WHERE id != ? ORDER BY name').all(excludeUserId); } catch { /* */ }
  try { groups = db.prepare('SELECT id, name FROM user_groups ORDER BY name').all(); } catch { /* */ }
  return { users, groups };
}

module.exports = { userGroupIds, accessFor, sharedAccessMap, listShares, shareTargets };
