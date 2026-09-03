#!/usr/bin/env node
/**
 * Reschedule all Ghost scheduled posts to one-minute intervals starting from
 * a given date/time.
 *
 * Usage:
 *   node inkhorn/reschedule.js <date> [time]
 *
 * Examples:
 *   node inkhorn/reschedule.js 2026-09-08
 *   node inkhorn/reschedule.js 2026-09-08 00:00
 *   node inkhorn/reschedule.js 2026-09-08 07:00
 *
 * Time is interpreted as UTC. Posts are sorted by their current published_at
 * order and rescheduled one minute apart from the start time.
 *
 * Credentials are read from macOS Keychain (set up via CLAUDE.md).
 */

const GhostAdminAPI = require('@tryghost/admin-api');
const { execSync } = require('child_process');

function getKey(service) {
  try {
    return execSync(`security find-generic-password -s "${service}" -w`, { stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
  } catch {
    console.error(`Keychain entry not found: ${service}`);
    process.exit(1);
  }
}

const [,, dateArg, timeArg = '00:00'] = process.argv;

if (!dateArg) {
  console.error('Usage: node inkhorn/reschedule.js <YYYY-MM-DD> [HH:MM]');
  console.error('Example: node inkhorn/reschedule.js 2026-09-08 00:00');
  process.exit(1);
}

const startISO = `${dateArg}T${timeArg}:00.000Z`;
const start = new Date(startISO);
if (isNaN(start.getTime())) {
  console.error(`Invalid date/time: ${startISO}`);
  process.exit(1);
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

  posts.sort((a, b) => new Date(a.published_at) - new Date(b.published_at));

  console.log(`Rescheduling ${posts.length} post(s) from ${startISO}, one minute apart:\n`);

  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];
    const newTime = new Date(start.getTime() + i * 60 * 1000).toISOString();
    await api.posts.edit({ id: post.id, published_at: newTime, updated_at: post.updated_at });
    console.log(`  ${String(i + 1).padStart(2)}  ${newTime}  ${post.title}`);
  }

  console.log('\nDone.');
}

main().catch(e => {
  console.error(e.message || e);
  process.exit(1);
});
