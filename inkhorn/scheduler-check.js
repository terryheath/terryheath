#!/usr/bin/env node
// inkhorn/scheduler-check.js — alerts if Ghost scheduler has not published overdue posts.
// Exits 0 if no overdue posts; exits 1 if any are found (Railway will log as failure).
//
// Required env:
//   GHOST_API_URL    Ghost instance URL
//   GHOST_ADMIN_KEY  Admin API key (kid:hex format)

import { createHmac } from 'crypto';

const url      = process.env.GHOST_API_URL;
const adminKey = process.env.GHOST_ADMIN_KEY;

if (!url || !adminKey) {
  console.error('GHOST_API_URL and GHOST_ADMIN_KEY are required');
  process.exit(1);
}

const [kid, hex] = adminKey.split(':');
const now = Math.floor(Date.now() / 1000);
const h = Buffer.from(JSON.stringify({ alg: 'HS256', kid, typ: 'JWT' })).toString('base64url');
const p = Buffer.from(JSON.stringify({ iat: now, exp: now + 300, aud: '/admin/' })).toString('base64url');
const s = createHmac('sha256', Buffer.from(hex, 'hex')).update(h + '.' + p).digest('base64url');
const token = h + '.' + p + '.' + s;

fetch(url + '/ghost/api/admin/posts/?filter=status:scheduled&fields=id,title,published_at&limit=all', {
  headers: { Authorization: 'Ghost ' + token },
})
  .then(r => {
    if (!r.ok) throw new Error('API returned ' + r.status);
    return r.json();
  })
  .then(data => {
    const nowMs   = Date.now();
    const overdue = (data.posts || []).filter(p => new Date(p.published_at).getTime() < nowMs);
    if (!overdue.length) process.exit(0);

    console.error('STUCK SCHEDULED POSTS — Ghost scheduler did not publish:');
    for (const post of overdue) {
      const ms    = nowMs - new Date(post.published_at).getTime();
      const label = ms < 3_600_000
        ? Math.round(ms / 60_000) + 'm overdue'
        : (ms / 3_600_000).toFixed(1) + 'h overdue';
      console.error('  ' + post.title + ' (' + label + ', was due ' + post.published_at + ')');
    }
    process.exit(1);
  })
  .catch(err => {
    console.error('Check failed:', err.message);
    process.exit(1);
  });
