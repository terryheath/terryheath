'use strict';

const crypto = require('crypto');
const cfg = require('./config');
const { db, logEvent } = require('./db');

if (!cfg.linkSecret) throw new Error('LINK_SECRET is required');

const DAY = 24 * 60 * 60 * 1000;

// A link is  <id>.<signature>  where id is random and the signature is an HMAC of the id,
// so the database holds no secret that could be used to build a link, and a link can still
// be re-sent unchanged.
function sign(id) {
  return crypto.createHmac('sha256', cfg.linkSecret).update('dl:' + id).digest('base64url').slice(0, 22);
}

function newId() {
  return crypto.randomBytes(16).toString('base64url');
}

function urlFor(id) {
  return `${cfg.downloadBaseUrl}/d/${id}.${sign(id)}`;
}

// Returns the link id for a valid token string, else null.
function parseToken(token) {
  const m = /^([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{22})$/.exec(token || '');
  if (!m) return null;
  const expected = Buffer.from(sign(m[1]));
  const given = Buffer.from(m[2]);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given) ? m[1] : null;
}

function getLink(id) {
  return db.prepare('SELECT * FROM links WHERE id = ?').get(id) || null;
}

function downloadsUsed(id) {
  return db.prepare('SELECT COUNT(*) AS n FROM downloads WHERE link_id = ?').get(id).n;
}

// 'ok' | 'pending' | 'revoked' | 'expired' | 'used_up' | 'unknown'
function state(link, now = new Date()) {
  if (!link) return 'unknown';
  if (link.status === 'revoked') return 'revoked';
  if (link.status === 'pending') return 'pending';
  if (new Date(link.expires_at) <= now) return 'expired';
  if (downloadsUsed(link.id) >= link.max_downloads) return 'used_up';
  return 'ok';
}

function createLink({ sessionId, lineIndex, original = 1, productId, sku, title, fileKey, releaseAt, active }) {
  const id = newId();
  const now = new Date();
  const status = active ? 'active' : 'pending';
  const info = db.prepare(`
    INSERT INTO links (id, session_id, line_index, original, product_id, sku, title, file_key, status,
                       release_at, issued_at, expires_at, max_downloads, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT DO NOTHING
  `).run(
    id, sessionId, lineIndex, original, productId, sku, title, fileKey || null, status,
    releaseAt ? releaseAt.toISOString() : null,
    active ? now.toISOString() : null,
    active ? new Date(now.getTime() + cfg.linkDays * DAY).toISOString() : null,
    cfg.maxDownloads, now.toISOString(),
  );
  if (info.changes === 0) return null; // already recorded (repeat webhook)
  logEvent(active ? 'link_issued' : 'link_pending', { sessionId, linkId: id, detail: sku });
  return id;
}

function activate(id) {
  const now = new Date();
  db.prepare(`UPDATE links SET status = 'active', issued_at = ?, expires_at = ? WHERE id = ? AND status = 'pending'`)
    .run(now.toISOString(), new Date(now.getTime() + cfg.linkDays * DAY).toISOString(), id);
  const link = getLink(id);
  logEvent('link_issued', { sessionId: link.session_id, linkId: id, detail: 'released' });
}

function revoke(id, replacedBy = null) {
  db.prepare(`UPDATE links SET status = 'revoked', revoked_at = ?, replaced_by = ? WHERE id = ?`)
    .run(new Date().toISOString(), replacedBy, id);
  const link = getLink(id);
  logEvent(replacedBy ? 'link_reissued' : 'link_revoked', { sessionId: link.session_id, linkId: id, detail: replacedBy });
}

// Start a download: claims one of the allowed downloads atomically.
// Returns the downloads row id, or null if the link is no longer usable.
function claimDownload(id, { ipHash, userAgent }) {
  const now = new Date().toISOString();
  const info = db.prepare(`
    INSERT INTO downloads (link_id, at, ip_hash, user_agent)
    SELECT l.id, ?, ?, ?
      FROM links l
     WHERE l.id = ? AND l.status = 'active' AND l.expires_at > ?
       AND (SELECT COUNT(*) FROM downloads d WHERE d.link_id = l.id) < l.max_downloads
  `).run(now, ipHash, userAgent, id, now);
  return info.changes ? Number(info.lastInsertRowid) : null;
}

function completeDownload(rowId) {
  db.prepare('UPDATE downloads SET completed_at = ? WHERE id = ?').run(new Date().toISOString(), rowId);
}

// File could not be read: give the download back.
function releaseDownload(rowId) {
  db.prepare('DELETE FROM downloads WHERE id = ?').run(rowId);
}

module.exports = {
  urlFor, parseToken, getLink, state, downloadsUsed, createLink, activate, revoke,
  claimDownload, completeDownload, releaseDownload, DAY,
};
