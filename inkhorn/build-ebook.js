#!/usr/bin/env node
/**
 * Build a Vellum-ready .docx from an Inkhorn Review Ghost issue.
 * Uses the Ghost ADMIN API so it works on scheduled (pre-release) posts.
 *
 * Usage:
 *   INKHORN_ADMIN_API_KEY=$(security find-generic-password -s "ghost-admin-inkhorn" -w) \
 *     node inkhorn/build-ebook.js <issue-slug> [--by-genre] [--status=published,scheduled]
 *
 * Examples:
 *   node inkhorn/build-ebook.js september-2026
 *   node inkhorn/build-ebook.js september-2026 --by-genre
 *   node inkhorn/build-ebook.js september-2026 --status=published
 *
 * Output (gitignored):
 *   inkhorn/build/<issue-slug>.docx  — import into Vellum
 *   inkhorn/build/<issue-slug>.html  — intermediate; check poem line breaks
 *
 * Requires: pandoc (brew install pandoc)
 * Key:      macOS Keychain, service "ghost-admin-inkhorn"  (id:secret format)
 */

'use strict';

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const { execSync } = require('child_process');

// ── Args ──────────────────────────────────────────────────────────────────────

const rawArgs  = process.argv.slice(2);
const flags    = rawArgs.filter(a => a.startsWith('--'));
const posArgs  = rawArgs.filter(a => !a.startsWith('--'));
const slug     = posArgs[0];
const byGenre  = flags.includes('--by-genre');
const statusFlag = (flags.find(f => f.startsWith('--status=')) || '--status=published,scheduled')
  .replace('--status=', '');

if (!slug) {
  console.error('Usage: INKHORN_ADMIN_API_KEY=... node inkhorn/build-ebook.js <issue-slug> [--by-genre] [--status=published,scheduled]');
  console.error('');
  console.error('  INKHORN_ADMIN_API_KEY=$(security find-generic-password -s "ghost-admin-inkhorn" -w) \\');
  console.error('    node inkhorn/build-ebook.js september-2026');
  process.exit(1);
}

// ── Credentials & JWT ─────────────────────────────────────────────────────────

const ADMIN_KEY = process.env.INKHORN_ADMIN_API_KEY;
if (!ADMIN_KEY || !ADMIN_KEY.includes(':')) {
  console.error('INKHORN_ADMIN_API_KEY is not set or is not in id:secret format.');
  console.error('  export INKHORN_ADMIN_API_KEY=$(security find-generic-password -s "ghost-admin-inkhorn" -w)');
  process.exit(1);
}

function getKeychain(service) {
  try {
    return execSync(`security find-generic-password -s "${service}" -w`, {
      stdio: ['pipe', 'pipe', 'pipe'],
    }).toString().trim();
  } catch {
    console.error(`Keychain entry not found: ${service}`);
    process.exit(1);
  }
}

const GHOST_URL = getKeychain('ghost-url-inkhorn').replace(/\/$/, '');

/**
 * Create a short-lived JWT for the Ghost Admin API.
 * Ghost expects: header.kid = key id, payload.aud = '/admin/'
 * Secret is a hex string that must be decoded to raw bytes before signing.
 */
function makeJWT(adminKey) {
  const [id, hexSecret] = adminKey.split(':');
  const header  = Buffer.from(JSON.stringify({ alg: 'HS256', kid: id, typ: 'JWT' })).toString('base64url');
  const now     = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ iat: now, exp: now + 300, aud: '/admin/' })).toString('base64url');
  const sigKey  = Buffer.from(hexSecret, 'hex');
  const sig     = crypto.createHmac('sha256', sigKey).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

function adminHeaders() {
  return { Authorization: `Ghost ${makeJWT(ADMIN_KEY)}` };
}

// ── Admin API fetches ─────────────────────────────────────────────────────────

async function fetchTag(tagSlug) {
  const url = `${GHOST_URL}/ghost/api/admin/tags/slug/${encodeURIComponent(tagSlug)}/`;
  const res = await fetch(url, { headers: adminHeaders() });
  if (!res.ok) throw new Error(`Failed to fetch tag "${tagSlug}": HTTP ${res.status}`);
  const data = await res.json();
  if (!data.tags || !data.tags[0]) throw new Error(`Tag not found: ${tagSlug}`);
  return data.tags[0];
}

async function fetchPosts(tagSlug, statuses) {
  const statusFilter = statuses.length === 1
    ? `status:${statuses[0]}`
    : `status:[${statuses.join(',')}]`;
  const params = new URLSearchParams({
    filter:  `tag:${tagSlug}+${statusFilter}`,
    include: 'tags',
    order:   'published_at asc',
    limit:   'all',
    formats: 'html',
  });
  const url = `${GHOST_URL}/ghost/api/admin/posts/?${params}`;
  const res = await fetch(url, { headers: adminHeaders() });
  if (!res.ok) throw new Error(`Failed to fetch posts: HTTP ${res.status}`);
  const data = await res.json();
  return data.posts || [];
}

// ── HTML builder ──────────────────────────────────────────────────────────────

const GENRE_SLUGS = new Set(['poetry', 'fiction', 'nonfiction']);
const GENRE_ORDER = ['Poetry', 'Fiction', 'Nonfiction'];

/** Escape plain text for HTML. Never call on post.html — it's already HTML. */
function esc(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pageBreak() {
  return '<div style="page-break-after: always;"></div>';
}

function genreOf(post) {
  const tag = (post.tags || []).find(t => GENRE_SLUGS.has(t.slug));
  if (!tag) return 'Other';
  return tag.name.charAt(0).toUpperCase() + tag.name.slice(1);
}

function groupByGenre(posts) {
  const groups = new Map(GENRE_ORDER.map(g => [g, []]));
  for (const post of posts) {
    const g = genreOf(post);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(post);
  }
  for (const [k, v] of groups) if (v.length === 0) groups.delete(k);
  return groups;
}

function contentsBlock(posts, byGenre) {
  const lines = ['<p><strong>Contents</strong></p>', '<p>'];
  if (byGenre) {
    for (const [genre, gPosts] of groupByGenre(posts)) {
      lines.push(`<strong>${esc(genre)}</strong><br>`);
      for (const p of gPosts) {
        const bl = p.custom_excerpt ? ` \u2014 ${esc(p.custom_excerpt)}` : '';
        lines.push(`${esc(p.title)}${bl}<br>`);
      }
    }
  } else {
    for (const p of posts) {
      const bl = p.custom_excerpt ? ` \u2014 ${esc(p.custom_excerpt)}` : '';
      lines.push(`${esc(p.title)}${bl}<br>`);
    }
  }
  lines.push('</p>');
  return lines.join('\n');
}

/**
 * Render one piece.
 * post.html is Ghost-rendered HTML — inserted raw to preserve <br> tags.
 */
function pieceBlock(post, headingLevel) {
  const h = `h${headingLevel}`;
  const parts = [`<${h}>${esc(post.title)}</${h}>`];
  if (post.custom_excerpt) parts.push(`<p>${esc(post.custom_excerpt)}</p>`);
  parts.push(post.html || '');
  return parts.join('\n');
}

function buildHTML(tag, posts, byGenre) {
  const out = [];

  out.push(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${esc(tag.name)}</title>
</head>
<body>`);

  out.push(`<h1>${esc(tag.name)}</h1>`);
  if (tag.description) out.push(`<p>${esc(tag.description)}</p>`);
  out.push(contentsBlock(posts, byGenre));
  out.push(pageBreak());

  if (byGenre) {
    for (const [genre, gPosts] of groupByGenre(posts)) {
      out.push(`<h1>${esc(genre)}</h1>`);
      for (const p of gPosts) {
        out.push(pieceBlock(p, 2));
        out.push(pageBreak());
      }
    }
  } else {
    for (const p of posts) {
      out.push(pieceBlock(p, 1));
      out.push(pageBreak());
    }
  }

  out.push('</body>\n</html>');
  return out.join('\n\n');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const statuses = statusFlag.split(',').map(s => s.trim()).filter(Boolean);
  console.log(`Building ebook: ${slug}${byGenre ? '  (by genre)' : ''}  [status: ${statuses.join(', ')}]\n`);

  const [tag, posts] = await Promise.all([fetchTag(slug), fetchPosts(slug, statuses)]);

  console.log(`Issue:  ${tag.name}`);
  console.log(`Posts:  ${posts.length}\n`);

  const scheduledCount = posts.filter(p => p.status === 'scheduled').length;
  if (scheduledCount > 0) {
    console.log(`⚠  ${scheduledCount} post(s) are still scheduled (not yet published) — this is a pre-release build.\n`);
  }

  posts.forEach((p, i) => {
    const status = p.status === 'scheduled' ? ' [scheduled]' : '';
    console.log(`  ${String(i + 1).padStart(2)}  [${genreOf(p).padEnd(10)}]  ${p.title}${status}`);
  });
  console.log('');

  const html = buildHTML(tag, posts, byGenre);

  const buildDir = path.join(__dirname, 'build');
  fs.mkdirSync(buildDir, { recursive: true });

  const htmlOut = path.join(buildDir, `${slug}.html`);
  const docxOut = path.join(buildDir, `${slug}.docx`);

  fs.writeFileSync(htmlOut, html, 'utf8');
  console.log(`HTML → ${htmlOut}`);

  try {
    execSync(`pandoc "${htmlOut}" -o "${docxOut}" --from=html --to=docx`, { stdio: 'inherit' });
  } catch {
    console.error('\npandoc failed. Install with: brew install pandoc');
    process.exit(1);
  }

  console.log(`DOCX → ${docxOut}`);
  console.log('\nDone.');
}

main().catch(e => {
  console.error(e.message || e);
  process.exit(1);
});
