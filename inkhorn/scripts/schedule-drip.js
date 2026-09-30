#!/usr/bin/env node
// inkhorn/scripts/schedule-drip.js
// Schedules the weekly drip for an issue.
//
// Usage:
//   node inkhorn/scripts/schedule-drip.js --issue <tag> --start <YYYY-MM-DD> --time <HH:MM>
// Example:
//   node inkhorn/scripts/schedule-drip.js --issue winter-2027 --start 2027-01-07 --time 09:00
//
// --start/--time are Pacific time. The script converts to UTC for Ghost.
// Reads the slug order from inkhorn/drip/<issue-tag>.txt (one slug per line).
// Sets each post: visibility=paid, tags +#archive +#this-week, schedules one week apart.
// NO newsletter is attached (Ghost 6.61 email segmenter bug — drip is site-only).
//
// Credentials (macOS):
//   GHOST_API_URL=$(security find-generic-password -s "ghost-url-inkhorn" -w)
//   GHOST_ADMIN_KEY=$(security find-generic-password -s "ghost-admin-inkhorn" -w)

import GhostAdminAPI from '@tryghost/admin-api';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const GHOST_API_URL   = process.env.GHOST_API_URL;
const GHOST_ADMIN_KEY = process.env.GHOST_ADMIN_KEY;

if (!GHOST_API_URL || !GHOST_ADMIN_KEY) {
  console.error('GHOST_API_URL and GHOST_ADMIN_KEY are required');
  process.exit(1);
}

function arg(name) {
  const i = process.argv.indexOf('--' + name);
  return i !== -1 ? process.argv[i + 1] : null;
}

const issueTag = arg('issue');
const startDate = arg('start');
const startTime = arg('time');

if (!issueTag || !startDate || !startTime) {
  console.error('Usage: schedule-drip.js --issue <tag> --start <YYYY-MM-DD> --time <HH:MM>');
  process.exit(1);
}

if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
  console.error('--start must be YYYY-MM-DD');
  process.exit(1);
}
if (!/^\d{2}:\d{2}$/.test(startTime)) {
  console.error('--time must be HH:MM (24h)');
  process.exit(1);
}

// Convert Pacific date+time to UTC ISO string.
// Handles PST (UTC-8) and PDT (UTC-7) correctly using Intl.
function pacificToUtc(dateStr, timeStr) {
  // Parse as Pacific time by creating a date string with timezone abbreviation
  // and using the offset from Intl for that instant.
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [h, mi] = timeStr.split(':').map(Number);

  // Construct a Date as if it were UTC, then find the Pacific offset at that moment.
  const naiveUtc = new Date(Date.UTC(y, mo - 1, d, h, mi));
  const pacificFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    timeZoneName: 'shortOffset',
  });
  const parts = pacificFormatter.formatToParts(naiveUtc);
  const offsetStr = parts.find(p => p.type === 'timeZoneName')?.value || 'GMT-8';
  const m = offsetStr.match(/GMT([+-])(\d+)/);
  const offsetHours = m ? (m[1] === '+' ? parseInt(m[2]) : -parseInt(m[2])) : -8;

  return new Date(naiveUtc.getTime() - offsetHours * 3600000).toISOString();
}

const dripFile = resolve(__dirname, '..', 'drip', `${issueTag}.txt`);
if (!existsSync(dripFile)) {
  console.error(`Drip file not found: ${dripFile}`);
  console.error(`Create inkhorn/drip/${issueTag}.txt with one post slug per line in contents order.`);
  process.exit(1);
}

const slugs = readFileSync(dripFile, 'utf8')
  .split('\n')
  .map(l => l.trim())
  .filter(Boolean);

if (!slugs.length) {
  console.error(`Drip file is empty: ${dripFile}`);
  process.exit(1);
}

const api = new GhostAdminAPI({
  url:     GHOST_API_URL,
  key:     GHOST_ADMIN_KEY,
  version: 'v5.0',
});

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

async function main() {
  console.log(`Issue: ${issueTag}`);
  console.log(`Drip file: ${dripFile}`);
  console.log(`Slugs: ${slugs.length}`);
  console.log();

  // Fetch each post by slug and verify it exists as a draft
  const posts = [];
  for (const slug of slugs) {
    let post;
    try {
      post = await api.posts.read({ slug }, { include: 'tags' });
    } catch {
      console.error(`Post not found or not a draft: slug "${slug}"`);
      process.exit(1);
    }
    if (post.status !== 'draft') {
      console.error(`Post "${slug}" is not a draft (status: ${post.status}). Stopping.`);
      process.exit(1);
    }
    posts.push(post);
    console.log(`  OK  "${post.title}" (${slug})`);
  }

  console.log('\nSchedule:');
  let scheduleTime = new Date(pacificToUtc(startDate, startTime));

  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];
    const publishedAt = new Date(scheduleTime.getTime() + i * ONE_WEEK_MS).toISOString();

    // Build updated tag list: add #archive and #this-week, keep existing tags
    const existingTagNames = (post.tags || []).map(t => ({ name: t.name }));
    const tagNames = [
      ...existingTagNames,
      { name: '#archive' },
      { name: '#this-week' },
    ];
    // Deduplicate by name
    const seen = new Set();
    const dedupedTags = tagNames.filter(t => {
      if (seen.has(t.name)) return false;
      seen.add(t.name);
      return true;
    });

    const dateLabel = new Date(publishedAt).toLocaleDateString('en-US', {
      timeZone: 'America/Los_Angeles',
      month: 'short', day: 'numeric', year: 'numeric',
    });
    console.log(`  ${String(i + 1).padStart(2)}. ${dateLabel.padEnd(20)} "${post.title}"`);

    await api.posts.edit({
      id:           post.id,
      status:       'scheduled',
      published_at: publishedAt,
      visibility:   'paid',
      tags:         dedupedTags,
      updated_at:   post.updated_at,
    });
  }

  console.log('\nDone. All posts scheduled.');
  console.log('Reminder: verify in Ghost Admin that no newsletter is attached to any of these posts.');
}

main().catch(err => { console.error(err); process.exit(1); });
