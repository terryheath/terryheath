#!/usr/bin/env node
/**
 * terryheath-digest.js — Monthly letter draft builder for terryheath.com
 *
 * Runs on the 1st of each month. Creates a draft post on terryheath.com
 * titled "Letter — [Month Year]" (the month just ended) tagged #letter-draft.
 * The draft body lists terryheath.com posts, the Inkhorn founder's letter, and
 * Inkhorn podcast episodes published during that month — plain titled links,
 * no styling — as raw notes for writing the monthly letter.
 *
 * Idempotent: if a #letter-draft post for that month already exists, exits 0.
 * Always creates the draft, even if all lists are empty.
 *
 * Required env:
 *   TH_GHOST_API_URL     terryheath.com Ghost API URL (PikaPods pod URL)
 *   TH_GHOST_ADMIN_KEY   terryheath.com Admin API key (id:hex)
 *
 * Optional env:
 *   INKHORN_API_URL      Inkhorn Ghost URL
 *   INKHORN_CONTENT_KEY  Inkhorn Content API key (read-only)
 *   DRY_RUN              1 to log without creating anything
 */

import GhostAdminAPI from '@tryghost/admin-api';

const TH_API_URL   = process.env.TH_GHOST_API_URL;
const TH_ADMIN_KEY = process.env.TH_GHOST_ADMIN_KEY;
const INKHORN_URL  = process.env.INKHORN_API_URL;
const INKHORN_KEY  = process.env.INKHORN_CONTENT_KEY;
const DRY_RUN      = process.env.DRY_RUN === '1';

if (!TH_API_URL || !TH_ADMIN_KEY) {
  console.error('TH_GHOST_API_URL and TH_GHOST_ADMIN_KEY are required');
  process.exit(1);
}

const api = new GhostAdminAPI({
  url:     TH_API_URL,
  key:     TH_ADMIN_KEY,
  version: 'v5.0',
});

// ── Month window ──────────────────────────────────────────────────────────────
// Previous calendar month in UTC. Called once so the boundaries are consistent
// across all queries in a single run.

function prevMonthWindow() {
  const now   = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const end   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(),     1));
  const label = start.toLocaleDateString('en-US', {
    month:    'long',
    year:     'numeric',
    timeZone: 'UTC',
  });
  return { start: start.toISOString(), end: end.toISOString(), label };
}

// ── Inkhorn Content API ───────────────────────────────────────────────────────
// Read-only. Returns posts with their canonical inkhornreview.com URLs.

async function fetchInkhornPosts(filter) {
  if (!INKHORN_URL || !INKHORN_KEY) return [];
  const params = new URLSearchParams({
    key:    INKHORN_KEY,
    filter,
    limit:  'all',
    order:  'published_at asc',
    fields: 'title,url',
  });
  try {
    const res = await fetch(`${INKHORN_URL}/ghost/api/content/posts/?${params}`);
    if (!res.ok) {
      console.warn(`Inkhorn Content API ${res.status}`);
      return [];
    }
    const data = await res.json();
    return data.posts || [];
  } catch (e) {
    console.warn(`Inkhorn Content API failed: ${e.message}`);
    return [];
  }
}

// ── Draft body ────────────────────────────────────────────────────────────────
// Plain titled links, no styling. Wrapped in an html card so Ghost renders it.

function buildBody(thPosts, letterPosts, podcastPosts) {
  const lines = ['<!--kg-card-begin: html-->', '<p><em>Raw notes — delete before sending</em></p>'];

  lines.push('<h3>terryheath.com</h3>');
  if (thPosts.length) {
    lines.push('<ul>');
    for (const p of thPosts) lines.push(`  <li><a href="${p.url}">${p.title}</a></li>`);
    lines.push('</ul>');
  } else {
    lines.push('<p>(none)</p>');
  }

  lines.push("<h3>Founder's Letter</h3>");
  if (letterPosts.length) {
    lines.push('<ul>');
    for (const p of letterPosts) lines.push(`  <li><a href="${p.url}">${p.title}</a></li>`);
    lines.push('</ul>');
  } else {
    lines.push('<p>(none)</p>');
  }

  lines.push('<h3>Life on Words</h3>');
  if (podcastPosts.length) {
    lines.push('<ul>');
    for (const p of podcastPosts) lines.push(`  <li><a href="${p.url}">${p.title}</a></li>`);
    lines.push('</ul>');
  } else {
    lines.push('<p>(none)</p>');
  }

  lines.push('<!--kg-card-end: html-->');
  return lines.join('\n');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const { start, end, label } = prevMonthWindow();
  const draftTitle = `Letter — ${label}`;

  console.log(`Month:  ${label}  (${start} → ${end})`);
  console.log(`Title:  "${draftTitle}"`);
  if (DRY_RUN) console.log('DRY_RUN — no changes will be made');

  // Idempotency check: is there already a #letter-draft for this month?
  const existing = await api.posts.browse({
    filter: 'tag:hash-letter-draft+status:draft',
    limit:  'all',
    fields: 'id,title',
  });
  const duplicate = existing.find(p => p.title === draftTitle);
  if (duplicate) {
    console.log(`Already exists (${duplicate.id}) — nothing to do.`);
    return;
  }

  // terryheath.com posts published in the previous month
  console.log('\nFetching terryheath.com posts …');
  const rawThPosts = await api.posts.browse({
    filter: `status:published+tag:-hash-letter-draft+published_at:>='${start}'+published_at:<'${end}'`,
    order:  'published_at asc',
    limit:  'all',
    fields: 'title,url',
  });
  const PREVIEW_URL_RE = /\/p\/[0-9a-f-]{36}\//;
  const thPosts = rawThPosts.filter(p => p.url && !PREVIEW_URL_RE.test(p.url));
  console.log(`  ${thPosts.length} post(s)`);
  thPosts.forEach(p => console.log(`    + ${p.title}`));

  // Inkhorn founder's letter posts in the previous month
  console.log("\nFetching Inkhorn founder's letter …");
  const letterPosts = await fetchInkhornPosts(
    `primary_tag:letter+status:published+published_at:>='${start}'+published_at:<'${end}'`
  );
  console.log(`  ${letterPosts.length} post(s)`);
  letterPosts.forEach(p => console.log(`    + ${p.title}`));

  // Inkhorn podcast episodes in the previous month
  console.log('\nFetching Inkhorn podcast episodes …');
  const podcastPosts = await fetchInkhornPosts(
    `primary_tag:podcast+status:published+published_at:>='${start}'+published_at:<'${end}'`
  );
  console.log(`  ${podcastPosts.length} episode(s)`);
  podcastPosts.forEach(p => console.log(`    + ${p.title}`));

  const html = buildBody(thPosts, letterPosts, podcastPosts);

  if (DRY_RUN) {
    console.log('\nDraft HTML:');
    console.log(html);
    return;
  }

  console.log('\nCreating draft …');
  const draft = await api.posts.add(
    { title: draftTitle, html, status: 'draft', tags: [{ name: '#letter-draft' }] },
    { source: 'html' }
  );

  console.log(`Created: ${draft.id} — "${draft.title}"`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
