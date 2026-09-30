#!/usr/bin/env node
// inkhorn/scripts/archive-report.js
// Lists every #archive post with title, contributor, primary_tag, free/paid,
// status, and published date. Output to terminal and CSV.
//
// Usage:
//   GHOST_API_URL=... GHOST_ADMIN_KEY=... node inkhorn/scripts/archive-report.js
//   GHOST_API_URL=... GHOST_ADMIN_KEY=... node inkhorn/scripts/archive-report.js --csv report.csv
//
// Credentials (macOS):
//   GHOST_API_URL=$(security find-generic-password -s "ghost-url-inkhorn" -w)
//   GHOST_ADMIN_KEY=$(security find-generic-password -s "ghost-admin-inkhorn" -w)

import GhostAdminAPI from '@tryghost/admin-api';
import { writeFileSync } from 'fs';

const GHOST_API_URL   = process.env.GHOST_API_URL;
const GHOST_ADMIN_KEY = process.env.GHOST_ADMIN_KEY;

if (!GHOST_API_URL || !GHOST_ADMIN_KEY) {
  console.error('GHOST_API_URL and GHOST_ADMIN_KEY are required');
  process.exit(1);
}

const csvArg = process.argv.indexOf('--csv');
const csvPath = csvArg !== -1 ? process.argv[csvArg + 1] : null;

const api = new GhostAdminAPI({
  url:     GHOST_API_URL,
  key:     GHOST_ADMIN_KEY,
  version: 'v5.0',
});

const SKIP = /^[a-z]+-\d{4}$|^(poetry|fiction|nonfiction|micro|podcast|art|letter)$/;

function contributorName(post) {
  // Contributor tag: non-issue, non-genre, non-internal tag
  if (!post.tags) return '';
  for (const t of post.tags) {
    if (t.slug.startsWith('hash-')) continue;
    if (SKIP.test(t.slug)) continue;
    return t.name || t.slug;
  }
  return '';
}

function genreLabel(post) {
  if (!post.tags) return '';
  const genres = ['poetry', 'fiction', 'nonfiction', 'micro', 'art', 'letter', 'podcast'];
  for (const t of post.tags) {
    if (genres.includes(t.slug)) return t.slug;
  }
  return '';
}

async function main() {
  console.log('Fetching #archive posts…');

  const posts = await api.posts.browse({
    filter:  'tag:hash-archive',
    include: 'tags',
    limit:   'all',
    order:   'published_at desc',
    fields:  'id,title,slug,status,visibility,published_at,primary_tag',
  });

  console.log(`Found ${posts.length} posts.\n`);

  const rows = posts.map(p => ({
    title:       p.title || '(untitled)',
    contributor: contributorName(p),
    issue:       p.primary_tag?.slug || '',
    genre:       genreLabel(p),
    access:      p.visibility === 'paid' ? 'Subscribers' : 'Free',
    status:      p.status,
    published:   p.published_at ? p.published_at.slice(0, 10) : '',
    url:         `https://inkhornreview.com/${p.primary_tag?.slug || 'post'}/${p.slug}/`,
  }));

  // Terminal output
  const colW = [42, 22, 16, 12, 12, 12, 12];
  const cols  = ['Title', 'Contributor', 'Issue', 'Genre', 'Access', 'Status', 'Published'];
  const pad = (s, w) => String(s).slice(0, w).padEnd(w);
  console.log(cols.map((c, i) => pad(c, colW[i])).join('  '));
  console.log(colW.map(w => '-'.repeat(w)).join('  '));
  for (const r of rows) {
    console.log([
      pad(r.title, colW[0]),
      pad(r.contributor, colW[1]),
      pad(r.issue, colW[2]),
      pad(r.genre, colW[3]),
      pad(r.access, colW[4]),
      pad(r.status, colW[5]),
      pad(r.published, colW[6]),
    ].join('  '));
  }

  console.log(`\nTotal: ${rows.length}`);
  console.log(`  Free:        ${rows.filter(r => r.access === 'Free').length}`);
  console.log(`  Subscribers: ${rows.filter(r => r.access === 'Subscribers').length}`);
  console.log(`  Published:   ${rows.filter(r => r.status === 'published').length}`);
  console.log(`  Scheduled:   ${rows.filter(r => r.status === 'scheduled').length}`);
  console.log(`  Draft:       ${rows.filter(r => r.status === 'draft').length}`);

  if (csvPath) {
    const header = 'title,contributor,issue,genre,access,status,published,url';
    const csvRows = rows.map(r =>
      [r.title, r.contributor, r.issue, r.genre, r.access, r.status, r.published, r.url]
        .map(v => `"${String(v).replace(/"/g, '""')}"`)
        .join(',')
    );
    writeFileSync(csvPath, [header, ...csvRows].join('\n') + '\n');
    console.log(`\nCSV written to ${csvPath}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
