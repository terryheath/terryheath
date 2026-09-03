#!/usr/bin/env node
/**
 * Reschedule all Ghost scheduled posts to one-minute intervals starting from
 * a given date/time.
 *
 * Usage:
 *   node inkhorn/reschedule.js <date> [time] [order-file]
 *
 * Examples:
 *   node inkhorn/reschedule.js 2026-09-08
 *   node inkhorn/reschedule.js 2026-09-08 00:00
 *   node inkhorn/reschedule.js 2026-09-08 00:00 inkhorn/september-2026.txt
 *
 * Time is UTC. Ghost displays posts newest-first, so the order file lists
 * posts top-to-bottom as they should appear on the issue page. The script
 * assigns times in reverse so the first entry in the file gets the latest
 * publish time and appears at the top.
 *
 * Without an order file, posts are sorted by their current published_at,
 * preserving the existing display order.
 *
 * Order file format: one post title per line, case-insensitive.
 * Lines starting with # are treated as comments and ignored.
 * Posts not listed in the order file are appended at the end (bottom of page).
 *
 * Credentials are read from macOS Keychain (set up via CLAUDE.md).
 */

const GhostAdminAPI = require('@tryghost/admin-api');
const { execSync } = require('child_process');
const fs = require('fs');

function getKey(service) {
  try {
    return execSync(`security find-generic-password -s "${service}" -w`, { stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
  } catch {
    console.error(`Keychain entry not found: ${service}`);
    process.exit(1);
  }
}

const [,, dateArg, timeArg = '00:00', orderFile] = process.argv;

if (!dateArg) {
  console.error('Usage: node inkhorn/reschedule.js <YYYY-MM-DD> [HH:MM] [order-file]');
  console.error('Example: node inkhorn/reschedule.js 2026-09-08 00:00');
  console.error('Example: node inkhorn/reschedule.js 2026-09-08 00:00 inkhorn/september-2026.txt');
  process.exit(1);
}

const startISO = `${dateArg}T${timeArg}:00.000Z`;
const start = new Date(startISO);
if (isNaN(start.getTime())) {
  console.error(`Invalid date/time: ${startISO}`);
  process.exit(1);
}

let orderedTitles = null;
if (orderFile) {
  if (!fs.existsSync(orderFile)) {
    console.error(`Order file not found: ${orderFile}`);
    process.exit(1);
  }
  orderedTitles = fs.readFileSync(orderFile, 'utf8')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .map(l => l.toLowerCase());
  console.log(`Order file: ${orderFile} (${orderedTitles.length} entries)\n`);
}

const key = getKey('ghost-admin-inkhorn');
const url = getKey('ghost-url-inkhorn');
const api = new GhostAdminAPI({ url, key, version: 'v5.0' });

async function main() {
  const posts = await api.posts.browse({
    filter: 'status:scheduled',
    limit: 'all',
    fields: 'id,title,published_at,updated_at',
  });

  if (posts.length === 0) {
    console.log('No scheduled posts found.');
    return;
  }

  // Build display order (top of page first)
  let displayOrder;
  if (orderedTitles) {
    const listed = [];
    const unlisted = [];
    for (const post of posts) {
      const idx = orderedTitles.indexOf(post.title.toLowerCase());
      if (idx !== -1) {
        listed.push({ post, idx });
      } else {
        unlisted.push(post);
      }
    }
    listed.sort((a, b) => a.idx - b.idx);
    unlisted.sort((a, b) => new Date(b.published_at) - new Date(a.published_at));

    if (unlisted.length > 0) {
      console.log(`Note: ${unlisted.length} post(s) not in order file — appended at bottom of page:\n  ${unlisted.map(p => p.post.title).join('\n  ')}\n`);
    }
    const unmatched = orderedTitles.filter(t => !posts.some(p => p.title.toLowerCase() === t));
    if (unmatched.length > 0) {
      console.log(`Warning: ${unmatched.length} order file entry(s) didn't match any scheduled post:\n  ${unmatched.join('\n  ')}\n`);
    }

    displayOrder = [...listed.map(l => l.post), ...unlisted];
  } else {
    // No order file: sort by current published_at descending to preserve display order
    displayOrder = [...posts].sort((a, b) => new Date(b.published_at) - new Date(a.published_at));
  }

  // Ghost shows newest first, so assign times in reverse:
  // displayOrder[0] (top of page) → latest time slot
  // displayOrder[n-1] (bottom of page) → start time (00:00)
  const n = displayOrder.length;
  console.log(`Rescheduling ${n} post(s) from ${startISO}, one minute apart:\n`);
  console.log('  Page order  Publish time (UTC)');

  for (let i = 0; i < n; i++) {
    const post = displayOrder[i];
    const slot = n - 1 - i; // reverse: top of page gets highest slot
    const newTime = new Date(start.getTime() + slot * 60 * 1000).toISOString();
    await api.posts.edit({ id: post.id, published_at: newTime, updated_at: post.updated_at });
    console.log(`  ${String(i + 1).padStart(2)} (top→btm)  ${newTime}  ${post.title}`);
  }

  console.log('\nDone.');
}

main().catch(e => {
  console.error(e.message || e);
  process.exit(1);
});
